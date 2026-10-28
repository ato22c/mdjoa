// Pure logic for "Copy context as prompt" (killer feature #2).
//
// Merges the selected context documents into one model-friendly prompt text.
// Only pure functions, separated from IO (read_file/clipboard), so unit tests are easy.

/** One file to merge into the prompt. name prefers the file name (or relative path). */
export interface PromptFile {
  /** Name shown in the file-boundary header (file name or folder-relative path). */
  name: string;
  /** File body. */
  content: string;
}

/**
 * Merge several documents into one prompt string, separated by file-boundary headers.
 *
 * Format of each block (readable and model-friendly):
 *   ===== <name> =====
 *   <content>
 *
 * One blank line between files. Returns "" for an empty list.
 * content is inserted untouched (nothing gets mangled); only duplicate trailing newlines are trimmed.
 */
export function buildContextPrompt(files: PromptFile[]): string {
  const blocks = files.map((f) => {
    const header = `===== ${f.name} =====`;
    // Strip trailing newlines from content so the gap between blocks stays constant (one blank line).
    const body = f.content.replace(/\n+$/, "");
    // Empty content → header only, so no blank line trails the header.
    return body ? `${header}\n${body}` : header;
  });
  return blocks.join("\n\n");
}
