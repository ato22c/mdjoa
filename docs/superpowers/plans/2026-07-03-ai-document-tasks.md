# AI 문서 작업(검토·개선·요점정리) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI가 만든 마크다운 문서를 로컬 `claude` CLI에 맡겨 검토·개선·요점정리하고, 결과를 좌우 분할창으로 받는다. 기존 "번역"을 같은 메커니즘의 한 작업으로 흡수한다.

**Architecture:** "무엇을 시킬지(작업 정의)"와 "어떻게 실행하는지(실행기)"를 분리한다. 프롬프트·모델·출력형태는 TS **작업 레지스트리**(`src/lib/aiTasks.ts`) 한 곳에 데이터로 모으고, Rust는 프롬프트를 받아 실행만 하는 **범용 실행기 `run_claude`**가 된다. 결과 뷰·메뉴는 레지스트리를 순회/조회하므로 **새 작업 추가 = 레지스트리 항목 1개**(Rust·뷰·메뉴·스토어 무변경).

**Tech Stack:** Tauri 2.x + React 18 + TypeScript + Vite / Rust(std::process) / Zustand / vitest / 기존 `translate.rs`·`TranslationView.tsx` 재사용.

설계 스펙: `docs/superpowers/specs/2026-07-03-ai-document-tasks-design.md`

**계획 수정 이력 (pre-flight 발견, 사용자 확인 2026-07-03):** 원 설계 스펙은 `src/lib/i18n/`(t()/useT(), ko.ts/en.ts)를 재사용한다고 가정했으나, 그 모듈은 진행 중인 별도 브랜치 `feat/i18n`(미완성·미병합)에만 있고 이 브랜치의 기반인 `main`에는 없다. **이 계획은 i18n에 의존하지 않고, `main`의 현재 관행(HamburgerMenu.tsx 등)과 동일하게 한국어 문자열을 직접 리터럴로 작성**한다. `feat/i18n`이 `main`에 병합된 뒤 이 기능의 문자열을 i18n화하는 것은 별도 후속 작업(BL-007에 기록, Task 7에서 처리).

## Global Constraints

- 한국어 UI 기본. **이 기능의 신규 UI 문자열은 리터럴 한국어로 직접 작성**(main에 i18n 모듈 없음 — 위 "계획 수정 이력" 참고). `t()`/`useT()`/`i18n` 관련 import를 추가하지 않는다.
- 코드/경로/식별자(파일명·커맨드명·필드명)는 **ASCII만**. 표시명만 한글("AI 작업").
- 단일 코드베이스로 Windows·macOS 동시 지원. OS 분기는 `src/lib/platform.ts`·Rust `#[cfg(target_os)]`에만.
- 경로는 `std::path`/`PathBuf`. atomic write(임시파일→교체)는 기존 `write_file` 재사용.
- 네트워크 통신 금지 — 단, **사용자가 메뉴에서 직접 트리거하는 AI 문서 작업**은 예외(Task 7에서 CLAUDE.md 문구 확장).
- 텔레메트리/비용($) 표시 없음.
- 버전 3파일(package.json/Cargo.toml/tauri.conf.json) 동일 유지 — 이 기능은 버전 bump 없음(릴리스 시 별도).
- 아이콘은 Lucide 단일 세트에서만.

---

## File Structure

**신규:**
- `src/lib/aiTasks.ts` — 작업 레지스트리(SSOT) + 범용 실행기(`runClaude`)·진입점(`runDocumentTask`)·`ensureClaude`·`saveTaskResultAsNew`.
- `src/lib/aiTasks.test.ts` — 레지스트리·프롬프트 빌더 단위 테스트.

**수정:**
- `src-tauri/src/commands/translate.rs` — 범용 `run_claude(prompt, model)` 커맨드 추가(기존 헬퍼 전부 재사용). `translate_markdown`은 Task 7에서 제거.
- `src-tauri/src/lib.rs` — `run_claude` import + 핸들러 등록.
- `src/store/app.ts` — 결과 상태 `translatedDoc`→`taskDoc{taskId,content}`, 액션 3개 개명 / `maybeSaveBeforeLeave`의 취소 호출 이전(Task 7).
- `src/components/viewer/TranslationView.tsx` → `TaskView.tsx` 로 개명 — `OutputKind` 기반 버튼/헤더 분기.
- `src/components/ui/TranslationIndicator.tsx` — 진행 pill을 작업별 라벨(taskDoc 기반) + `cancelClaudeTask`로.
- `src/components/layout/AppShell.tsx` — `taskDoc` 참조 + `TaskView` import.
- `src/components/layout/HamburgerMenu.tsx` — "번역" 서브메뉴를 레지스트리 순회 "AI 작업" 서브메뉴로 교체.
- `CLAUDE.md` — 네트워크 예외 조항 확장(Task 7).
- `BACKLOG.md` — BL-007에 "feat/i18n 병합 후 이 기능 문자열 i18n화" 후속 항목 추가(Task 7).

**삭제(Task 7, 모든 소비자 이전 후):**
- `src/lib/translate.ts` — 실행기·오케스트레이션이 전부 `aiTasks.ts`로 옮겨가면 남는 게 없다. 마지막에 통째 삭제.

**순서 불변식(리뷰 반영):** producer 삭제 전에 소비자를 먼저 이전한다. Task 4는 **추가만**(translate.ts 무수정) → Task 5·6에서 뷰·pill·메뉴를 `aiTasks.ts`로 이전 → Task 7에서 store 취소 호출 이전 + translate.ts 삭제. 실행기·청크러너·`cancelled` 플래그를 **한 모듈(`aiTasks.ts`)** 에 두어 취소 플래그가 갈리지 않게 한다(순환/동적 import 불필요).

**개명하지 않고 유지(기능상 범용, 이름만 legacy — 오해 방지 주석만):** Rust `TranslateProc`/`TranslateCache`/`cancel_translate`, 스토어 `translating`/`translateProgress`/`setTranslating`/`translationRaw`. (전면 개명은 이득 없이 리플만 큼 — YAGNI.)

---

## Task 1: Rust 범용 실행기 `run_claude`

기존 `translate.rs`의 모든 헬퍼(`resolve_claude`·`quiet`·`kill_pid`·`strip_outer_fence`·`cache_key`·상태·`claude_status`)를 그대로 두고, 프롬프트를 받아 실행만 하는 범용 커맨드를 추가한다. `translate_markdown`은 이 시점엔 건드리지 않는다(green 유지).

**Files:**
- Modify: `src-tauri/src/commands/translate.rs` (끝에 `run_claude` + 테스트 추가)
- Modify: `src-tauri/src/lib.rs:19` (import), `:353` 부근(핸들러 등록)

**Interfaces:**
- Produces: Tauri 커맨드 `run_claude(prompt: String, model: String, claude_path: Option<String>) -> Result<String, String>`. 프론트에서 `invoke("run_claude", { prompt, model, claudePath })`.
- Consumes: 기존 `resolve_claude`·`quiet`·`strip_outer_fence`·`cache_key`·`TranslateProc`·`TranslateCache`(같은 파일).

- [ ] **Step 1: `strip_outer_fence` 실패 테스트 추가**

`src-tauri/src/commands/translate.rs` 맨 끝에 추가:

```rust
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
```

- [ ] **Step 2: 테스트가 (컴파일되어) 통과/실패하는지 확인**

Run: `cd src-tauri && cargo test strips_ 2>&1 | tail -20`
Expected: 3개 테스트 PASS (`strip_outer_fence`는 이미 존재하는 private fn이라 통과해야 함). 컴파일 에러 시 `mod tests` 배치를 확인.

- [ ] **Step 3: 범용 `run_claude` 커맨드 추가**

`translate.rs`에서 `translate_markdown` 함수 **바로 위**에 추가:

```rust
/// 완성된 프롬프트를 claude CLI로 실행하고 정리된 결과를 반환하는 **범용 실행기**.
/// 프롬프트에는 본문·작업 지시가 이미 다 들어 있다(TS 작업 레지스트리가 조립). Rust는
/// task가 무엇인지 모른다 → 새 AI 작업이 생겨도 이 커맨드는 무변경.
/// 동일 (prompt, model)은 캐시에서 즉시 반환. 취소는 cancel_translate(모든 claude 작업 공용) 재사용.
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
    let claude = resolve_claude(claude_path).ok_or(
        "Claude CLI(claude)를 찾을 수 없습니다. 설정에서 경로를 지정하거나 PATH에 추가하세요.",
    )?;
    // 프롬프트에 본문이 포함됨. Windows CreateProcessW 명령줄 한계(~32767 UTF-16) 방어.
    // 프론트가 본문 28,000자에서 미리 막으므로 여기 도달은 드묾(백스톱).
    if prompt.chars().count() > 30000 {
        return Err("문서가 너무 깁니다(약 28,000자 초과). 더 작은 문서에서 시도해 주세요.".into());
    }
    let slot = proc.0.clone();
    let cache_inner = cache.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&claude);
        cmd.arg("--model")
            .arg(&model)
            .arg("-p")
            .arg(&prompt)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        quiet(&mut cmd);
        let child = cmd.spawn().map_err(|e| format!("claude 실행 실패: {e}"))?;
        let pid = child.id();
        slot.lock().unwrap().push(pid);
        let out = child
            .wait_with_output()
            .map_err(|e| format!("claude 종료 대기 실패: {e}"))?;
        slot.lock().unwrap().retain(|&p| p != pid);
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout);
            let cleaned = strip_outer_fence(&text);
            if cleaned.trim().is_empty() {
                Err("결과가 비어 있습니다".into())
            } else {
                cache_inner.lock().unwrap().insert(key, cleaned.clone());
                Ok(cleaned)
            }
        } else {
            let err = String::from_utf8_lossy(&out.stderr);
            Err(format!("작업 실패: {}", err.trim()))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
```

- [ ] **Step 4: `lib.rs`에 import + 핸들러 등록**

`src-tauri/src/lib.rs:19` 의 use 목록에 `run_claude` 추가:

```rust
    translate::{cancel_translate, claude_status, run_claude, translate_markdown, TranslateCache, TranslateProc},
```

`generate_handler![` 목록(`:353` 부근, `translate_markdown,` 다음 줄)에 추가:

```rust
            translate_markdown,
            run_claude,
            cancel_translate,
```

- [ ] **Step 5: 빌드 + 테스트 확인**

Run: `cd src-tauri && cargo build 2>&1 | tail -20 && cargo test strips_ 2>&1 | tail -10`
Expected: 빌드 성공(경고만 허용), 3개 테스트 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src-tauri/src/commands/translate.rs src-tauri/src/lib.rs
git commit -m "feat(ai-tasks): add generic run_claude command (Rust executor)"
```

---

## Task 2: TS 작업 레지스트리 `aiTasks.ts` (순수, 미배선)

작업 정의를 데이터로 선언한다. 이 Task는 배선 없이 순수 로직만 — 단위 테스트로 검증.

**Files:**
- Create: `src/lib/aiTasks.ts`
- Test: `src/lib/aiTasks.test.ts`

**Interfaces:**
- Produces:
  - `type OutputKind = "replace" | "critique" | "summary"`
  - `interface AiTask { id: string; label: string; model: "haiku"|"sonnet"; output: OutputKind; chunked?: boolean; saveSuffix?: string; buildPrompt: (content: string) => string }`
  - `const AI_TASKS: AiTask[]` (ids: `review`, `improve`, `summarize`, `translate-ko`, `translate-en`)
  - `function getTask(id: string): AiTask | undefined`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/aiTasks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AI_TASKS, getTask } from "./aiTasks";

describe("aiTasks registry", () => {
  it("has the expected task ids", () => {
    expect(AI_TASKS.map((t) => t.id).sort()).toEqual([
      "improve",
      "review",
      "summarize",
      "translate-en",
      "translate-ko",
    ]);
  });

  it("every task builds a prompt wrapping the document body in markers", () => {
    for (const task of AI_TASKS) {
      const p = task.buildPrompt("HELLO_DOC_BODY");
      expect(p).toContain("===BEGIN DOCUMENT===");
      expect(p).toContain("===END DOCUMENT===");
      expect(p).toContain("HELLO_DOC_BODY");
    }
  });

  it("only translate tasks are chunked", () => {
    for (const t of AI_TASKS) {
      expect(Boolean(t.chunked)).toBe(t.id.startsWith("translate-"));
    }
  });

  it("review has no saveSuffix; improve/summarize/translate do", () => {
    expect(getTask("review")!.saveSuffix).toBeUndefined();
    expect(getTask("improve")!.saveSuffix).toBe("improved");
    expect(getTask("summarize")!.saveSuffix).toBe("summary");
    expect(getTask("translate-ko")!.saveSuffix).toBe("ko");
  });

  it("getTask returns undefined for an unknown id", () => {
    expect(getTask("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- aiTasks 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './aiTasks'`.

- [ ] **Step 3: 레지스트리 구현 (배선 없음)**

`src/lib/aiTasks.ts`:

```ts
// AI 문서 작업 레지스트리(SSOT). 프롬프트·모델·출력형태를 데이터로 선언한다.
// 새 작업 추가 = 이 배열에 항목 1개. Rust·뷰·메뉴·스토어 무변경.
// label은 리터럴 한국어(main에 i18n 모듈 없음 — feat/i18n 병합 후 i18n화는 별도 후속, BL-007).

// 우측 결과 창의 버튼·스크롤동기를 결정한다.
//  replace  = 문서를 고쳐/바꿔 씀(개선·번역): 편집토글·새파일저장·복사, 스크롤 동기 켬
//  critique = 읽기 전용 지적(검토): 복사만, 스크롤 동기 끔
//  summary  = 짧은 요약(요점정리): 새파일저장·복사, 스크롤 동기 끔
export type OutputKind = "replace" | "critique" | "summary";

export interface AiTask {
  id: string;                       // 안정 식별자(스토어 taskId)
  label: string;                    // 표시용 한국어 라벨(메뉴·헤더·pill)
  model: "haiku" | "sonnet";        // 작업별 모델(번역=haiku 충분, 나머지=sonnet)
  output: OutputKind;
  chunked?: boolean;                // true=긴 문서 청크 병렬(번역 전용). 나머지는 단일 호출
  saveSuffix?: string;              // "새 파일로 저장" 파일명 접미사. 없으면 저장 불가(검토)
  buildPrompt: (content: string) => string;
}

// 본문을 마커로 감싼다(translate.rs와 동일 규약).
function doc(content: string): string {
  return `\n\n===BEGIN DOCUMENT===\n${content}\n===END DOCUMENT===`;
}

// 번역 프롬프트(기존 translate.rs:218의 프롬프트를 TS로 이관).
function translatePrompt(content: string, langName: string): string {
  return (
    `You are a Markdown translation engine. Translate the Markdown document delimited by the markers ` +
    `below into ${langName}. Translate only natural-language prose. Do NOT modify: fenced/inline code, URLs, link ` +
    `and image targets, HTML, YAML frontmatter keys, table structure, LaTeX math, or [[wikilink]] targets. ` +
    `Preserve all Markdown formatting, headings, and structure exactly. Output ONLY the translated Markdown — ` +
    `no explanations, no commentary, and do not wrap the whole output in a code fence.` +
    doc(content)
  );
}

export const AI_TASKS: AiTask[] = [
  {
    id: "review",
    label: "검토",
    model: "sonnet",
    output: "critique",
    buildPrompt: (c) =>
      `You are a meticulous Markdown document reviewer. Review the document delimited below and report problems ` +
      `and improvement points. Do NOT rewrite the document. Write your findings in Korean (한국어), ordered by ` +
      `priority. For each finding give a short bullet stating what is wrong, why it matters, and how to fix it. ` +
      `Use Markdown bullets and headings. Output only the review, in Korean.` +
      doc(c),
  },
  {
    id: "improve",
    label: "개선",
    model: "sonnet",
    output: "replace",
    saveSuffix: "improved",
    buildPrompt: (c) =>
      `You are a Markdown editor. Rewrite the document delimited below to be clearer and more accurate while ` +
      `PRESERVING its meaning. Keep all Markdown structure, headings, code, links, and tables intact. Keep the ` +
      `prose in its original language (Korean stays Korean). Output ONLY the improved Markdown — no explanations, ` +
      `no commentary, and do not wrap the whole output in a code fence.` +
      doc(c),
  },
  {
    id: "summarize",
    label: "요점정리",
    model: "sonnet",
    output: "summary",
    saveSuffix: "summary",
    buildPrompt: (c) =>
      `Summarize the key points of the Markdown document delimited below. Write the summary in Korean (한국어), ` +
      `concise, capturing only the essentials. You may use Markdown bullets and headings. Output only the summary.` +
      doc(c),
  },
  {
    id: "translate-ko",
    label: "한국어로 번역",
    model: "haiku",
    output: "replace",
    chunked: true,
    saveSuffix: "ko",
    buildPrompt: (c) => translatePrompt(c, "Korean (한국어)"),
  },
  {
    id: "translate-en",
    label: "영어로 번역",
    model: "haiku",
    output: "replace",
    chunked: true,
    saveSuffix: "en",
    buildPrompt: (c) => translatePrompt(c, "English"),
  },
];

export function getTask(id: string): AiTask | undefined {
  return AI_TASKS.find((t) => t.id === id);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- aiTasks 2>&1 | tail -20`
Expected: 5개 테스트 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/aiTasks.ts src/lib/aiTasks.test.ts
git commit -m "feat(ai-tasks): add task registry (review/improve/summarize/translate)"
```

---

## Task 3: 스토어 결과 상태 일반화 (`translatedDoc`→`taskDoc`)

순수 개명 리팩터 — 동작 변화 없음. 번역이 이전과 동일하게 작동해야 한다. 결과 상태를 taskId로 일반화해 어떤 작업이든 담게 한다.

**Files:**
- Modify: `src/store/app.ts`
- Modify: `src/lib/translate.ts` (호출부만)
- Modify: `src/components/viewer/TranslationView.tsx` (참조만)
- Modify: `src/components/layout/AppShell.tsx` (참조만)

**Interfaces:**
- Produces (store):
  - state `taskDoc: { taskId: string; content: string } | null`
  - `showTaskResult(taskId: string, content: string): void`
  - `updateTaskContent(content: string): void`
  - `closeTaskResult(): void`
  - (유지) `translating`, `translateProgress`, `setTranslating`, `setTranslateProgress`, `translationRaw`, `toggleTranslationRaw`

- [ ] **Step 1: 스토어 타입·초기값·리셋 개명**

`src/store/app.ts`:
- `:111` 교체:
  ```ts
  // AI 작업 결과 보기: 좌 원문 / 우 결과(검토·개선·요점정리·번역). null = 미표시.
  // taskId = aiTasks 레지스트리 키. 보기 전용(저장 안 함) — 파일 전환·편집 진입 시 해제.
  taskDoc: { taskId: string; content: string } | null;
  ```
- `:230-232` 인터페이스 선언 교체:
  ```ts
  showTaskResult: (taskId: string, content: string) => void;
  updateTaskContent: (content: string) => void;
  closeTaskResult: () => void;
  ```
- `:368` 초기값 `translatedDoc: null,` → `taskDoc: null,`
- `:411`, `:454`, `:543`, `:934`, `:1223` 의 `translatedDoc: null,` → `taskDoc: null,` (전부. `grep -n "translatedDoc: null" src/store/app.ts` 로 확인)

- [ ] **Step 2: 스토어 액션 3개 교체**

`src/store/app.ts:922-926` 를 교체:

```ts
  showTaskResult: (taskId, content) =>
    set({ taskDoc: { taskId, content }, translationRaw: false, compareWith: null, compareContent: null }),
  updateTaskContent: (content) =>
    set((s) => (s.taskDoc ? { taskDoc: { ...s.taskDoc, content } } : {})),
  closeTaskResult: () => set({ taskDoc: null, translationRaw: false }),
```

- [ ] **Step 3: `translate.ts` 호출부 개명**

`src/lib/translate.ts`:
- `:102` `store.showTranslation("", target);` → `store.showTaskResult("translate-" + target, "");`
- `:116-118` `store.updateTranslationContent(...)` → `store.updateTaskContent(...)`
- `:123` `store.showTranslation(results.join("\n\n"), target);` → `store.showTaskResult("translate-" + target, results.join("\n\n"));`
- `:143` `const td = store.translatedDoc;` → `const td = store.taskDoc;`
- `:154` `store.closeTranslation();` → `store.closeTaskResult();`
- `saveTranslationAsNew`(`:141-160`)에서 `td.target` 사용부: `td` 는 이제 `{taskId, content}`. `:148` 의 `${base}.${td.target}.md` → `${base}.${td.taskId.replace("translate-", "")}.md` (임시 — Task 4에서 `saveTaskResultAsNew`로 대체).

- [ ] **Step 4: `TranslationView.tsx` 참조 개명**

`src/components/viewer/TranslationView.tsx`:
- `:95` 구조분해 `translatedDoc, closeTranslation,` → `taskDoc, closeTaskResult,`
- `:137` `closeTranslation()` → `closeTaskResult()`; `:141` deps 동일 교체
- `:143` `if (!translatedDoc) return null;` → `if (!taskDoc) return null;`
- `:146` `const target = translatedDoc.target;` → 임시로 `const target = taskDoc.taskId.replace("translate-", "") as Lang;` (Task 5에서 재작성)
- `:178` `onClick={closeTranslation}` → `onClick={closeTaskResult}`
- `:187`, `:192` `translatedDoc.content` → `taskDoc.content`

- [ ] **Step 5: `AppShell.tsx` 참조 개명**

`src/components/layout/AppShell.tsx`:
- `:71` 구조분해 `translatedDoc,` → `taskDoc,`
- `:274` `if (st.translatedDoc) {` → `if (st.taskDoc) {`
- `:662` `{translatedDoc ? (` → `{taskDoc ? (`

- [ ] **Step 6: 빌드·기존 테스트 확인**

Run: `npm run build 2>&1 | tail -25 && npm test 2>&1 | tail -15`
Expected: 타입 에러 0, 빌드 성공, 기존 테스트 전부 PASS. 남은 `translatedDoc`/`showTranslation`/`closeTranslation` 참조가 있으면 컴파일 에러로 드러난다 — `grep -rn "translatedDoc\|showTranslation\|updateTranslationContent\|closeTranslation" src` 로 0건 확인.

- [ ] **Step 7: 수동 확인 — 번역 회귀 없음**

Run: `npm run dev:win` → 문서 열고 햄버거 → 번역 → 한국어로/영어로. 좌우 분할·스크롤 동기·새 파일로 저장이 이전과 동일하게 동작하는지 확인.

- [ ] **Step 8: 커밋**

```bash
git add src/store/app.ts src/lib/translate.ts src/components/viewer/TranslationView.tsx src/components/layout/AppShell.tsx
git commit -m "refactor(ai-tasks): generalize translatedDoc→taskDoc (no behavior change)"
```

---

## Task 4: TS 실행기를 `aiTasks.ts`에 구축 (추가만 — translate.ts 무수정)

실행기·청크러너·진입점을 **한 모듈(`aiTasks.ts`)** 에 추가한다. 취소 플래그(`cancelled`)를 한 곳에만 둬 청크/단일 경로가 같은 플래그를 공유(취소 시 중복 토스트 방지). **translate.ts는 이 Task에서 건드리지 않는다** — 기존 번역 경로(메뉴·pill·store)가 그대로 동작(green 유지). 잠시 `ensureClaude`/`mapLimit`가 두 파일에 중복 존재하지만 Task 7에서 translate.ts와 함께 사라진다.

**Files:**
- Modify: `src/lib/aiTasks.ts` (실행기 추가)

**Interfaces:**
- Produces (`aiTasks.ts`):
  - `async function ensureClaude(): Promise<boolean>`
  - `async function runClaude(prompt: string, model: string): Promise<string>` (단일 호출+타임아웃)
  - `async function runDocumentTask(taskId: string): Promise<void>` (메뉴 진입점 — chunked/단일 분기)
  - `async function saveTaskResultAsNew(): Promise<void>` (범용 저장)
  - `async function cancelClaudeTask(): Promise<void>`
- Consumes: `getTask`/`AI_TASKS`(Task 2), `splitMarkdownForTranslation`(`lang.ts`); store `showTaskResult`/`updateTaskContent`/`setTranslating`/`setTranslateProgress`/`translating`/`currentContent`/`currentFile`/`settings`; `invoke("run_claude")`/`invoke("cancel_translate")`(Task 1).

- [ ] **Step 1: `aiTasks.ts` 상단 import 추가**

`src/lib/aiTasks.ts` 파일 맨 위에:

```ts
import { invoke } from "@tauri-apps/api/core";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store/app";
import { baseName } from "./pathUtil";
import { splitMarkdownForTranslation } from "./lang";
import type { ClaudeStatus } from "../types";
```

- [ ] **Step 2: 파일 하단에 실행기 추가**

`src/lib/aiTasks.ts` 맨 끝에:

```ts
// ── 실행기 ─────────────────────────────────────────────────────────────
// 모든 claude 작업 공용 취소 플래그. 단일 모듈에 하나만 둬 청크/단일 경로가 공유한다.
let cancelled = false;
const TIMEOUT_MS = 180_000; // 단일 호출 응답 타임아웃
const CONCURRENCY = 4;      // 청크 병렬 상한(번역)

// 로컬 claude CLI 존재 확인. 없으면 설치/경로 안내 다이얼로그.
export async function ensureClaude(): Promise<boolean> {
  const store = useAppStore.getState();
  let status: ClaudeStatus;
  try {
    status = await invoke<ClaudeStatus>("claude_status", { overridePath: store.settings.claude_cli_path });
  } catch {
    status = { state: "none", version: null, path: null };
  }
  if (status.state !== "none") return true;
  const openSettings = await ask(
    "AI 문서 작업에는 로컬 Claude CLI(Claude Code)가 필요합니다 — 설치되어 있지 않거나 찾을 수 없습니다.\n\n" +
      "· Claude Code를 설치하고 로그인했는지 확인하세요.\n" +
      "· 이미 설치했다면 설정에서 claude 실행 파일 경로를 직접 지정할 수 있습니다.\n\n" +
      "지금 설정을 열까요?",
    { title: "Claude CLI를 찾을 수 없음", kind: "warning", okLabel: "설정 열기", cancelLabel: "닫기" }
  ).catch(() => false);
  if (openSettings) store.setSettingsOpen(true);
  return false;
}

// 진행 중인 claude 작업 취소(자식 프로세스 종료). 청크·단일 공통.
export async function cancelClaudeTask(): Promise<void> {
  const store = useAppStore.getState();
  if (!store.translating) return;
  cancelled = true;
  await invoke("cancel_translate").catch(() => {}); // 모든 claude 작업 공용(커맨드명은 legacy)
  store.setTranslating(false);
  store.setTranslateProgress(null);
  store.showToast("AI 작업을 취소했습니다");
}

// 프롬프트 하나 실행 + 타임아웃. 모든 작업의 원자 단위.
export async function runClaude(prompt: string, model: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const claudePath = useAppStore.getState().settings.claude_cli_path;
  const p = invoke<string>("run_claude", { prompt, model, claudePath });
  p.catch(() => {}); // 타임아웃이 이기면 늦은 reject를 삼켜 unhandled 방지
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void invoke("cancel_translate").catch(() => {});
      reject(new Error("__timeout__"));
    }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// 동시 실행 제한 + 순서 보존.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// 청크 작업(번역) 러너 — 긴 문서를 청크로 나눠 병렬 실행, 완료분 즉시 표시.
async function runChunkedTask(task: AiTask, content: string): Promise<void> {
  const store = useAppStore.getState();
  const chunks = splitMarkdownForTranslation(content);
  const total = chunks.length;
  let done = 0;
  store.setTranslateProgress(total > 1 ? { cur: 0, total } : null);
  const partial: (string | null)[] = new Array(total).fill(null);
  const results = await mapLimit(chunks, CONCURRENCY, async (chunk, idx) => {
    if (cancelled) throw new Error("__cancelled__");
    const r = await runClaude(task.buildPrompt(chunk), task.model);
    partial[idx] = r;
    done += 1;
    if (!cancelled) {
      if (total > 1) store.setTranslateProgress({ cur: done, total });
      store.updateTaskContent(partial.filter((x): x is string => x !== null).join("\n\n"));
    }
    return r;
  });
  if (cancelled) return;
  store.showTaskResult(task.id, results.join("\n\n"));
}

// 메뉴 진입점. 단일 실행 가드·존재 확인 후 chunked면 청크러너, 아니면 단일 호출.
export async function runDocumentTask(taskId: string): Promise<void> {
  const store = useAppStore.getState();
  const task = getTask(taskId);
  const content = store.currentContent;
  if (!task) return;
  if (!store.currentFile || !content || !content.trim()) {
    store.showToast("작업할 문서가 없습니다");
    return;
  }
  if (store.translating) return; // 단일 실행 가드
  if (!(await ensureClaude())) return;
  // 단일 호출 작업은 문서 전체를 한 번에 → 길이 상한. 청크(번역)는 나눠 보내므로 예외.
  if (!task.chunked && [...content].length > 28000) {
    store.showToast("문서가 너무 깁니다(약 28,000자 초과). 더 작은 문서에서 시도해 주세요.");
    return;
  }

  cancelled = false;
  store.showTaskResult(task.id, "");
  store.setTranslating(true);
  store.setTranslateProgress(null);
  try {
    if (task.chunked) {
      await runChunkedTask(task, content);
    } else {
      const out = await runClaude(task.buildPrompt(content), task.model);
      if (cancelled) return;
      store.showTaskResult(task.id, out);
    }
  } catch (e) {
    if (cancelled) return; // 수동 취소 → 실패 토스트 없음(cancelClaudeTask가 안내)
    if (e instanceof Error && e.message === "__timeout__") {
      store.showToast("응답이 없어 중단했습니다. 문서가 너무 크거나 claude가 응답하지 않습니다.");
      return;
    }
    store.showToast(`AI 작업 실패: ${e}`);
    await invoke("write_log", { level: "error", message: `ai task ${taskId} failed: ${e}` }).catch(() => {});
  } finally {
    if (!cancelled) {
      store.setTranslating(false);
      store.setTranslateProgress(null);
    }
  }
}

// 결과를 새 파일로 저장(원본 보존). 검토(critique, saveSuffix 없음)는 저장 불가.
export async function saveTaskResultAsNew(): Promise<void> {
  const store = useAppStore.getState();
  const td = store.taskDoc;
  if (!td) return;
  const task = getTask(td.taskId);
  if (!task?.saveSuffix) return;
  const file = store.currentFile;
  const base = file ? baseName(file).replace(/\.(md|markdown)$/i, "") : "result";
  const out = await save({
    defaultPath: `${base}.${task.saveSuffix}.md`,
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  }).catch(() => null);
  if (!out) return;
  try {
    await invoke("write_file", { path: out, content: td.content });
    store.closeTaskResult();
    await store.openFile(out);
    store.showToast("결과를 새 파일로 저장했습니다");
  } catch (e) {
    store.showToast(`저장 실패: ${e}`);
  }
}
```

- [ ] **Step 3: 빌드 확인 (green — translate.ts 무변경)**

Run: `npm run build 2>&1 | tail -25`
Expected: 타입 에러 0. 기존 번역은 여전히 translate.ts 경로로 동작(회귀 없음).

- [ ] **Step 4: 커밋**

```bash
git add src/lib/aiTasks.ts
git commit -m "feat(ai-tasks): runner + chunked runner + entrypoint in aiTasks (single cancel flag)"
```

---

## Task 5: 뷰(`TaskView`) + 진행 pill (리터럴 한국어)

`TranslationView`를 `TaskView`로 개명해 `OutputKind`로 분기하고, 진행 pill을 작업별로 만들고, 두 곳이 `translate.ts` 대신 `aiTasks.ts`를 쓰게 이전한다. **main에 i18n 모듈이 없으므로 문자열은 리터럴 한국어로 직접 작성**(Global Constraints 참고).

**Files:**
- Rename: `src/components/viewer/TranslationView.tsx` → `src/components/viewer/TaskView.tsx`
- Modify: `src/components/ui/TranslationIndicator.tsx`
- Modify: `src/components/layout/AppShell.tsx`

**Interfaces:**
- Produces: `export function TaskView()`
- Consumes: store `taskDoc`/`closeTaskResult`/`translationRaw`/`toggleTranslationRaw`/`translating`/`translateProgress`; `getTask`/`OutputKind`(Task 2); `saveTaskResultAsNew`/`cancelClaudeTask`(Task 4).

- [ ] **Step 1: 파일 개명**

```bash
git mv src/components/viewer/TranslationView.tsx src/components/viewer/TaskView.tsx
```

- [ ] **Step 2: `TaskView.tsx` 내용 갱신**

- import 교체: `saveTranslationAsNew`(from translate) 제거; 추가 `import { getTask, saveTaskResultAsNew, type OutputKind } from "../../lib/aiTasks";`. `langLabel`/`type Lang` import 제거.
- 컴포넌트 선언 `export function TranslationView()` → `export function TaskView()`.
- 상단에서 작업 조회(+ 기존 `currentContent`/`currentFile`/`settings` 유지):
  ```ts
  const showToast = useAppStore((s) => s.showToast);
  const taskDoc = useAppStore((s) => s.taskDoc);
  const closeTaskResult = useAppStore((s) => s.closeTaskResult);
  const raw = useAppStore((s) => s.translationRaw);
  const toggleRaw = useAppStore((s) => s.toggleTranslationRaw);
  const translating = useAppStore((s) => s.translating);
  if (!taskDoc) return null;
  const task = getTask(taskDoc.taskId);
  const output: OutputKind = task?.output ?? "replace";
  const label = task?.label ?? "";
  const effectiveRaw = output === "replace" && raw;   // 편집/보기 토글은 replace에서만
  const copyResult = () => {
    navigator.clipboard.writeText(taskDoc.content)
      .then(() => showToast("클립보드에 복사되었습니다"))
      .catch(() => showToast("복사에 실패했습니다"));
  };
  ```
- Esc 핸들러(`:135-141`)의 `closeTranslation` → `closeTaskResult`.
- 헤더(`:151-182`)를 교체:
  ```tsx
  <div className="no-print shrink-0 flex items-center gap-2 px-4 h-9 text-[12px]"
       style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)" }}>
    <span style={{ color: "var(--muted)" }}>{label} 결과</span>
    <div className="ml-auto flex items-center gap-1.5">
      {output === "replace" && (
        <button onClick={toggleRaw} className="flex items-center gap-1 rounded-md px-2 h-7 text-[12px]"
                style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
                title={`${raw ? "보기 모드" : "편집 모드"} (${MOD_LABEL}E)`}>
          {raw ? <Eye size={13} /> : <Pencil size={13} />}
          {raw ? "보기 모드" : "편집 모드"}
        </button>
      )}
      <button onClick={copyResult} className="flex items-center gap-1 rounded-md px-2 h-7 text-[12px]"
              style={{ border: "1px solid var(--border)", color: "var(--fg)" }} title="복사">
        <Copy size={13} /> 복사
      </button>
      {task?.saveSuffix && (
        <button onClick={() => void saveTaskResultAsNew()} className="flex items-center gap-1 rounded-md px-2 h-7 text-[12px]"
                style={{ border: "1px solid var(--border)", color: "var(--fg)" }} title="새 파일로 저장">
          <FilePlus size={13} /> 새 파일로 저장
        </button>
      )}
      <button onClick={closeTaskResult} className="icon-btn !p-1" title="닫기 (Esc)">
        <X size={14} />
      </button>
    </div>
  </div>
  ```
- 본문(`:183-194`): 좌 `Pane content={currentContent ?? ""}`, 우 `Pane content={taskDoc.content}`. 두 `Pane`의 `raw`에 `effectiveRaw` 전달. 스크롤 동기 핸들러(`onLeftScroll`/`onRightScroll`)는 `output === "replace"` 일 때만 연결(그 외 `undefined`). 스피너 텍스트 `번역 중...` → `` {`${label} 중…`} ``.
- 삭제: `const target`, `const src`, `langLabel` 사용 라인.

- [ ] **Step 3: `TranslationIndicator.tsx` 작업별 pill로 (전체 교체)**

`src/components/ui/TranslationIndicator.tsx`:

```tsx
import { Loader2, X } from "lucide-react";
import { useAppStore } from "../../store/app";
import { ToastPill } from "./ToastPill";
import { cancelClaudeTask, getTask } from "../../lib/aiTasks";

/**
 * AI 작업 진행 표시 + 취소. claude `-p`는 완료 시 일괄 출력이라 진행률(%)이 없어
 * 불확정 스피너만. 청크(번역)일 때만 cur/total. taskDoc로 작업명을 표시한다.
 */
export function TranslationIndicator() {
  const translating = useAppStore((s) => s.translating);
  const progress = useAppStore((s) => s.translateProgress);
  const taskDoc = useAppStore((s) => s.taskDoc);
  if (!translating) return null;
  const task = taskDoc ? getTask(taskDoc.taskId) : undefined;
  const name = task?.label ?? "";
  const base = `${name} 중…`;
  const label = progress ? `${base} (${progress.cur}/${progress.total})` : base;
  return (
    <ToastPill>
      <Loader2 size={14} className="animate-spin" />
      <span className="tabular-nums">{label}</span>
      <button
        onClick={() => void cancelClaudeTask()}
        className="ml-1 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[12px] opacity-80 hover:opacity-100"
        style={{ background: "rgba(127,127,127,0.25)" }}
        title="취소"
      >
        <X size={12} />
        취소
      </button>
    </ToastPill>
  );
}
```

- [ ] **Step 4: `AppShell.tsx` lazy import·렌더 태그 교체**

`src/components/layout/AppShell.tsx`:
- `:38-40`:
  ```ts
  const TaskView = lazy(() =>
    import("../viewer/TaskView").then((m) => ({ default: m.TaskView }))
  );
  ```
- `:663` `<TranslationView />` → `<TaskView />`

- [ ] **Step 5: 빌드 + 수동 확인(번역 렌더)**

Run: `npm run build 2>&1 | tail -25`
Expected: 타입 에러 0. `grep -rn "TranslationView\|saveTranslationAsNew\|langLabel" src/components` 및 `grep -rn "lib/translate\"" src/components` → TaskView.tsx·TranslationIndicator.tsx에서 translate.ts 참조 0건.
그다음 `npm run dev:win` → 번역(메뉴는 아직 old 경로) 실행 시 결과가 `TaskView`로 렌더되고 편집/보기·저장·복사·pill·취소가 동작하는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add -A src/components/viewer/TaskView.tsx src/components/ui/TranslationIndicator.tsx src/components/layout/AppShell.tsx
git commit -m "feat(ai-tasks): TaskView + task-aware pill; consumers use aiTasks"
```

---

## Task 6: 메뉴 "AI 작업" (레지스트리 순회)

"번역" 서브메뉴를 `AI_TASKS`를 순회하는 "AI 작업" 서브메뉴로 교체한다. 이 시점부터 번역도 `runDocumentTask("translate-*")` → `aiTasks.ts`의 청크러너로 흐른다.

**Files:**
- Modify: `src/components/layout/HamburgerMenu.tsx`

**Interfaces:**
- Consumes: `AI_TASKS`/`runDocumentTask`(Task 4).

- [ ] **Step 1: 메뉴 배선 교체**

`src/components/layout/HamburgerMenu.tsx`:
- import(`:2`)에 `Sparkles` 추가.
- import(`:13`) `translateCurrentDocument` **제거**, 추가:
  ```ts
  import { AI_TASKS, runDocumentTask } from "../../lib/aiTasks";
  ```
- 상태(`:18`) `const [translateOpen, setTranslateOpen] = useState(false);` → `const [aiOpen, setAiOpen] = useState(false);`.
- `:62` 의 `setTranslateOpen(false)` → `setAiOpen(false)`.
- `handleTranslate`(`:35-39`) 제거, 교체:
  ```ts
  const handleRunTask = useCallback(async (taskId: string) => {
    setIsOpen(false);
    setAiOpen(false);
    await runDocumentTask(taskId);
  }, []);
  ```
- 번역 서브메뉴 블록(`:253-285`)을 교체:
  ```tsx
  {/* AI 작업 서브메뉴 — 레지스트리(AI_TASKS)를 순회해 렌더. 새 작업은 자동 노출. */}
  {currentContent != null && (
    <div className="relative"
         onMouseEnter={() => setAiOpen(true)}
         onMouseLeave={() => setAiOpen(false)}>
      <button onClick={() => setAiOpen(true)} className={itemClass}
              aria-haspopup="menu" aria-expanded={aiOpen}>
        <Sparkles size={14} style={{ color: "var(--muted)" }} />
        AI 작업
        <ChevronRight size={13} className="ml-auto" style={{ color: "var(--muted)" }} />
      </button>
      {aiOpen && (
        <div className="absolute left-full top-0 ml-1 z-50 w-44 rounded-[10px] py-1.5 px-1.5"
             style={{ background: "var(--bg)", boxShadow: "var(--shadow-popover)" }} role="menu">
          {AI_TASKS.map((task, i) => {
            const prev = AI_TASKS[i - 1];
            const divider = Boolean(task.chunked && prev && !prev.chunked); // 번역 그룹 앞 구분선
            return (
              <div key={task.id}>
                {divider && <div className="my-1 -mx-1.5 border-t" style={{ borderColor: "var(--border)" }} />}
                <button onClick={() => void handleRunTask(task.id)} className={itemClass}>
                  {task.label}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  )}
  ```

- [ ] **Step 2: 빌드·테스트 확인**

Run: `npm run build 2>&1 | tail -25 && npm test 2>&1 | tail -15`
Expected: 타입 에러 0, 테스트 PASS. `grep -rn "translateCurrentDocument\|handleTranslate\|setTranslateOpen" src` → 0건.

- [ ] **Step 3: 수동 확인 — 세 작업 end-to-end**

Run: `npm run dev:win` → 문서 열기 → 햄버거 → **AI 작업**:
- **검토**: 우측 한국어 지적 목록(렌더), 버튼 = 복사·닫기(저장 없음), 스크롤 동기 없음, pill "검토 중…".
- **개선**: 우측 고쳐 쓴 문서, 버튼 = 편집/보기·새 파일로 저장·복사, 스크롤 동기 동작.
- **요점정리**: 우측 짧은 요약, 버튼 = 복사·새 파일로 저장.
- **한국어로/영어로 번역**: 청크·진행률·저장 정상, pill "한국어로 번역 중… (n/m)".

- [ ] **Step 4: 커밋**

```bash
git add src/components/layout/HamburgerMenu.tsx
git commit -m "feat(ai-tasks): registry-driven AI Tasks menu (absorbs translate submenu)"
```

---

## Task 7: 소비자 마지막 이전(+TopBar/MarkdownViewer) + `translate.ts`/`translate_markdown` 삭제 + 거버넌스

남은 소비자(store의 취소 호출 + **Task 6 구현 중 발견된 계획 공백**: `TopBar.tsx`·`MarkdownViewer.tsx`도 `translateCurrentDocument`를 직접 호출 중)를 이전하고, 죽은 코드를 제거하고, CLAUDE.md 예외를 확장한다.

**계획 공백 발견 경위 (Task 6 구현자, 컨트롤러 확인·해결):** Task 6은 `HamburgerMenu.tsx`만 이전하면 됐지만, `TopBar.tsx`의 툴바 "번역" 드롭다운과 `MarkdownViewer.tsx`의 우클릭 컨텍스트 메뉴도 각각 `translateCurrentDocument`를 직접 import·호출하고 있었다(원 설계 스펙·계획 모두 이 두 파일을 놓침). Task 7의 "소비자 0 확인 후 삭제" 전제가 깨지므로, 이 두 파일의 이전을 Step 2·3으로 추가한다.

**Files:**
- Modify: `src/store/app.ts` (`maybeSaveBeforeLeave`)
- Modify: `src/components/layout/TopBar.tsx` (`TranslateDropdown`)
- Modify: `src/components/viewer/MarkdownViewer.tsx` (우클릭 컨텍스트 메뉴)
- Delete: `src/lib/translate.ts`
- Modify: `src-tauri/src/commands/translate.rs`, `src-tauri/src/lib.rs`
- Modify: `CLAUDE.md`
- Modify: `BACKLOG.md` (BL-007에 i18n 마이그레이션 후속 항목 추가)

- [ ] **Step 1: store의 취소 호출 이전**

`src/store/app.ts:1000-1002` 교체:
```ts
    if (s.translating) {
      const { cancelClaudeTask } = await import("../lib/aiTasks");
      await cancelClaudeTask();
    }
```

- [ ] **Step 2: `TopBar.tsx`의 툴바 번역 드롭다운 이전**

`src/components/layout/TopBar.tsx`:
- import(`:10`) `import { translateCurrentDocument } from "../../lib/translate";` → `import { runDocumentTask } from "../../lib/aiTasks";`
- `TranslateDropdown` 컴포넌트 내부(`:55-58`)의 `translate` 함수 교체:
  ```ts
  const translate = (target: "ko" | "en") => {
    setOpen(false);
    void runDocumentTask(`translate-${target}`);
  };
  ```

- [ ] **Step 3: `MarkdownViewer.tsx`의 우클릭 컨텍스트 메뉴 이전**

`src/components/viewer/MarkdownViewer.tsx`:
- import에서 `translateCurrentDocument` (from `"../../lib/translate"`) 제거, `runDocumentTask` (from `"../../lib/aiTasks"`) 추가.
- 컨텍스트 메뉴 항목(`:484-491`)의 서브메뉴 교체:
  ```ts
  items.push({
    label: "번역",
    icon: Languages,
    submenu: [
      { label: "한국어로", onClick: () => void runDocumentTask("translate-ko") },
      { label: "영어로", onClick: () => void runDocumentTask("translate-en") },
    ],
  });
  ```

- [ ] **Step 4: `translate.ts` 삭제 (소비자 0 확인 후)**

Run: `grep -rn "lib/translate\"" src` — 임포트가 0건이어야 한다(TaskView·Indicator·Menu·TopBar·MarkdownViewer·store 전부 이전됨).
그다음:
```bash
git rm src/lib/translate.ts
```

- [ ] **Step 5: 죽은 `translate_markdown`(Rust) 제거**

Run: `grep -rn "translate_markdown" src` → 0건 확인.
- `src-tauri/src/commands/translate.rs`: `translate_markdown` 함수 전체 삭제. `strip_outer_fence`/`cache_key`/`resolve_claude`/`quiet`/`kill_pid`/상태/`claude_status`/`run_claude`/`cancel_translate`는 **유지**.
- `src-tauri/src/lib.rs:19` use 목록에서 `translate_markdown,` 제거.
- `src-tauri/src/lib.rs` `generate_handler!` 목록에서 `translate_markdown,` 제거.

- [ ] **Step 6: CLAUDE.md 예외 조항 확장**

`CLAUDE.md` "코드 품질 원칙"의 예외 2 문장을 교체:
```
예외 2: AI 문서 작업(번역·검토·개선·요점정리 등) — 사용자가 메뉴에서 직접 트리거할 때만
 로컬 `claude` CLI를 통해 Anthropic과 통신. 백그라운드/텔레메트리 아님, 별도 과금 없음(기존 로그인 사용).
 작업 정의는 src/lib/aiTasks.ts 레지스트리에 있으며, 새 작업 추가 시 이 예외 범위에 포함된다.
```

- [ ] **Step 7: BACKLOG.md BL-007에 i18n 마이그레이션 후속 항목 추가**

`BACKLOG.md`의 `[BL-007]` 항목 마지막 bullet(`긴 문서 분할 요약(map-reduce)...`) 뒤에 추가:

```
- **UI 문자열 i18n화**: v1은 `main`에 i18n 모듈(`src/lib/i18n/`)이 없어 한국어 문자열을 리터럴로
  직접 작성했다(`src/lib/aiTasks.ts`의 `AiTask.label`, `TaskView.tsx`, `TranslationIndicator.tsx`,
  `HamburgerMenu.tsx`의 "AI 작업" 서브메뉴, `TopBar.tsx`·`MarkdownViewer.tsx`의 번역 항목).
  `feat/i18n`이 `main`에 병합된 뒤, 이 문자열들을 `t()`/`useT()` 기반 키로 옮긴다.
```

- [ ] **Step 8: 전체 빌드·테스트**

Run: `cd src-tauri && cargo build 2>&1 | tail -15 && cargo test 2>&1 | tail -10 && cd .. && npm run build 2>&1 | tail -15 && npm test 2>&1 | tail -15`
Expected: 전부 성공. 미사용 import/경고 0(있으면 정리).

- [ ] **Step 9: 최종 수동 회귀**

Run: `npm run dev:win` → 검토·개선·요점정리·번역(한/영, 햄버거 메뉴 경로) 전부 재확인. **추가로 TopBar 툴바 번역 드롭다운·본문 우클릭 컨텍스트 메뉴의 번역도 각각 확인**(Step 2·3에서 이전한 두 경로). **취소 회귀 특별 확인**: 긴 문서 번역 중 취소 → "AI 작업을 취소했습니다" 토스트 1개만(실패 토스트 중복 없음). 작업 중 다른 문서로 이동 → 조용히 취소되고 에러 없음(store 경로).

- [ ] **Step 10: 커밋**

```bash
git add -A src/store/app.ts src/components/layout/TopBar.tsx src/components/viewer/MarkdownViewer.tsx src-tauri/src/commands/translate.rs src-tauri/src/lib.rs CLAUDE.md BACKLOG.md
git commit -m "chore(ai-tasks): migrate remaining consumers, drop translate.ts/translate_markdown, widen CLAUDE.md exception"
```

---

## Self-Review 결과

**Spec 커버리지:** §3.1 범용 실행기→T1 / §3.2 레지스트리→T2, runClaude·runDocumentTask→T4 / §4 taskDoc·OutputKind 뷰→T3·T5 / §5 프롬프트→T2 / §6 모델(haiku/sonnet)→T2 레지스트리 / §7 메뉴→T6 / §8 거버넌스→T7 / §9 확장성→T2 구조 / §10 테스트→T1·T2 / §11 범위밖→BL-007(계획 대상 아님). ✅ 갭 없음.

**순서 불변식(리뷰 반영):** producer 삭제 전 소비자 이전. T4는 추가만(translate.ts 무수정). T5에서 TaskView·pill을 aiTasks로, T6에서 메뉴를, T7에서 store 취소 호출을 이전한 뒤 translate.ts 삭제. → 각 Task 빌드 green.

**단일 취소 플래그:** 실행기·청크러너·`cancelled`를 모두 `aiTasks.ts` 한 모듈에 둠 → 취소 시 청크/단일 경로가 같은 플래그를 봐 중복 토스트 없음(리뷰 #2 해소). 순환/동적 import 불필요(store→aiTasks 동적 import 1곳은 기존 패턴 유지).

**진행 pill:** `TranslationIndicator`가 `taskDoc.taskId`로 작업명을 표시 → 검토 시 "번역 중"이 아니라 "검토 중"(리뷰 #3 해소).

**타입 일관성:** `taskDoc:{taskId,content}` / `showTaskResult(taskId,content)` / `runDocumentTask(taskId)` / `getTask(id)` / `AiTask.output:OutputKind` / `saveSuffix` — T2~T7 동일 시그니처. `AiTask.labelKey`(i18n 키) → `AiTask.label`(리터럴 한국어)로 통일 — T2 정의, T4(사용 없음)·T5·T6 전부 `task.label`/`task?.label` 참조로 일관.

**의도된 동작(비블로킹, 리뷰 note):** `run_claude`는 `hash(prompt+model)` 캐시라 같은 문서·작업·모델 재실행은 캐시된 동일 결과를 반환(재-roll 없음). v1은 번역과 동일하게 이 동작을 수용. 재실행 강제가 필요해지면 후속(BL-007 인접).

**Pre-flight 발견(사용자 확인 2026-07-03):** 원 설계 스펙은 이 브랜치의 기반(`main`)에 없는 `feat/i18n`(미병합)의 `src/lib/i18n/` 모듈을 전제했다. 사용자 결정에 따라 **하드코딩 리터럴 한국어로 계획 전체를 수정**(T2 `AiTask.label`, T4 토스트 문자열, T5 `TaskView`/`TranslationIndicator`, T6 메뉴 라벨) — `t()`/`useT()`/`i18n` import 전부 제거. T7에 BL-007 후속 항목(병합 후 i18n화) 기록 스텝 추가.
