# `.claude` 스킬 목록 사이드바 섹션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폴더를 열 때 `.claude/`를 감지해 스킬·서브에이전트·슬래시 커맨드를 사이드바 "스킬" 섹션에 자동 목록으로 보여주고, 클릭하면 해당 `.md`를 뷰어로 연다(폴더 워처로 실시간 갱신).

**Architecture:** 컨텍스트 자동 그룹(`ContextSection`)과 동형 — Rust 전용 커맨드 `scan_claude_assets`가 `.claude/{skills,agents,commands}`를 한 번 스캔하고 각 파일의 YAML frontmatter(`name`/`description`)를 파싱해 완성형 `ClaudeAsset[]`를 반환한다. 프론트는 스토어에 담아 `SkillsSection`이 렌더하며, 기존 재귀 폴더 워처가 `.claude` 경로 변경 시 재스캔만 트리거한다(트리 뱃지 없음).

**Tech Stack:** Tauri 2.x(Rust), React 18 + TypeScript + Zustand, Lucide 아이콘, vitest(프론트, node 환경) + Rust `#[cfg(test)]` 단위테스트.

## Global Constraints

- 단일 코드베이스로 Windows·macOS 동시 지원. OS 분기 금지(이 기능은 `.claude`가 양 OS 공통이라 분기 불필요). 경로는 `std::path`/`PathBuf` 사용, 구분자 하드코딩 금지.
- 콘텐츠 퍼스트 미니멀: 상단 메뉴바·아이콘 증가 없음. 섹션은 `.claude` 자산이 있을 때만 노출(평소 크롬 0).
- 텔레메트리/네트워크 통신 금지. 설정(SettingsModal) 추가 없음(경로 고정).
- 예외 시 앱이 죽지 않고 무음 처리 + 필요 시 `write_log`. atomic write 무관(읽기 전용 기능).
- 한국어 UI. 아이콘은 Lucide 단일 세트만.
- 커밋은 작은 단위로 자주. 각 태스크 끝에서 독립적으로 테스트 가능.

---

## File Structure

| 파일 | 역할 | 신규/수정 |
| --- | --- | --- |
| `src-tauri/src/commands/claude_assets.rs` | `ClaudeAsset` 구조체, frontmatter 파서, `scan_claude_assets` 커맨드 + 단위테스트 | 신규 |
| `src-tauri/src/commands/mod.rs` | `pub mod claude_assets;` 선언 | 수정 |
| `src-tauri/src/lib.rs` | `use` + `invoke_handler!` 등록 | 수정 |
| `src/types/index.ts` | `ClaudeAsset` 타입 | 수정 |
| `src/store/app.ts` | `claudeAssets` 상태 + `scanClaudeAssets()` 액션 + `setFolder` 연결 | 수정 |
| `src/lib/mdPath.ts` | `isClaudeAssetPath` 순수 헬퍼 | 수정 |
| `src/lib/mdPath.test.ts` | `isClaudeAssetPath` 테스트 | 수정(또는 신규) |
| `src/hooks/useFolderWatch.ts` | `.claude` 변경 시 재스캔 디바운스 | 수정 |
| `src/components/sidebar/SkillsSection.tsx` | 사이드바 "스킬" 섹션 컴포넌트 | 신규 |
| `src/components/layout/AppShell.tsx` | `<SkillsSection />` 배치 | 수정 |

---

## Task 1: Rust frontmatter 파서 + `ClaudeAsset` (모듈 신설)

**Files:**
- Create: `src-tauri/src/commands/claude_assets.rs`
- Modify: `src-tauri/src/commands/mod.rs` (모듈 선언)

**Interfaces:**
- Produces: `pub struct ClaudeAsset { kind: String, name: String, description: String, path: String }`; `fn parse_frontmatter(content: &str) -> std::collections::HashMap<String, String>`(모듈 내부).

- [ ] **Step 1: 모듈 선언 추가**

`src-tauri/src/commands/mod.rs`를 열어 기존 `pub mod ...;` 선언들과 동일한 자리(알파벳 순서상 `bookmarks` 다음)에 한 줄 추가:

```rust
pub mod claude_assets;
```

- [ ] **Step 2: 실패하는 테스트부터 작성**

`src-tauri/src/commands/claude_assets.rs` 생성. 먼저 구조체 + 파서 시그니처(빈 구현)와 테스트만 둔다:

```rust
use std::collections::HashMap;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd src-tauri && cargo test claude_assets`
Expected: PASS (이 태스크의 파서는 Step 2에서 이미 완성형으로 작성 — 컴파일 통과 + 3개 테스트 통과). 만약 컴파일 에러가 나면 `mod.rs` 선언 누락이므로 Step 1을 확인.

> 참고: 이 모듈은 TDD상 "테스트와 구현을 함께" 작성한다(파서는 순수 함수라 한 번에 검증). 다음 태스크에서 커맨드를 얹는다.

- [ ] **Step 4: 커밋**

```bash
git add src-tauri/src/commands/claude_assets.rs src-tauri/src/commands/mod.rs
git commit -m "feat(claude-assets): .claude frontmatter 파서 + ClaudeAsset 구조체"
```

---

## Task 2: `scan_claude_assets` 커맨드 + 등록

**Files:**
- Modify: `src-tauri/src/commands/claude_assets.rs`
- Modify: `src-tauri/src/lib.rs` (`use` + `invoke_handler!`)

**Interfaces:**
- Consumes: `ClaudeAsset`, `parse_frontmatter` (Task 1).
- Produces: `#[tauri::command] pub fn scan_claude_assets(folder: String) -> Result<Vec<ClaudeAsset>, String>`.

- [ ] **Step 1: 실패하는 테스트 작성**

`claude_assets.rs`의 `mod tests`에 헬퍼와 테스트를 추가(기존 `context.rs` 테스트의 `temp_root`/`write` 패턴 차용):

```rust
    use std::fs;
    use std::path::{Path, PathBuf};

    fn temp_root(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let mut p = std::env::temp_dir();
        p.push(format!("mdjoa_claude_test_{}_{}", tag, nanos));
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd src-tauri && cargo test claude_assets`
Expected: FAIL — `scan_claude_assets` 미정의(컴파일 에러).

- [ ] **Step 3: 커맨드 구현**

`claude_assets.rs`의 `mod tests` **위쪽**(파서 다음)에 추가:

```rust
use std::path::{Path, PathBuf};
use tauri::command;

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
```

`mod tests` 상단의 `use super::*;`는 그대로 두고, Step 1에서 추가한 `use std::path::{Path, PathBuf};`가 본문의 동일 import와 중복되면 테스트 모듈 쪽 중복 `use`를 제거한다(본문 `use`가 `super::*`로 노출됨).

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd src-tauri && cargo test claude_assets`
Expected: PASS (파서 3 + 커맨드 3 = 6 테스트).

- [ ] **Step 5: `lib.rs`에 커맨드 등록**

`src-tauri/src/lib.rs`의 `use commands::{ ... }` 블록에서 `bookmarks::...` 다음 줄에 추가:

```rust
    claude_assets::scan_claude_assets,
```

그리고 `invoke_handler![ ... ]` 목록에 `scan_context_files,` 다음 줄에 추가:

```rust
            scan_claude_assets,
```

- [ ] **Step 6: 컴파일 확인**

Run: `cd src-tauri && cargo check`
Expected: 경고 증가 0, 에러 0.

- [ ] **Step 7: 커밋**

```bash
git add src-tauri/src/commands/claude_assets.rs src-tauri/src/lib.rs
git commit -m "feat(claude-assets): scan_claude_assets 커맨드 + invoke_handler 등록"
```

---

## Task 3: 프론트 타입 + 스토어 액션 + `setFolder` 연결

**Files:**
- Modify: `src/types/index.ts:44-48` (ContextFile 다음)
- Modify: `src/store/app.ts` (상태 46행 부근, 시그니처 183행 부근, 초기값 329행 부근, `setFolder` 656행, 구현은 `scanContextFiles` 702행 다음)

**Interfaces:**
- Consumes: Tauri `scan_claude_assets` 커맨드(Task 2).
- Produces: 스토어 상태 `claudeAssets: ClaudeAsset[]`, 액션 `scanClaudeAssets(): Promise<void>`; 타입 `ClaudeAsset`.

- [ ] **Step 1: 타입 추가**

`src/types/index.ts`의 `ContextFile` 인터페이스 바로 아래에:

```ts
/** A skill/agent/command discovered under the open project's `.claude/` dir. */
export interface ClaudeAsset {
  kind: "skill" | "agent" | "command";
  name: string;
  description: string;
  path: string;
}
```

- [ ] **Step 2: 스토어 상태/시그니처/초기값 추가**

`src/store/app.ts`에서 (a) `ClaudeAsset`를 기존 타입 import에 추가(예: `import type { ..., ContextFile, ClaudeAsset } from "../types";` — 기존 import 구문에 맞춰 한 항목 추가),
(b) 상태 인터페이스의 `contextFiles: ContextFile[];`(46행) 다음 줄:

```ts
  claudeAssets: ClaudeAsset[];
```

(c) 액션 시그니처 `scanContextFiles: () => Promise<void>;`(183행) 다음 줄:

```ts
  scanClaudeAssets: () => Promise<void>;
```

(d) 초기 상태 `contextFiles: [],`(329행) 다음 줄:

```ts
  claudeAssets: [],
```

- [ ] **Step 3: 액션 구현 + `setFolder` 연결**

`scanContextFiles` 구현(702행, 닫는 `},`) **다음에** 새 액션 추가:

```ts
  scanClaudeAssets: async () => {
    const folder = get().currentFolder;
    if (!folder) {
      set({ claudeAssets: [] });
      return;
    }
    try {
      const assets = await invoke<ClaudeAsset[]>("scan_claude_assets", { folder });
      set({ claudeAssets: assets });
    } catch (e) {
      // No `.claude` (or a scan error) is normal — clear silently, never block
      // folder opening.
      set({ claudeAssets: [] });
      await invoke("write_log", {
        level: "error",
        message: `scan_claude_assets failed: ${e}`,
      }).catch(() => {});
    }
  },
```

`setFolder`의 `get().scanContextFiles();`(656행) 바로 다음 줄에:

```ts
    get().scanClaudeAssets();
```

- [ ] **Step 4: 타입체크**

Run: `npm run build` 의 tsc 단계(또는 `npx tsc --noEmit`)
Expected: 타입 에러 0. (런타임 검증은 Task 6에서 통합.)

- [ ] **Step 5: 커밋**

```bash
git add src/types/index.ts src/store/app.ts
git commit -m "feat(skills): claudeAssets 스토어 상태 + scanClaudeAssets 액션 + setFolder 연결"
```

---

## Task 4: `isClaudeAssetPath` 순수 헬퍼 (TDD)

**Files:**
- Modify: `src/lib/mdPath.ts`
- Modify/Create: `src/lib/mdPath.test.ts`

**Interfaces:**
- Produces: `export function isClaudeAssetPath(path: string): boolean`, `export const CLAUDE_ASSET_RE`.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/mdPath.test.ts`에 추가(파일이 없으면 생성하고 `import { isClaudeAssetPath } from "./mdPath";` + vitest import):

```ts
import { describe, it, expect } from "vitest";
import { isClaudeAssetPath } from "./mdPath";

describe("isClaudeAssetPath", () => {
  it("matches skills/agents/commands .md under .claude (POSIX & Windows)", () => {
    expect(isClaudeAssetPath("/proj/.claude/skills/ui-ux/SKILL.md")).toBe(true);
    expect(isClaudeAssetPath("/proj/.claude/agents/planner.md")).toBe(true);
    expect(isClaudeAssetPath("C:\\proj\\.claude\\commands\\deploy.md")).toBe(true);
  });
  it("rejects non-asset paths", () => {
    expect(isClaudeAssetPath("/proj/.claude/settings.local.json")).toBe(false);
    expect(isClaudeAssetPath("/proj/.claude/skills/ui-ux/notes.txt")).toBe(false);
    expect(isClaudeAssetPath("/proj/docs/README.md")).toBe(false);
    expect(isClaudeAssetPath("/proj/.git/skills/x.md")).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/mdPath.test.ts`
Expected: FAIL — `isClaudeAssetPath` 미정의.

- [ ] **Step 3: 헬퍼 구현**

`src/lib/mdPath.ts` 끝에 추가:

```ts
/**
 * Matches a Markdown asset under a project's `.claude/` directory — a skill,
 * subagent, or slash command. The folder watcher uses this to re-scan the 스킬
 * section on change WITHOUT surfacing a tree badge: these live under a dot-dir,
 * which `isWatchableMarkdownPath` deliberately ignores. Works for both POSIX
 * (`/`) and Windows (`\`) separators.
 */
export const CLAUDE_ASSET_RE =
  /(^|[\\/])\.claude[\\/](skills|agents|commands)[\\/].+\.md$/i;
export function isClaudeAssetPath(path: string): boolean {
  return CLAUDE_ASSET_RE.test(path);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/mdPath.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/mdPath.ts src/lib/mdPath.test.ts
git commit -m "feat(skills): isClaudeAssetPath 경로 판별 헬퍼 + 테스트"
```

---

## Task 5: 폴더 워처 연동 자동 재스캔

**Files:**
- Modify: `src/hooks/useFolderWatch.ts`

**Interfaces:**
- Consumes: `isClaudeAssetPath`(Task 4), `useAppStore.getState().scanClaudeAssets`(Task 3).

- [ ] **Step 1: import 추가**

`src/hooks/useFolderWatch.ts`의 import에서:

```ts
import { isWatchableMarkdownPath } from "../lib/mdPath";
```
를
```ts
import { isWatchableMarkdownPath, isClaudeAssetPath } from "../lib/mdPath";
```
로 변경.

- [ ] **Step 2: 디바운스 재스캔 추가**

`scheduleRefresh` 정의(40행, 닫는 `};`) **다음에** 추가:

```ts
    // `.claude/{skills,agents,commands}` changes → re-scan the 스킬 section.
    // Separate from the tree-badge path: these live under a dot-dir which
    // isWatchableMarkdownPath ignores, so they never badge the tree.
    let claudeRescanTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleClaudeRescan = () => {
      if (claudeRescanTimer) clearTimeout(claudeRescanTimer);
      claudeRescanTimer = setTimeout(() => {
        claudeRescanTimer = null;
        if (active) useAppStore.getState().scanClaudeAssets();
      }, DEBOUNCE_MS);
    };
```

- [ ] **Step 3: 이벤트 루프에서 호출**

`watchImmediate` 콜백의 `for (const path of event.paths) {` 루프 첫 줄(현재 `if (!isWatchableMarkdownPath(path)) continue;` 바로 앞)에 추가:

```ts
            for (const path of event.paths) {
              if (isClaudeAssetPath(path)) scheduleClaudeRescan();
              if (!isWatchableMarkdownPath(path)) continue;
```

- [ ] **Step 4: cleanup에 타이머 정리 추가**

`return () => { ... }` 정리 블록의 `if (refreshTimer) clearTimeout(refreshTimer);` 다음 줄에:

```ts
      if (claudeRescanTimer) clearTimeout(claudeRescanTimer);
```

- [ ] **Step 5: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0. (동작 검증은 Task 6 통합 체크리스트에서.)

- [ ] **Step 6: 커밋**

```bash
git add src/hooks/useFolderWatch.ts
git commit -m "feat(skills): 폴더 워처가 .claude 변경 시 스킬 섹션 재스캔(트리 뱃지 무관)"
```

---

## Task 6: `SkillsSection` 컴포넌트 + 배치 + 통합 검증

**Files:**
- Create: `src/components/sidebar/SkillsSection.tsx`
- Modify: `src/components/layout/AppShell.tsx:16-17`(import), `:534-535`(배치)

**Interfaces:**
- Consumes: 스토어 `claudeAssets`/`currentFile`/`openFile`/`showToast`(Task 3), `ClaudeAsset` 타입.

- [ ] **Step 1: 컴포넌트 작성**

`src/components/sidebar/SkillsSection.tsx` 생성(`ContextSection` 구조를 그룹형으로 단순화 — 체크박스·리사이즈 없음):

```tsx
import { useState } from "react";
import {
  ChevronRight, Boxes, Wand2, Bot, SquareTerminal, FileText, FolderOpen,
  type LucideIcon,
} from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useAppStore } from "../../store/app";
import { isMac } from "../../lib/platform";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import type { ClaudeAsset } from "../../types";

const KIND_META: Record<ClaudeAsset["kind"], { label: string; Icon: LucideIcon }> = {
  skill: { label: "스킬", Icon: Wand2 },
  agent: { label: "에이전트", Icon: Bot },
  command: { label: "커맨드", Icon: SquareTerminal },
};
const KIND_ORDER: ClaudeAsset["kind"][] = ["skill", "agent", "command"];

/**
 * Auto-detected `.claude` assets (skills/agents/commands) for the open folder.
 * Mirrors ContextSection: AUTO, folder-scoped, read-only (click to open).
 * Minimal-chrome guard: renders NOTHING when there are no assets.
 */
export function SkillsSection() {
  const { claudeAssets, currentFile, openFile, showToast } = useAppStore();
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const onRowContextMenu = (path: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const items: ContextMenuItem[] = [
      { label: "열기", icon: FileText, onClick: () => openFile(path) },
      {
        label: isMac ? "Finder에서 보기" : "탐색기에서 보기",
        icon: FolderOpen,
        onClick: () => {
          revealItemInDir(path).catch(() =>
            showToast(isMac ? "Finder에서 보기 실패" : "탐색기에서 보기 실패")
          );
        },
      },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const onPanelContextMenu = (e: React.MouseEvent) => e.preventDefault();

  // Empty group → no chrome at all.
  if (claudeAssets.length === 0) return null;

  // Group by kind, preserving the backend's kind→name sort.
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    items: claudeAssets.filter((a) => a.kind === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <div
      className="shrink-0"
      style={{ borderBottom: "1px solid var(--border)" }}
      onContextMenu={onPanelContextMenu}
    >
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-1 w-full h-9 pr-4 text-[12px] font-semibold uppercase tracking-wide"
        style={{ color: "var(--muted)", letterSpacing: "0.04em", paddingLeft: 7 }}
      >
        <ChevronRight
          size={12}
          style={{
            transform: collapsed ? undefined : "rotate(90deg)",
            transition: "transform 120ms ease",
          }}
        />
        <Boxes size={11} />
        스킬
        <span className="ml-auto font-normal tabular-nums">{claudeAssets.length}</span>
      </button>

      {!collapsed && (
        <div className="pb-1.5 px-2 overflow-y-auto" style={{ maxHeight: 320 }}>
          {groups.map((g) => {
            const { label, Icon } = KIND_META[g.kind];
            return (
              <div key={g.kind}>
                <div
                  className="flex items-center gap-1 text-[11px] mt-1.5 mb-0.5"
                  style={{ color: "var(--muted)", paddingLeft: 7 }}
                >
                  <Icon size={11} />
                  <span className="uppercase tracking-wide">{label}</span>
                  <span className="ml-auto tabular-nums pr-1">{g.items.length}</span>
                </div>
                {g.items.map((a) => {
                  const active = a.path === currentFile;
                  return (
                    <div
                      key={a.path}
                      className="row-hover rounded-md cursor-pointer"
                      style={{
                        background: active ? "var(--active)" : undefined,
                        paddingTop: 3, paddingBottom: 3, paddingLeft: 7, paddingRight: 6,
                      }}
                      onClick={() => openFile(a.path)}
                      onContextMenu={onRowContextMenu(a.path)}
                      title={a.description ? `${a.name} — ${a.description}` : a.path}
                    >
                      <div
                        className="flex items-center gap-1 text-[14px]"
                        style={{ fontWeight: active ? 500 : 400 }}
                      >
                        <Icon size={13} className="shrink-0" style={{ color: "var(--accent)" }} />
                        <span className="truncate flex-1">{a.name}</span>
                      </div>
                      {a.description && (
                        <div
                          className="truncate text-[12px]"
                          style={{ color: "var(--muted)", paddingLeft: 18, marginTop: 1 }}
                        >
                          {a.description}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
```

> 참고: `LucideIcon` 타입과 `Boxes/Wand2/Bot/SquareTerminal`는 lucide-react export임(현 버전에 존재). 만약 `SquareTerminal` 미존재 시 `Terminal`로 대체.

- [ ] **Step 2: AppShell에 배치**

`src/components/layout/AppShell.tsx` import 구역(16~17행 부근, `ContextGaugePanel` import 다음)에:

```ts
import { SkillsSection } from "../sidebar/SkillsSection";
```

그리고 사이드바 JSX에서 `<ContextGaugePanel />`(534행)과 `<FavoritesSection />`(535행) **사이**에:

```tsx
            <SkillsSection />
```

- [ ] **Step 3: 타입체크 + 전체 테스트**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 에러 0, vitest 전부 PASS(기존 240 + isClaudeAssetPath 신규).

- [ ] **Step 4: Rust 테스트 + 컴파일**

Run: `cd src-tauri && cargo test && cargo check`
Expected: claude_assets 6 테스트 포함 전부 PASS, 경고 증가 0.

- [ ] **Step 5: 실제 앱 통합 검증 (`npm run tauri dev`)**

다음을 눈으로 확인:
  1. 이 리포(`mdjoa`) 폴더 열기 → 사이드바에 **"스킬" 섹션** 노출. "스킬" 그룹에 `ui-ux`(설명이 `>-` 멀티라인 → 한 줄 미리보기로), "에이전트" 그룹에 `.claude/agents/*` 항목.
  2. 항목 클릭 → 해당 `SKILL.md`/`*.md`가 뷰어에 열림(active 하이라이트).
  3. 우클릭 → "열기" / "탐색기에서 보기" 동작.
  4. 앱 실행 중 `.claude/skills/zzz-test/SKILL.md` 새로 추가(`---\nname: zzz-test\ndescription: 임시\n---`) → ~300ms 후 섹션에 자동 등장. 파일 삭제 → 자동 사라짐.
  5. `.claude` 없는 임의 폴더 열기 → "스킬" 섹션 미노출(크롬 0). 트리에 `.claude` 뱃지 노이즈 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/components/sidebar/SkillsSection.tsx src/components/layout/AppShell.tsx
git commit -m "feat(skills): .claude 스킬/에이전트/커맨드 사이드바 섹션 + AppShell 배치"
```

---

## Self-Review (작성자 점검)

- **Spec coverage:** 진입(자동 섹션)=Task 6, 범위(skill/agent/command)=Task 2, 접근 A(전용 Rust)=Task 1·2, 베이스 해석 3케이스=Task 2 `resolve_claude_dir`+테스트, frontmatter 폴디드=Task 1 테스트, 워처 갱신=Task 5, 무설정·미니멀 가드=Task 6 빈 가드. 모두 태스크에 매핑됨.
- **Placeholder scan:** TBD/TODO 없음. 모든 코드 단계에 완전한 코드 포함.
- **Type consistency:** `ClaudeAsset{kind,name,description,path}`가 Rust 직렬화·TS 타입·컴포넌트에서 동일. `scanClaudeAssets`/`isClaudeAssetPath`/`scan_claude_assets` 명칭 일관.
- **알려진 한계:** 컴포넌트·스토어·훅은 vitest(node 환경)로 직접 단위테스트하지 않음 — 위험 로직(파서·스캔·경로판별)만 자동 테스트하고 UI/glue는 Task 6의 `tauri dev` 체크리스트로 검증(현 테스트 인프라가 node 전용이라 DOM/Tauri 모킹 미도입 — YAGNI).

## 최종 검증 (전체)

```bash
# 프론트
npx tsc --noEmit && npx vitest run
# 백엔드
cd src-tauri && cargo test && cargo check && cd ..
# 통합
npm run tauri dev   # Task 6 Step 5 체크리스트 수행
```
