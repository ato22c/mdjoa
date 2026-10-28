// Automatic document language detection — decides the ko↔en translation direction.
// After stripping code blocks/inline code, compares the number of Hangul syllables
// (가-힣) against Latin letters (so English inside code doesn't make a Korean
// document look English). Pure function — unit-tested (CLAUDE.md).

export type Lang = "ko" | "en";

// Replace non-prose regions excluded from language detection with spaces. Besides
// code, wikilink targets and link URLs (mostly English file names/addresses) must be
// removed so a Korean document full of links like [[link-test-a]] isn't misdetected
// as English. A link's display text ([text]) is prose, so it stays.
function stripNonProse(md: string): string {
  return (md ?? "")
    .replace(/```[\s\S]*?```/g, " ")             // fenced code block
    .replace(/`[^`]*`/g, " ")                     // inline code
    .replace(/!?\[\[[^\]]*\]\]/g, " ")            // [[wikilink]] target (= file name)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, " $1 ")  // [text](url) → keep only the text
    .replace(/\bhttps?:\/\/\S+/gi, " ")           // bare URL
    .replace(/<[^>]+>/g, " ");                    // HTML tag
}

/** The document's main language: "ko" if Hangul outnumbers Latin letters, otherwise "en" (default). */
export function detectLang(text: string): Lang {
  const t = stripNonProse(text ?? "");
  const hangul = (t.match(/[가-힣]/g) ?? []).length;
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  return hangul > latin ? "ko" : "en";
}

/** The opposite of the detected language = the translation target language. */
export function translationTarget(text: string): Lang {
  return detectLang(text) === "ko" ? "en" : "ko";
}

/** Display name of the language. */
export function langLabel(l: Lang): string {
  return l === "ko" ? "한국어" : "English";
}

// Split a long document into chunks for translation. claude takes the body as a
// -p command-line argument and Windows has a command-line length limit (~32K chars),
// so split into pieces of at most maxChars. Cut only at blank lines (paragraph
// boundaries) and never inside a code fence (```), so code blocks aren't broken up.
export function splitMarkdownForTranslation(content: string, maxChars = 20000): string[] {
  if (content.length <= maxChars) return [content];

  // 1) Break into paragraph (block) units while preserving code fences.
  const lines = content.split("\n");
  const blocks: string[] = [];
  let buf: string[] = [];
  let inCode = false;
  const flush = () => {
    if (buf.length) {
      blocks.push(buf.join("\n"));
      buf = [];
    }
  };
  for (const line of lines) {
    const isFence = /^\s*```/.test(line);
    if (isFence) inCode = !inCode;
    buf.push(line);
    if (!inCode && !isFence && line.trim() === "") flush(); // blank line outside code = block boundary
  }
  flush();

  // 2) Group blocks into chunks of at most maxChars (a block that alone exceeds the limit becomes its own chunk).
  const chunks: string[] = [];
  let cur = "";
  for (const b of blocks) {
    if (cur && cur.length + b.length + 1 > maxChars) {
      chunks.push(cur);
      cur = "";
    }
    cur = cur ? cur + "\n" + b : b;
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [content];
}
