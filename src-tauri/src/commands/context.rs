use std::path::Path;
use tauri::command;

/// A context document discovered under the opened folder. Mirrors the shape the
/// sidebar needs: a display `name` (file name only) and an absolute `path`.
#[derive(serde::Serialize, Clone)]
pub struct ContextFile {
    pub name: String,
    pub path: String,
}

/// Maximum directory depth we descend into while scanning for context files
/// (the scan root is depth 0). Deep trees below this are almost always
/// build/dependency artifacts rather than authored context docs. Kept modest
/// (6) so nested `SKILL.md` files are still found without walking huge trees.
const MAX_DEPTH: usize = 6;
/// Hard cap on the number of context files returned, keeping the sidebar light
/// and the walk bounded on unexpectedly large trees.
const MAX_RESULTS: usize = 200;

/// Directory names that are always skipped: heavy dependency/build/cache trees
/// that never contain user-authored context docs worth surfacing. Matched on
/// the final path component only (case-sensitive — these are conventional
/// names). Kept in sync with `search.rs::SKIP_DIRS` intentionally rather than
/// shared, to avoid changing the already-shipped search module's surface.
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

/// Returns true if `name` is a directory we should never descend into:
/// hidden (dot-prefixed) directories or a well-known heavy directory.
fn should_skip_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name)
}

/// Case-insensitive match of a file `name` against a single glob `pattern`.
///
/// Globbing is deliberately minimal — only `*` is supported (matches any run of
/// characters, including none). This covers the spec patterns
/// (`*.spec.md`, `plan*.md`, `*.plan.md`) and the literal names (`CLAUDE.md`).
/// `?` and character classes are intentionally unsupported (feature creep).
fn glob_match(pattern: &str, name: &str) -> bool {
    // Lowercased so matching is case-insensitive on both sides.
    let p: Vec<char> = pattern.to_lowercase().chars().collect();
    let s: Vec<char> = name.to_lowercase().chars().collect();
    // Classic two-pointer wildcard match with backtracking on `*`.
    let (mut pi, mut si) = (0usize, 0usize);
    let (mut star, mut mark) = (usize::MAX, 0usize);
    while si < s.len() {
        if pi < p.len() && (p[pi] == s[si]) {
            pi += 1;
            si += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = pi;
            mark = si;
            pi += 1;
        } else if star != usize::MAX {
            pi = star + 1;
            mark += 1;
            si = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

/// True if `name` matches any of the supplied glob patterns.
fn matches_any(name: &str, patterns: &[String]) -> bool {
    patterns.iter().any(|pat| glob_match(pat, name))
}

/// Mutable state threaded through the recursive walk so the result cap is
/// enforced in exactly one place.
struct Scanner<'a> {
    patterns: &'a [String],
    found: Vec<ContextFile>,
}

impl<'a> Scanner<'a> {
    fn done(&self) -> bool {
        self.found.len() >= MAX_RESULTS
    }
}

/// Scan `folder` for files whose name matches any of `patterns` (minimal glob,
/// case-insensitive). Returns the matches as `{name, path}`, sorted by path and
/// de-duplicated.
///
/// Performance guards (for huge/deep trees):
/// - skips hidden dirs and heavy build/dependency dirs (`SKIP_DIRS`),
/// - descends at most `MAX_DEPTH` levels,
/// - returns at most `MAX_RESULTS` files.
///
/// Single one-shot scan — no index, no file watcher (by design). Never panics
/// on unreadable files/dirs — they are simply skipped.
#[command]
pub fn scan_context_files(
    folder: String,
    patterns: Vec<String>,
) -> Result<Vec<ContextFile>, String> {
    // No patterns → nothing to surface (the UI hides the section anyway).
    let patterns: Vec<String> = patterns
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    if patterns.is_empty() {
        return Ok(Vec::new());
    }

    let mut scanner = Scanner {
        patterns: &patterns,
        found: Vec::new(),
    };
    walk(Path::new(&folder), 0, &mut scanner);

    let mut found = scanner.found;
    // Sort by path, then de-dupe (paths are unique already, but this guards
    // against any accidental double-visit and gives a stable order).
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found.dedup_by(|a, b| a.path == b.path);
    Ok(found)
}

/// Depth-first walk. `depth` is the level below the scan root (root == 0).
fn walk(dir: &Path, depth: usize, sc: &mut Scanner) {
    if sc.done() || depth > MAX_DEPTH {
        return;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return, // unreadable dir: skip silently
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
            walk(&path, depth + 1, sc);
            continue;
        }

        // Skip hidden files; match the remaining files by name only.
        if name.starts_with('.') {
            continue;
        }
        if matches_any(&name, sc.patterns) {
            sc.found.push(ContextFile {
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
    use std::path::PathBuf;

    fn temp_root(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let mut p = std::env::temp_dir();
        p.push(format!("mdjoa_context_test_{}_{}", tag, nanos));
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn write(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn default_patterns() -> Vec<String> {
        vec![
            "CLAUDE.md".to_string(),
            "AGENTS.md".to_string(),
            "SKILL.md".to_string(),
            "README.md".to_string(),
            "*.spec.md".to_string(),
            "plan*.md".to_string(),
            "*.plan.md".to_string(),
        ]
    }

    #[test]
    fn glob_literal_and_wildcards() {
        assert!(glob_match("CLAUDE.md", "CLAUDE.md"));
        assert!(glob_match("CLAUDE.md", "claude.md")); // case-insensitive
        assert!(!glob_match("CLAUDE.md", "CLAUDE.txt"));
        assert!(glob_match("*.spec.md", "api.spec.md"));
        assert!(glob_match("*.spec.md", ".spec.md")); // `*` matches empty
        assert!(!glob_match("*.spec.md", "api.spec.markdown"));
        assert!(glob_match("plan*.md", "plan.md"));
        assert!(glob_match("plan*.md", "plan-v2.md"));
        assert!(!glob_match("plan*.md", "myplan.md"));
        assert!(glob_match("*.plan.md", "release.plan.md"));
    }

    #[test]
    fn finds_matches_and_skips_others() {
        let root = temp_root("matches");
        write(&root.join("CLAUDE.md"), "x");
        write(&root.join("README.md"), "x");
        write(&root.join("api.spec.md"), "x");
        write(&root.join("plan-v1.md"), "x");
        write(&root.join("notes.md"), "x"); // no pattern matches
        write(&root.join("data.txt"), "x"); // wrong extension

        let res = scan_context_files(
            root.to_string_lossy().to_string(),
            default_patterns(),
        )
        .unwrap();

        let names: Vec<_> = res.iter().map(|c| c.name.clone()).collect();
        assert!(names.contains(&"CLAUDE.md".to_string()));
        assert!(names.contains(&"README.md".to_string()));
        assert!(names.contains(&"api.spec.md".to_string()));
        assert!(names.contains(&"plan-v1.md".to_string()));
        assert!(!names.contains(&"notes.md".to_string()));
        assert!(!names.contains(&"data.txt".to_string()));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn finds_nested_skill_md_but_skips_heavy_and_hidden_dirs() {
        let root = temp_root("nested");
        // A nested SKILL.md within depth must be found.
        write(&root.join("skills").join("foo").join("SKILL.md"), "x");
        // These directories must never be descended into.
        write(&root.join("node_modules").join("CLAUDE.md"), "x");
        write(&root.join("target").join("AGENTS.md"), "x");
        write(&root.join(".git").join("CLAUDE.md"), "x");

        let res = scan_context_files(
            root.to_string_lossy().to_string(),
            default_patterns(),
        )
        .unwrap();

        assert_eq!(res.len(), 1, "only the nested SKILL.md should match");
        assert!(res[0].path.ends_with("SKILL.md"));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn enforces_depth_limit() {
        let root = temp_root("depth");
        // root/d1/.../d{MAX_DEPTH+2}/CLAUDE.md — below the limit, excluded.
        let mut deep = root.clone();
        for i in 1..=(MAX_DEPTH + 2) {
            deep.push(format!("d{}", i));
        }
        write(&deep.join("CLAUDE.md"), "x");
        // A shallow match that must always be found.
        write(&root.join("README.md"), "x");

        let res = scan_context_files(
            root.to_string_lossy().to_string(),
            default_patterns(),
        )
        .unwrap();

        assert!(res.iter().any(|c| c.name == "README.md"));
        assert!(
            res.iter().all(|c| !c.path.contains("d7")),
            "files below MAX_DEPTH must be skipped"
        );

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn empty_patterns_returns_nothing() {
        let root = temp_root("nopatterns");
        write(&root.join("CLAUDE.md"), "x");
        let res =
            scan_context_files(root.to_string_lossy().to_string(), vec![]).unwrap();
        assert!(res.is_empty());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn results_sorted_and_deduped() {
        let root = temp_root("sorted");
        write(&root.join("README.md"), "x");
        write(&root.join("CLAUDE.md"), "x");
        write(&root.join("AGENTS.md"), "x");

        let res = scan_context_files(
            root.to_string_lossy().to_string(),
            default_patterns(),
        )
        .unwrap();

        let paths: Vec<_> = res.iter().map(|c| c.path.clone()).collect();
        let mut sorted = paths.clone();
        sorted.sort();
        assert_eq!(paths, sorted, "results must be sorted by path");

        fs::remove_dir_all(&root).ok();
    }
}
