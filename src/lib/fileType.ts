// File type detection — single source of truth for the markdown vs code/text viewer
// split, open-dialog filters, and tree visibility.
// Pure functions, so they are unit-testable without files or the Tauri runtime
// (CLAUDE.md: test core logic).

import { MARKDOWN_EXT_RE } from "./mdPath";
import { t } from "./i18n";

/**
 * Extension (no dot, lowercase) → Shiki language. Maps only within markdown.ts's
 * HL_LANGS/HL_ALIAS (giving the highlighter an unknown language makes highlighting
 * fail entirely). Text extensions not listed here are treated as plain text.
 */
const LANG_BY_EXT: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", mts: "typescript", cts: "typescript",
  tsx: "tsx", jsx: "jsx",
  html: "html", htm: "html",
  css: "css", scss: "scss",
  json: "json", jsonc: "json",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  sh: "bash", bash: "bash", zsh: "bash",
  diff: "diff", patch: "diff",
  ini: "ini", cfg: "ini", conf: "ini",
  env: "dotenv",
  py: "python", pyw: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin", kts: "kotlin",
  swift: "swift",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  sql: "sql",
  xml: "xml", svg: "xml",
  r: "r",
  ps1: "powershell", psm1: "powershell",
};

/** Text extensions with no highlight language that can still be viewed as plain text. */
const PLAIN_TEXT_EXT = new Set([
  "txt", "text", "log", "csv", "tsv", "tab",
  "gitignore", "gitattributes", "editorconfig", "npmrc",
  "properties", "gradle", "lock", "map", "list",
]);

/** Well-known file names (lowercase) treated as text even without an extension. */
const PLAIN_TEXT_NAMES = new Set([
  "dockerfile", "makefile", "license", "readme", "authors", "changelog", "notice",
]);

/** File name only, from a path (handles both POSIX `/` and Windows `\`). */
function nameOf(path: string): string {
  return path.replace(/^.*[\\/]/, "").toLowerCase();
}

/** Extension (no dot, lowercase). A dotfile with only a leading dot, like `.gitignore`, uses its whole name as the extension. */
function extOf(path: string): string {
  const base = nameOf(path);
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  if (dot === 0) return base.slice(1); // .gitignore → "gitignore"
  return base.slice(dot + 1);
}

/** Is this a Markdown file (.md/.markdown)? */
export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXT_RE.test(path);
}

/** Is this a PDF file? It is only viewed through the webview's native renderer (never read as text). */
export function isPdfPath(path: string): boolean {
  return extOf(path) === "pdf";
}

/** Is this an HTML file (.html/.htm)? Shown as the rendered page, not as source. */
export function isHtmlPath(path: string): boolean {
  const ext = extOf(path);
  return ext === "html" || ext === "htm";
}

/** Is this a file (PDF/HTML) that is "shown" in a webview iframe rather than as text?
 *  openFile does not read such files with read_file; it passes only the path and FrameViewer renders it. */
export function opensInFrame(path: string): boolean {
  return isPdfPath(path) || isHtmlPath(path);
}

/** Is this a (non-Markdown) file the code/text viewer can display? */
export function isTextLikePath(path: string): boolean {
  const ext = extOf(path);
  if (ext && (ext in LANG_BY_EXT || PLAIN_TEXT_EXT.has(ext))) return true;
  return PLAIN_TEXT_NAMES.has(nameOf(path));
}

/** Shiki language for highlighting a code file. "" if unmapped (shown as plain text). */
export function langFromPath(path: string): string {
  if (nameOf(path) === "dockerfile") return "dockerfile";
  return LANG_BY_EXT[extOf(path)] ?? "";
}

/**
 * Filters for the open dialog (Markdown/HTML first → text/code → all files).
 * It is a function because the store↔i18n circular import means t() can't be called
 * at module evaluation time (same pattern as buildMenuLabels in menuLabels.ts) —
 * evaluating at call time (when the dialog opens) is safe and also reflects the
 * current language accurately.
 */
export function buildOpenDialogFilters() {
  return [
    { name: t("fileType.markdownHtmlFilter"), extensions: ["md", "markdown", "html", "htm"] },
    {
      name: t("fileType.textCodeFilter"),
      extensions: Array.from(
        new Set<string>(["md", "markdown", "html", "htm", ...Object.keys(LANG_BY_EXT), ...PLAIN_TEXT_EXT])
      ),
    },
    { name: "PDF", extensions: ["pdf"] },
    { name: t("fileType.allFilesFilter"), extensions: ["*"] },
  ];
}
