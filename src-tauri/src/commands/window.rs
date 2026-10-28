use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{command, AppHandle, State, WebviewUrl, WebviewWindowBuilder};

/// Maps a secondary window's label (e.g. `doc-1`) to the absolute file path it
/// should open. Populated by `open_in_new_window` *before* the window is
/// created, and drained by the frontend via `get_window_file` once that window's
/// webview is ready. This avoids passing paths through the URL (which would
/// break on Korean/space/backslash paths).
#[derive(Default)]
pub struct WindowFiles(pub Mutex<HashMap<String, String>>);

/// Monotonic counter for generating collision-free, ASCII-only window labels.
static WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Opens `path` in a new, independent webview window. The window reuses the same
/// frontend bundle (`index.html`) but — being labelled `doc-N` rather than
/// `main` — skips session restore and opens only this file (see App.tsx).
///
/// Window creation happens in Rust so no extra JS window-management permission
/// is needed. The path is handed off via the `WindowFiles` map (label → path),
/// not the URL.
#[command]
pub fn open_in_new_window(
    app: AppHandle,
    state: State<WindowFiles>,
    path: String,
) -> Result<(), String> {
    // Unique, ASCII label. The capability scope (`doc-*`) grants this window the
    // same fs/asset/opener permissions as `main`.
    let n = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed) + 1;
    let label = format!("doc-{n}");

    // Window title = file basename (std::path, no separator hardcoding).
    let title = Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "MD좋아".to_string());

    // Insert the mapping BEFORE creating the window so the frontend can never
    // query before the path is available.
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(label.clone(), path);

    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(900.0, 800.0)
        .min_inner_size(600.0, 400.0);

    // Match the main window's chrome on macOS (overlay traffic lights, hidden
    // title). Windows/Linux keep their default decorations.
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    if let Err(e) = builder.build() {
        // Roll back the mapping so a failed open doesn't leak an entry.
        if let Ok(mut map) = state.0.lock() {
            map.remove(&label);
        }
        return Err(e.to_string());
    }

    Ok(())
}

/// Returns (and removes) the file path a secondary window was created to open.
/// Called once by that window's frontend on init. `None` for `main` or any
/// window with no pending file.
#[command]
pub fn get_window_file(state: State<WindowFiles>, label: String) -> Option<String> {
    state.0.lock().ok()?.remove(&label)
}
