// Line-anchor scroll sync helpers, shared by the read view (MarkdownViewer) and
// the editor. Instead of a proportional ratio (which drifts when rendered height
// ≠ raw-text height — images, diagrams, tables, math), we map a SOURCE LINE to a
// vertical position so view↔edit lands on the SAME content.
//
// Anchors come from `[data-source-line]` blocks (markdown.ts tags every top-level
// block with its 0-based BODY line). The editor (raw text) has no such DOM, so it
// derives its top line arithmetically (scrollTop / lineHeight − frontmatter lines)
// and restores the same way.

export interface SrcAnchor {
  line: number; // source line (0-based, body-relative — matches data-source-line)
  top: number; // px from the top of the scroll content
}

/** Collect {line, top} for every tagged block, in document (= ascending) order. */
export function collectAnchors(scroller: HTMLElement, content: HTMLElement): SrcAnchor[] {
  const cTop = scroller.getBoundingClientRect().top;
  const out: SrcAnchor[] = [];
  content.querySelectorAll<HTMLElement>("[data-source-line]").forEach((el) => {
    const ln = parseInt(el.dataset.sourceLine ?? "", 10);
    if (Number.isNaN(ln)) return;
    out.push({ line: ln, top: el.getBoundingClientRect().top - cTop + scroller.scrollTop });
  });
  return out;
}

/** Source line currently at the top of the viewport (linear interp between anchors). */
export function lineAtScrollTop(anchors: SrcAnchor[], scrollTop: number): number | null {
  if (!anchors.length) return null;
  let i = 0;
  while (i < anchors.length - 1 && anchors[i + 1].top <= scrollTop) i++;
  if (i >= anchors.length - 1) return anchors[i].line;
  const span = Math.max(1, anchors[i + 1].top - anchors[i].top);
  const f = Math.min(1, Math.max(0, (scrollTop - anchors[i].top) / span));
  return anchors[i].line + f * (anchors[i + 1].line - anchors[i].line);
}

/** scrollTop that puts the given source line at the top of the viewport. */
export function scrollTopForLine(anchors: SrcAnchor[], line: number): number | null {
  if (!anchors.length) return null;
  let i = 0;
  while (i < anchors.length - 1 && anchors[i + 1].line <= line) i++;
  if (i >= anchors.length - 1) return anchors[i].top;
  const span = Math.max(1, anchors[i + 1].line - anchors[i].line);
  const f = Math.min(1, Math.max(0, (line - anchors[i].line) / span));
  return anchors[i].top + f * (anchors[i + 1].top - anchors[i].top);
}
