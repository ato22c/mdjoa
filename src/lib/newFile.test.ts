import { describe, it, expect } from "vitest";
import { withMdExtension, parentDir, joinPath, uniqueFileName } from "./newFile";

describe("withMdExtension", () => {
  it("appends .md when missing", () => {
    expect(withMdExtension("notes")).toBe("notes.md");
  });
  it("keeps existing .md / .markdown (case-insensitive)", () => {
    expect(withMdExtension("a.md")).toBe("a.md");
    expect(withMdExtension("a.MD")).toBe("a.MD");
    expect(withMdExtension("a.markdown")).toBe("a.markdown");
  });
  it("appends .md to other extensions", () => {
    expect(withMdExtension("a.txt")).toBe("a.txt.md");
  });
});

describe("parentDir", () => {
  it("strips the last segment (posix)", () => {
    expect(parentDir("/a/b/c.md")).toBe("/a/b");
  });
  it("strips the last segment (windows)", () => {
    expect(parentDir("C:\\Users\\x\\c.md")).toBe("C:\\Users\\x");
  });
  it("returns '' when there is no parent", () => {
    expect(parentDir("c.md")).toBe("");
  });
});

describe("joinPath", () => {
  it("joins posix paths", () => {
    expect(joinPath("/a/b", "c.md")).toBe("/a/b/c.md");
  });
  it("joins windows paths with backslash", () => {
    expect(joinPath("C:\\a\\b", "c.md")).toBe("C:\\a\\b\\c.md");
  });
  it("does not double the separator when dir ends with one", () => {
    expect(joinPath("/a/b/", "c.md")).toBe("/a/b/c.md");
    expect(joinPath("C:\\a\\", "c.md")).toBe("C:\\a\\c.md");
  });
});

describe("uniqueFileName", () => {
  const ext = ".md";
  it("returns base name when free", () => {
    expect(uniqueFileName("새 문서", ext, () => false)).toBe("새 문서.md");
  });
  it("suffixes the next free number when base is taken", () => {
    const taken = new Set(["새 문서.md"]);
    expect(uniqueFileName("새 문서", ext, (n) => taken.has(n))).toBe("새 문서 2.md");
  });
  it("skips multiple taken names", () => {
    const taken = new Set(["새 문서.md", "새 문서 2.md", "새 문서 3.md"]);
    expect(uniqueFileName("새 문서", ext, (n) => taken.has(n))).toBe("새 문서 4.md");
  });
});
