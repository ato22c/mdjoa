import { describe, it, expect } from "vitest";
import {
  parseWikiLinkBody,
  extractWikiLinks,
  normalizeWikiTarget,
  textReferencesDoc,
} from "./wikilink";

describe("parseWikiLinkBody", () => {
  it("parses a bare target", () => {
    expect(parseWikiLinkBody("a")).toEqual({ target: "a", heading: null });
  });

  it("parses target#heading", () => {
    expect(parseWikiLinkBody("a#h")).toEqual({ target: "a", heading: "h" });
  });

  it("trims surrounding whitespace on both sides", () => {
    expect(parseWikiLinkBody("  a  #  h  ")).toEqual({ target: "a", heading: "h" });
  });

  it("treats an empty heading after # as no heading", () => {
    expect(parseWikiLinkBody("a#")).toEqual({ target: "a", heading: null });
    expect(parseWikiLinkBody("a#   ")).toEqual({ target: "a", heading: null });
  });

  it("splits on the FIRST # so headings may contain #", () => {
    expect(parseWikiLinkBody("a#h#2")).toEqual({ target: "a", heading: "h#2" });
  });

  it("returns null for empty / heading-only bodies", () => {
    expect(parseWikiLinkBody("")).toBeNull();
    expect(parseWikiLinkBody("   ")).toBeNull();
    expect(parseWikiLinkBody("#h")).toBeNull();
  });

  it("keeps spaces and special characters inside the target", () => {
    expect(parseWikiLinkBody("My Note (v2)")).toEqual({
      target: "My Note (v2)",
      heading: null,
    });
  });
});

describe("extractWikiLinks", () => {
  it("finds a single link", () => {
    expect(extractWikiLinks("see [[a]] here")).toEqual([{ target: "a", heading: null }]);
  });

  it("finds a link with a heading", () => {
    expect(extractWikiLinks("see [[a#h]]")).toEqual([{ target: "a", heading: "h" }]);
  });

  it("finds multiple links in order", () => {
    expect(extractWikiLinks("[[a]] then [[b#x]] then [[c]]")).toEqual([
      { target: "a", heading: null },
      { target: "b", heading: "x" },
      { target: "c", heading: null },
    ]);
  });

  it("ignores empty / broken brackets", () => {
    expect(extractWikiLinks("[[]] [[ ]] [[#h]]")).toEqual([]);
    expect(extractWikiLinks("an unclosed [[link")).toEqual([]);
  });

  it("includes links found inside code spans/blocks (scan errs toward inclusion)", () => {
    // The backlink scan intentionally does NOT strip code — a `[[x]]` in a code
    // block still counts as a reference. Documented behavior, asserted here.
    const md = "```\n[[code-ref]]\n```\ninline `[[span-ref]]`";
    expect(extractWikiLinks(md)).toEqual([
      { target: "code-ref", heading: null },
      { target: "span-ref", heading: null },
    ]);
  });

  it("handles targets with spaces and punctuation", () => {
    expect(extractWikiLinks("[[My Note (v2)#섹션 1]]")).toEqual([
      { target: "My Note (v2)", heading: "섹션 1" },
    ]);
  });
});

describe("normalizeWikiTarget", () => {
  it("lowercases and strips a markdown extension", () => {
    expect(normalizeWikiTarget("Note")).toBe("note");
    expect(normalizeWikiTarget("Note.md")).toBe("note");
    expect(normalizeWikiTarget("Note.MARKDOWN")).toBe("note");
    expect(normalizeWikiTarget("  Note.md  ")).toBe("note");
  });

  it("leaves non-markdown extensions intact", () => {
    expect(normalizeWikiTarget("data.json")).toBe("data.json");
  });
});

describe("textReferencesDoc", () => {
  it("matches case-insensitively and ignoring extension/heading", () => {
    expect(textReferencesDoc("[[Spec]]", "spec.md")).toBe(true);
    expect(textReferencesDoc("[[spec.md#part]]", "Spec")).toBe(true);
  });

  it("does not match a different target", () => {
    expect(textReferencesDoc("[[other]]", "spec")).toBe(false);
    expect(textReferencesDoc("no links here", "spec")).toBe(false);
  });

  it("returns false for an empty doc name", () => {
    expect(textReferencesDoc("[[a]]", "")).toBe(false);
  });
});
