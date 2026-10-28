import { describe, it, expect } from "vitest";
import {
  parentDirName,
  parentLabelOf,
  isGenericName,
  makeFileItem,
  makeFolderItem,
  nameMatchBonus,
} from "./quickOpenItem";

describe("parentDirName", () => {
  it("returns the immediate parent folder name (POSIX & Windows)", () => {
    expect(parentDirName("/proj/.claude/skills/ui-ux/SKILL.md")).toBe("ui-ux");
    expect(parentDirName("C:\\proj\\.claude\\skills\\code-review\\SKILL.md")).toBe("code-review");
    expect(parentDirName("/proj/docs/api/index.md")).toBe("api");
  });
  it("is empty when there is no parent segment", () => {
    expect(parentDirName("README.md")).toBe("");
  });
});

describe("parentLabelOf", () => {
  it("returns the last two parent segments joined with /", () => {
    expect(parentLabelOf("/proj/.claude/skills/ui-ux/SKILL.md")).toBe("skills/ui-ux");
    expect(parentLabelOf("C:\\proj\\docs\\api\\v2\\guide.md")).toBe("api/v2");
    expect(parentLabelOf("/proj/notes.md")).toBe("proj");
  });
});

describe("isGenericName", () => {
  it("treats folder-identity filenames as generic (case-insensitive)", () => {
    expect(isGenericName("SKILL.md")).toBe(true);
    expect(isGenericName("skill.md")).toBe(true);
    expect(isGenericName("README.md")).toBe(true);
    expect(isGenericName("index.md")).toBe(true);
  });
  it("treats distinctive filenames as non-generic", () => {
    expect(isGenericName("architecture.md")).toBe(false);
    expect(isGenericName("ui-ux.md")).toBe(false);
  });
});

describe("makeFileItem", () => {
  it("for a generic file: folder name is primary, full context is secondary, search includes folder", () => {
    const it1 = makeFileItem("SKILL.md", "/proj/.claude/skills/ui-ux/SKILL.md");
    expect(it1.kind).toBe("file");
    expect(it1.primary).toBe("ui-ux");
    expect(it1.secondary).toBe("skills/ui-ux/SKILL.md");
    expect(it1.searchText).toBe("skills/ui-ux/SKILL.md");
    // The whole point: typing the folder name must be searchable.
    expect(it1.searchText).toContain("ui-ux");
  });

  it("for a distinctive file: filename is primary, parent label is secondary", () => {
    const it2 = makeFileItem("architecture.md", "/proj/docs/api/architecture.md");
    expect(it2.primary).toBe("architecture.md");
    expect(it2.secondary).toBe("docs/api");
    expect(it2.searchText).toBe("docs/api/architecture.md");
  });

  it("falls back to the filename when there is no parent context", () => {
    const it3 = makeFileItem("SKILL.md", "SKILL.md");
    expect(it3.primary).toBe("SKILL.md");
    expect(it3.secondary).toBe("SKILL.md");
    expect(it3.searchText).toBe("SKILL.md");
  });

  it("handles Windows separators", () => {
    const it4 = makeFileItem("SKILL.md", "C:\\proj\\.claude\\skills\\code-review\\SKILL.md");
    expect(it4.primary).toBe("code-review");
    expect(it4.searchText).toBe("skills/code-review/SKILL.md");
  });
});

describe("nameMatchBonus", () => {
  it("scores an exact (case-insensitive) name match highest", () => {
    expect(nameMatchBonus("mdjoa", "mdjoa")).toBe(1000);
    expect(nameMatchBonus("mdjoa", "MDJOA")).toBe(1000);
  });
  it("scores a prefix match lower than exact but above no match", () => {
    expect(nameMatchBonus("mdjoa-old", "mdjoa")).toBe(200);
    expect(nameMatchBonus("mdjoa", "mdjoa-old")).toBe(0);
  });
  it("is 0 when the name doesn't start with the query or the query is empty", () => {
    expect(nameMatchBonus("docs", "mdjoa")).toBe(0);
    expect(nameMatchBonus("mdjoa", "")).toBe(0);
  });
});

describe("makeFolderItem", () => {
  it("uses the folder's own name as primary and is searchable by name", () => {
    const f = makeFolderItem("/proj/workspace/mdjoa/docs");
    expect(f.kind).toBe("folder");
    expect(f.primary).toBe("docs");
    expect(f.searchText).toContain("docs");
  });

  it("location secondary is the parent dir context (last two parent segments)", () => {
    const f = makeFolderItem("/proj/workspace/mdjoa/docs");
    expect(f.secondary).toBe("workspace/mdjoa");
    expect(f.searchText).toBe("workspace/mdjoa/docs");
  });

  it("handles Windows separators and root-level folders", () => {
    expect(makeFolderItem("C:\\proj\\.claude\\skills").primary).toBe("skills");
    expect(makeFolderItem("C:\\proj\\.claude\\skills").searchText).toBe("proj/.claude/skills");
    const bare = makeFolderItem("solo");
    expect(bare.primary).toBe("solo");
    expect(bare.searchText).toBe("solo");
  });
});
