// Shared subsequence fuzzy matcher. Used by QuickOpen (file names) and the
// command palette (CommandPalette, command labels). Pure + dependency-free so it's unit-tested
// in isolation. Higher score = better match; null = the query is not a
// subsequence of the target.
//
// Rewards contiguous runs, matches at the start of string, and matches right
// after a word boundary (-, _, space, .). Korean labels have no ASCII word
// boundaries, so for those it degrades gracefully to a plain subsequence test
// (still ranks shorter/earlier matches higher via the length penalty).

export function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let score = 0;
  let qi = 0;
  let prevMatch = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      let bonus = 1;
      if (ti === prevMatch + 1) bonus += 5; // contiguous run
      if (ti === 0) bonus += 8; // start of string
      else {
        const prev = t[ti - 1];
        if (prev === "-" || prev === "_" || prev === " " || prev === ".") bonus += 4; // word boundary
      }
      score += bonus;
      prevMatch = ti;
      qi++;
    }
  }
  if (qi < q.length) return null; // not a full subsequence
  // Shorter targets that fully match rank slightly higher.
  score -= t.length * 0.05;
  return score;
}

/**
 * Filter + rank a list of items by fuzzy-matching `query` against each item's
 * searchable text (`keyOf`). Empty query keeps the original order. Non-matching
 * items are dropped. Ties break by the item's label/text via `keyOf`.
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  keyOf: (item: T) => string
): T[] {
  const q = query.trim();
  if (!q) return items;
  const scored: { item: T; score: number; key: string }[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const s = fuzzyScore(q, key);
    if (s === null) continue;
    scored.push({ item, score: s, key });
  }
  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return scored.map((s) => s.item);
}
