use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::command;

/// Rotate the log once it passes this size so it never grows unbounded.
const MAX_LOG_BYTES: u64 = 1024 * 1024; // 1 MB → keeps ~2 MB total (current + .1)

/// Log directory, per-OS convention. OS branching is isolated here (CLAUDE.md):
/// macOS uses ~/Library/Logs; Windows/Linux use the local data dir (%LOCALAPPDATA%).
fn log_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    let dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Library")
        .join("Logs")
        .join("com.fusionsoft.mdjoa");
    #[cfg(not(target_os = "macos"))]
    let dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.fusionsoft.mdjoa")
        .join("logs");
    fs::create_dir_all(&dir).ok();
    dir
}

fn log_path() -> PathBuf {
    log_dir().join("mdjoa.log")
}

/// Best-effort append (never errors out): rotate if oversized, then append a line.
/// Used by both the write_log command and the panic hook, so it must not panic.
pub fn append_line(level: &str, message: &str) {
    let path = log_path();
    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() > MAX_LOG_BYTES {
            // Keep one previous generation (mdjoa.log.1), replacing any older one.
            let _ = fs::rename(&path, log_dir().join("mdjoa.log.1"));
        }
    }
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S");
    let line = format!("[{}] [{}] {}\n", now, level.to_uppercase(), message);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(line.as_bytes());
    }
}

#[command]
pub fn write_log(level: String, message: String) -> Result<(), String> {
    append_line(&level, &message);
    Ok(())
}

/// Absolute path of the active log file — for the "로그 폴더 열기" action.
#[command]
pub fn get_log_path() -> String {
    log_path().to_string_lossy().to_string()
}

/// Record uncaught Rust panics to the log file (defense in depth; commands are
/// Result-based, but plugins/threads could still panic). Keeps the default hook
/// (stderr) too. Call once at startup.
pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let loc = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_default();
        append_line("panic", &format!("{info} ({loc})"));
        default(info);
    }));
}
