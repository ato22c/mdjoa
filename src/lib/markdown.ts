import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
// @ts-expect-error - no types
import taskLists from "markdown-it-task-lists";
import DOMPurify from "dompurify";
import { convertFileSrc } from "@tauri-apps/api/core";
import katex from "katex";
// KaTeX glyph metrics + layout CSS. Bundled locally (no runtime network) so the
// fonts ship with the app. Imported here because markdown.ts is the single entry
// that produces the math markup; whoever renders that HTML pulls this in.
import "katex/dist/katex.min.css";
import { createHighlighter } from "shiki/bundle/full";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { ShikiTransformer } from "shiki";
import type { HeadingItem } from "../types";
import { parseWikiLinkBody } from "./wikilink";
import { t } from "./i18n";

/**
 * Render a TeX string to HTML via KaTeX. `output: "html"` keeps the markup to
 * `<span>` + `class`/`style`/`aria-hidden` only (no MathML tags), which sails
 * through DOMPurify's default allowlist unchanged. `throwOnError: false` turns a
 * malformed formula into inline red error text instead of throwing, so a bad
 * `$...$` never crashes the render. The output already escapes its content.
 */
function renderKatex(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, {
    throwOnError: false,
    displayMode,
    errorColor: "#cc0000",
    output: "html",
  });
}

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;
let highlighterPromise: Promise<Highlighter> | null = null;

/** Unicode-safe base64 encode (btoa chokes on non-Latin1). */
function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Inverse of encodeBase64. */
export function decodeBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const HL_THEMES = ["github-light", "github-dark"];
const HL_LANGS = [
  "javascript", "typescript", "tsx", "jsx", "html", "css", "scss",
  "json", "yaml", "toml", "markdown", "bash", "sh", "diff", "ini", "dotenv",
  "python", "rust", "go", "java", "kotlin", "swift", "c", "cpp",
  "csharp", "php", "ruby", "sql", "xml", "dockerfile", "r",
  "powershell",
];
// ```env → dotenv, ```ps1/pwsh/posh → powershell
const HL_ALIAS = { env: "dotenv", ps1: "powershell", pwsh: "powershell", posh: "powershell" };

async function buildHighlighter(): Promise<Highlighter> {
  const base = { themes: HL_THEMES, langs: HL_LANGS, langAlias: HL_ALIAS };
  // First choice: the WASM (oniguruma) engine — grammar compilation is fast, so the
  // first highlight of code-heavy documents is much quicker (several times faster
  // than the JS engine). Needs 'wasm-unsafe-eval' in the CSP (tauri.conf.json).
  try {
    const { createOnigurumaEngine } = await import("shiki/engine/oniguruma");
    const engine = await createOnigurumaEngine(import("shiki/wasm"));
    return await createHighlighter({ ...base, engine });
  } catch {
    // WASM failed to load (old webview, CSP, etc.) → fall back to the pure-JS regex
    // engine. Slower but always works, so we avoid "no highlighting at all".
    // `forgiving` skips unsupported grammar.
    return createHighlighter({
      ...base,
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  }
}

export function initHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = buildHighlighter();
  }
  return highlighterPromise;
}

/** Escape HTML special characters (for showing code files as plain text). */
function escapeCodeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Wrap a whole code/text file in code-block markup. It has the same structure as the
 * fence renderer's "pending" path (.code-block + data-lang + pre.code-pending), so
 * highlightPendingCode colors it as-is once it is on screen — reusing the copy
 * button, language label, theme, and WASM/JS fallback. If `lang` is "", it stays
 * plain text (.txt/.log, etc.).
 */
export function renderCodeFileHtml(content: string, lang: string): string {
  const safeLang = escapeCodeHtml(lang);
  const label = lang ? `<span class="code-lang">${safeLang}</span>` : "";
  return (
    `<div class="code-block" data-lang="${safeLang}">${label}` +
    `<button class="code-copy" type="button">${t("common.copy")}</button>` +
    `<pre class="shiki code-pending"><code>${escapeCodeHtml(content)}</code></pre></div>`
  );
}

/**
 * Callout type config: per-type default label i18n key + icon glyph. Colors
 * live in CSS keyed by the `.md-callout-<type>` class. `note`/`caution` serve
 * as the canonical targets for the `info`/`danger` aliases (resolved in the
 * matcher). `labelKey` is resolved via `t()` at render time (not here) so a
 * language switch is picked up without re-importing this module.
 */
const CALLOUT_TYPES: Record<string, { labelKey: string; icon: string }> = {
  note: { labelKey: "markdown.calloutNote", icon: "ℹ️" },
  tip: { labelKey: "markdown.calloutTip", icon: "💡" },
  important: { labelKey: "markdown.calloutImportant", icon: "❗" },
  warning: { labelKey: "markdown.calloutWarning", icon: "⚠️" },
  caution: { labelKey: "markdown.calloutCaution", icon: "🚫" },
};

const CALLOUT_ALIASES: Record<string, string> = {
  info: "note",
  danger: "caution",
};

/**
 * Inspect a blockquote's first `inline` token for a leading `[!TYPE]` marker.
 * Returns the resolved type, its config, an optional title, and how many leading
 * inline children to drop (the marker text + an immediately following
 * softbreak). Returns null when the line isn't a recognized callout marker.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCalloutMarker(inlineTok: any): {
  type: string;
  cfg: { labelKey: string; icon: string };
  title: string;
  consume: number;
} | null {
  const children = inlineTok?.children as any[] | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!children || children.length === 0) return null;
  const first = children[0];
  if (!first || first.type !== "text") return null;

  // The first text node holds the start of the first line: `[!TYPE]` plus any
  // title text up to the line break (markdown-it emits a `softbreak` child at
  // the newline). e.g. "[!warning] 디스크 공간".
  const m = first.content.match(/^\[!([A-Za-z]+)\]\s*(.*)$/);
  if (!m) return null;

  let type = m[1].toLowerCase();
  type = CALLOUT_ALIASES[type] || type;
  const cfg = CALLOUT_TYPES[type];
  if (!cfg) return null;

  // Drop the marker text node; if the next child is the softbreak ending the
  // marker line, drop it too so the body doesn't begin with a blank line.
  let consume = 1;
  if (children[1] && children[1].type === "softbreak") consume = 2;

  return { type, cfg, title: m[2].trim(), consume };
}

/**
 * Pull the plain text out of a hast node tree (Shiki line/span nodes). Used by
 * the diff transformer to inspect the first visible character of a line.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hastText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  if (Array.isArray(node.children)) return node.children.map(hastText).join("");
  return "";
}

/**
 * Append a class to a Shiki hast element. Shiki stores classes in
 * `properties.class` as a space-separated string (not the `className` array hast
 * normally uses), so we append to that string.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addClass(node: any, cls: string): void {
  node.properties = node.properties || {};
  const existing = node.properties.class;
  node.properties.class =
    typeof existing === "string" && existing.length > 0
      ? `${existing} ${cls}`
      : cls;
}

/**
 * Shiki transformer for ```diff fences: tag each `.line` whose first visible
 * character is `+`/`-` with `diff-add`/`diff-remove` so CSS can paint a full-row
 * background. The Shiki diff grammar already colors the text; this only adds the
 * row tint. Applied only when lang === "diff" (see the fence renderer).
 */
const diffTransformer: ShikiTransformer = {
  name: "mdjoa:diff-lines",
  line(node) {
    // Diff lines literally start at column 0 with the marker; use the raw first
    // char (not trimmed) so a leading space (context line) is never tinted.
    const raw = hastText(node)[0];
    if (raw === "+") addClass(node, "diff-add");
    else if (raw === "-") addClass(node, "diff-remove");
    return node;
  },
};

/**
 * Shiki transformer that italicizes comment tokens for ALL languages. Shiki's
 * GitHub themes don't set italic on comments, so we inspect each token's scope
 * explanation (enabled via `includeExplanation: "scopeName"`, which records
 * scope names only — cheaper than full theme-match explanations) and, when any
 * scope contains "comment", add `font-style: italic` to that span.
 */
const commentItalicTransformer: ShikiTransformer = {
  name: "mdjoa:comment-italic",
  span(node, _line, _col, _lineEl, token) {
    const isComment = token.explanation?.some((part) =>
      part.scopes?.some((s) => s.scopeName.includes("comment"))
    );
    // Tag comment spans with a class; CSS applies italic + a green color and
    // overrides Shiki's inline (gray) color with !important. Doing the color in
    // CSS keeps it theme-aware (light/dark) without the transformer knowing the
    // theme, and applies uniformly to full-line AND trailing (end-of-line)
    // comments (both carry the `comment` scope).
    if (isComment) addClass(node, "code-comment");
    return node;
  },
};

// Reuse the markdown-it instance across renders with the same context. Rebuilding
// it (footnote/task-list plugins + ~6 custom core/inline/block rules + renderers)
// on every render — checkbox toggle, external reload, same-folder file switch — is
// pure overhead. The rules close over baseDir/isDark/hl, so that triple is the key.
let mdCache: { baseDir: string | null; isDark: boolean; hl: Highlighter | null; md: MarkdownIt } | null = null;

function buildMd(baseDir: string | null, isDark: boolean, hl: Highlighter | null): MarkdownIt {
  if (mdCache && mdCache.baseDir === baseDir && mdCache.isDark === isDark && mdCache.hl === hl) {
    return mdCache.md;
  }
  const md = new MarkdownIt({
    html: false,
    linkify: false,
    // Single newline → <br>. Dev docs often rely on visual line breaks inside a
    // paragraph/blockquote matching the source (e.g. multi-line callouts, quoted
    // log lines). Hard-wrapping respects the author's line layout. (GFM-like.)
    breaks: true,
    // typographer OFF: dev docs are full of `--flag`, ranges like 1--10, straight
    // quotes in paths/JSON, etc. that should render verbatim. markdown-it can't
    // disable just the dash substitution (it lives with …, (c)→© in one rule),
    // so we turn auto-substitution off entirely. linkify is independent (stays on).
    typographer: false,
  })
    .use(footnote)
    .use(taskLists, { enabled: true });

  // "Pretty replacements" without the surprising ones: convert ellipsis and (c)/(r)/(tm)/+-
  // but NOT dashes (1--10 stays) and NOT quotes (straight quotes stay). Operates
  // only on inline TEXT tokens, so code spans / fences are untouched.
  md.core.ruler.push("pretty_replacements", (state) => {
    for (const blockTok of state.tokens) {
      if (blockTok.type !== "inline" || !blockTok.children) continue;
      for (const tok of blockTok.children) {
        if (tok.type !== "text") continue;
        tok.content = tok.content
          .replace(/\(c\)/gi, "©")
          .replace(/\(r\)/gi, "®")
          .replace(/\(tm\)/gi, "™")
          .replace(/\+-/g, "±")
          .replace(/\.{3,}/g, "…");
      }
    }
  });

  // Tag each top-level block with its source line (0-based, within the body
  // passed to render). Used by the edit-mode split view to scroll-sync the
  // editor and preview so the SAME content lines up. `token.map[0]` is the
  // start line. Harmless elsewhere (a data attribute, no visual effect).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.core.ruler.push("source_line", (state: any) => {
    for (const t of state.tokens) {
      if (t.level === 0 && t.map && t.type.endsWith("_open")) {
        t.attrSet("data-source-line", String(t.map[0]));
      }
    }
  });

  // ── Wikilinks `[[file]]` / `[[file#heading]]` (feature E / #9) ─────────────────
  // An inline rule that recognizes `[[…]]` and emits a `wikilink` token. The
  // renderer below turns it into an `<a>` WITHOUT an `href` (so the webview can
  // never navigate to it) carrying `data-wikilink` (+ optional
  // `data-wikilink-heading`). MarkdownViewer's delegated click handler reads
  // those data attributes, resolves the target in the current folder, and opens
  // it. Parsing of the bracket body is shared with the backlink scan via
  // parseWikiLinkBody (lib/wikilink.ts). Runs INLINE, so it does not fire inside
  // fenced/inline code (markdown-it tokenizes those as `code_*` first), keeping
  // wikilinks inert in code — exactly the desired UX.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.inline.ruler.before("link", "wikilink", (state: any, silent: boolean) => {
    const start = state.pos;
    const src: string = state.src;
    // Fast bail: need `[[` at the cursor.
    if (src.charCodeAt(start) !== 0x5b /* [ */ || src.charCodeAt(start + 1) !== 0x5b) {
      return false;
    }
    const close = src.indexOf("]]", start + 2);
    if (close === -1 || close > state.posMax) return false;
    const body = src.slice(start + 2, close);
    // A nested `[[` inside means this isn't a clean wikilink — let other rules try.
    if (body.includes("[[")) return false;
    const parsed = parseWikiLinkBody(body);
    if (!parsed) return false; // empty/heading-only body → not a wikilink

    if (!silent) {
      const token = state.push("wikilink", "", 0);
      token.meta = { target: parsed.target, heading: parsed.heading };
      // Visible label: the target, plus `#heading` when present (Obsidian-style).
      token.content = parsed.heading
        ? `${parsed.target}#${parsed.heading}`
        : parsed.target;
    }
    state.pos = close + 2;
    return true;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.renderer.rules.wikilink = (tokens: any[], idx: number) => {
    const t = tokens[idx];
    const target: string = t.meta?.target ?? "";
    const heading: string | null = t.meta?.heading ?? null;
    const headingAttr = heading
      ? ` data-wikilink-heading="${escapeHtml(heading)}"`
      : "";
    // No href: this is an in-app navigation handled by the click delegate, never
    // a real link. `role`/`tabindex` keep it keyboard/AT reachable; the class
    // lets CSS style it like a link.
    return (
      `<a class="wikilink" data-wikilink="${escapeHtml(target)}"${headingAttr}` +
      ` role="link" tabindex="0">${escapeHtml(t.content)}</a>`
    );
  };

  // ── Math (KaTeX) ─────────────────────────────────────────────────────────
  // Inline `$...$` / `\(...\)` and block `$$...$$` / `\[...\]`. We use small
  // custom rules + katex.renderToString rather than a plugin to keep the
  // dependency surface minimal (only `katex`). The inline rule is registered
  // AFTER markdown-it's built-in `backticks` rule (it runs near the end of the
  // chain), so a `$` inside a code span / inline code is already locked into a
  // `code_inline` token and is never seen here — math stays inert in code.
  // Likewise fenced/indented code is tokenized as a block before inline rules
  // run, so `$` inside fenced code is untouched.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.inline.ruler.after("emphasis", "math_inline", (state: any, silent: boolean) => {
    const src: string = state.src;
    const start = state.pos;
    const ch = src.charCodeAt(start);

    let open: string;
    let close: string;
    if (ch === 0x24 /* $ */) {
      // A literal `$$` here would be a block; the block rule handles that. A lone
      // `$` opens inline math. Require a non-space right after `$` so plain prices
      // like "$5 and $10" don't accidentally start a formula.
      if (src.charCodeAt(start + 1) === 0x24) return false;
      open = "$";
      close = "$";
    } else if (ch === 0x5c /* \ */ && src.charCodeAt(start + 1) === 0x28 /* ( */) {
      open = "\\(";
      close = "\\)";
    } else {
      return false;
    }

    const contentStart = start + open.length;
    // No content immediately, or a space right after the opener -> not math.
    if (open === "$") {
      const next = src.charCodeAt(contentStart);
      if (next === 0x20 || next === 0x09 || next === 0x0a || Number.isNaN(next)) {
        return false;
      }
    }

    // Find the closing delimiter, skipping escaped delimiters (`\$`, `\)`).
    let pos = contentStart;
    let found = -1;
    while (pos < state.posMax) {
      const idx = src.indexOf(close, pos);
      if (idx === -1) break;
      if (idx + close.length > state.posMax) break;
      if (src.charCodeAt(idx - 1) === 0x5c /* preceding backslash = escaped */) {
        pos = idx + 1;
        continue;
      }
      // For `$`, the char before close must not be a space ("$x $" is not math),
      // matching common CommonMath/pandoc behavior.
      if (close === "$") {
        const prev = src.charCodeAt(idx - 1);
        if (prev === 0x20 || prev === 0x09) {
          pos = idx + 1;
          continue;
        }
      }
      found = idx;
      break;
    }
    if (found === -1 || found === contentStart) return false;

    const tex = src.slice(contentStart, found);
    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.content = tex;
    }
    state.pos = found + close.length;
    return true;
  });

  // Block math: a line beginning with `$$` (or `\[`). Supports both single-line
  // `$$ x $$` and multi-line blocks closing on a later `$$`/`\]`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.block.ruler.before("fence", "math_block", (state: any, startLine: number, endLine: number, silent: boolean) => {
    const startPos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const lineText = state.src.slice(startPos, max);

    let open: string;
    let close: string;
    if (lineText.startsWith("$$")) {
      open = "$$";
      close = "$$";
    } else if (lineText.startsWith("\\[")) {
      open = "\\[";
      close = "\\]";
    } else {
      return false;
    }

    if (silent) return true;

    // Collect lines until the closing delimiter (which may be on the same line).
    const firstLineRest = lineText.slice(open.length);
    let nextLine = startLine;
    const buf: string[] = [];
    let closed = false;

    // Same-line close: `$$ ... $$`
    const sameClose = firstLineRest.lastIndexOf(close);
    if (sameClose >= 0 && firstLineRest.trim().length > 0) {
      // Only treat as same-line if there is actual content before the close.
      const inner = firstLineRest.slice(0, sameClose);
      if (inner.trim().length > 0) {
        buf.push(inner);
        closed = true;
      }
    }

    if (!closed) {
      if (firstLineRest.trim().length > 0) buf.push(firstLineRest);
      nextLine = startLine + 1;
      for (; nextLine < endLine; nextLine++) {
        const ls = state.bMarks[nextLine] + state.tShift[nextLine];
        const le = state.eMarks[nextLine];
        const text = state.src.slice(state.bMarks[nextLine], le);
        const trimmed = state.src.slice(ls, le).trimEnd();
        if (trimmed.endsWith(close)) {
          buf.push(text.slice(0, text.lastIndexOf(close)));
          closed = true;
          break;
        }
        buf.push(text);
      }
    }

    // Unterminated block: don't consume — let other rules handle the line.
    if (!closed) return false;

    state.line = nextLine + 1;
    const token = state.push("math_block", "math", 0);
    token.block = true;
    token.content = buf.join("\n").trim();
    token.map = [startLine, state.line];
    return true;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.renderer.rules.math_inline = (tokens: any[], idx: number) =>
    renderKatex(tokens[idx].content, false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.renderer.rules.math_block = (tokens: any[], idx: number) =>
    `<div class="math-block">${renderKatex(tokens[idx].content, true)}</div>\n`;

  // ── Collapsible <details> sections ───────────────────────────────────────
  // `html: false` (above) escapes all raw HTML so dev-doc placeholders like
  // `<your-api-key>` render as text instead of being swallowed as tags. This
  // carves out ONE narrow exception: `<details>`/`<details open>`, a single-line
  // `<summary>...</summary>`, and `</details>` are recognized only in these exact
  // forms (no other attributes) and passed through literally; markdown between
  // them is parsed normally (same layout GitHub's own <details> markdown expects).
  // Anything that doesn't match this exact shape (typos, extra attributes) falls
  // through to the existing escaped-text behavior — no new attack surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.block.ruler.before("paragraph", "details_html", (state: any, startLine: number, _endLine: number, silent: boolean) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const line = state.src.slice(start, max).trim();

    const openMatch = /^<details(\s+open)?\s*>$/i.exec(line);
    const summaryMatch = /^<summary>([\s\S]*?)<\/summary>$/i.exec(line);
    const closeMatch = /^<\/details\s*>$/i.exec(line);
    if (!openMatch && !summaryMatch && !closeMatch) return false;
    if (silent) return true;

    if (openMatch) {
      const token = state.push("details_open", "details", 0);
      token.content = openMatch[1] ? "<details open>" : "<details>";
      token.block = true;
    } else if (summaryMatch) {
      const token = state.push("details_summary", "summary", 0);
      token.content = summaryMatch[1];
      token.block = true;
    } else {
      const token = state.push("details_close", "details", 0);
      token.content = "</details>";
      token.block = true;
    }

    state.line = startLine + 1;
    return true;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.renderer.rules.details_open = (tokens: any[], idx: number) =>
    tokens[idx].content + "\n";
  md.renderer.rules.details_close = () => "</details>\n";
  md.renderer.rules.details_summary = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tokens: any[],
    idx: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _options: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    env: any
  ) => `<summary>${md.renderInline(tokens[idx].content, env)}</summary>\n`;

  // Wrap tables in a scrollable div so a table wider than the prose column
  // scrolls horizontally on its own instead of squeezing every cell.
  const defaultTableOpen =
    md.renderer.rules.table_open ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((tokens: any[], idx: number, options: any, _env: any, self: any) =>
      self.renderToken(tokens, idx, options));
  const defaultTableClose =
    md.renderer.rules.table_close ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((tokens: any[], idx: number, options: any, _env: any, self: any) =>
      self.renderToken(tokens, idx, options));
  md.renderer.rules.table_open = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tokens: any[],
    idx: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    env: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    self: any
  ) => `<div class="md-table-wrap">${defaultTableOpen(tokens, idx, options, env, self)}`;
  md.renderer.rules.table_close = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tokens: any[],
    idx: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    env: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    self: any
  ) => `${defaultTableClose(tokens, idx, options, env, self)}</div>`;

  // Fenced code: shiki highlight wrapped with language label + copy button
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.renderer.rules.fence = (tokens: any[], idx: number) => {
    const token = tokens[idx];
    const code: string = token.content;
    const lang: string = (token.info || "").trim().split(/\s+/)[0] ?? "";

    // Mermaid: emit a placeholder carrying the source (base64 to survive
    // sanitization). MarkdownViewer renders it client-side and falls back to a
    // code block on error, so a bad diagram never crashes the app.
    if (lang === "mermaid") {
      const encoded = encodeBase64(code);
      return `<div class="mermaid-block" data-mermaid="${encoded}"></div>\n`;
    }

    let inner: string;
    try {
      // Comment-italic needs token scope info; the diff row-tint transformer is
      // added ONLY for ```diff so other languages don't pay for line scanning.
      const transformers: ShikiTransformer[] = [commentItalicTransformer];
      if (lang === "diff") transformers.push(diffTransformer);
      inner =
        hl && lang
          ? hl.codeToHtml(code, {
              lang,
              theme: isDark ? "github-dark" : "github-light",
              // "scopeName" records only scope names (no per-theme match data),
              // so commentItalicTransformer can detect comment tokens with much
              // less output bloat than full `true` explanations.
              includeExplanation: "scopeName",
              transformers,
            })
          : // `highlight: false` render (fast first paint): escaped code only, no coloring.
            // Tagging it `code-pending` lets highlightPendingCode color and replace it in
            // the DOM once it is on screen.
            `<pre class="shiki code-pending"><code>${md.utils.escapeHtml(code)}</code></pre>`;
    } catch {
      inner = `<pre class="shiki code-pending"><code>${md.utils.escapeHtml(code)}</code></pre>`;
    }

    const label = lang
      ? `<span class="code-lang">${md.utils.escapeHtml(lang)}</span>`
      : "";
    // data-lang: preserved (ADD_ATTR) so highlightPendingCode knows which language to color with.
    return `<div class="code-block" data-lang="${md.utils.escapeHtml(lang)}">${label}<button class="code-copy" type="button">${t("common.copy")}</button>${inner}</div>\n`;
  };

  // ── Obsidian/GitHub-style callouts ───────────────────────────────────────
  // A blockquote whose very first inline line is `[!TYPE]` (optionally followed
  // by a title) is rendered as a styled callout box instead of a <blockquote>.
  // We detect this in a renderer override of `blockquote_open`: we peek at the
  // following paragraph's `inline` token, and if its first child text matches
  // the marker we (1) strip the marker line from the inline content, (2) emit
  // the callout opening HTML, and (3) flag the matching `blockquote_close` to
  // emit the callout closing HTML. Non-callout blockquotes are untouched.
  const defaultBlockquoteOpen =
    md.renderer.rules.blockquote_open ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((tokens: any[], idx: number, options: any, _env: any, self: any) =>
      self.renderToken(tokens, idx, options));
  const defaultBlockquoteClose =
    md.renderer.rules.blockquote_close ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((tokens: any[], idx: number, options: any, _env: any, self: any) =>
      self.renderToken(tokens, idx, options));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.renderer.rules.blockquote_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    // Find the first child paragraph's inline token within this blockquote.
    let depth = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let inlineTok: any = null;
    for (let i = idx + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === "blockquote_open") depth++;
      else if (t.type === "blockquote_close") {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && t.type === "inline") {
        inlineTok = t;
        break;
      } else if (depth === 0 && t.type !== "paragraph_open") {
        // First block-level child isn't a paragraph -> not a callout.
        break;
      }
    }

    const parsed = inlineTok ? parseCalloutMarker(inlineTok) : null;
    if (!parsed) return defaultBlockquoteOpen(tokens, idx, options, env, self);

    // Strip the marker (and the following softbreak) from the inline children
    // so the body renders without the `[!TYPE] title` line.
    const children = inlineTok.children as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    children.splice(0, parsed.consume);

    // Mark the matching blockquote_close so its renderer emits </div></div>.
    let d = 0;
    for (let i = idx + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === "blockquote_open") d++;
      else if (t.type === "blockquote_close") {
        if (d === 0) {
          t.meta = { ...(t.meta || {}), callout: true };
          break;
        }
        d--;
      }
    }

    const cfg = parsed.cfg;
    const title = parsed.title || t(cfg.labelKey);
    return (
      `<div class="md-callout md-callout-${parsed.type}">` +
      `<div class="md-callout-title">` +
      `<span class="md-callout-icon" aria-hidden="true">${cfg.icon}</span>` +
      `<span class="md-callout-label">${escapeHtml(title)}</span>` +
      `</div>` +
      `<div class="md-callout-body">`
    );
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.renderer.rules.blockquote_close = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    if (tokens[idx].meta?.callout) return `</div></div>\n`;
    return defaultBlockquoteClose(tokens, idx, options, env, self);
  };

  // Rewrite relative image src to Tauri asset protocol
  const defaultImageRenderer = md.renderer.rules.image!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.renderer.rules.image = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    // Decode off the main thread so image-heavy docs open without a stall.
    // (No loading=lazy: unloaded images have 0 height, which breaks scroll restore.)
    token.attrSet("decoding", "async");
    const srcIdx = token.attrIndex("src");
    if (srcIdx >= 0 && baseDir) {
      const src = token.attrs[srcIdx][1] as string;
      if (!src.startsWith("http") && !src.startsWith("data:") && !src.startsWith("blob:")) {
        const abs = `${baseDir}/${src}`.replace(/\/+/g, "/");
        // convertFileSrc builds the platform-correct asset URL (asset://localhost
        // on macOS/Linux, https://asset.localhost on Windows) with proper
        // encoding. The manual URL only worked on Windows and bypassed encoding.
        // Guard: convertFileSrc needs Tauri internals (absent in non-app/test
        // contexts) — on failure leave the original src rather than break render.
        try {
          token.attrs[srcIdx][1] = convertFileSrc(abs);
        } catch {
          /* not in a Tauri webview — leave src as-is */
        }
      }
    }
    return defaultImageRenderer(tokens, idx, options, env, self);
  };

  // ── External link affordance ─────────────────────────────────────────────
  // Tag links that point OUTSIDE the document (http(s):// or mailto:) so the
  // CSS can append a small ↗ glyph and screen readers announce "외부 링크".
  // Excluded automatically: wikilinks (rendered via the `wikilink` renderer,
  // never `link_open`, and carry no href), internal `.md` links, in-doc anchors
  // (`#...`, footnotes included), and any relative/non-external href. We keep
  // and call the default `link_open` renderer so nothing else changes.
  const defaultLinkOpen =
    md.renderer.rules.link_open ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((tokens: any[], idx: number, options: any, _env: any, self: any) =>
      self.renderToken(tokens, idx, options));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.renderer.rules.link_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    const hrefIdx = token.attrIndex("href");
    if (hrefIdx >= 0) {
      const href = String(token.attrs[hrefIdx][1] ?? "").trim();
      // External = absolute web link or mailto. Matched case-insensitively on a
      // leading scheme so `#anchor`, `./other.md`, `../x`, `foo.md` all fall
      // through untouched. A bare `http`/`mailto` substring later in the string
      // can't match because the test is anchored to the start.
      if (/^(?:https?:\/\/|mailto:)/i.test(href)) {
        // Merge with any existing class rather than clobbering it.
        const classIdx = token.attrIndex("class");
        if (classIdx >= 0) {
          const existing = String(token.attrs[classIdx][1] ?? "");
          token.attrs[classIdx][1] = existing
            ? `${existing} md-external-link`
            : "md-external-link";
        } else {
          token.attrPush(["class", "md-external-link"]);
        }
        // noopener/noreferrer: external nav must not get a window.opener handle.
        if (token.attrIndex("rel") < 0) {
          token.attrPush(["rel", "noopener noreferrer"]);
        }
        // title (not aria-label): the link already has visible text, so a title
        // gives AT users the "외부 링크" hint without overriding the accessible
        // name. The ::after ↗ is decorative-only (CSS, no DOM/AT text).
        if (token.attrIndex("title") < 0) {
          token.attrPush(["title", t("markdown.externalLinkTitle")]);
        }
      }
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  mdCache = { baseDir, isDark, hl, md };
  return md;
}

/** HTML-escape text for safe insertion into markup. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Decode HTML entities (e.g. `&amp;` → `&`) for plain-text use like the outline. */
function decodeEntities(str: string): string {
  if (typeof document === "undefined") {
    return str
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  const el = document.createElement("textarea");
  el.innerHTML = str;
  return el.value;
}

/**
 * Detect leading YAML frontmatter and build a metadata card.
 * Only matches when content STARTS with a `---` line, has body lines, then a
 * closing `---` line. Returns the card HTML (already escaped/safe) and the
 * remaining body with the frontmatter block stripped.
 */
function extractFrontmatter(content: string): { card: string; body: string } {
  // Support both Unix (\n) and Windows (\r\n) line endings.
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { card: "", body: content };

  const block = match[1];
  const body = content.slice(match[0].length);

  // Minimal flat `key: value` parser. Lines that don't match are skipped
  // gracefully (nested/complex YAML, list items, blank lines, comments).
  const rows: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_.\- ]+?):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    let value = kv[2].trim();
    // Strip surrounding matching quotes.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    rows.push(
      `<div class="md-fm-key">${escapeHtml(key)}</div>` +
        `<div class="md-fm-val">${escapeHtml(value)}</div>`
    );
  }

  if (rows.length === 0) return { card: "", body };

  const card = `<div class="md-frontmatter">${rows.join("")}</div>`;
  return { card, body };
}

export async function renderMarkdown(
  content: string,
  baseDir: string | null,
  isDark: boolean,
  opts?: { highlight?: boolean }
): Promise<{ html: string; headings: HeadingItem[] }> {
  // `highlight: false` skips Shiki entirely (code falls back to escaped <pre>).
  // Used for a fast first paint (two-stage render): show the document immediately, then
  // re-render with highlighting. Avoids the synchronous Shiki cost blocking the
  // first paint on code-heavy documents (e.g. render-test.md).
  let hl: Highlighter | null = null;
  if (opts?.highlight !== false) {
    try {
      hl = await initHighlighter();
    } catch {
      // Continue without syntax highlighting
    }
  }

  // Strip leading YAML frontmatter before markdown-it so it isn't rendered as
  // an <hr>/heading. The card is built from escaped text and prepended after
  // sanitization of the body.
  const { card, body } = extractFrontmatter(content);

  const md = buildMd(baseDir, isDark, hl);
  const raw = md.render(body);

  // Assign IDs to headings and collect outline. The visible text is
  // entity-DECODED (so the outline shows "&" not "&amp;"), and the id is a SAFE
  // slug (alphanumeric/Korean/hyphen only). Both matter: a raw `&`/`<` in the id
  // attribute gets re-decoded by the browser on parse, so the stored id would no
  // longer equal the DOM element's id and getElementById (outline click,
  // scroll-spy) would silently fail.
  const headings: HeadingItem[] = [];
  const withIds = raw.replace(
    /<(h[1-6])([^>]*)>([\s\S]*?)<\/\1>/gi,
    (_full: string, tag: string, attrs: string, inner: string) => {
      const level = parseInt(tag[1]);
      const text = decodeEntities(inner.replace(/<[^>]+>/g, "")).trim();
      const slug = text
        .slice(0, 24)
        .toLowerCase()
        .replace(/[^a-z0-9가-힣]+/gi, "-")
        .replace(/^-+|-+$/g, "");
      const id = `h-${headings.length}-${slug}`;
      headings.push({ id, text, level });
      return `<${tag}${attrs} id="${id}">${inner}</${tag}>`;
    }
  );

  const sanitized = DOMPurify.sanitize(withIds, {
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
    ALLOW_DATA_ATTR: false,
    // Allow Tauri's asset scheme for local images. macOS/Linux convertFileSrc
    // returns `asset://localhost/...`, which DOMPurify's default URI filter
    // strips (leaving an <img> with no src). Windows uses https://asset.localhost
    // (already allowed). This adds `asset:` to the default-safe scheme set.
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|asset):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    ADD_ATTR: [
      "id",
      "checked",
      "disabled",
      "data-mermaid",
      "data-source-line",
      "data-lang",
      // Wikilink (#9): the click delegate reads these; ALLOW_DATA_ATTR is false
      // so each must be listed explicitly or DOMPurify strips it. `role`/
      // `tabindex` keep the hrefless <a> reachable.
      "data-wikilink",
      "data-wikilink-heading",
      "role",
      "tabindex",
    ],
  });

  // Prepend the frontmatter card to the sanitized body. The card is built
  // entirely from HTML-escaped key/value text (no user HTML), so it is safe to
  // concatenate after sanitization and preserves its class attributes.
  return { html: card + sanitized, headings };
}

/**
 * Syntax-highlight code blocks that a `highlight: false` render left plain
 * (`pre.code-pending`), IN PLACE in the DOM — no full re-render. This lets the
 * viewer paint instantly with plain code, then colorize without re-running
 * markdown-it / KaTeX / Mermaid (which a second renderMarkdown pass would).
 * Safe: Shiki output is sanitized before injection; unknown/unloaded languages
 * just stay plain.
 */
/** Safe HTML string built from Shiki output and sanitized with DOMPurify. Core logic shared by
 * highlightPendingCode (one-shot DOM replacement) and highlightCodeToHtml (pure function,
 * called repeatedly in real time). */
function codeToSafeHtml(hl: Highlighter, code: string, lang: string, theme: string): string {
  const transformers: ShikiTransformer[] = [commentItalicTransformer];
  if (lang === "diff") transformers.push(diffTransformer);
  const out = hl.codeToHtml(code, { lang, theme, includeExplanation: "scopeName", transformers });
  return DOMPurify.sanitize(out, {
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
  });
}

export async function highlightPendingCode(root: HTMLElement, isDark: boolean): Promise<void> {
  const pending = Array.from(root.querySelectorAll<HTMLPreElement>("pre.code-pending"));
  if (pending.length === 0) return;
  let hl: Highlighter;
  try {
    hl = await initHighlighter();
  } catch {
    pending.forEach((p) => p.classList.remove("code-pending"));
    return;
  }
  const theme = isDark ? "github-dark" : "github-light";
  for (const pre of pending) {
    // Stop if a new render removed this block from the DOM (e.g. file switch) — avoids wasted work.
    if (!pre.isConnected) return;
    pre.classList.remove("code-pending"); // consume once regardless of outcome
    const block = pre.closest(".code-block");
    const lang = (block?.getAttribute("data-lang") ?? "").trim();
    const code = pre.querySelector("code")?.textContent ?? "";
    if (lang) {
      try {
        const safe = codeToSafeHtml(hl, code, lang, theme);
        const tmp = document.createElement("div");
        tmp.innerHTML = safe;
        const next = tmp.firstElementChild;
        if (next) pre.replaceWith(next);
      } catch {
        /* unknown/unloaded language → leave the plain <pre> as-is */
      }
    }
    // Yield one frame per block: even with lots of code, the UI doesn't freeze —
    // blocks get colored one at a time so scrolling and input stay responsive
    // (better perceived speed). Without rAF (e.g. tests), proceed immediately.
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
      else resolve();
    });
  }
}

/**
 * Pure function (no DOM manipulation) that turns one code string into safe HTML colored by Shiki.
 * The editor's live highlight backdrop (Editor.tsx, source-file edit mode) calls it on each
 * input (debounced). Returns null if the language is missing/unsupported or the highlighter
 * fails to load — the caller falls back to plain text.
 */
export async function highlightCodeToHtml(code: string, lang: string, isDark: boolean): Promise<string | null> {
  if (!lang) return null;
  let hl: Highlighter;
  try {
    hl = await initHighlighter();
  } catch {
    return null;
  }
  try {
    return codeToSafeHtml(hl, code, lang, isDark ? "github-dark" : "github-light");
  } catch {
    return null;
  }
}
