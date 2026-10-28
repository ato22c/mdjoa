import { describe, it, expect } from "vitest";
import { isWatchableMarkdownPath, isWatchablePrimaryPath, isClaudeAssetPath } from "./mdPath";

// These decide which changed files get a "변경됨" badge in the file tree.
describe("isWatchableMarkdownPath", () => {
  it("accepts .md and .markdown files", () => {
    expect(isWatchableMarkdownPath("/docs/notes.md")).toBe(true);
    expect(isWatchableMarkdownPath("/docs/readme.markdown")).toBe(true);
  });

  it("is case-insensitive on the extension", () => {
    expect(isWatchableMarkdownPath("/A/B/README.MD")).toBe(true);
    expect(isWatchableMarkdownPath("/A/B/Notes.Markdown")).toBe(true);
  });

  it("rejects non-markdown extensions", () => {
    expect(isWatchableMarkdownPath("/docs/notes.txt")).toBe(false);
    expect(isWatchableMarkdownPath("/docs/image.png")).toBe(false);
    expect(isWatchableMarkdownPath("/docs/notes.md.bak")).toBe(false);
    expect(isWatchableMarkdownPath("/docs/noext")).toBe(false);
  });

  it("accepts markdown nested in subfolders", () => {
    expect(isWatchableMarkdownPath("/a/b/c/d/deep.md")).toBe(true);
  });

  it("rejects markdown under a dot-directory", () => {
    expect(isWatchableMarkdownPath("/proj/.git/COMMIT_EDITMSG.md")).toBe(false);
    expect(isWatchableMarkdownPath("/proj/.obsidian/cache.md")).toBe(false);
  });

  it("rejects dotfiles themselves", () => {
    expect(isWatchableMarkdownPath("/proj/.hidden.md")).toBe(false);
  });

  it("rejects markdown under node_modules", () => {
    expect(isWatchableMarkdownPath("/proj/node_modules/pkg/README.md")).toBe(false);
  });

  it("handles Windows-style backslash separators", () => {
    expect(isWatchableMarkdownPath("C:\\proj\\docs\\notes.md")).toBe(true);
    expect(isWatchableMarkdownPath("C:\\proj\\node_modules\\p\\readme.md")).toBe(false);
    expect(isWatchableMarkdownPath("C:\\proj\\.git\\x.md")).toBe(false);
  });

  it("does not treat a dot inside a filename as a dot-segment", () => {
    expect(isWatchableMarkdownPath("/proj/my.notes.md")).toBe(true);
    expect(isWatchableMarkdownPath("/proj/v1.2/release.md")).toBe(true);
  });
});

describe("isWatchablePrimaryPath", () => {
  it("accepts .md and .html files", () => {
    expect(isWatchablePrimaryPath("/docs/notes.md")).toBe(true);
    expect(isWatchablePrimaryPath("/docs/page.html")).toBe(true);
    expect(isWatchablePrimaryPath("/docs/page.htm")).toBe(true);
  });

  it("rejects non-primary extensions", () => {
    expect(isWatchablePrimaryPath("/docs/notes.txt")).toBe(false);
    expect(isWatchablePrimaryPath("/docs/image.png")).toBe(false);
  });

  it("rejects html under ignored paths", () => {
    expect(isWatchablePrimaryPath("/proj/.git/index.html")).toBe(false);
    expect(isWatchablePrimaryPath("/proj/node_modules/pkg/index.html")).toBe(false);
  });

  it("handles Windows paths", () => {
    expect(isWatchablePrimaryPath("C:\\proj\\docs\\index.html")).toBe(true);
    expect(isWatchablePrimaryPath("C:\\proj\\.git\\index.html")).toBe(false);
  });
});

describe("isClaudeAssetPath", () => {
  it("matches skills/agents/commands .md under .claude (POSIX & Windows)", () => {
    expect(isClaudeAssetPath("/proj/.claude/skills/ui-ux/SKILL.md")).toBe(true);
    expect(isClaudeAssetPath("/proj/.claude/agents/planner.md")).toBe(true);
    expect(isClaudeAssetPath("C:\\proj\\.claude\\commands\\deploy.md")).toBe(true);
  });
  it("rejects non-asset paths", () => {
    expect(isClaudeAssetPath("/proj/.claude/settings.local.json")).toBe(false);
    expect(isClaudeAssetPath("/proj/.claude/skills/ui-ux/notes.txt")).toBe(false);
    expect(isClaudeAssetPath("/proj/docs/README.md")).toBe(false);
    expect(isClaudeAssetPath("/proj/.git/skills/x.md")).toBe(false);
  });
});
