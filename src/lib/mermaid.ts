// Mermaid rendering. Lazy-loaded (the lib is large) and offline-bundled.
// Each diagram renders in isolation; a failure falls back to a code block so a
// malformed diagram never crashes the viewer.
import { decodeBase64 } from "./markdown";
import { t } from "./i18n";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mermaidMod: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loadPromise: Promise<any> | null = null;
let renderSeq = 0;

async function loadMermaid(isDark: boolean) {
  if (!mermaidMod) {
    if (!loadPromise) loadPromise = import("mermaid");
    mermaidMod = (await loadPromise).default;
  }
  // Re-init per theme so diagrams match the active light/dark palette.
  mermaidMod.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: isDark ? "dark" : "neutral",
    fontFamily: "Pretendard, system-ui, sans-serif",
  });
  return mermaidMod;
}

// A wide diagram is fit to the column width, but never shrunk below this share
// of its natural size — past that the text gets unreadable, so it scrolls instead.
const MIN_SCALE = 0.75;

function limitShrink(block: HTMLElement): void {
  const svg = block.querySelector("svg");
  const natural = svg?.viewBox.baseVal?.width;
  if (svg && natural) svg.style.minWidth = `${Math.round(natural * MIN_SCALE)}px`;
}

/**
 * Render every `.mermaid-block` placeholder inside `root`. Idempotent: blocks
 * already rendered (marked with data-rendered) are skipped on re-runs.
 */
export async function renderMermaid(root: HTMLElement, isDark: boolean): Promise<void> {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>(".mermaid-block[data-mermaid]")
  ).filter((b) => b.dataset.rendered !== "1");
  if (blocks.length === 0) return;

  let mermaid;
  try {
    mermaid = await loadMermaid(isDark);
  } catch {
    // Library failed to load — leave placeholders as-is (silent, no crash).
    return;
  }

  for (const block of blocks) {
    const code = decodeBase64(block.dataset.mermaid ?? "");
    block.dataset.rendered = "1";
    const id = `mmd-${Date.now()}-${renderSeq++}`;
    try {
      const { svg } = await mermaid.render(id, code);
      block.innerHTML = svg;
      block.classList.add("mermaid-rendered");
      limitShrink(block);
    } catch {
      // Fallback: show the source as a plain code block. App stays alive.
      block.classList.add("mermaid-error");
      const pre = document.createElement("pre");
      pre.className = "shiki";
      const codeEl = document.createElement("code");
      codeEl.textContent = code;
      pre.appendChild(codeEl);
      const note = document.createElement("div");
      note.className = "mermaid-error-note";
      note.textContent = t("mermaid.renderError");
      block.innerHTML = "";
      block.append(note, pre);
    }
  }
}

/** Force diagrams to re-render (e.g. after a theme switch). */
export function resetMermaidRender(root: HTMLElement): void {
  root
    .querySelectorAll<HTMLElement>(".mermaid-block")
    .forEach((b) => delete b.dataset.rendered);
}
