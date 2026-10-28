use tauri::command;

/// macOS: net.daringfireball.markdown is the UTI declared in Info.plist for
/// our .md/.markdown document type; com.fusionsoft.mdjoa is our bundle id
/// (tauri.conf.json `identifier`) — both must match what's actually shipped.
#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};

    // ponytail: LSSetDefaultRoleHandlerForContentType is deprecated but still
    // functional on current macOS; swap to NSWorkspace.setDefaultApplication
    // (needs objc2-app-kit) if Apple removes it in a future release.
    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSSetDefaultRoleHandlerForContentType(
            in_content_type: CFStringRef,
            in_role_mask: u32,
            in_handler_bundle_id: CFStringRef,
        ) -> i32;
    }

    const LS_ROLES_ALL: u32 = 0xFFFF_FFFF;

    extern "C" {
        fn LSCopyDefaultRoleHandlerForContentType(
            in_content_type: CFStringRef,
            in_role: u32,
        ) -> CFStringRef;
    }

    const LS_ROLES_VIEWER: u32 = 0x0000_0002;

    /// None = lookup failed (includes no handler → the caller falls back to the safe side).
    pub fn is_default() -> Option<bool> {
        let content_type = CFString::new("net.daringfireball.markdown");
        let handler = unsafe {
            LSCopyDefaultRoleHandlerForContentType(content_type.as_concrete_TypeRef(), LS_ROLES_VIEWER)
        };
        if handler.is_null() {
            return Some(false);
        }
        let handler = unsafe { CFString::wrap_under_create_rule(handler) };
        Some(handler.to_string().eq_ignore_ascii_case("com.fusionsoft.mdjoa"))
    }

    pub fn set_default() -> Result<(), String> {
        let content_type = CFString::new("net.daringfireball.markdown");
        let bundle_id = CFString::new("com.fusionsoft.mdjoa");
        let status = unsafe {
            LSSetDefaultRoleHandlerForContentType(
                content_type.as_concrete_TypeRef(),
                LS_ROLES_ALL,
                bundle_id.as_concrete_TypeRef(),
            )
        };
        if status == 0 {
            Ok(())
        } else {
            Err(format!("LSSetDefaultRoleHandlerForContentType OSStatus {status}"))
        }
    }
}

/// Checks whether mdjoa is currently the default app for .md (decides whether to show the top notice bar).
/// A failed lookup is treated as "is the default" so a wrong notice never appears.
#[command]
pub async fn is_default_markdown_app() -> bool {
    tauri::async_runtime::spawn_blocking(is_default_impl)
        .await
        .unwrap_or(true)
}

#[cfg(target_os = "macos")]
fn is_default_impl() -> bool {
    macos::is_default().unwrap_or(true)
}

/// Windows: the user's choice (UserChoice) → else the default ProgId under HKCR\.md → mdjoa is
/// the default app if that ProgId's shell\open\command contains the current executable name.
#[cfg(target_os = "windows")]
fn is_default_impl() -> bool {
    windows::is_default().unwrap_or(true)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn is_default_impl() -> bool {
    true
}

#[cfg(target_os = "windows")]
mod windows {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    /// Extracts the first REG_SZ value from `reg query <key> [/v name | /ve]` output.
    fn reg_value(key: &str, value_arg: &[&str]) -> Option<String> {
        // Point directly at System32's reg.exe so we don't depend on PATH lookup.
        let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        let out = Command::new(format!(r"{sys_root}\System32\reg.exe"))
            .arg("query")
            .arg(key)
            .args(value_arg)
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&out.stdout);
        text.lines().find_map(|l| {
            let (_, v) = l.split_once("REG_SZ")?;
            let v = v.trim();
            (!v.is_empty()).then(|| v.to_string())
        })
    }

    /// None = the current executable name is unknown (lookup failed). Some(false) when there
    /// is no association, another app holds it, or the command can't be read (e.g. a Store app ProgId).
    fn reg_add(key: &str, name: &str, data: &str) -> Result<(), String> {
        let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        let status = Command::new(format!(r"{sys_root}\System32\reg.exe"))
            .args(["add", key, "/v", name, "/t", "REG_SZ", "/d", data, "/f"])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("reg add {key} 실패 ({status})"))
        }
    }

    /// Registers the app's Capabilities under HKCU so the Settings app can open the dedicated
    /// MD좋아 page (ms-settings:defaultapps?registeredAppUser=MDjoa). Idempotent. HKCU, so no admin rights needed.
    /// The associated ProgId is "Markdown Document", created by the installer (tauri fileAssociations).
    pub fn register_capabilities() -> Result<(), String> {
        const CAP: &str = r"HKCU\Software\MDjoa\Capabilities";
        reg_add(CAP, "ApplicationName", "MDjoa")?;
        reg_add(CAP, "ApplicationDescription", "Markdown viewer")?;
        let assoc = format!(r"{CAP}\FileAssociations");
        reg_add(&assoc, ".md", "Markdown Document")?;
        reg_add(&assoc, ".markdown", "Markdown Document")?;
        reg_add(r"HKCU\Software\RegisteredApplications", "MDjoa", r"Software\MDjoa\Capabilities")
    }

    pub fn is_default() -> Option<bool> {
        let exe = std::env::current_exe().ok()?;
        let name = exe.file_name()?.to_string_lossy().to_lowercase();
        // Recent Windows 11 stores the user's choice in UserChoiceLatest\ProgId (a subkey)
        // (the old UserChoice may hold stale values, so it goes second). If neither exists, use the default ProgId under HKCR\.md.
        let choice = |key: &str| {
            reg_value(
                &format!(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\{key}"),
                &["/v", "ProgId"],
            )
        };
        let prog_id = choice(r"UserChoiceLatest\ProgId")
            .or_else(|| choice("UserChoice"))
            .or_else(|| reg_value(r"HKCR\.md", &["/ve"]));
        let Some(prog_id) = prog_id else {
            return Some(false);
        };
        let command = reg_value(&format!(r"HKCR\{prog_id}\shell\open\command"), &["/ve"]);
        Some(command.is_some_and(|c| c.to_lowercase().contains(&name)))
    }
}

/// Windows: registers app info so the Default apps settings screen opens the dedicated MD좋아 page.
/// Nothing to do on other OSes (no-op).
#[command]
pub fn register_default_app_capabilities() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows::register_capabilities()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

/// Sets mdjoa as the default handler for .md/.markdown, overriding whatever
/// app currently owns the association. macOS only: Windows 10+ hash-protects
/// the user's UserChoice registry entry against silent override, so there the
/// frontend just opens Settings > Default apps (`ms-settings:defaultapps`)
/// directly via the opener plugin instead of calling into the backend.
#[command]
pub fn set_default_markdown_app() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::set_default()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("이 명령은 macOS 전용입니다".to_string())
    }
}
