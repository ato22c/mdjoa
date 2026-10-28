// Hosts the general-purpose AI document task runner (run_claude) — all five tasks (review,
// improve, summarize, translate, ...) share this one command (per-task prompts and models are
// assembled by the aiTasks.ts registry on the TS side; this file doesn't know which task it is).
// It also holds helpers such as cancel_translate (legacy name, but actually shared by all tasks)
// and claude_status. It shells out to the local `claude` CLI (Claude Code) that the user is
// already logged into — no separate API key or metered billing (uses the existing
// subscription). The external-binary invocation pattern follows pandoc.rs (quiet/spawn_blocking).
//
// ⚠️ This command talks to Anthropic servers through the claude CLI. It is an **explicit
// exception, triggered directly by the user**, to the "no network communication" rule in
// CLAUDE.md (not background/telemetry).

use serde::Serialize;
use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{command, State};

/// Set of PIDs of running claude child processes (shared by review/improve/summarize/translate).
/// Chunked translation runs several chunks in parallel, so there may be more than one.
/// cancel_translate kills them all so the user can abort the task.
#[derive(Default)]
pub struct TranslateProc(pub Arc<Mutex<Vec<u32>>>);

/// In-memory cache of run_claude results (shared by review/improve/summarize/translate). The same
/// (prompt, model) pair returns immediately without re-running. Key = hash(prompt || model).
/// Lives for the app session (reset on restart).
#[derive(Default)]
pub struct TranslateCache(pub Arc<Mutex<HashMap<String, String>>>);

fn cache_key(prompt: &str, model: &str) -> String {
    let mut h = DefaultHasher::new();
    prompt.hash(&mut h);
    model.hash(&mut h);
    format!("{:x}", h.finish())
}

/// Force-kills a process (and its child tree) by PID. Windows = taskkill /T /F, otherwise kill -9.
fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        let mut c = Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        let _ = quiet(&mut c).output();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").arg("-9").arg(pid.to_string()).output();
    }
}

/// Cancels the running AI document task (kills the child claude process). Once killed,
/// run_claude's wait_with_output unblocks and returns Err, which the frontend treats as "cancelled".
#[command]
pub fn cancel_translate(proc: State<'_, TranslateProc>) {
    let pids: Vec<u32> = std::mem::take(&mut *proc.0.lock().unwrap());
    for pid in pids {
        kill_pid(pid);
    }
}

/// Windows: suppresses the black console window that short-lived child processes (where/claude) pop up.
/// CREATE_NO_WINDOW = 0x0800_0000. No-op on other OSes. (Same purpose as the identical helper in pandoc.rs)
fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// Finds the `claude` executable on PATH (where/which). None if absent.
fn find_on_path() -> Option<String> {
    let probe = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = Command::new(probe);
    cmd.arg("claude");
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

/// A GUI app may not inherit the terminal's PATH, so check well-known install locations as a fallback.
/// (Actual location on this machine = ~/.local/bin/claude(.exe))
fn well_known_locations() -> Vec<PathBuf> {
    let mut v = Vec::new();
    let exe = if cfg!(windows) { "claude.exe" } else { "claude" };
    if let Some(home) = dirs::home_dir() {
        v.push(home.join(".local").join("bin").join(exe));
        v.push(home.join(".claude").join("local").join(exe));
    }
    #[cfg(windows)]
    {
        // npm global install (claude.cmd)
        if let Some(appdata) = dirs::config_dir() {
            // dirs::config_dir() = %APPDATA% on Windows
            v.push(appdata.join("npm").join("claude.cmd"));
        }
    }
    v
}

/// Decides which claude binary path to use: (1) settings override → (2) PATH → (3) common-location fallback.
fn resolve_claude(override_path: Option<String>) -> Option<String> {
    if let Some(p) = override_path {
        let p = p.trim();
        if !p.is_empty() && std::path::Path::new(p).exists() {
            return Some(p.to_string());
        }
    }
    if let Some(p) = find_on_path() {
        return Some(p);
    }
    well_known_locations()
        .into_iter()
        .find(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string())
}

#[derive(Serialize, Clone)]
pub struct ClaudeStatus {
    /// "none" | "system" | "override"
    pub state: String,
    pub version: Option<String>,
    pub path: Option<String>,
}

/// Detection status of the claude CLI (for the settings screen). Checks the version via `claude --version`.
#[command]
pub fn claude_status(override_path: Option<String>) -> ClaudeStatus {
    let had_override = override_path
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let Some(path) = resolve_claude(override_path) else {
        return ClaudeStatus {
            state: "none".into(),
            version: None,
            path: None,
        };
    };
    let mut cmd = Command::new(&path);
    cmd.arg("--version");
    let version = quiet(&mut cmd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());
    ClaudeStatus {
        state: if had_override { "override" } else { "system" }.into(),
        version,
        path: Some(path),
    }
}

/// Output wrapped in ```` ```markdown … ``` ```` / ```` ``` … ``` ```` is unwrapped when the whole output is fenced (defensive).
fn strip_outer_fence(s: &str) -> String {
    let t = s.trim();
    if let Some(rest) = t.strip_prefix("```") {
        // Remove the first line (language tag) and the trailing ```
        if let Some(end) = rest.rfind("```") {
            let inner = &rest[..end];
            // The actual body starts after the first newline
            if let Some(nl) = inner.find('\n') {
                return inner[nl + 1..].trim_end().to_string();
            }
        }
    }
    t.to_string()
}

/// **General-purpose runner** that executes a finished prompt via the claude CLI and returns the cleaned result.
/// The prompt already contains the body and task instructions (assembled by the TS task registry). Rust
/// doesn't know what the task is → this command is unchanged when a new AI task is added.
/// An identical (prompt, model) returns instantly from the cache. Cancellation reuses cancel_translate (shared by all claude tasks).
#[command]
pub async fn run_claude(
    prompt: String,
    model: String,
    claude_path: Option<String>,
    proc: State<'_, TranslateProc>,
    cache: State<'_, TranslateCache>,
) -> Result<String, String> {
    let key = cache_key(&prompt, &model);
    {
        let guard = cache.0.lock().unwrap();
        if let Some(cached) = guard.get(&key).cloned() {
            return Ok(cached);
        }
    }

    // Stable wire-format code (never localized text) — frontend maps via
    // errorMessage() (src/lib/i18n).
    let claude = resolve_claude(claude_path).ok_or("translate_claude_not_found")?;
    // The prompt includes the body. Guards against the Windows CreateProcessW command-line limit (~32767 UTF-16).
    // The frontend already blocks bodies over 28,000 chars, so reaching here is rare (backstop).
    if prompt.chars().count() > 30000 {
        return Err("translate_doc_too_long".into());
    }
    let slot = proc.0.clone();
    let cache_inner = cache.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&claude);
        // This is text transformation only, so tools, MCP, skills and session persistence are unneeded — removes startup overhead.
        // The variadic arg (--tools) is placed early so it ends at the next flag (--model).
        // cwd is pinned to a temp folder to stop auto-discovery of the user project's CLAUDE.md.
        // (--bare is not used because it blocks keychain login auth.)
        cmd.arg("--tools")
            .arg("")
            .arg("--strict-mcp-config")
            .arg("--disable-slash-commands")
            .arg("--no-session-persistence")
            // Skip loading user settings (hooks/plugins) — the main factor in the measured 8-10s → ~3.5s per call.
            .arg("--setting-sources")
            .arg("")
            .arg("--model")
            .arg(&model)
            .arg("-p")
            .arg(&prompt)
            .current_dir(std::env::temp_dir())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        quiet(&mut cmd);
        let child = cmd
            .spawn()
            .map_err(|e| format!("translate_claude_spawn_failed|{e}"))?;
        // Register the PID so cancel_translate can kill it (added to the set since runs are parallel).
        let pid = child.id();
        slot.lock().unwrap().push(pid);
        let out = child
            .wait_with_output()
            .map_err(|e| format!("translate_claude_wait_failed|{e}"))?;
        slot.lock().unwrap().retain(|&p| p != pid); // done → release this PID
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout);
            let cleaned = strip_outer_fence(&text);
            if cleaned.trim().is_empty() {
                Err("translate_empty_result".into())
            } else {
                cache_inner.lock().unwrap().insert(key, cleaned.clone());
                Ok(cleaned)
            }
        } else {
            let err = String::from_utf8_lossy(&out.stderr);
            Err(format!("translate_failed|{}", err.trim()))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::strip_outer_fence;

    #[test]
    fn strips_markdown_fence() {
        assert_eq!(strip_outer_fence("```markdown\nhello\nworld\n```"), "hello\nworld");
    }

    #[test]
    fn strips_plain_fence() {
        assert_eq!(strip_outer_fence("```\nhi\n```"), "hi");
    }

    #[test]
    fn leaves_unfenced_text_untouched() {
        assert_eq!(strip_outer_fence("no fence here"), "no fence here");
    }
}
