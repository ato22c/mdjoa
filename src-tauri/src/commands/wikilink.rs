use std::path::{Path, PathBuf};
use tauri::command;

// Wikilink support (features E/#9 resolution and F/#10 backlinks). Both walk the
// open folder ON DEMAND (no persistent index, no watcher) and reuse the same
// performance guards as `search.rs`/`context.rs`: skip heavy/hidden dirs, bound
// depth, and cap how many files are read. Paths use `std::path` joins / `PathBuf`
// throughout (no separator hardcoding) for Windows/macOS parity.

/// Maximum directory depth descended (scan root == depth 0).
const MAX_DEPTH: usize = 10;
/// Hard cap on Markdown files read during a backlink scan.
const MAX_SCANNED_FILES: usize = 5_000;
/// Files larger than this are skipped (Markdown docs are tiny; anything larger
/// is almost certainly generated/binary noise).
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024; // 2 MiB
/// Hard cap on the number of backlink results returned.
const MAX_BACKLINKS: usize = 200;

/// Directory names always skipped (heavy build/dependency/cache trees). Matched
/// on the final component, case-sensitive (conventional names). Kept in sync
/// with `search.rs`/`context.rs` deliberately rather than shared, to avoid
/// changing those already-shipped modules' surface.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".cache",
    ".venv",
    "venv",
    "__pycache__",
    ".idea",
    ".vscode",
    "vendor",
    "out",
    "coverage",
];

fn should_skip_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name)
}

fn is_markdown(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let ext = ext.to_lowercase();
            ext == "md" || ext == "markdown"
        }
        None => false,
    }
}

/// Normalize a wikilink target or file name for matching: lowercase, trim, and
/// strip a trailing `.md`/`.markdown`. Mirrors `normalizeWikiTarget` in
/// `src/lib/wikilink.ts` so the frontend and backend agree on what matches.
fn normalize_target(name: &str) -> String {
    let lower = name.trim().to_lowercase();
    for ext in [".md", ".markdown"] {
        if let Some(stripped) = lower.strip_suffix(ext) {
            return stripped.to_string();
        }
    }
    lower
}

/// The file-name stem (without extension) of a path, normalized for matching.
fn file_stem_normalized(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(normalize_target)
}

// ── #9: resolve a wikilink target to an actual file in the folder ───────────

/// Resolve a wikilink `target` (bare name, optionally with `.md`) to an absolute
/// file path under `folder`. Case-insensitive, extension optional. Returns the
/// FIRST match found in a depth-first walk (guarded as above), or `None` when no
/// Markdown file matches. On-demand only — no index is built or cached here.
#[command]
pub fn resolve_wikilink(folder: String, target: String) -> Option<String> {
    let want = normalize_target(&target);
    if want.is_empty() {
        return None;
    }
    let mut scanned = 0usize;
    resolve_walk(Path::new(&folder), 0, &want, &mut scanned)
        .map(|p| p.to_string_lossy().to_string())
}

fn resolve_walk(
    dir: &Path,
    depth: usize,
    want: &str,
    scanned: &mut usize,
) -> Option<PathBuf> {
    if depth > MAX_DEPTH || *scanned >= MAX_SCANNED_FILES {
        return None;
    }
    let entries = std::fs::read_dir(dir).ok()?;
    // Collect dirs to recurse into after files, so a same-level match wins over
    // a deeper one (more intuitive resolution order).
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let is_dir = entry
            .file_type()
            .map(|t| t.is_dir())
            .unwrap_or_else(|_| path.is_dir());
        if is_dir {
            if !should_skip_dir(&name) {
                subdirs.push(path);
            }
            continue;
        }
        if name.starts_with('.') || !is_markdown(&path) {
            continue;
        }
        *scanned += 1;
        if *scanned > MAX_SCANNED_FILES {
            return None;
        }
        if file_stem_normalized(&path).as_deref() == Some(want) {
            return Some(path);
        }
    }
    for sub in subdirs {
        if let Some(found) = resolve_walk(&sub, depth + 1, want, scanned) {
            return Some(found);
        }
    }
    None
}

// ── #10: backlinks — files whose body references the current document ───────

/// A file that references the current document via `[[…]]`.
#[derive(serde::Serialize, Clone)]
pub struct Backlink {
    pub name: String,
    pub path: String,
}

/// Result of a backlink scan. `truncated` is true when a guard (scanned-file cap
/// or result cap) stopped the walk early, so the UI can hint the list is partial.
#[derive(serde::Serialize)]
pub struct BacklinkResult {
    pub links: Vec<Backlink>,
    pub truncated: bool,
}

struct BacklinkScanner {
    /// Normalized name of the document we're finding references TO.
    want: String,
    /// Absolute path of the current document, excluded from its own backlinks.
    self_path: Option<PathBuf>,
    found: Vec<Backlink>,
    scanned: usize,
    truncated: bool,
}

impl BacklinkScanner {
    fn done(&self) -> bool {
        self.found.len() >= MAX_BACKLINKS || self.scanned >= MAX_SCANNED_FILES
    }
}

/// True if `text` contains a `[[…]]` reference whose target normalizes to
/// `want` (heading ignored). Linear scan; mirrors `extractWikiLinks` +
/// `normalizeWikiTarget` in `src/lib/wikilink.ts`. Code blocks are intentionally
/// NOT stripped (errs toward inclusion — same as the frontend predicate).
fn text_references(text: &str, want: &str) -> bool {
    let bytes = text.as_bytes();
    let mut i = 0usize;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            // Find the matching `]]`.
            if let Some(rel) = text[i + 2..].find("]]") {
                let body = &text[i + 2..i + 2 + rel];
                if !body.contains("[[") {
                    // Take the part before the first '#' as the target.
                    let target = match body.find('#') {
                        Some(h) => &body[..h],
                        None => body,
                    };
                    if normalize_target(target) == want {
                        return true;
                    }
                }
                i = i + 2 + rel + 2;
                continue;
            } else {
                break;
            }
        }
        i += 1;
    }
    false
}

/// Scan `folder` for Markdown files whose body references `doc_name` via
/// `[[…]]`. `current_path` (the open document) is excluded from its own results.
///
/// On-demand, one-shot scan — no index, no watcher (by design). Guards mirror
/// `search.rs`: skip heavy/hidden dirs, bound depth, cap scanned files and
/// results, skip oversized files. Never panics on unreadable files/dirs.
/// Results are sorted by path for a stable order.
/// Runs the backlink scan on a background thread — it doesn't block the invoke
/// thread, so there is no UI lag when a file is first opened.
#[command]
pub async fn scan_backlinks(
    folder: String,
    doc_name: String,
    current_path: Option<String>,
) -> Result<BacklinkResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let want = normalize_target(&doc_name);
        if want.is_empty() {
            return Ok(BacklinkResult {
                links: Vec::new(),
                truncated: false,
            });
        }
        let mut scanner = BacklinkScanner {
            want,
            self_path: current_path.map(PathBuf::from),
            found: Vec::new(),
            scanned: 0,
            truncated: false,
        };
        backlink_walk(Path::new(&folder), 0, &mut scanner);
        let mut links = scanner.found;
        links.sort_by(|a, b| a.path.cmp(&b.path));
        links.dedup_by(|a, b| a.path == b.path);
        Ok(BacklinkResult {
            links,
            truncated: scanner.truncated,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn backlink_walk(dir: &Path, depth: usize, sc: &mut BacklinkScanner) {
    if sc.done() {
        return;
    }
    if depth > MAX_DEPTH {
        sc.truncated = true;
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if sc.done() {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let is_dir = entry
            .file_type()
            .map(|t| t.is_dir())
            .unwrap_or_else(|_| path.is_dir());
        if is_dir {
            if should_skip_dir(&name) {
                continue;
            }
            backlink_walk(&path, depth + 1, sc);
            continue;
        }
        if name.starts_with('.') || !is_markdown(&path) {
            continue;
        }
        // Don't list the current document as referencing itself.
        if let Some(self_path) = &sc.self_path {
            if &path == self_path {
                continue;
            }
        }
        if let Ok(meta) = entry.metadata() {
            if meta.len() > MAX_FILE_BYTES {
                continue;
            }
        }
        sc.scanned += 1;
        if sc.scanned >= MAX_SCANNED_FILES {
            sc.truncated = true;
        }
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let content = String::from_utf8_lossy(&bytes);
        if text_references(&content, &sc.want) {
            sc.found.push(Backlink {
                name,
                path: path.to_string_lossy().to_string(),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let mut p = std::env::temp_dir();
        p.push(format!("mdjoa_wikilink_test_{}_{}", tag, nanos));
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn write(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn normalize_strips_ext_and_lowercases() {
        assert_eq!(normalize_target("Note"), "note");
        assert_eq!(normalize_target("Note.md"), "note");
        assert_eq!(normalize_target("  NOTE.MARKDOWN  "), "note");
        assert_eq!(normalize_target("data.json"), "data.json");
    }

    #[test]
    fn text_references_matches_target_ignoring_heading_and_case() {
        assert!(text_references("see [[Spec]]", "spec"));
        assert!(text_references("see [[spec.md#part]]", "spec"));
        assert!(text_references("a [[other]] and [[Spec]]", "spec"));
        assert!(!text_references("see [[other]]", "spec"));
        assert!(!text_references("no links here", "spec"));
        assert!(!text_references("unclosed [[spec", "spec"));
    }

    #[test]
    fn resolve_finds_by_name_case_and_ext_insensitive() {
        let root = temp_root("resolve");
        write(&root.join("Target.md"), "hi");
        write(&root.join("other.md"), "hi");

        let folder = root.to_string_lossy().to_string();
        assert!(resolve_wikilink(folder.clone(), "Target".into())
            .unwrap()
            .ends_with("Target.md"));
        assert!(resolve_wikilink(folder.clone(), "target".into())
            .unwrap()
            .ends_with("Target.md"));
        assert!(resolve_wikilink(folder.clone(), "target.md".into())
            .unwrap()
            .ends_with("Target.md"));
        assert!(resolve_wikilink(folder, "missing".into()).is_none());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolve_skips_heavy_and_hidden_dirs() {
        let root = temp_root("resolve_skip");
        write(&root.join("node_modules").join("Hit.md"), "x");
        write(&root.join(".git").join("Hit.md"), "x");
        // Only a real (non-skipped) copy should resolve.
        let folder = root.to_string_lossy().to_string();
        assert!(resolve_wikilink(folder.clone(), "Hit".into()).is_none());
        write(&root.join("sub").join("Hit.md"), "x");
        assert!(resolve_wikilink(folder, "Hit".into())
            .unwrap()
            .ends_with("Hit.md"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn backlinks_collects_referencing_files_and_excludes_self() {
        let root = temp_root("backlinks");
        let cur = root.join("Current.md");
        write(&cur, "I reference [[Current]] myself but should be excluded");
        write(&root.join("a.md"), "see [[Current]] for details");
        write(&root.join("b.md"), "and [[current.md#section]] too");
        write(&root.join("c.md"), "no reference here");

        let res = tauri::async_runtime::block_on(scan_backlinks(
            root.to_string_lossy().to_string(),
            "Current".into(),
            Some(cur.to_string_lossy().to_string()),
        ))
        .unwrap();

        let names: Vec<_> = res.links.iter().map(|l| l.name.clone()).collect();
        assert!(names.contains(&"a.md".to_string()));
        assert!(names.contains(&"b.md".to_string()));
        assert!(!names.contains(&"c.md".to_string()));
        assert!(!names.contains(&"Current.md".to_string()), "self excluded");
        assert!(!res.truncated);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn backlinks_skips_heavy_dirs_and_sorts() {
        let root = temp_root("backlinks_skip");
        write(&root.join("node_modules").join("dep.md"), "[[Current]]");
        write(&root.join("z.md"), "[[Current]]");
        write(&root.join("a.md"), "[[Current]]");

        let res = tauri::async_runtime::block_on(scan_backlinks(
            root.to_string_lossy().to_string(),
            "Current".into(),
            None,
        ))
        .unwrap();

        let paths: Vec<_> = res.links.iter().map(|l| l.path.clone()).collect();
        assert!(paths.iter().all(|p| !p.contains("node_modules")));
        let mut sorted = paths.clone();
        sorted.sort();
        assert_eq!(paths, sorted, "results sorted by path");
        assert_eq!(res.links.len(), 2);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn backlinks_empty_name_returns_nothing() {
        let root = temp_root("backlinks_empty");
        write(&root.join("a.md"), "[[x]]");
        let res = tauri::async_runtime::block_on(scan_backlinks(
            root.to_string_lossy().to_string(),
            "  ".into(),
            None,
        ))
        .unwrap();
        assert!(res.links.is_empty());
        fs::remove_dir_all(&root).ok();
    }
}
