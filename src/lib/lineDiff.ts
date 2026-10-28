// Line-level unified diff (LCS-based). Pure, dependency-free, and unit-tested in
// isolation (lineDiff.test.ts) so the compare view can render a git-style
// unified diff of two documents.
//
// Direction convention used by the compare view: `base` = the document the user
// is currently viewing, `other` = the document they picked to compare against.
//   - a line present only in `base`  → 'remove' (only in the current document, red)
//   - a line present only in `other` → 'add'    (only in the target document, green)
//   - a line present in both         → 'context'

export type DiffLineType = "context" | "add" | "remove";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  // 1-based line numbers within each source (only the relevant side is set):
  // context lines carry both; add carries only `otherLineNo`; remove only
  // `baseLineNo`.
  baseLineNo?: number;
  otherLineNo?: number;
}

/**
 * Split text into lines for diffing. A trailing newline does NOT produce a
 * spurious empty final line (so "a\n" is a single line "a"), matching how users
 * think about document lines. An empty string yields a single empty line so the
 * two-empty-docs case is "all context", not "nothing".
 */
function splitLines(text: string): string[] {
  // Normalize CRLF/CR → LF first so platform line endings don't show as diffs.
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  // Drop a single trailing empty element introduced by a terminal newline.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Compute the line-level unified diff between `baseText` and `otherText`.
 * Standard LCS dynamic programming over the line arrays, then a backtrack that
 * emits removes (base-only), adds (other-only), and context (common) lines in
 * source order.
 */
export function lineDiff(baseText: string, otherText: string): DiffLine[] {
  const a = splitLines(baseText); // base
  const b = splitLines(otherText); // other
  const n = a.length;
  const m = b.length;

  // dp[i][j] = LCS length of a[i..] and b[j..]. (n+1)×(m+1), zero-filled.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "context", text: a[i], baseLineNo: i + 1, otherLineNo: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      // Dropping a[i] keeps a longer (or equal) LCS → it's a removal.
      out.push({ type: "remove", text: a[i], baseLineNo: i + 1 });
      i++;
    } else {
      out.push({ type: "add", text: b[j], otherLineNo: j + 1 });
      j++;
    }
  }
  // Tail: whatever remains is pure removes / adds.
  while (i < n) {
    out.push({ type: "remove", text: a[i], baseLineNo: i + 1 });
    i++;
  }
  while (j < m) {
    out.push({ type: "add", text: b[j], otherLineNo: j + 1 });
    j++;
  }
  return out;
}

/** One row of a side-by-side (2-pane) diff: left = before (remove/context), right = after (add/context). */
export interface SideBySideRow {
  left: DiffLine | null; // null = no "before" side on this row (an added line)
  right: DiffLine | null; // null = no "after" side on this row (a removed line)
}

/**
 * Convert a unified diff (the `lineDiff` result) into side-by-side 2-pane rows. Context
 * lines appear on both sides; in a changed hunk, removes (left) and adds (right) are
 * paired row by row (GitHub split-view style). If one side has more lines, the shorter
 * side is padded with blanks (null). Display-only conversion, so it is a pure function.
 */
export function toSideBySideRows(lines: DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type === "context") {
      rows.push({ left: lines[i], right: lines[i] });
      i++;
      continue;
    }
    // Gather a contiguous changed hunk, split it into removes/adds, then pair them row by row.
    const removes: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].type !== "context") {
      (lines[i].type === "remove" ? removes : adds).push(lines[i]);
      i++;
    }
    const k = Math.max(removes.length, adds.length);
    for (let x = 0; x < k; x++) {
      rows.push({ left: removes[x] ?? null, right: adds[x] ?? null });
    }
  }
  return rows;
}
