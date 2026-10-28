use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::command;

/// A discoverable asset under a project's `.claude/` directory: a skill,
/// subagent, or slash command. `kind` is "skill" | "agent" | "command".
#[derive(serde::Serialize, Clone, PartialEq, Debug)]
pub struct ClaudeAsset {
    pub kind: String,
    pub name: String,
    pub description: String,
    pub path: String,
}

/// Strip a matching pair of surrounding single/double quotes from a scalar.
fn strip_quotes(s: &str) -> String {
    let s = s.trim();
    if s.len() >= 2
        && ((s.starts_with('"') && s.ends_with('"'))
            || (s.starts_with('\'') && s.ends_with('\'')))
    {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

/// Parse the leading YAML frontmatter (`---` … `---`) into a flat map of the
/// keys we care about. Supports plain `key: value` and YAML block scalars
/// (`>`, `>-`, `|`, `|-`) whose value spans the following indented lines —
/// `.claude` skill files commonly write `description: >-`. For a one-line
/// sidebar preview, block-scalar lines are joined with single spaces.
/// Nested mappings/sequences are ignored. Returns an empty map when there is
/// no frontmatter or it is malformed (callers fall back to file/folder names).
fn parse_frontmatter(content: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut lines = content.lines();
    match lines.next() {
        Some(l) if l.trim_end() == "---" => {}
        _ => return out,
    }
    let mut body: Vec<&str> = Vec::new();
    let mut closed = false;
    for l in lines {
        if l.trim_end() == "---" {
            closed = true;
            break;
        }
        body.push(l);
    }
    if !closed {
        return out;
    }
    let mut i = 0;
    while i < body.len() {
        let line = body[i];
        i += 1;
        if line.starts_with(' ') || line.starts_with('\t') {
            continue; // only top-level keys
        }
        let (key, rest) = match line.split_once(':') {
            Some((k, v)) => (k.trim().to_string(), v.trim().to_string()),
            None => continue,
        };
        if key.is_empty() {
            continue;
        }
        if rest == ">" || rest == ">-" || rest == "|" || rest == "|-" {
            let mut parts: Vec<String> = Vec::new();
            while i < body.len() {
                let cont = body[i];
                if cont.trim().is_empty() {
                    i += 1;
                    continue;
                }
                if cont.starts_with(' ') || cont.starts_with('\t') {
                    parts.push(cont.trim().to_string());
                    i += 1;
                } else {
                    break;
                }
            }
            out.insert(key, parts.join(" ").trim().to_string());
            continue;
        }
        out.insert(key, strip_quotes(&rest));
    }
    out
}

/// Hard cap on assets returned (keeps the sidebar light).
const MAX_ASSETS: usize = 300;
/// Frontmatter lives at the very top, so reading the head bounds work on
/// unexpectedly large files.
const FRONTMATTER_READ_BYTES: usize = 8192;

/// Read at most the first `FRONTMATTER_READ_BYTES` of a file (UTF-8 lossy).
fn read_head(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).ok()?;
    let mut buf = vec![0u8; FRONTMATTER_READ_BYTES];
    let n = f.read(&mut buf).ok()?;
    buf.truncate(n);
    Some(String::from_utf8_lossy(&buf).to_string())
}

/// Resolve the `.claude` directory to scan, given the opened `folder`:
/// 1) `<folder>/.claude`, else 2) `<folder>` when it is named `.claude`,
/// else 3) `<folder>`'s parent when `<folder>` is `.claude/skills`.
fn resolve_claude_dir(folder: &Path) -> Option<PathBuf> {
    let nested = folder.join(".claude");
    if nested.is_dir() {
        return Some(nested);
    }
    let name = folder.file_name()?.to_string_lossy().to_string();
    if name == ".claude" && folder.is_dir() {
        return Some(folder.to_path_buf());
    }
    if name == "skills" {
        if let Some(parent) = folder.parent() {
            if parent.file_name().map(|n| n == ".claude").unwrap_or(false) && parent.is_dir() {
                return Some(parent.to_path_buf());
            }
        }
    }
    None
}

/// Immediate `*.md` files in `dir` (non-recursive) as (file_stem, path).
fn list_md_files(dir: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let fname = entry.file_name().to_string_lossy().to_string();
        if !fname.to_lowercase().ends_with(".md") {
            continue;
        }
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or(fname);
        out.push((stem, path));
    }
    out
}

fn fm_field(fm: &HashMap<String, String>, key: &str) -> Option<String> {
    fm.get(key).cloned().filter(|s| !s.is_empty())
}

/// Scan the project's `.claude/` for skills (`skills/<name>/SKILL.md`),
/// subagents (`agents/*.md`), and slash commands (`commands/*.md`). Returns
/// display name + description (from each file's frontmatter) + path to open,
/// sorted by kind (skill→agent→command) then name. Empty when no `.claude/`
/// applies (the UI hides the section). Never panics on unreadable files.
#[command]
pub fn scan_claude_assets(folder: String) -> Result<Vec<ClaudeAsset>, String> {
    let base = match resolve_claude_dir(Path::new(&folder)) {
        Some(b) => b,
        None => return Ok(Vec::new()),
    };
    let mut assets: Vec<ClaudeAsset> = Vec::new();

    // Skills: <base>/skills/<name>/SKILL.md
    if let Ok(entries) = std::fs::read_dir(base.join("skills")) {
        for entry in entries.flatten() {
            let dir = entry.path();
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let skill_md = dir.join("SKILL.md");
            if !skill_md.is_file() {
                continue;
            }
            let fm = read_head(&skill_md).map(|c| parse_frontmatter(&c)).unwrap_or_default();
            let folder_name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            assets.push(ClaudeAsset {
                kind: "skill".to_string(),
                name: fm_field(&fm, "name").unwrap_or(folder_name),
                description: fm.get("description").cloned().unwrap_or_default(),
                path: skill_md.to_string_lossy().to_string(),
            });
        }
    }

    // Agents: <base>/agents/*.md
    for (stem, path) in list_md_files(&base.join("agents")) {
        let fm = read_head(&path).map(|c| parse_frontmatter(&c)).unwrap_or_default();
        assets.push(ClaudeAsset {
            kind: "agent".to_string(),
            name: fm_field(&fm, "name").unwrap_or(stem),
            description: fm.get("description").cloned().unwrap_or_default(),
            path: path.to_string_lossy().to_string(),
        });
    }

    // Commands: <base>/commands/*.md (filename is the command name)
    for (stem, path) in list_md_files(&base.join("commands")) {
        let fm = read_head(&path).map(|c| parse_frontmatter(&c)).unwrap_or_default();
        assets.push(ClaudeAsset {
            kind: "command".to_string(),
            name: stem,
            description: fm.get("description").cloned().unwrap_or_default(),
            path: path.to_string_lossy().to_string(),
        });
    }

    fn kind_rank(k: &str) -> u8 {
        match k {
            "skill" => 0,
            "agent" => 1,
            "command" => 2,
            _ => 3,
        }
    }
    assets.sort_by(|a, b| {
        kind_rank(&a.kind)
            .cmp(&kind_rank(&b.kind))
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    assets.truncate(MAX_ASSETS);
    Ok(assets)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let mut p = std::env::temp_dir();
        p.push(format!("mdjoa_claude_test_{}_{}", tag, nanos));
        fs::create_dir_all(&p).unwrap();
        p
    }
    fn write(path: &std::path::Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn scans_skills_agents_commands_with_fallback_names() {
        let root = temp_root("scan");
        let c = root.join(".claude");
        // skill: name from frontmatter
        write(&c.join("skills").join("ui-ux").join("SKILL.md"),
              "---\nname: ui-ux\ndescription: 디자인 작업\n---\n");
        // skill: no name → folder-name fallback
        write(&c.join("skills").join("nameless").join("SKILL.md"), "no frontmatter");
        // agent
        write(&c.join("agents").join("planner.md"),
              "---\nname: Plan\ndescription: 계획\n---\n");
        // command: name = file stem
        write(&c.join("commands").join("deploy.md"), "---\ndescription: 배포\n---\n");

        let res = scan_claude_assets(root.to_string_lossy().to_string()).unwrap();

        let skill = res.iter().find(|a| a.name == "ui-ux").unwrap();
        assert_eq!(skill.kind, "skill");
        assert_eq!(skill.description, "디자인 작업");
        assert!(res.iter().any(|a| a.kind == "skill" && a.name == "nameless"));
        assert!(res.iter().any(|a| a.kind == "agent" && a.name == "Plan"));
        let cmd = res.iter().find(|a| a.kind == "command").unwrap();
        assert_eq!(cmd.name, "deploy");
        assert_eq!(cmd.description, "배포");

        // Ordering: all skills come before agents before commands.
        let kinds: Vec<&str> = res.iter().map(|a| a.kind.as_str()).collect();
        let first_agent = kinds.iter().position(|k| *k == "agent").unwrap();
        let last_skill = kinds.iter().rposition(|k| *k == "skill").unwrap();
        assert!(last_skill < first_agent);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn no_claude_dir_returns_empty() {
        let root = temp_root("empty");
        write(&root.join("README.md"), "x");
        let res = scan_claude_assets(root.to_string_lossy().to_string()).unwrap();
        assert!(res.is_empty());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolves_when_folder_is_dot_claude_itself() {
        let root = temp_root("isclaude");
        let c = root.join(".claude");
        write(&c.join("skills").join("foo").join("SKILL.md"), "---\nname: foo\n---\n");
        // Open the `.claude` dir directly.
        let res = scan_claude_assets(c.to_string_lossy().to_string()).unwrap();
        assert!(res.iter().any(|a| a.name == "foo"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn parses_plain_and_folded_frontmatter() {
        let content = "---\nname: ui-ux\ndescription: >-\n  첫 줄\n  둘째 줄\n---\n# Body\n";
        let fm = parse_frontmatter(content);
        assert_eq!(fm.get("name").map(|s| s.as_str()), Some("ui-ux"));
        assert_eq!(fm.get("description").map(|s| s.as_str()), Some("첫 줄 둘째 줄"));
    }

    #[test]
    fn strips_quotes_and_ignores_non_frontmatter() {
        assert!(parse_frontmatter("no frontmatter here").is_empty());
        let fm = parse_frontmatter("---\nname: \"quoted\"\n---\n");
        assert_eq!(fm.get("name").map(|s| s.as_str()), Some("quoted"));
    }

    #[test]
    fn unclosed_fence_returns_empty() {
        assert!(parse_frontmatter("---\nname: x\nno closing fence\n").is_empty());
    }

    #[test]
    fn resolves_when_folder_is_skills_subdir() {
        let root = temp_root("isskills");
        let c = root.join(".claude");
        write(&c.join("skills").join("bar").join("SKILL.md"), "---\nname: bar\n---\n");
        let skills_dir = c.join("skills");
        let res = scan_claude_assets(skills_dir.to_string_lossy().to_string()).unwrap();
        assert!(res.iter().any(|a| a.name == "bar"));
        fs::remove_dir_all(&root).ok();
    }
}
