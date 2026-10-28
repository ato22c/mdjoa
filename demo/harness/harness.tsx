// 데모 캡처 전용 하네스 — 앱의 실제 렌더링 파이프라인(renderMarkdown + Shiki + KaTeX +
// Mermaid + 앱 CSS)을 그대로 써서 showcase.md를 렌더한다. Tauri 셸 없이 browse(Chromium)로
// 스크린샷/GIF 프레임을 캡처하기 위한 임시 스캐폴딩. 배포 코드 아님 — 캡처 후 삭제.
import "../../src/styles/global.css";
import "../../src/styles/markdown.css";
import { renderMarkdown, highlightPendingCode } from "../../src/lib/markdown";
import { renderMermaid } from "../../src/lib/mermaid";
import { lineDiff, toSideBySideRows } from "../../src/lib/lineDiff";
import showcase from "../showcase.md?raw";
import showcaseB from "../showcase-b.md?raw";

// v2: 자동 새로고침 데모용 — showcase(v1)에서 몇 곳만 바뀐 버전.
// (상태 배지, 체크박스 하나 완료, 표의 롤백 셀 변경) → "파일이 바뀌면 뷰어가 즉시 갱신"을 보여준다.
const showcaseV2 = showcase
  .replace("status: 배포 완료", "status: 배포 완료 · 카나리 100% 전환됨")
  .replace(
    "- [ ] 정산 리포트 CSV 내보내기 *(다음 릴리스로 이월)*",
    "- [x] 정산 리포트 CSV 내보내기 *(v2.4에 포함됨!)*"
  )
  .replace("| DB 스키마 | `settlement_events` 테이블 신설 | 높음 | **불가** |",
           "| DB 스키마 | `settlement_events` 테이블 신설 | 높음 | ✅ 검증됨 |");

const params = new URLSearchParams(location.search);
const scene = params.get("scene") ?? "rendered"; // rendered | raw | v1 | v2
const isDark = params.get("theme") === "dark";

// 앱과 동일한 테마 토글: 다크는 최상위에 .dark 클래스.
if (isDark) document.documentElement.classList.add("dark");
document.documentElement.setAttribute("data-content-font", "pretendard");
document.body.style.background = "var(--bg)";
document.body.style.margin = "0";

const root = document.getElementById("harness-root")!;

function docFor(): string {
  if (scene === "v2") return showcaseV2;
  if (scene === "render-b") return showcaseB; // B안 히어로: AI 지침 문서(SKILL.md) 렌더
  return showcase; // rendered / raw / v1
}

// AI 변경 리뷰 센터(diff) 재현 — 앱 ReviewCenter의 우측 2-pane을 실제 lineDiff 엔진 +
// compare-* CSS로 그대로 그린다. before=기준선(showcase), after=현재 디스크(showcaseV2).
function mountDiff() {
  const before = showcase;
  const after = showcaseV2;
  const rows = toSideBySideRows(lineDiff(before, after));
  const esc = escapeHtml;
  const rowsHtml = rows
    .map((r) => {
      const l = r.left, rt = r.right;
      const lCls = l?.type === "remove" ? " compare-remove" : "";
      const rCls = rt?.type === "add" ? " compare-add" : "";
      return (
        `<div class="compare-split-row">` +
        `<div class="compare-cell${lCls}"><span class="compare-lineno">${l?.baseLineNo ?? ""}</span>` +
        `<span class="compare-text">${l ? (l.text === "" ? " " : esc(l.text)) : ""}</span></div>` +
        `<div class="compare-cell${rCls}"><span class="compare-lineno">${rt?.otherLineNo ?? ""}</span>` +
        `<span class="compare-text">${rt ? (rt.text === "" ? " " : esc(rt.text)) : ""}</span></div>` +
        `</div>`
      );
    })
    .join("");

  // 좌측 파일 목록(리뷰 센터 룩): 종류 배지. showcase.md=수정 선택됨.
  const files = [
    { name: "showcase.md", kind: "수정", color: "#d29922", active: true },
    { name: "api-notes.md", kind: "생성", color: "#2ea043", active: false },
    { name: "old-plan.md", kind: "삭제", color: "#f85149", active: false },
  ];
  const listHtml = files
    .map(
      (f) =>
        `<div class="rc-file${f.active ? " rc-file-active" : ""}">` +
        `<span class="rc-dot" style="background:${f.color}"></span>` +
        `<span class="rc-name"${f.kind === "삭제" ? ' style="text-decoration:line-through;opacity:.6"' : ""}>${f.name}</span>` +
        `<span class="rc-badge" style="color:${f.color}">${f.kind}</span></div>`
    )
    .join("");

  root.innerHTML = `
    <div class="rc-backdrop">
      <div class="rc-modal">
        <div class="rc-header">
          <span class="rc-title">변경 리뷰</span>
          <span class="rc-count">변경 3개</span>
          <span class="rc-clear">모두 확인</span>
        </div>
        <div class="rc-body">
          <div class="rc-list">${listHtml}</div>
          <div class="rc-diff">
            <div class="rc-diff-head"><span class="rc-diff-name">showcase.md</span></div>
            <div class="rc-diff-cols"><div class="rc-col-l">이전</div><div class="rc-col-r">현재</div></div>
            <div class="rc-diff-scroll">
              <div class="md-content" style="width:100%">
                <div class="compare-split">${rowsHtml}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  signalReady();
}

async function mount() {
  if (scene === "diff") {
    mountDiff();
    return;
  }
  if (scene === "raw") {
    // "렌더링 없이 원문만 봤을 때" — 평범한 에디터/터미널에서 보이는 모습.
    // 앱의 md-body와 같은 폭·여백 안에 monospace 원문을 그대로 깐다.
    root.innerHTML = `
      <div class="harness-scroll">
        <div class="harness-col">
          <pre class="harness-raw">${escapeHtml(showcase)}</pre>
        </div>
      </div>`;
    signalReady();
    return;
  }

  const content = docFor();
  const { html } = await renderMarkdown(content, null, isDark);
  root.innerHTML = `
    <div class="harness-scroll">
      <div class="harness-col">
        <div class="md-body" id="md-body">${html}</div>
      </div>
    </div>`;
  const body = document.getElementById("md-body") as HTMLElement;
  // 앱과 동일한 후처리: Mermaid 다이어그램 렌더 + 코드 하이라이팅 인플레이스 적용.
  await highlightPendingCode(body, isDark);
  await renderMermaid(body, isDark);
  // Mermaid는 내부적으로 비동기 레이아웃이라, SVG가 실제로 붙고 높이를 가질 때까지
  // 폴링한 뒤(최대 5s) 여유를 두고 준비 신호를 낸다. 캡처가 렌더 완료 전에 찍히는 것 방지.
  const hasMermaid = body.querySelector(".mermaid-block");
  for (let i = 0; i < 50 && hasMermaid; i++) {
    const svg = body.querySelector(".mermaid-block svg") as SVGElement | null;
    if (svg && svg.getBoundingClientRect().height > 20) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await document.fonts.ready;
  setTimeout(signalReady, 500);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 캡처 스크립트가 폴링할 준비 완료 플래그.
function signalReady() {
  (window as unknown as { __READY__: boolean }).__READY__ = true;
  document.title = "READY";
}

// 하네스 전용 레이아웃 CSS (앱 MarkdownViewer의 컨테이너 구조를 재현).
const style = document.createElement("style");
style.textContent = `
  .harness-scroll {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 44px 32px 80px;
    box-sizing: border-box;
  }
  .harness-col { width: 100%; max-width: 820px; }
  .harness-raw {
    font-family: "JetBrains Mono", "D2Coding", ui-monospace, monospace;
    font-size: 13px;
    line-height: 1.55;
    color: var(--fg-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }
  /* ── AI 변경 리뷰 센터(diff) 크롬 재현 ── */
  .rc-backdrop {
    min-height: 100vh; background: rgba(0,0,0,0.35);
    display: flex; align-items: center; justify-content: center; padding: 24px;
    box-sizing: border-box;
  }
  .rc-modal {
    width: 960px; max-width: 96vw; height: 640px;
    background: var(--bg); border-radius: 16px; overflow: hidden;
    display: flex; flex-direction: column; box-shadow: var(--shadow-popover);
  }
  .rc-header {
    display: flex; align-items: center; gap: 12px; padding: 0 20px; height: 48px;
    border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .rc-title { font-size: 14px; font-weight: 600; color: var(--fg); }
  .rc-count { font-size: 12px; color: var(--muted); }
  .rc-clear {
    margin-left: auto; font-size: 13px; color: var(--fg);
    border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px;
  }
  .rc-body { flex: 1; min-height: 0; display: flex; }
  .rc-list {
    width: 240px; flex-shrink: 0; border-right: 1px solid var(--border);
    padding: 6px 0;
  }
  .rc-file {
    display: flex; align-items: center; gap: 8px; padding: 8px 14px;
    font-size: 13px; color: var(--fg);
  }
  .rc-file-active { background: var(--active); }
  .rc-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .rc-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rc-badge {
    font-size: 10px; padding: 2px 7px; border-radius: 999px; background: var(--hover);
    flex-shrink: 0;
  }
  .rc-diff { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .rc-diff-head {
    height: 40px; display: flex; align-items: center; padding: 0 16px;
    border-bottom: 1px solid var(--border); font-size: 12px; font-weight: 500; color: var(--fg);
    flex-shrink: 0;
  }
  .rc-diff-cols {
    display: grid; grid-template-columns: 1fr 1fr; font-size: 11px; font-weight: 500;
    color: var(--muted); border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .rc-col-l { padding: 4px 20px; }
  .rc-col-r { padding: 4px 20px; border-left: 1px solid var(--border); }
  .rc-diff-scroll { flex: 1; min-height: 0; overflow: auto; padding: 14px 18px 32px; }
`;
document.head.appendChild(style);

mount();
