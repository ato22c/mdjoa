import { describe, it, expect } from "vitest";
import {
  approxTokens,
  sumTokens,
  gaugeRatio,
  isOverBudget,
  gaugeFillPercent,
  displayPercent,
  normalizeWindow,
  isStaleSelection,
  MODEL_PRESETS,
  DEFAULT_CONTEXT_WINDOW,
  MIN_CONTEXT_WINDOW,
  MAX_CONTEXT_WINDOW,
} from "./contextTokens";

describe("approxTokens (chars/4)", () => {
  it("counts ceil(chars/4)", () => {
    expect(approxTokens("")).toBe(0);
    expect(approxTokens("abcd")).toBe(1);
    expect(approxTokens("abcde")).toBe(2); // ceil(5/4)
    expect(approxTokens("a".repeat(400))).toBe(100);
  });
  it("counts code points (astral chars as 1)", () => {
    // 4 emoji code points → ceil(4/4) = 1, not byte/utf16-unit based.
    expect(approxTokens("😀😀😀😀")).toBe(1);
  });
});

describe("sumTokens", () => {
  it("sums valid numbers", () => {
    expect(sumTokens([10, 20, 30])).toBe(60);
  });
  it("ignores undefined/null/NaN/negatives", () => {
    expect(sumTokens([10, undefined, null, NaN, -5, 5])).toBe(15);
  });
  it("empty → 0", () => {
    expect(sumTokens([])).toBe(0);
  });
});

describe("gaugeRatio", () => {
  it("ratio = total/window", () => {
    expect(gaugeRatio(38_000, 200_000)).toBeCloseTo(0.19);
  });
  it("zero/negative window → 0 (no division by zero)", () => {
    expect(gaugeRatio(100, 0)).toBe(0);
    expect(gaugeRatio(100, -5)).toBe(0);
  });
  it("over budget → ratio > 1", () => {
    expect(gaugeRatio(250_000, 200_000)).toBeCloseTo(1.25);
  });
});

describe("isOverBudget", () => {
  it("strictly greater than window is over", () => {
    expect(isOverBudget(200_001, 200_000)).toBe(true);
  });
  it("exactly full is NOT over", () => {
    expect(isOverBudget(200_000, 200_000)).toBe(false);
  });
  it("under budget is not over", () => {
    expect(isOverBudget(38_000, 200_000)).toBe(false);
  });
  it("invalid window never reports over", () => {
    expect(isOverBudget(100, 0)).toBe(false);
  });
});

describe("gaugeFillPercent / displayPercent", () => {
  it("fill clamps to 100 when over budget", () => {
    expect(gaugeFillPercent(250_000, 200_000)).toBe(100);
    expect(gaugeFillPercent(38_000, 200_000)).toBe(19);
  });
  it("display percent can exceed 100 (shows real ratio)", () => {
    expect(displayPercent(250_000, 200_000)).toBe(125);
    expect(displayPercent(38_000, 200_000)).toBe(19);
  });
});

describe("normalizeWindow", () => {
  it("rounds valid values", () => {
    expect(normalizeWindow(128_000.4)).toBe(128_000);
  });
  it("rejects out-of-range / non-finite → null", () => {
    expect(normalizeWindow(0)).toBeNull();
    expect(normalizeWindow(MIN_CONTEXT_WINDOW - 1)).toBeNull();
    expect(normalizeWindow(MAX_CONTEXT_WINDOW + 1)).toBeNull();
    expect(normalizeWindow(NaN)).toBeNull();
    expect(normalizeWindow(Infinity)).toBeNull();
  });
  it("accepts boundaries", () => {
    expect(normalizeWindow(MIN_CONTEXT_WINDOW)).toBe(MIN_CONTEXT_WINDOW);
    expect(normalizeWindow(MAX_CONTEXT_WINDOW)).toBe(MAX_CONTEXT_WINDOW);
  });
});

describe("isStaleSelection (cancel guard)", () => {
  it("same set (order-independent) → not stale", () => {
    expect(isStaleSelection(["a", "b"], ["b", "a"])).toBe(false);
  });
  it("different length → stale", () => {
    expect(isStaleSelection(["a"], ["a", "b"])).toBe(true);
    expect(isStaleSelection(["a", "b"], ["a"])).toBe(true);
  });
  it("same length, different member → stale", () => {
    expect(isStaleSelection(["a", "b"], ["a", "c"])).toBe(true);
  });
  it("empty vs empty → not stale", () => {
    expect(isStaleSelection([], [])).toBe(false);
  });
  it("duplicate counts differing → stale (set-size guard)", () => {
    // snapshot has 2 distinct, current has 1 distinct repeated → different sets.
    expect(isStaleSelection(["a", "b"], ["a", "a"])).toBe(true);
  });
});

describe("presets / defaults", () => {
  it("ships exactly the minimal preset set 128k/200k/1M", () => {
    expect(MODEL_PRESETS.map((p) => p.window)).toEqual([128_000, 200_000, 1_000_000]);
  });
  it("default window is 200000", () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(200_000);
  });
  it("end-to-end: 38k of 200k reads as 19%, not over", () => {
    const total = sumTokens([20_000, 18_000]);
    expect(total).toBe(38_000);
    expect(displayPercent(total, DEFAULT_CONTEXT_WINDOW)).toBe(19);
    expect(isOverBudget(total, DEFAULT_CONTEXT_WINDOW)).toBe(false);
  });
});
