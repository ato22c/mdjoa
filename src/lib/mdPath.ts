// Pure path predicates for the folder watcher / change-badge feature.
// Extracted from useFolderWatch so the filtering logic can be unit-tested
// without the React/Tauri runtime.

/** Matches a Markdown file by extension (.md / .markdown), case-insensitive. */
export const MARKDOWN_EXT_RE = /\.(md|markdown)$/i;

/** Matches the primary viewable file types (Markdown + HTML) that get full watcher treatment. */
export const PRIMARY_EXT_RE = /\.(md|markdown|html|htm)$/i;

/**
 * Matches noisy/irrelevant locations we never badge: any path segment that is a
 * dotfile/dotdir (e.g. `.git`, `.obsidian`) or `node_modules`. Works for both
 * POSIX (`/`) and Windows (`\`) separators.
 */
export const IGNORED_PATH_RE = /(^|[\\/])(\.[^\\/]+|node_modules)([\\/]|$)/;

/**
 * True when a changed path should surface a "변경됨" badge: it is a Markdown
 * file AND does not live under an ignored (dot / node_modules) segment.
 */
export function isWatchableMarkdownPath(path: string): boolean {
  return MARKDOWN_EXT_RE.test(path) && !IGNORED_PATH_RE.test(path);
}

/**
 * True for any primary viewable file (Markdown OR HTML) outside ignored paths.
 * The folder watcher uses this so .html files get the same badge/refresh treatment as .md.
 */
export function isWatchablePrimaryPath(path: string): boolean {
  return PRIMARY_EXT_RE.test(path) && !IGNORED_PATH_RE.test(path);
}

/**
 * Matches a Markdown asset under a project's `.claude/` directory — a skill,
 * subagent, or slash command. The folder watcher uses this to re-scan the skills
 * section on change WITHOUT surfacing a tree badge: these live under a dot-dir,
 * which `isWatchableMarkdownPath` deliberately ignores. Works for both POSIX
 * (`/`) and Windows (`\`) separators.
 */
export const CLAUDE_ASSET_RE =
  /(^|[\\/])\.claude[\\/](skills|agents|commands)[\\/].+\.md$/i;
export function isClaudeAssetPath(path: string): boolean {
  return CLAUDE_ASSET_RE.test(path);
}
