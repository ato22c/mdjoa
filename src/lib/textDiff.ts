// Block-level text diffing for the "변경 하이라이트" (change highlight) feature.
//
// When a file is reloaded due to an external edit, we want to show the user
// *which* parts changed. We approximate this at the block level: each text is
// split into blocks on blank lines (mirroring how Markdown groups paragraphs,
// headings, lists, code fences, etc. into top-level elements), then a simple
// LCS over the block strings tells us which blocks in the new text are new or
// modified. Dependency-free and intentionally approximate — good enough to
// draw the user's eye to the right region for the MVP.

/** Split text into blocks on blank lines, trimming and dropping empties. */
function toBlocks(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

/**
 * Returns the indices (in newText's block list) of blocks that were ADDED or
 * CHANGED relative to oldText. Indices are 0-based and correspond to the order
 * of non-empty blocks in newText.
 *
 * Approach: classic LCS (longest common subsequence) over the two block-string
 * arrays. Blocks in newText that are NOT part of the common subsequence are
 * the ones that were added or changed, so we report their indices.
 */
export function changedBlockIndices(oldText: string, newText: string): number[] {
  const oldBlocks = toBlocks(oldText);
  const newBlocks = toBlocks(newText);

  const m = oldBlocks.length;
  const n = newBlocks.length;

  // No new content at all → nothing to highlight.
  if (n === 0) return [];
  // No prior content (or prior was empty) → treat everything as new.
  if (m === 0) return newBlocks.map((_, i) => i);

  // LCS length table. dp[i][j] = LCS length of oldBlocks[i..] and newBlocks[j..].
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldBlocks[i] === newBlocks[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Walk the table to find which newBlocks are part of the common subsequence;
  // every other new block index is reported as added/changed.
  const matchedNew = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldBlocks[i] === newBlocks[j]) {
      matchedNew.add(j);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  const changed: number[] = [];
  for (let k = 0; k < n; k++) {
    if (!matchedNew.has(k)) changed.push(k);
  }
  return changed;
}
