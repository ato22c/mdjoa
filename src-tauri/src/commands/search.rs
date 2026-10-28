use std::path::Path;
use tauri::command;

/// A single matching line inside a Markdown file.
#[derive(serde::Serialize)]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    /// 1-based line number of the match.
    pub line: u32,
    /// The matching line text, trimmed to ~200 chars around the match.
    pub text: String,
}

/// Result of a folder-wide search. `truncated` is true when any performance
/// guard (hit cap, scanned-file cap, depth limit) stopped the walk before it
/// could exhaust the tree — the frontend surfaces this so the user knows the
/// result list is partial rather than complete.
#[derive(serde::Serialize)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub truncated: bool,
}

/// Hard cap on the number of results returned, to keep the UI light and the
/// walk fast. The frontend shows a "truncated" note when this many are hit.
const MAX_HITS: usize = 200;
/// Hard cap on the number of `.md`/`.markdown` files we will read. Protects
/// against huge/deep trees where even a "no match" walk would be expensive.
const MAX_SCANNED_FILES: usize = 5_000;
/// Maximum directory depth we descend into (the search root is depth 0). Trees
/// deeper than this have their lower levels skipped — they are almost always
/// build/dependency artifacts rather than documents.
const MAX_DEPTH: usize = 10;
/// Files larger than this are skipped entirely. Markdown documents are tiny;
/// anything this large is almost certainly generated/binary-ish noise.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024; // 2 MiB
/// Approximate window of characters kept around a match on long lines.
const SNIPPET_RADIUS: usize = 100;

/// Directory names that are always skipped: heavy dependency/build/cache trees
/// that never contain user-authored Markdown worth searching. Matched on the
/// final path component only (case-sensitive — these are conventional names).
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

/// Mutable state threaded through the recursive walk so each guard (hit cap,
/// scanned-file cap) is enforced in exactly one place.
struct Walker<'a> {
    needle: &'a str,
    hits: Vec<SearchHit>,
    scanned: usize,
    truncated: bool,
}

impl<'a> Walker<'a> {
    fn new(needle: &'a str) -> Self {
        Walker {
            needle,
            hits: Vec::new(),
            scanned: 0,
            truncated: false,
        }
    }

    /// True once any guard has fired and we should stop descending/reading.
    fn done(&self) -> bool {
        self.hits.len() >= MAX_HITS || self.scanned >= MAX_SCANNED_FILES
    }
}

/// Returns true if `name` is a directory we should never descend into:
/// hidden (dot-prefixed) directories or a well-known heavy directory.
fn should_skip_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name)
}

/// Returns true if `path` has a Markdown extension (`.md` / `.markdown`),
/// case-insensitively.
fn is_markdown(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let ext = ext.to_lowercase();
            ext == "md" || ext == "markdown"
        }
        None => false,
    }
}

/// Recursively full-text search every `.md`/`.markdown` file under `folder`
/// for `query` (case-insensitive substring).
///
/// Performance guards (for huge/deep trees):
/// - skips hidden dirs and heavy build/dependency dirs (`SKIP_DIRS`),
/// - descends at most `MAX_DEPTH` levels,
/// - reads at most `MAX_SCANNED_FILES` files and skips files > `MAX_FILE_BYTES`,
/// - returns at most `MAX_HITS` hits.
///
/// When any cap stops the walk early, `SearchResult.truncated` is `true`.
/// Never panics on unreadable files/dirs — they are simply skipped.
#[command]
pub fn search_in_folder(folder: String, query: String) -> Result<SearchResult, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(SearchResult {
            hits: Vec::new(),
            truncated: false,
        });
    }
    let needle = query.to_lowercase();

    let mut walker = Walker::new(&needle);
    walk(Path::new(&folder), 0, &mut walker);

    Ok(SearchResult {
        hits: walker.hits,
        truncated: walker.truncated,
    })
}

/// Depth-first walk. `depth` is the level below the search root (root == 0).
/// Mutates `w` in place, stopping early once any guard fires.
fn walk(dir: &Path, depth: usize, w: &mut Walker) {
    if w.done() {
        return;
    }
    // Beyond the depth limit we stop descending. Flag truncation so the UI can
    // hint that deeper files were not searched.
    if depth > MAX_DEPTH {
        w.truncated = true;
        return;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return, // unreadable dir: skip silently
    };

    for entry in entries.flatten() {
        if w.done() {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();

        // file_type avoids an extra stat where possible; fall back to is_dir().
        let is_dir = entry
            .file_type()
            .map(|t| t.is_dir())
            .unwrap_or_else(|_| path.is_dir());

        if is_dir {
            if should_skip_dir(&name) {
                continue;
            }
            walk(&path, depth + 1, w);
            continue;
        }

        // Skip hidden files too.
        if name.starts_with('.') {
            continue;
        }
        if !is_markdown(&path) {
            continue;
        }

        // Skip oversized files; treat them as "noise" rather than documents.
        if let Ok(meta) = entry.metadata() {
            if meta.len() > MAX_FILE_BYTES {
                continue;
            }
        }

        // Count every Markdown file we actually open against the scan cap.
        w.scanned += 1;
        if w.scanned >= MAX_SCANNED_FILES {
            w.truncated = true;
        }

        search_file(&path, &name, w);
    }
}

/// Read a single file and append any matching lines to `w.hits`. Marks
/// `w.truncated` if the hit cap is reached while scanning this file.
fn search_file(path: &Path, name: &str, w: &mut Walker) {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(_) => return, // unreadable file: skip
    };
    let content = String::from_utf8_lossy(&bytes);

    for (idx, line) in content.lines().enumerate() {
        if w.hits.len() >= MAX_HITS {
            w.truncated = true;
            return;
        }
        let line_lower = line.to_lowercase();
        if let Some(pos) = line_lower.find(w.needle) {
            w.hits.push(SearchHit {
                path: path.to_string_lossy().to_string(),
                name: name.to_string(),
                line: (idx as u32) + 1,
                text: snippet(line, pos, w.needle.len()),
            });
        }
    }
}

/// Trim a long line to a window around the match. `match_byte` is the byte
/// offset (from the lowercased line, which is byte-compatible for the purpose
/// of windowing on the original). Falls back gracefully on multi-byte text by
/// always slicing on char boundaries.
fn snippet(line: &str, match_byte: usize, match_len: usize) -> String {
    let chars: Vec<char> = line.chars().collect();
    if chars.len() <= 2 * SNIPPET_RADIUS + match_len {
        return line.to_string();
    }

    // Convert the byte offset of the match into a char index.
    let match_char = line[..match_byte.min(line.len())].chars().count();

    let start = match_char.saturating_sub(SNIPPET_RADIUS);
    let end = (match_char + match_len + SNIPPET_RADIUS).min(chars.len());

    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.extend(&chars[start..end]);
    if end < chars.len() {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    /// Create a unique temp dir under the OS temp location. Uses `std::path`
    /// joins (no separator hardcoding) for Windows/macOS parity.
    fn temp_root(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let mut p = std::env::temp_dir();
        p.push(format!("mdjoa_search_test_{}_{}", tag, nanos));
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
    fn skips_excluded_and_hidden_dirs() {
        let root = temp_root("excluded");

        write(&root.join("doc.md"), "hello needle here");
        // Each of these must be ignored by the walk.
        write(&root.join("node_modules").join("dep.md"), "needle in dep");
        write(&root.join("target").join("gen.md"), "needle in target");
        write(&root.join(".git").join("hook.md"), "needle in git");
        write(&root.join(".hidden").join("secret.md"), "needle hidden");
        write(&root.join("__pycache__").join("c.md"), "needle pyc");

        let res =
            search_in_folder(root.to_string_lossy().to_string(), "needle".to_string()).unwrap();

        assert_eq!(res.hits.len(), 1, "only the top-level doc.md should match");
        assert!(res.hits[0].path.ends_with("doc.md"));
        assert!(!res.truncated);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn skips_hidden_and_non_markdown_files() {
        let root = temp_root("filetypes");
        write(&root.join("a.md"), "needle a");
        write(&root.join("b.markdown"), "needle b");
        write(&root.join("c.txt"), "needle c"); // wrong extension
        write(&root.join(".secret.md"), "needle hidden file"); // hidden file

        let res =
            search_in_folder(root.to_string_lossy().to_string(), "needle".to_string()).unwrap();

        assert_eq!(res.hits.len(), 2);
        let mut names: Vec<_> = res.hits.iter().map(|h| h.name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["a.md".to_string(), "b.markdown".to_string()]);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn enforces_depth_limit() {
        let root = temp_root("depth");

        // Build a chain: root/d1/d2/.../d{MAX_DEPTH+2}/deep.md
        let mut deep = root.clone();
        for i in 1..=(MAX_DEPTH + 2) {
            deep.push(format!("d{}", i));
        }
        write(&deep.join("deep.md"), "needle too deep");
        // A shallow file that must always be found.
        write(&root.join("shallow.md"), "needle shallow");

        let res =
            search_in_folder(root.to_string_lossy().to_string(), "needle".to_string()).unwrap();

        // The deep file is below MAX_DEPTH and must be excluded.
        assert!(
            res.hits.iter().all(|h| !h.path.ends_with("deep.md")),
            "file below MAX_DEPTH should be skipped"
        );
        assert!(
            res.hits.iter().any(|h| h.path.ends_with("shallow.md")),
            "shallow file must be found"
        );
        assert!(res.truncated, "hitting the depth limit should set truncated");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn enforces_hit_cap_and_truncates() {
        let root = temp_root("hitcap");

        // One file with far more matching lines than MAX_HITS.
        let mut content = String::new();
        for i in 0..(MAX_HITS + 50) {
            content.push_str(&format!("line {} has needle\n", i));
        }
        write(&root.join("big.md"), &content);

        let res =
            search_in_folder(root.to_string_lossy().to_string(), "needle".to_string()).unwrap();

        assert_eq!(res.hits.len(), MAX_HITS, "hits must be capped at MAX_HITS");
        assert!(res.truncated, "exceeding MAX_HITS must set truncated");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn skips_oversized_files() {
        let root = temp_root("bigfile");

        // A file just over the size cap, containing the needle.
        let filler = "x".repeat((MAX_FILE_BYTES as usize) + 1024);
        write(&root.join("huge.md"), &format!("needle\n{}", filler));
        // A small file with the needle that must be found.
        write(&root.join("small.md"), "needle small");

        let res =
            search_in_folder(root.to_string_lossy().to_string(), "needle".to_string()).unwrap();

        assert!(
            res.hits.iter().all(|h| !h.path.ends_with("huge.md")),
            "oversized file must be skipped"
        );
        assert!(res.hits.iter().any(|h| h.path.ends_with("small.md")));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn empty_query_returns_nothing() {
        let root = temp_root("empty");
        write(&root.join("a.md"), "anything");
        let res = search_in_folder(root.to_string_lossy().to_string(), "   ".to_string()).unwrap();
        assert!(res.hits.is_empty());
        assert!(!res.truncated);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn snippet_trims_long_lines() {
        let long = format!("{}NEEDLE{}", "a".repeat(500), "b".repeat(500));
        let pos = long.to_lowercase().find("needle").unwrap();
        let s = snippet(&long, pos, "needle".len());
        assert!(s.contains("NEEDLE"));
        assert!(s.starts_with('…'));
        assert!(s.ends_with('…'));
        assert!(s.chars().count() < long.chars().count());
    }
}
