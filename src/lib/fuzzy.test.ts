import { describe, it, expect } from "vitest";
import { fuzzyScore, fuzzyFilter } from "./fuzzy";

describe("fuzzyScore", () => {
  it("returns 0 for an empty query (matches anything)", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyScore("xyz", "abc")).toBeNull();
    expect(fuzzyScore("cba", "abc")).toBeNull(); // order matters
  });

  it("matches a subsequence regardless of gaps", () => {
    expect(fuzzyScore("ac", "abc")).not.toBeNull();
  });

  it("scores a start-of-string match higher than a mid-string one", () => {
    const start = fuzzyScore("a", "abc")!;
    const mid = fuzzyScore("c", "abc")!;
    expect(start).toBeGreaterThan(mid);
  });

  it("rewards contiguous runs over scattered matches", () => {
    const contiguous = fuzzyScore("ab", "abxy")!;
    const scattered = fuzzyScore("ab", "axby")!;
    expect(contiguous).toBeGreaterThan(scattered);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("AB", "ab")).not.toBeNull();
    expect(fuzzyScore("ab", "AB")).not.toBeNull();
  });

  it("matches Korean labels as a plain subsequence", () => {
    expect(fuzzyScore("집중", "집중 모드 토글")).not.toBeNull();
    expect(fuzzyScore("테마", "테마: 다크")).not.toBeNull();
    expect(fuzzyScore("zz", "집중 모드 토글")).toBeNull();
  });
});

describe("fuzzyFilter", () => {
  const cmds = [
    { label: "새 문서" },
    { label: "파일 열기" },
    { label: "폴더 열기" },
    { label: "집중 모드 토글" },
    { label: "테마: 다크" },
    { label: "테마: 라이트" },
  ];

  it("keeps original order for an empty query", () => {
    const out = fuzzyFilter(cmds, "", (c) => c.label);
    expect(out).toEqual(cmds);
  });

  it("keeps original order for a whitespace-only query", () => {
    const out = fuzzyFilter(cmds, "   ", (c) => c.label);
    expect(out).toEqual(cmds);
  });

  it("drops non-matching items", () => {
    const out = fuzzyFilter(cmds, "열기", (c) => c.label);
    expect(out.map((c) => c.label)).toEqual(["파일 열기", "폴더 열기"]);
  });

  it("returns matches ranked, label tie-break is stable", () => {
    const out = fuzzyFilter(cmds, "테마", (c) => c.label);
    expect(out.map((c) => c.label)).toContain("테마: 다크");
    expect(out.map((c) => c.label)).toContain("테마: 라이트");
  });

  it("returns empty array when nothing matches", () => {
    expect(fuzzyFilter(cmds, "zzzz", (c) => c.label)).toEqual([]);
  });
});
