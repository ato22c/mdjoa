// Pure find/replace helpers for the edit-mode <textarea> (see EditorFindBar).
// Operates on the raw markdown string so it's trivially unit-testable and shares
// no DOM concerns with the read-view SearchBar (which highlights rendered HTML).
// Matching is literal (the query is escaped, never interpreted as a regex) to
// match user expectation in a plain editor.

/** Escape a string so it matches literally inside a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface FindMatch {
  /** Inclusive start offset in the source text. */
  start: number;
  /** Exclusive end offset in the source text. */
  end: number;
}

/**
 * All non-overlapping matches of `query` in `text`, left to right.
 * Empty query → no matches. Case-insensitive unless `caseSensitive`.
 */
export function findMatches(text: string, query: string, caseSensitive = false): FindMatch[] {
  if (!query) return [];
  const re = new RegExp(escapeRegExp(query), caseSensitive ? "g" : "gi");
  const out: FindMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length });
    // Guard against a pathological zero-length match looping forever.
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

/**
 * Replace every match of `query` with `replacement` (replacement is literal —
 * `$&` etc. are NOT special). Returns the new text and how many were replaced.
 */
export function replaceAllMatches(
  text: string,
  query: string,
  replacement: string,
  caseSensitive = false
): { text: string; count: number } {
  const matches = findMatches(text, query, caseSensitive);
  if (!matches.length) return { text, count: 0 };
  let out = "";
  let last = 0;
  for (const m of matches) {
    out += text.slice(last, m.start) + replacement;
    last = m.end;
  }
  out += text.slice(last);
  return { text: out, count: matches.length };
}

/** 0-based line number (newline count before `index`) of an offset in `text`. */
export function lineOfIndex(text: string, index: number): number {
  let line = 0;
  const n = Math.min(Math.max(index, 0), text.length);
  for (let i = 0; i < n; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Index of the first match whose start is at or after `pos`; falls back to 0
 * (wrap to the first match) when none is at/after `pos`. -1 when there are none.
 */
export function firstMatchFrom(matches: FindMatch[], pos: number): number {
  if (!matches.length) return -1;
  const i = matches.findIndex((m) => m.start >= pos);
  return i < 0 ? 0 : i;
}
