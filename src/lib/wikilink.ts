// Wikilink parsing — the single source of truth for the `[[…]]` syntax, shared
// by the markdown-it inline rule (feature E / #9) and the backlink scan logic
// (feature F / #10). Kept as a pure, runtime-free module so it can be unit
// tested in plain Node (see wikilink.test.ts) and reused on both sides without
// pulling in markdown-it or Tauri.

/** A single parsed wikilink reference. */
export interface WikiLink {
  /** Raw target file name as written, e.g. "My Note" (no extension, trimmed). */
  target: string;
  /** Optional heading after `#`, trimmed. `null` when absent. */
  heading: string | null;
}

/**
 * Parse the inside of a `[[…]]` token (the text BETWEEN the brackets) into a
 * target + optional heading. Returns `null` when the body is empty/whitespace
 * or has an empty target (e.g. `[[]]`, `[[#h]]`), so callers can skip rendering
 * a broken link.
 *
 * Splitting is on the FIRST `#` only, so a heading may itself contain `#`.
 * Both sides are trimmed; surrounding whitespace inside the brackets is
 * tolerated (`[[ a # b ]]`).
 */
export function parseWikiLinkBody(body: string): WikiLink | null {
  const hashIdx = body.indexOf("#");
  let target: string;
  let heading: string | null;
  if (hashIdx === -1) {
    target = body.trim();
    heading = null;
  } else {
    target = body.slice(0, hashIdx).trim();
    const h = body.slice(hashIdx + 1).trim();
    heading = h.length > 0 ? h : null;
  }
  if (target.length === 0) return null;
  return { target, heading };
}

/**
 * Find every `[[…]]` wikilink in a block of Markdown text and return the parsed
 * references in document order. Used by the backlink scan (#10) to decide
 * whether a file references a given document.
 *
 * Deliberately simple/linear: scans for `[[` then the next `]]`. Fenced/inline
 * code is NOT stripped here — the markdown-it inline rule (#9) is what controls
 * rendering inside code, and the backlink scan errs toward inclusion (a `[[x]]`
 * mentioned in a code block still "references" x for backlink purposes, which
 * is acceptable and avoids a second Markdown parse on every scanned file).
 */
export function extractWikiLinks(text: string): WikiLink[] {
  const out: WikiLink[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("[[", i);
    if (open === -1) break;
    const close = text.indexOf("]]", open + 2);
    if (close === -1) break;
    const body = text.slice(open + 2, close);
    // A wikilink body never spans a `[[` start — bail to avoid eating across a
    // malformed/nested opener, but still advance so we keep scanning.
    if (!body.includes("[[")) {
      const link = parseWikiLinkBody(body);
      if (link) out.push(link);
    }
    i = close + 2;
  }
  return out;
}

/**
 * Normalize a wikilink target / file name for matching: lowercase, strip a
 * trailing `.md`/`.markdown`, and trim. Lets `[[Note]]`, `[[note]]`,
 * `[[Note.md]]` all resolve to the file `Note.md`. Mirrors the Rust-side
 * normalization so backlink (#10) and resolution (#9) agree.
 */
export function normalizeWikiTarget(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\.(md|markdown)$/i, "");
}

/**
 * True if `text` contains a `[[…]]` reference whose target resolves (after
 * normalization, heading ignored) to `docName`. `docName` may be a bare name or
 * a file name with extension. Used by the frontend as a pure predicate; the
 * heavy folder scan itself lives in Rust.
 */
export function textReferencesDoc(text: string, docName: string): boolean {
  const want = normalizeWikiTarget(docName);
  if (want.length === 0) return false;
  return extractWikiLinks(text).some(
    (l) => normalizeWikiTarget(l.target) === want
  );
}
