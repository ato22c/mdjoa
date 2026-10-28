use chardetng::EncodingDetector;
use std::path::{Path, PathBuf};
use tauri::command;

#[derive(serde::Serialize)]
pub struct ReadResult {
    pub content: String,
    pub encoding: String,
    pub path: String,
}

/// Hard ceiling on a single document. Guards against OOM/freeze when a user
/// accidentally opens a huge or binary file (e.g. a multi-hundred-MB log/dump).
const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024; // 25 MB

#[command]
pub fn read_file(path: String) -> Result<ReadResult, String> {
    // Check size cheaply BEFORE reading the bytes into memory.
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_FILE_BYTES {
        // Stable wire-format code (never localized Korean text) — the frontend
        // maps this to a translated message via errorMessage() (src/lib/i18n).
        return Err(format!(
            "file_too_large|{:.1}|{}",
            meta.len() as f64 / 1_048_576.0,
            MAX_FILE_BYTES / 1_048_576
        ));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;

    let mut detector = EncodingDetector::new();
    detector.feed(&bytes, true);
    let encoding = detector.guess(None, true);

    let (content, enc_name, _) = encoding.decode(&bytes);

    Ok(ReadResult {
        content: content.into_owned(),
        encoding: enc_name.name().to_string(),
        path,
    })
}

#[command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// True when `path` points at a directory (used by drag-drop to decide
/// open-file vs open-folder). Cross-platform via `std::path`.
#[command]
pub fn path_is_dir(path: String) -> bool {
    Path::new(&path).is_dir()
}

#[derive(serde::Serialize)]
pub struct FileMeta {
    /// Unix epoch milliseconds; None when the platform/file doesn't report it.
    pub created_ms: Option<u64>,
    pub modified_ms: Option<u64>,
    pub size: u64,
}

fn to_epoch_ms(t: std::io::Result<std::time::SystemTime>) -> Option<u64> {
    t.ok()
        .and_then(|st| st.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

#[command]
pub fn file_meta(path: String) -> Result<FileMeta, String> {
    let md = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(FileMeta {
        created_ms: to_epoch_ms(md.created()),
        modified_ms: to_epoch_ms(md.modified()),
        size: md.len(),
    })
}

/// True when `line` is a GFM task-list item (`- [ ]`, `* [x]`, `+ [X]`, …),
/// with optional leading whitespace. If so, returns the byte offset of the `[`
/// of the checkbox marker so the caller can flip the single char inside `[ ]`.
/// Pattern: ^\s*[-*+]\s+\[[ xX]\]\s
fn task_checkbox_bracket_pos(line: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    let mut i = 0;
    // leading whitespace
    while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
        i += 1;
    }
    // bullet marker
    if i >= bytes.len() || !(bytes[i] == b'-' || bytes[i] == b'*' || bytes[i] == b'+') {
        return None;
    }
    i += 1;
    // at least one space/tab after the bullet
    let ws_start = i;
    while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
        i += 1;
    }
    if i == ws_start {
        return None;
    }
    // `[`
    if i >= bytes.len() || bytes[i] != b'[' {
        return None;
    }
    let bracket = i;
    i += 1;
    // single status char: space, x or X
    if i >= bytes.len() || !(bytes[i] == b' ' || bytes[i] == b'x' || bytes[i] == b'X') {
        return None;
    }
    i += 1;
    // `]`
    if i >= bytes.len() || bytes[i] != b']' {
        return None;
    }
    i += 1;
    // trailing whitespace required (matches markdown-it-task-lists)
    if i >= bytes.len() || !(bytes[i] == b' ' || bytes[i] == b'\t') {
        return None;
    }
    Some(bracket)
}

/// Toggle the `index`-th task-list checkbox in a markdown file to `checked`,
/// writing the result back atomically (tmp file in the same dir → rename, like
/// favorites.rs/settings.rs). Returns the new full file content so the frontend
/// can update without a re-read race. Never panics.
#[command]
pub fn toggle_task(path: String, index: u32, checked: bool) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    // Lossy UTF-8: task markers are ASCII, so any non-UTF8 bytes elsewhere are
    // preserved as replacement chars only in pathological files; acceptable.
    let content = String::from_utf8_lossy(&bytes).into_owned();

    // Walk lines, find the index-th task-list checkbox and flip its status char.
    let mut count = 0u32;
    let mut out = String::with_capacity(content.len());
    let mut found = false;
    // Preserve original line endings by splitting on '\n' and re-joining; the
    // final segment after the last '\n' has no trailing newline (matches input).
    let mut first = true;
    for line in content.split('\n') {
        if !first {
            out.push('\n');
        }
        first = false;

        if !found {
            if let Some(bracket) = task_checkbox_bracket_pos(line) {
                if count == index {
                    // Replace the single char at bracket+1 (`[` is at `bracket`).
                    let status = if checked { 'x' } else { ' ' };
                    out.push_str(&line[..bracket + 1]);
                    out.push(status);
                    out.push_str(&line[bracket + 2..]);
                    found = true;
                    continue;
                }
                count += 1;
            }
        }
        out.push_str(line);
    }

    if !found {
        return Err(format!("task checkbox #{index} not found"));
    }

    // Atomic write: tmp in the same dir → rename.
    let p = Path::new(&path);
    let tmp = p.with_extension("md.tmp");
    std::fs::write(&tmp, out.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, p).map_err(|e| e.to_string())?;

    Ok(out)
}

/// Write `content` to `path` atomically (tmp file in the same dir → rename, like
/// favorites.rs/settings.rs and toggle_task above). The tmp file lives in the
/// same directory as the target so the rename stays on one filesystem (atomic).
/// Used by the simple edit mode (⌘S).
#[command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    // Tmp filename derived from the target so concurrent saves of different
    // files don't collide. `.md.tmp` extension mirrors toggle_task.
    let tmp = p.with_extension("md.tmp");
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, p).map_err(|e| e.to_string())?;
    Ok(())
}

/// Rename (or move within the same dir) a file or folder. Both paths come from
/// the frontend as OS-native strings; we operate on `Path`/`PathBuf` so the
/// separator is never hardcoded. Refuses to overwrite: if `new_path` already
/// exists the rename is rejected (so a careless rename can't clobber a sibling).
/// `std::fs::rename` works for files AND directories on both Windows and macOS.
#[command]
pub fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    let old = Path::new(&old_path);
    let new = Path::new(&new_path);
    if !old.exists() {
        return Err("source_not_found".into());
    }
    // No overwriting. On Windows rename errors if the target exists, but macOS/Unix
    // silently overwrite files, so block it here regardless of OS. (Empty/identical
    // names are rejected by the frontend.)
    if new.exists() {
        return Err("name_exists".into());
    }
    std::fs::rename(old, new).map_err(|e| e.to_string())?;
    Ok(())
}

/// Move a file or folder to the system trash/recycle bin (NOT a permanent delete).
/// Cross-platform via the `trash` crate (Windows Recycle Bin / macOS Trash). The
/// trash itself is the safety net, so no extra confirmation is needed here.
#[command]
pub fn trash_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("item_not_found".into());
    }
    trash::delete(p).map_err(|e| e.to_string())?;
    Ok(())
}

/// Directory for unnamed ("Untitled") scratch documents, kept inside our appdata
/// so they never litter the user's folders. OS branching isolated here (CLAUDE.md),
/// mirroring log_dir: macOS → ~/Library/Application Support, else %LOCALAPPDATA%.
fn untitled_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    let dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Library")
        .join("Application Support")
        .join("com.fusionsoft.mdjoa")
        .join("untitled");
    #[cfg(not(target_os = "macos"))]
    let dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.fusionsoft.mdjoa")
        .join("untitled");
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// Create an empty unnamed scratch file in the untitled dir and return its path.
/// A new document is backed by this temp file (auto-saved into it) until the user
/// names it via Save; only then is it written to a real location and this removed.
#[command]
pub fn create_untitled_file() -> Result<String, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = untitled_dir().join(format!("untitled-{}.md", nanos));
    std::fs::write(&path, b"").map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Remove a scratch temp file. Safety-gated: only deletes files that actually live
/// inside the untitled dir, so a stray/bad path can never delete a real document.
#[command]
pub fn remove_untitled_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.parent() != Some(untitled_dir().as_path()) {
        return Err("untitled_dir_mismatch".into());
    }
    if p.exists() {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Delete `path` only if it exists and its content is empty/whitespace-only.
/// Returns true when it was deleted, false when kept (non-empty) or absent.
/// Used to clean up a freshly-created blank document the user abandoned without
/// typing. The on-disk emptiness check makes this race-safe: a file that gained
/// real content (e.g. via auto-save) between creation and cleanup is never removed.
#[command]
pub fn delete_file_if_empty(path: String) -> Result<bool, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(false);
    }
    let content = std::fs::read_to_string(p).map_err(|e| e.to_string())?;
    if content.trim().is_empty() {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Whether a folder contains at least one file MD좋아 can open (recursive). md/markdown/html/htm/pdf
/// always count, and when show_non_md is on any other file counts too (approximated as
/// "any file counts" to avoid duplicating the frontend's detailed isTextLikePath
/// whitelist — a folder holding only a binary being shown by mistake is an accepted
/// error). Stops at the first match instead of scanning everything (early exit). Folders
/// starting with `.` and node_modules are skipped. If `budget` (the number of entries
/// we may visit) runs out, returns true — i.e. big folders are shown rather than hidden
/// (safe default) while still preventing unbounded/excessive traversal. Only called when
/// md_only is on, and only for the level being expanded (lazy), so the whole tree is
/// never pre-scanned.
fn dir_has_visible_file(dir: &Path, budget: &mut u32, show_non_md: bool) -> bool {
    let rd = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return false,
    };
    let mut subdirs: Vec<std::path::PathBuf> = Vec::new();
    for entry in rd.flatten() {
        if *budget == 0 {
            return true; // budget exhausted → show (don't hide)
        }
        *budget -= 1;
        let p = entry.path();
        if p.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }
            subdirs.push(p);
        } else {
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if ext == "md" || ext == "markdown" || ext == "html" || ext == "htm" || ext == "pdf" {
                return true; // early exit
            }
            if show_non_md {
                return true; // view-source mode: any file counts
            }
        }
    }
    for sd in subdirs {
        if dir_has_visible_file(&sd, budget, show_non_md) {
            return true;
        }
    }
    false
}

#[command]
pub fn list_dir(
    path: String,
    md_only: Option<bool>,
    show_non_md: Option<bool>,
) -> Result<Vec<DirEntry>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let show_non_md = show_non_md.unwrap_or(false);
    let mut result = Vec::new();

    for entry in entries.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = p.is_dir();
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let is_md = !is_dir && (ext == "md" || ext == "markdown");
        let is_html = !is_dir && (ext == "html" || ext == "htm");

        // Default: folders + markdown + HTML. With show_non_md, text/code is returned too,
        // and the frontend (FileTree) filters down to the text/code it should show via
        // isTextLikePath (prevents exposing binaries — the single source of truth for the
        // whitelist lives in the frontend).
        if is_dir || is_md || is_html || show_non_md {
            result.push(DirEntry {
                name,
                path: p.to_string_lossy().to_string(),
                is_dir,
                is_md,
            });
        }
    }

    // "Only folders with openable files" is on: hide subfolders that contain no md/html/pdf
    // (or, with show_non_md, any other file). A per-folder budget cap protects big folders.
    if md_only.unwrap_or(false) {
        result.retain(|e| {
            if !e.is_dir {
                return true;
            }
            let mut budget: u32 = 6000;
            dir_has_visible_file(Path::new(&e.path), &mut budget, show_non_md)
        });
    }

    result.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(result)
}

#[derive(serde::Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_md: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temp_root(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let mut p = std::env::temp_dir();
        p.push(format!("mdjoa_file_test_{}_{}", tag, nanos));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn deletes_an_empty_file() {
        let dir = temp_root("empty");
        let f = dir.join("새 문서.md");
        fs::write(&f, "").unwrap();
        let deleted = delete_file_if_empty(f.to_string_lossy().into_owned()).unwrap();
        assert!(deleted, "an empty file should be deleted");
        assert!(!f.exists(), "the file should be gone from disk");
    }

    #[test]
    fn deletes_a_whitespace_only_file() {
        let dir = temp_root("ws");
        let f = dir.join("새 문서.md");
        fs::write(&f, "  \n\t\r\n  ").unwrap();
        let deleted = delete_file_if_empty(f.to_string_lossy().into_owned()).unwrap();
        assert!(deleted, "a whitespace-only file counts as empty");
        assert!(!f.exists());
    }

    #[test]
    fn keeps_a_file_with_content() {
        let dir = temp_root("content");
        let f = dir.join("real.md");
        fs::write(&f, "# 제목\n내용").unwrap();
        let deleted = delete_file_if_empty(f.to_string_lossy().into_owned()).unwrap();
        assert!(!deleted, "a file with real content must never be deleted");
        assert!(f.exists(), "the file must remain on disk");
    }

    #[test]
    fn absent_file_is_a_noop() {
        let dir = temp_root("absent");
        let f = dir.join("nope.md");
        let deleted = delete_file_if_empty(f.to_string_lossy().into_owned()).unwrap();
        assert!(!deleted, "a missing file reports not-deleted, not an error");
    }

    #[test]
    fn untitled_create_lives_in_untitled_dir_and_removes() {
        let path = create_untitled_file().unwrap();
        let p = PathBuf::from(&path);
        assert!(p.exists(), "the scratch file is created on disk");
        assert_eq!(p.parent(), Some(untitled_dir().as_path()), "it lives in the untitled dir");
        // The safety-gated remove deletes it.
        remove_untitled_file(path).unwrap();
        assert!(!p.exists(), "remove_untitled_file deletes the scratch file");
    }

    #[test]
    fn remove_untitled_rejects_paths_outside_the_untitled_dir() {
        let dir = temp_root("not_untitled");
        let f = dir.join("real.md");
        fs::write(&f, "소중한 내용").unwrap();
        // A real document outside the untitled dir must never be deletable here.
        assert!(remove_untitled_file(f.to_string_lossy().into_owned()).is_err());
        assert!(f.exists(), "the real file is untouched");
    }

    #[test]
    fn dir_has_visible_file_finds_markdown() {
        let dir = temp_root("visible_md");
        fs::write(dir.join("note.md"), "").unwrap();
        let mut budget = 100;
        assert!(dir_has_visible_file(&dir, &mut budget, false));
    }

    #[test]
    fn dir_has_visible_file_finds_html_and_pdf_without_show_non_md() {
        let dir = temp_root("visible_html_pdf");
        fs::write(dir.join("page.html"), "").unwrap();
        let mut budget = 100;
        assert!(dir_has_visible_file(&dir, &mut budget, false), "html counts even when show_non_md is off");

        let dir2 = temp_root("visible_pdf");
        fs::write(dir2.join("doc.pdf"), "").unwrap();
        let mut budget2 = 100;
        assert!(dir_has_visible_file(&dir2, &mut budget2, false), "pdf counts even when show_non_md is off");
    }

    #[test]
    fn dir_has_visible_file_ignores_code_unless_show_non_md() {
        let dir = temp_root("code_only");
        fs::write(dir.join("main.rs"), "").unwrap();
        let mut budget = 100;
        assert!(!dir_has_visible_file(&dir, &mut budget, false), "code files don't count when show_non_md is off");
        let mut budget2 = 100;
        assert!(dir_has_visible_file(&dir, &mut budget2, true), "code files count once show_non_md is on");
    }

    #[test]
    fn dir_has_visible_file_recurses_into_subfolders() {
        let dir = temp_root("nested");
        let sub = dir.join("a").join("b");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("deep.md"), "").unwrap();
        let mut budget = 100;
        assert!(dir_has_visible_file(&dir, &mut budget, false));
    }

    #[test]
    fn dir_has_visible_file_false_when_empty() {
        let dir = temp_root("empty_dir");
        let mut budget = 100;
        assert!(!dir_has_visible_file(&dir, &mut budget, false));
        assert!(!dir_has_visible_file(&dir, &mut budget, true));
    }
}
