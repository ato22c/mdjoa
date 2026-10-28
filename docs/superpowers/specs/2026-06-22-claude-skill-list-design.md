# 설계 — `.claude` 스킬 목록 사이드바 섹션

> 작성: 2026-06-22 · 대상: agentic AI 개발자 · 백로그 항목 **L**(`ai-dev-features-v2.md` §6·§7)

## Context

agentic AI 개발자는 프로젝트마다 `.claude/` 아래에 다수의 스킬(`skills/<name>/SKILL.md`),
서브에이전트(`agents/*.md`), 슬래시 커맨드(`commands/*.md`)를 관리한다. 어떤 자산이 있고
무슨 일을 하는지(설명) 한눈에 보려면 지금은 트리를 파고들어 각 파일을 일일이 열어야 한다.
게다가 `.claude`는 점(.)폴더라 **현재 파일 트리에서 숨겨져 클릭조차 안 된다**.

MD좋아는 "다수 MD를 쉽게 열기"가 핵심 가치이고 타깃이 바로 스킬 작성자다. 이미 있는
**컨텍스트 자동 그룹**(`ContextSection`)과 동일한 패턴으로, 폴더를 열 때 `.claude`를 감지해
**스킬/에이전트/커맨드를 자동 그룹 목록**으로 보여주고, 클릭하면 해당 `.md`를 뷰어로 연다.
목표 결과: 트리를 헤집지 않고 사이드바에서 `.claude` 자산을 즉시 훑고 열 수 있다.

## 핵심 결정 (확정)

- **진입:** 사이드바 **자동 섹션**(`.claude/skills` 등 감지 시 노출, 없으면 숨김). `.claude`를
  트리에 노출하지 않는다. "폴더를 직접 선택"한 경우(루트가 `.claude` 또는 `.claude/skills`)도 커버.
- **범위(v1):** 스킬 + 에이전트 + 커맨드 3종을 한 섹션 안에 **kind별 소그룹**으로.
- **구현:** 접근 A — **전용 Rust 커맨드**가 `.claude`를 한 번 스캔해 완성형 데이터 반환(컨텍스트
  섹션과 동형: "Rust 스캔 → 프론트 표시").
- **갱신:** **폴더 워처 연동 자동 재스캔.** 수동 새로고침 버튼 미도입.
- **무설정:** 경로가 고정이라 SettingsModal·패턴 추가 없음.
- **범위 밖(YAGNI):** 글로벌 `~/.claude` / 플러그인 스킬, 영속 리사이즈 핸들, 비용·텔레메트리.

## 아키텍처 / 데이터 흐름

```
폴더 열기 → store.setFolder
  ├─ scanContextFiles()            (기존)
  └─ scanClaudeAssets()  (신규)  → invoke("scan_claude_assets", { folder })
        → Rust가 <folder>/.claude/{skills,agents,commands} 스캔 + frontmatter 파싱
        → ClaudeAsset[] 반환 → store.claudeAssets
        → SkillsSection 렌더 (비면 숨김)

파일 변경(워처) → useFolderWatch
  └─ 경로가 .claude/{skills,agents,commands}/**.md 이면 (isClaudeAssetPath)
        → 디바운스 후 store.scanClaudeAssets() 재호출 (트리 뱃지와 무관)
```

## 데이터 모델

Rust → 프론트 공통 형태:

```rust
// src-tauri/src/commands/claude_assets.rs
#[derive(serde::Serialize)]
pub struct ClaudeAsset {
    pub kind: String,        // "skill" | "agent" | "command"
    pub name: String,        // 표시 이름
    pub description: String,  // 없으면 ""
    pub path: String,        // 열 .md의 절대 경로
}
```

```ts
// src/types/index.ts
export interface ClaudeAsset {
  kind: "skill" | "agent" | "command";
  name: string;
  description: string;
  path: string;
}
```

## 1. Rust — 신규 커맨드 `scan_claude_assets(folder)`

신규 모듈 `src-tauri/src/commands/claude_assets.rs`, `src-tauri/src/lib.rs`의 모듈 선언 +
`invoke_handler!`에 등록. 경로는 전부 `PathBuf`/`std::path` 사용(구분자 하드코딩 금지).

**시그니처**
```rust
#[tauri::command]
pub fn scan_claude_assets(folder: String) -> Result<Vec<ClaudeAsset>, String>
```

**베이스(.claude) 해석**
1. `<folder>/.claude`가 디렉터리면 그것을 base로 사용.
2. 아니면 `<folder>` 자체의 마지막 세그먼트가 `.claude`면 `<folder>`를 base로.
3. 아니면 `<folder>`의 마지막 세그먼트가 `skills`이고 부모가 `.claude`면 그 부모를 base로.
4. 어디에도 해당 없으면 `Ok(vec![])` (섹션 숨김).

**수집 규칙**
- 스킬: `<base>/skills/*/SKILL.md` (1단계 하위 폴더). 이름 = frontmatter `name`, 없으면 폴더명.
- 에이전트: `<base>/agents/*.md` (1단계). 이름 = frontmatter `name`, 없으면 파일 stem.
- 커맨드: `<base>/commands/*.md` (1단계). 이름 = 파일 stem(커맨드명). 설명 = frontmatter `description`.
- 각 파일은 frontmatter 파싱 위해 앞 ~8KB만 읽음(나머지 무시).
- 정렬: kind(skill→agent→command) → name(대소문자 무시). 상한 300건.
- 읽을 수 없는 디렉터리/파일은 건너뜀. 패닉 금지.

**frontmatter 파서 (소규모 헬퍼)**
- 문서 선두 `^---\r?\n ... \r?\n---` 블록만 대상.
- 평면 `key: value` 라인 파싱, 값 양끝 따옴표 제거.
- **YAML 폴디드/리터럴 스칼라 처리 필수**: 값이 `>-` / `>` / `|` / `|-` 면 다음의 들여쓰기된
  연속 라인을 모아 한 문자열로 합침(`>`계열은 공백으로 join, `|`계열은 개행 유지 후 표시용 정규화).
  근거: 실제 `.claude/skills/ui-ux/SKILL.md`가 `description: >-` 멀티라인을 사용.
- 필요한 키만 추출(`name`, `description`). 나머지 무시. 파싱 실패는 빈 맵 반환(폴백 동작).

## 2. 프론트 — 스토어

`src/store/app.ts`
- 상태: `claudeAssets: ClaudeAsset[]` (초기 `[]`).
- 액션 `scanClaudeAssets()`:
  ```ts
  const folder = get().currentFolder;
  if (!folder) { set({ claudeAssets: [] }); return; }
  try {
    const assets = await invoke<ClaudeAsset[]>("scan_claude_assets", { folder });
    set({ claudeAssets: assets });
  } catch {
    set({ claudeAssets: [] });   // 부재/오류는 무음 (섹션 숨김)
  }
  ```
- `setFolder`에서 `scanContextFiles()` 직후 `get().scanClaudeAssets()` 호출.
- 파일 열기는 기존 `openFile(path)` 재사용.

## 3. 프론트 — 워처 연동 (자동 갱신)

`src/lib/mdPath.ts` (또는 인접 순수 모듈)에 단위테스트 가능한 순수 헬퍼 추가:
```ts
// .claude/{skills,agents,commands}/ 아래의 .md 인가 (POSIX·Windows 구분자 모두)
export const CLAUDE_ASSET_RE =
  /(^|[\\/])\.claude[\\/](skills|agents|commands)[\\/].+\.md$/i;
export function isClaudeAssetPath(path: string): boolean {
  return CLAUDE_ASSET_RE.test(path);
}
```

`src/hooks/useFolderWatch.ts` 콜백 수정:
- `scheduleRefresh`와 동형의 단일 트레일링 디바운스 `scheduleClaudeRescan`(예 350ms) 추가 →
  `useAppStore.getState().scanClaudeAssets()` 호출.
- 이벤트 경로 루프에서 **`isWatchableMarkdownPath` 조기 `continue` 이전에**:
  ```ts
  for (const path of event.paths) {
    if (isClaudeAssetPath(path)) scheduleClaudeRescan();   // 추가
    if (!isWatchableMarkdownPath(path)) continue;          // 기존 (점폴더 뱃지 제외 유지)
    ... 기존 뱃지/재리스트 로직 ...
  }
  ```
- cleanup에서 `claudeRescanTimer` 클리어.
- 효과: 스킬/에이전트/커맨드 추가·수정·삭제가 섹션에 실시간 반영. `.claude`는 여전히 트리
  뱃지 대상이 아님(노이즈 없음). 기존 재귀 워처 재사용 — **새 Rust 워처 불필요**.

## 4. 프론트 — 컴포넌트 `SkillsSection.tsx`

`src/components/sidebar/SkillsSection.tsx` (신규, `ContextSection.tsx` 구조 복제).
- **빈 가드:** `claudeAssets.length === 0` → `null` 반환(크롬 0).
- **접이식 헤더:** 아이콘 + 라벨 "스킬" + 개수 배지(전체 건수). 펼침 상태는 컴포넌트 로컬 state.
- **kind별 소그룹:** 항목이 있는 그룹만 작은 서브헤더(`스킬` / `에이전트` / `커맨드`)와 함께 표시.
- **행:** 이름(굵게, 말줄임) + 설명 1줄 미리보기(말줄임, 전체는 `title` 툴팁). 클릭 →
  `openFile(path)`. 본문 현재 파일이면 active 스타일. 우클릭 → 앱 컨텍스트 메뉴(열기 /
  탐색기에서 보기 — `ContextSection`의 메뉴 패턴 재사용).
- **높이:** 고정 `max-height` + 스크롤(영속 리사이즈 핸들 미도입).
- **아이콘(Lucide 단일 세트):** 섹션 `Boxes`, 스킬 `Wand2`, 에이전트 `Bot`, 커맨드
  `SquareTerminal` (구현 시 최종 미세 조정 가능).

`src/components/layout/AppShell.tsx`
- 사이드바에서 컨텍스트 그룹(`ContextSection`/`ContextGaugePanel`) **바로 다음**,
  `FavoritesSection` **앞**에 `<SkillsSection />` 배치.

## 5. 에러 처리

- `.claude` 부재 = 정상 → 빈 배열 → 섹션 숨김(토스트 없음).
- frontmatter 파싱/읽기 실패 = 이름 폴백(폴더명/파일명)·설명 공란. 앱은 죽지 않음.
- 워처 자체 실패는 기존 `write_log` 경로로 기록(현행 유지).

## 6. 테스트

**Rust 단위테스트** (`claude_assets.rs`, 기존 `context.rs`의 `temp_root` 패턴 재사용):
- 스킬: `skills/foo/SKILL.md`에서 `name` 추출 / `name` 없을 때 폴더명 폴백.
- **폴디드 스칼라**(`description: >-` 멀티라인) 파싱이 한 줄 설명으로 합쳐지는지.
- 에이전트 `agents/*.md`, 커맨드 `commands/*.md` 수집 + 파일 stem 이름.
- 베이스 해석: `<folder>/.claude` / 루트가 `.claude` / 루트가 `.claude/skills` 3케이스.
- `.claude` 부재 → 빈 배열. 정렬(kind→name) 및 상한.

**프론트 (vitest, node)**:
- `isClaudeAssetPath`: POSIX·Windows 구분자, `.md` 만, skills/agents/commands 한정,
  `.claude` 밖 경로 제외.
- (선택) SkillsSection의 kind별 그룹핑/정렬 순수 헬퍼를 분리하면 테스트 1개.

## 미니멀 가드 점검 (CLAUDE.md 원칙)

- 상단 메뉴바·아이콘 증가 없음. 섹션은 `.claude` 있을 때만 노출(평소 크롬 0).
- 본문 폭(720~760px) 불변. 네트워크/텔레메트리 없음. 설정 추가 없음.
- 단일 코드베이스: 경로 `PathBuf`·구분자 헬퍼, OS 분기 없음(`.claude`는 양 OS 공통).

## 검증 (구현 후)

1. `cargo test` (claude_assets 신규 테스트 포함) · `npm run test` (vitest) 통과.
2. `tsc` 0 · `cargo check` 경고 증가 0.
3. `npm run tauri dev`로:
   - 이 리포(`mdjoa`) 폴더 열기 → "스킬" 섹션에 `ui-ux`(스킬) + `.claude/agents/*` 노출 확인,
     설명(`>-` 멀티라인)이 한 줄 미리보기로 보이는지, 클릭 시 해당 `.md` 열리는지.
   - 실행 중 `.claude/skills/<new>/SKILL.md` 추가/수정/삭제 → 디바운스 후 섹션 자동 갱신.
   - `.claude` 없는 폴더 열기 → 섹션 미노출.
```
