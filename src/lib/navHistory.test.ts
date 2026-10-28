import { describe, it, expect } from "vitest";
import {
  emptyNav,
  pushEntry,
  goBack,
  goForward,
  canGoBack,
  canGoForward,
  MAX_NAV,
} from "./navHistory";

describe("navHistory.emptyNav", () => {
  it("starts empty with index -1 and no navigation possible", () => {
    const s = emptyNav();
    expect(s).toEqual({ entries: [], index: -1 });
    expect(canGoBack(s)).toBe(false);
    expect(canGoForward(s)).toBe(false);
  });
});

describe("navHistory.pushEntry", () => {
  it("appends and points index at the new entry", () => {
    let s = pushEntry(emptyNav(), "a.md");
    expect(s).toEqual({ entries: ["a.md"], index: 0 });
    s = pushEntry(s, "b.md");
    expect(s).toEqual({ entries: ["a.md", "b.md"], index: 1 });
  });

  it("does not push when path equals the current entry (refresh)", () => {
    const s = pushEntry(emptyNav(), "a.md");
    const same = pushEntry(s, "a.md");
    expect(same).toBe(s); // unchanged reference
    expect(same).toEqual({ entries: ["a.md"], index: 0 });
  });

  it("allows re-pushing a path that is NOT the current entry", () => {
    let s = pushEntry(emptyNav(), "a.md");
    s = pushEntry(s, "b.md");
    s = pushEntry(s, "a.md"); // a is not the current (b is) → allowed
    expect(s).toEqual({ entries: ["a.md", "b.md", "a.md"], index: 2 });
  });

  it("truncates forward history when navigating after going back (branch)", () => {
    let s = pushEntry(emptyNav(), "a.md");
    s = pushEntry(s, "b.md");
    s = pushEntry(s, "c.md");
    // go back twice to 'a'
    s = goBack(s).state; // index 1 (b)
    s = goBack(s).state; // index 0 (a)
    expect(s.entries).toEqual(["a.md", "b.md", "c.md"]);
    expect(s.index).toBe(0);
    // navigating now drops the b/c forward branch
    s = pushEntry(s, "d.md");
    expect(s).toEqual({ entries: ["a.md", "d.md"], index: 1 });
    expect(canGoForward(s)).toBe(false);
  });

  it("enforces the MAX_NAV depth cap (drops oldest)", () => {
    let s = emptyNav();
    for (let i = 0; i < MAX_NAV + 10; i++) {
      s = pushEntry(s, `f${i}.md`);
    }
    expect(s.entries.length).toBe(MAX_NAV);
    expect(s.index).toBe(MAX_NAV - 1);
    // newest is last, oldest 10 dropped
    expect(s.entries[s.entries.length - 1]).toBe(`f${MAX_NAV + 9}.md`);
    expect(s.entries[0]).toBe("f10.md");
  });
});

describe("navHistory.goBack / goForward", () => {
  it("returns null target and unchanged state at the boundaries", () => {
    const empty = emptyNav();
    expect(goBack(empty)).toEqual({ state: empty, path: null });
    expect(goForward(empty)).toEqual({ state: empty, path: null });

    const one = pushEntry(empty, "a.md");
    expect(goBack(one)).toEqual({ state: one, path: null });
    expect(goForward(one)).toEqual({ state: one, path: null });
  });

  it("moves back then forward returning the correct paths", () => {
    let s = pushEntry(emptyNav(), "a.md");
    s = pushEntry(s, "b.md");
    s = pushEntry(s, "c.md"); // index 2

    const back1 = goBack(s);
    expect(back1.path).toBe("b.md");
    expect(back1.state.index).toBe(1);

    const back2 = goBack(back1.state);
    expect(back2.path).toBe("a.md");
    expect(back2.state.index).toBe(0);
    expect(canGoBack(back2.state)).toBe(false);

    const fwd = goForward(back2.state);
    expect(fwd.path).toBe("b.md");
    expect(fwd.state.index).toBe(1);
    expect(canGoForward(fwd.state)).toBe(true);
  });

  it("does not mutate the entries array when navigating", () => {
    let s = pushEntry(emptyNav(), "a.md");
    s = pushEntry(s, "b.md");
    const before = s.entries;
    const back = goBack(s);
    expect(back.state.entries).toBe(before); // same array, only index changed
  });
});
