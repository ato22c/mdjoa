// Pandoc download manager + DOCX conversion.
//
// Network use here is the ONE sanctioned exception to the no-network rule
// (CLAUDE.md): pandoc is downloaded only on explicit user consent. We pin a
// specific release and verify a SHA-256 checksum before installing.
//
// Resolution order for the pandoc binary: system PATH first, then the app-data
// bundled copy. The installer downloads the official jgm/pandoc release zip,
// verifies it, extracts just the `pandoc` binary, and installs it with exec
// permissions under <app-data>/bin/.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::Command;
use tauri::{command, AppHandle, Emitter};

const PANDOC_VERSION: &str = "3.10";

// Pinned checksums for the pinned version's macOS release zips (verified at
// build time). If the version bumps, these MUST be regenerated.
#[cfg(target_os = "macos")]
const SHA256_ARM64: &str = "d9cad01d96ae774a0dc8c8c45bb1ad3e4c5ff2cc2e24f45958f5f9b7974aee34";
#[cfg(target_os = "macos")]
const SHA256_X86_64: &str = "6334f4d9af7c9e37e761dfad56fa5507685f6d29724ebf31c4be6d5c654a3161";
// Windows release zip checksum. MUST be pinned before the Windows release:
// download `pandoc-3.10-windows-x86_64.zip` from the official jgm/pandoc release,
// verify it, and paste its SHA-256 here (same pinning process as the macOS
// consts above). While empty, DOCX auto-download is intentionally blocked on
// Windows (an unpinned hash must never be accepted) — see docs/windows-todo.md.
#[cfg(target_os = "windows")]
const SHA256_WIN_X86_64: &str = "bb808d00fd58762299d64582a9b4c3e4b106cd929e62c5f19bcdcb496f1e54ae";

#[derive(Serialize, Clone)]
pub struct PandocStatus {
    /// "none" | "system" | "bundled"
    pub state: String,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    received: u64,
    total: u64,
}

fn data_dir() -> PathBuf {
    let dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.fusionsoft.mdjoa");
    fs::create_dir_all(&dir).ok();
    dir
}

fn bundled_pandoc_path() -> PathBuf {
    data_dir().join("bin").join(if cfg!(windows) {
        "pandoc.exe"
    } else {
        "pandoc"
    })
}

/// Windows: suppress the transient black console window these short-lived child
/// processes (where/pandoc) would otherwise flash. CREATE_NO_WINDOW = 0x0800_0000.
/// No-op elsewhere.
fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// Find pandoc on the system PATH (cross-platform: `which`/`where`).
fn find_system_pandoc() -> Option<String> {
    let probe = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = Command::new(probe);
    cmd.arg("pandoc");
    let out = quiet(&mut cmd).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

fn query_version(pandoc: &str) -> Option<String> {
    let mut cmd = Command::new(pandoc);
    cmd.arg("--version");
    let out = quiet(&mut cmd).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next()?; // "pandoc 3.10"
    first
        .split_whitespace()
        .nth(1)
        .map(|v| v.to_string())
        .or(Some(first.to_string()))
}

/// Resolve the pandoc binary to use, system first then bundled.
fn resolve_pandoc() -> Option<String> {
    if let Some(sys) = find_system_pandoc() {
        return Some(sys);
    }
    let bundled = bundled_pandoc_path();
    if bundled.exists() {
        return Some(bundled.to_string_lossy().to_string());
    }
    None
}

#[command]
pub fn pandoc_status() -> PandocStatus {
    if let Some(sys) = find_system_pandoc() {
        return PandocStatus {
            state: "system".to_string(),
            version: query_version(&sys),
            path: Some(sys),
        };
    }
    let bundled = bundled_pandoc_path();
    if bundled.exists() {
        let p = bundled.to_string_lossy().to_string();
        return PandocStatus {
            state: "bundled".to_string(),
            version: query_version(&p),
            path: Some(p),
        };
    }
    PandocStatus {
        state: "none".to_string(),
        version: None,
        path: None,
    }
}

/// Asset name + expected checksum for the current platform/arch.
fn release_asset() -> Result<(String, &'static str), String> {
    let arch = std::env::consts::ARCH; // "aarch64" | "x86_64"
    #[cfg(target_os = "macos")]
    {
        match arch {
            "aarch64" => Ok((format!("pandoc-{PANDOC_VERSION}-arm64-macOS.zip"), SHA256_ARM64)),
            "x86_64" => Ok((format!("pandoc-{PANDOC_VERSION}-x86_64-macOS.zip"), SHA256_X86_64)),
            // Stable wire-format codes (never localized text) — frontend maps
            // these via errorMessage() (src/lib/i18n).
            other => Err(format!("pandoc_unsupported_arch|{other}")),
        }
    }
    #[cfg(target_os = "windows")]
    {
        match arch {
            "x86_64" => {
                if SHA256_WIN_X86_64.is_empty() {
                    // Hash not yet pinned → refuse rather than download unverified.
                    return Err("pandoc_checksum_not_pinned".to_string());
                }
                Ok((
                    format!("pandoc-{PANDOC_VERSION}-windows-x86_64.zip"),
                    SHA256_WIN_X86_64,
                ))
            }
            other => Err(format!("pandoc_unsupported_arch|{other}")),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // Linux assets are defined for later builds; not exercised on macOS/Windows.
        let _ = arch;
        Err("pandoc_unsupported_platform".to_string())
    }
}

/// Download, verify (SHA-256), and install pandoc. Emits "pandoc-progress".
#[command]
pub async fn pandoc_download(app: AppHandle) -> Result<(), String> {
    let (asset, expected_sha) = release_asset()?;
    let url = format!(
        "https://github.com/jgm/pandoc/releases/download/{PANDOC_VERSION}/{asset}"
    );

    let client = reqwest::Client::builder()
        .user_agent("mdjoa")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("pandoc_download_connect_failed|{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("pandoc_download_http_error|{}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);

    // Stream to memory while hashing and reporting progress.
    use futures_util::StreamExt;
    let mut hasher = Sha256::new();
    let mut buf: Vec<u8> = Vec::with_capacity(total as usize);
    let mut received: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut last_emit = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("pandoc_download_stream_error|{e}"))?;
        hasher.update(&chunk);
        buf.extend_from_slice(&chunk);
        received += chunk.len() as u64;
        // Throttle progress events (~every 512KB) to avoid flooding the UI.
        if received - last_emit > 512 * 1024 || received == total {
            last_emit = received;
            app.emit("pandoc-progress", DownloadProgress { received, total }).ok();
        }
    }

    // Verify checksum before touching disk.
    let digest = hasher.finalize();
    let actual = hex_encode(&digest);
    if actual != expected_sha {
        return Err("pandoc_checksum_mismatch".to_string());
    }

    // Extract just the pandoc binary from the zip.
    let cursor = std::io::Cursor::new(buf);
    let mut zip = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("pandoc_zip_extract_failed|{e}"))?;
    let mut pandoc_bytes: Option<Vec<u8>> = None;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        // macOS zip: pandoc-X.Y/bin/pandoc
        // Windows zip: pandoc-X.Y-windows-x86_64/pandoc.exe  (no bin/ subdir)
        if name.ends_with("/bin/pandoc")
            || name.ends_with("/pandoc.exe")
            || name == "pandoc.exe"
        {
            let mut data = Vec::new();
            entry.read_to_end(&mut data).map_err(|e| e.to_string())?;
            pandoc_bytes = Some(data);
            break;
        }
    }
    let pandoc_bytes = pandoc_bytes.ok_or("pandoc_binary_not_in_zip")?;

    // Atomic install: write to tmp then rename, then mark executable.
    let dest = bundled_pandoc_path();
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = dest.with_extension("tmp");
    fs::write(&tmp, &pandoc_bytes).map_err(|e| format!("pandoc_install_failed|{e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &dest).map_err(|e| format!("pandoc_install_failed|{e}"))?;

    Ok(())
}

/// Remove the bundled pandoc (system pandoc, if any, is untouched).
#[command]
pub fn pandoc_delete() -> Result<(), String> {
    let p = bundled_pandoc_path();
    if p.exists() {
        fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Convert a markdown file to DOCX via pandoc. Runs off the UI thread.
#[command]
pub async fn convert_docx(input: String, output: String) -> Result<(), String> {
    let pandoc = resolve_pandoc().ok_or("pandoc_engine_not_found")?;
    // Run blocking process work on a worker thread.
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&pandoc);
        cmd.arg(&input).arg("-o").arg(&output).arg("--standalone");
        let out = quiet(&mut cmd)
            .output()
            .map_err(|e| format!("pandoc_exec_failed|{e}"))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!(
                "pandoc_convert_failed|{}",
                String::from_utf8_lossy(&out.stderr).trim()
            ))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}
