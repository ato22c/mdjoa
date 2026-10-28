// Wrap-aware line↔pixel mapping for the editor's <textarea>.
//
// A textarea soft-wraps long lines, so "source line N is at pixel N × lineHeight"
// is wrong whenever any line above the fold wraps to more than one visual row —
// the error grows the further you scroll. That broke view↔edit scroll transfer
// (which lines up the SAME source line in both modes).
//
// To measure the true vertical offset of each source line we mirror the textarea
// into a hidden <div> with identical wrapping metrics (width, font, padding,
// white-space) and read each line-start marker's offsetTop. Results are cached
// per (value, width) so the on-scroll path is just an array lookup.

interface LineTopsCache {
  ta: HTMLTextAreaElement;
  value: string;
  width: number;
  padTop: number;
  // tops[i] = vertical offset (px, in the textarea's own scroll coordinate space,
  // 0 = first content line) of source line i's first visual row.
  tops: number[];
}

let cache: LineTopsCache | null = null;
let mirror: HTMLDivElement | null = null;

// Above this line count, skip the per-line mirror measurement (perf/memory guard).
const MAX_MIRROR_LINES = 6000;

// Style properties that affect line wrapping/height, copied from the textarea.
const COPIED_PROPS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "textTransform",
  "lineHeight",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "boxSizing",
  "tabSize",
] as const;

function buildTops(ta: HTMLTextAreaElement): LineTopsCache {
  if (!mirror) {
    mirror = document.createElement("div");
    mirror.setAttribute("aria-hidden", "true");
    document.body.appendChild(mirror);
  }
  const cs = getComputedStyle(ta);
  const padTop = parseFloat(cs.paddingTop) || 0;
  const lineCount = ta.value.length === 0 ? 1 : ta.value.split("\n").length;

  // Very long document: skip the per-line mirror (building tens of thousands of
  // spans + a forced layout would jank). Fall back to a flat line-height estimate
  // (less exact with soft-wrap, but cheap and crash-safe).
  if (lineCount > MAX_MIRROR_LINES) {
    const lineH = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 13) * 1.7;
    const tops = ta.value.split("\n").map((_, i) => i * lineH);
    return { ta, value: ta.value, width: ta.clientWidth, padTop, tops };
  }

  const m = mirror;
  m.style.position = "absolute";
  m.style.visibility = "hidden";
  m.style.top = "0";
  m.style.left = "-99999px";
  // Copy the wrapping-related properties from the real textarea's computed style
  // instead of hardcoding them. Code-file editing (wrap="off") computes white-space
  // as "pre", so the mirror must measure without wrapping too — forcing "pre-wrap"
  // here would make the gutter compute positions as if lines wrapped even though
  // the real textarea doesn't, throwing the line numbers off.
  m.style.whiteSpace = cs.whiteSpace;
  m.style.overflowWrap = cs.overflowWrap;
  m.style.wordBreak = cs.wordBreak;
  // Match the textarea's content-box width so wrapping happens at the same column.
  m.style.width = `${ta.clientWidth}px`;
  for (const p of COPIED_PROPS) m.style[p] = cs[p] as string;

  // One marker span per source line; literal "\n" between them forces a new line
  // (pre-wrap), so a wrapped line still pushes the next marker down correctly.
  // Empty lines get a zero-width char so they occupy a row.
  m.textContent = "";
  const lines = ta.value.split("\n");
  const spans: HTMLSpanElement[] = [];
  for (let i = 0; i < lines.length; i++) {
    const span = document.createElement("span");
    span.textContent = lines[i].length ? lines[i] : "​";
    m.appendChild(span);
    spans.push(span);
    if (i < lines.length - 1) m.appendChild(document.createTextNode("\n"));
  }

  // offsetTop is measured from the mirror's padding edge, so it includes padTop;
  // subtract it to get a content-relative offset (line 0 → 0), matching the
  // textarea's scroll coordinate where scrollTop 0 shows the top padding.
  const tops = spans.map((s) => s.offsetTop - padTop);

  return { ta, value: ta.value, width: ta.clientWidth, padTop, tops };
}

function getTops(ta: HTMLTextAreaElement): number[] {
  if (
    !cache ||
    cache.ta !== ta ||
    cache.value !== ta.value ||
    cache.width !== ta.clientWidth
  ) {
    cache = buildTops(ta);
  }
  return cache.tops;
}

/**
 * Per-source-line vertical offsets (px, in the textarea's scroll coordinate
 * space; `tops[i]` = top of source line i, `tops[0] === 0`). Wrap-aware — a
 * soft-wrapped line above pushes later offsets down. Used by the line-number
 * gutter to place each number at its line's true position. Cached per
 * (value, width), so repeated calls are cheap.
 */
export function editorLineTops(ta: HTMLTextAreaElement): number[] {
  return getTops(ta).slice();
}

/** scrollTop that puts the given 0-based full-file source line at the viewport top. */
export function editorScrollTopForLine(ta: HTMLTextAreaElement, line: number): number {
  const tops = getTops(ta);
  if (!tops.length) return 0;
  const i = Math.floor(line);
  if (i < 0) return 0;
  if (i >= tops.length - 1) return tops[tops.length - 1];
  const f = line - i; // fractional part → interpolate within the line's block
  return tops[i] + f * (tops[i + 1] - tops[i]);
}

/** 0-based full-file source line at the given textarea scrollTop (interpolated). */
export function editorLineAtScrollTop(ta: HTMLTextAreaElement, scrollTop: number): number {
  const tops = getTops(ta);
  if (!tops.length) return 0;
  let i = 0;
  while (i < tops.length - 1 && tops[i + 1] <= scrollTop) i++;
  if (i >= tops.length - 1) return i;
  const span = Math.max(1, tops[i + 1] - tops[i]);
  const f = Math.min(1, Math.max(0, (scrollTop - tops[i]) / span));
  return i + f;
}
