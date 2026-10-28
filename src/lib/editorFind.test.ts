import { describe, it, expect } from "vitest";
import {
  escapeRegExp,
  findMatches,
  replaceAllMatches,
  lineOfIndex,
  firstMatchFrom,
} from "./editorFind";

describe("findMatches", () => {
  it("returns nothing for an empty query", () => {
    expect(findMatches("hello world", "")).toEqual([]);
  });

  it("finds all case-insensitive matches by default", () => {
    const m = findMatches("Cat cat CAT", "cat");
    expect(m).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
  });

  it("respects case sensitivity when asked", () => {
    const m = findMatches("Cat cat CAT", "cat", true);
    expect(m).toEqual([{ start: 4, end: 7 }]);
  });

  it("treats the query as literal text, not a regex", () => {
    const m = findMatches("a.b a_b axb", "a.b");
    expect(m).toEqual([{ start: 0, end: 3 }]);
  });

  it("matches across newlines as separate hits", () => {
    const m = findMatches("foo\nfoo", "foo");
    expect(m).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
  });
});

describe("replaceAllMatches", () => {
  it("replaces every occurrence and reports the count", () => {
    const r = replaceAllMatches("cat cat", "cat", "dog");
    expect(r).toEqual({ text: "dog dog", count: 2 });
  });

  it("treats the replacement literally ($& is not special)", () => {
    const r = replaceAllMatches("a", "a", "$&b");
    expect(r).toEqual({ text: "$&b", count: 1 });
  });

  it("returns the text unchanged with count 0 when nothing matches", () => {
    const r = replaceAllMatches("hello", "xyz", "q");
    expect(r).toEqual({ text: "hello", count: 0 });
  });

  it("returns the text unchanged for an empty query", () => {
    const r = replaceAllMatches("hello", "", "q");
    expect(r).toEqual({ text: "hello", count: 0 });
  });

  it("handles a replacement that contains the query (no infinite growth)", () => {
    const r = replaceAllMatches("a a", "a", "aa");
    expect(r).toEqual({ text: "aa aa", count: 2 });
  });
});

describe("lineOfIndex", () => {
  it("is 0 on the first line", () => {
    expect(lineOfIndex("hello world", 5)).toBe(0);
  });

  it("counts newlines before the index", () => {
    const text = "a\nb\nc";
    expect(lineOfIndex(text, 0)).toBe(0);
    expect(lineOfIndex(text, 2)).toBe(1); // 'b'
    expect(lineOfIndex(text, 4)).toBe(2); // 'c'
  });

  it("clamps an out-of-range index", () => {
    expect(lineOfIndex("a\nb", 999)).toBe(1);
    expect(lineOfIndex("a\nb", -5)).toBe(0);
  });
});

describe("firstMatchFrom", () => {
  const matches = [
    { start: 2, end: 5 },
    { start: 10, end: 13 },
    { start: 20, end: 23 },
  ];

  it("returns -1 with no matches", () => {
    expect(firstMatchFrom([], 0)).toBe(-1);
  });

  it("finds the first match at or after the position", () => {
    expect(firstMatchFrom(matches, 0)).toBe(0);
    expect(firstMatchFrom(matches, 6)).toBe(1);
    expect(firstMatchFrom(matches, 20)).toBe(2);
  });

  it("wraps to the first match when none is at/after the position", () => {
    expect(firstMatchFrom(matches, 99)).toBe(0);
  });
});

describe("escapeRegExp", () => {
  it("escapes regex metacharacters", () => {
    expect(escapeRegExp("a.b*c")).toBe("a\\.b\\*c");
  });
});
