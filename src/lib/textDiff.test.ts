import { describe, it, expect } from "vitest";
import { changedBlockIndices } from "./textDiff";

// Blocks are split on blank lines (see textDiff.toBlocks). The function returns
// the indices — in the NEW text's block list — of blocks that were added or
// changed relative to the old text (via LCS). These tests pin that contract,
// which the "변경 하이라이트" feature relies on to tint the right elements.
describe("changedBlockIndices", () => {
  it("returns [] when old and new are identical", () => {
    const t = "# Title\n\npara one\n\npara two";
    expect(changedBlockIndices(t, t)).toEqual([]);
  });

  it("treats every block as new when old is empty", () => {
    const next = "a\n\nb\n\nc";
    expect(changedBlockIndices("", next)).toEqual([0, 1, 2]);
  });

  it("treats whitespace-only old text as empty (all new)", () => {
    expect(changedBlockIndices("   \n\n  \n", "a\n\nb")).toEqual([0, 1]);
  });

  it("returns [] when new text has no blocks", () => {
    expect(changedBlockIndices("a\n\nb", "")).toEqual([]);
    expect(changedBlockIndices("a\n\nb", "   \n\n  ")).toEqual([]);
  });

  it("flags only the modified block", () => {
    const oldT = "intro\n\nmiddle\n\nend";
    const newT = "intro\n\nMIDDLE CHANGED\n\nend";
    expect(changedBlockIndices(oldT, newT)).toEqual([1]);
  });

  it("flags a block inserted in the middle (new-text index)", () => {
    const oldT = "a\n\nc";
    const newT = "a\n\nb\n\nc";
    expect(changedBlockIndices(oldT, newT)).toEqual([1]);
  });

  it("flags an appended block at the end", () => {
    const oldT = "a\n\nb";
    const newT = "a\n\nb\n\nc";
    expect(changedBlockIndices(oldT, newT)).toEqual([2]);
  });

  it("flags a prepended block at the start", () => {
    const oldT = "b\n\nc";
    const newT = "a\n\nb\n\nc";
    expect(changedBlockIndices(oldT, newT)).toEqual([0]);
  });

  it("reports nothing new when blocks are only deleted", () => {
    const oldT = "a\n\nb\n\nc";
    const newT = "a\n\nc";
    // b is gone; a and c still match → no new/changed blocks in newT.
    expect(changedBlockIndices(oldT, newT)).toEqual([]);
  });

  it("flags multiple inserted blocks", () => {
    const oldT = "a\n\nd";
    const newT = "a\n\nb\n\nc\n\nd";
    expect(changedBlockIndices(oldT, newT)).toEqual([1, 2]);
  });

  it("ignores surrounding blank lines / inconsistent spacing", () => {
    const oldT = "\n\na\n\n\n\nb\n\n";
    const newT = "a\n\nb";
    expect(changedBlockIndices(oldT, newT)).toEqual([]);
  });

  it("treats a reordered block as changed (LCS keeps the longer run)", () => {
    const oldT = "a\n\nb\n\nc";
    const newT = "b\n\nc\n\na";
    // LCS of [a,b,c] and [b,c,a] is [b,c]; the trailing 'a' is not matched.
    expect(changedBlockIndices(oldT, newT)).toEqual([2]);
  });

  it("handles a full rewrite (no common blocks) as all-new", () => {
    const oldT = "x\n\ny";
    const newT = "a\n\nb\n\nc";
    expect(changedBlockIndices(oldT, newT)).toEqual([0, 1, 2]);
  });
});
