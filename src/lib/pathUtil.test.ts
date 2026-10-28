import { describe, it, expect } from "vitest";
import {
  baseName,
  pathSegments,
  parentSegments,
  parentDir,
  joinPath,
  isPathAtOrUnder,
  remapUnderRename,
} from "./pathUtil";

describe("pathUtil — cross-platform path segments", () => {
  it("baseName: POSIX paths", () => {
    expect(baseName("/Users/me/notes/a.md")).toBe("a.md");
    expect(baseName("/Users/me/notes/")).toBe("notes"); // trailing slash
  });

  it("baseName: Windows backslash paths", () => {
    expect(baseName("C:\\Users\\me\\notes\\a.md")).toBe("a.md");
    expect(baseName("C:\\Users\\me\\notes\\")).toBe("notes");
  });

  it("baseName: mixed separators (UNC / normalized)", () => {
    expect(baseName("C:/Users/me\\a.md")).toBe("a.md");
  });

  it("baseName: bare name / empty", () => {
    expect(baseName("a.md")).toBe("a.md");
    expect(baseName("")).toBe("");
  });

  it("pathSegments: both separators, drops empties", () => {
    expect(pathSegments("/a/b/c")).toEqual(["a", "b", "c"]);
    expect(pathSegments("C:\\a\\b\\c")).toEqual(["C:", "a", "b", "c"]);
    expect(pathSegments("a//b")).toEqual(["a", "b"]);
  });

  it("parentSegments: everything except the basename", () => {
    expect(parentSegments("/a/b/c.md")).toEqual(["a", "b"]);
    expect(parentSegments("C:\\a\\b\\c.md")).toEqual(["C:", "a", "b"]);
    expect(parentSegments("c.md")).toEqual([]);
  });
});

describe("pathUtil — rename/delete path consistency helpers", () => {
  it("parentDir: keeps the source separator and POSIX leading slash", () => {
    expect(parentDir("/a/b/c.md")).toBe("/a/b");
    expect(parentDir("C:\\a\\b\\c.md")).toBe("C:\\a\\b");
    expect(parentDir("a.md")).toBe(""); // no parent
  });

  it("joinPath: uses the directory's native separator, no double sep", () => {
    expect(joinPath("/a/b", "c.md")).toBe("/a/b/c.md");
    expect(joinPath("C:\\a\\b", "c.md")).toBe("C:\\a\\b\\c.md");
    expect(joinPath("/a/b/", "c.md")).toBe("/a/b/c.md"); // trailing sep not doubled
    expect(joinPath("", "c.md")).toBe("c.md");
  });

  it("parentDir + joinPath round-trips a rename within the same dir", () => {
    const p = "/Users/me/notes/old.md";
    expect(joinPath(parentDir(p), "new.md")).toBe("/Users/me/notes/new.md");
    const w = "C:\\Users\\me\\notes\\old.md";
    expect(joinPath(parentDir(w), "new.md")).toBe("C:\\Users\\me\\notes\\new.md");
  });

  it("isPathAtOrUnder: self, descendant, sibling-prefix, both separators", () => {
    expect(isPathAtOrUnder("/a/b", "/a/b")).toBe(true); // self
    expect(isPathAtOrUnder("/a/b/c.md", "/a/b")).toBe(true); // descendant
    expect(isPathAtOrUnder("/a/bc.md", "/a/b")).toBe(false); // prefix but not a boundary
    expect(isPathAtOrUnder("/a/c.md", "/a/b")).toBe(false);
    expect(isPathAtOrUnder("C:\\a\\b\\c.md", "C:\\a\\b")).toBe(true);
  });

  it("remapUnderRename: rewrites self and descendants only", () => {
    // The renamed item itself.
    expect(remapUnderRename("/a/old", "/a/old", "/a/new")).toBe("/a/new");
    // A descendant of a renamed folder.
    expect(remapUnderRename("/a/old/x/y.md", "/a/old", "/a/new")).toBe("/a/new/x/y.md");
    // Unrelated path is untouched.
    expect(remapUnderRename("/a/other.md", "/a/old", "/a/new")).toBe("/a/other.md");
    // Prefix-but-not-boundary is untouched.
    expect(remapUnderRename("/a/oldish.md", "/a/old", "/a/new")).toBe("/a/oldish.md");
    // Windows separators.
    expect(remapUnderRename("C:\\a\\old\\y.md", "C:\\a\\old", "C:\\a\\new")).toBe(
      "C:\\a\\new\\y.md"
    );
  });
});
