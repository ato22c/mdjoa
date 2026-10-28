import { describe, it, expect } from "vitest";
import { eventMentionsFile } from "./fileWatch";

describe("eventMentionsFile", () => {
  const file = "/Users/me/docs/note.md";

  it("matches an exact path", () => {
    expect(eventMentionsFile([file], file)).toBe(true);
  });
  it("matches by basename within the watched dir", () => {
    expect(eventMentionsFile(["/Users/me/docs/note.md"], file)).toBe(true);
  });
  it("matches when macOS reports a realpath suffix", () => {
    expect(eventMentionsFile(["/private/var/folders/x/note.md"], "/var/folders/x/note.md")).toBe(true);
  });
  it("ignores unrelated sibling files", () => {
    expect(eventMentionsFile(["/Users/me/docs/other.md"], file)).toBe(false);
  });
  it("does not match a different file ending similarly", () => {
    expect(eventMentionsFile(["/Users/me/docs/anote.md"], file)).toBe(false);
  });
  it("handles windows separators", () => {
    const win = "C:\\Users\\me\\docs\\note.md";
    expect(eventMentionsFile(["C:\\Users\\me\\docs\\note.md"], win)).toBe(true);
    expect(eventMentionsFile(["C:\\Users\\me\\docs\\other.md"], win)).toBe(false);
  });
  it("is false for empty inputs", () => {
    expect(eventMentionsFile([], file)).toBe(false);
    expect(eventMentionsFile([file], "")).toBe(false);
  });
});
