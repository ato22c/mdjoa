// @vitest-environment jsdom
//
// The 'system' test below relies on navigator.language defaulting to 'en-US'
// (per the comment inline). The project's default vitest environment is plain
// "node" (see vitest.config.ts), where the global `navigator.language` mirrors
// the host OS locale instead — making the assertion flaky across machines
// (e.g. it returns "ko" on a ko-KR dev machine). jsdom hardcodes
// navigator.language to "en-US" regardless of host locale, so this directive
// makes that assumption actually true. Same pattern as src/lib/markdown.test.ts.

import { describe, it, expect } from "vitest";
import { resolveLang, translate, interpolate } from "./index";
import { ko } from "./ko";
import { en } from "./en";

describe("resolveLang", () => {
  it("passes through explicit ko/en", () => {
    expect(resolveLang("ko")).toBe("ko");
    expect(resolveLang("en")).toBe("en");
  });
  it("'system' resolves via navigator.language", () => {
    // jsdom navigator.language is 'en-US' by default → en
    expect(resolveLang("system")).toBe("en");
  });
  it("an arbitrary invalid string falls through to navigator-based resolution like 'system'", () => {
    // Anything that isn't literally "ko" or "en" hits the same fallback path as "system".
    // jsdom navigator.language is 'en-US' by default → en
    expect(resolveLang("fr")).toBe("en");
  });
});

describe("interpolate", () => {
  it("replaces {name} tokens", () => {
    expect(interpolate("파일 열기 실패: {err}", { err: "X" })).toBe("파일 열기 실패: X");
  });
  it("leaves unknown tokens literal", () => {
    expect(interpolate("hi {who}", {})).toBe("hi {who}");
  });
  it("no params → unchanged", () => {
    expect(interpolate("plain")).toBe("plain");
  });
});

describe("translate", () => {
  it("looks up a dot-path key", () => {
    expect(translate("ko", "common.close")).toBe("닫기");
    expect(translate("en", "common.close")).toBe("Close");
  });
  it("interpolates params", () => {
    expect(translate("en", "toast.openFailed", { err: "boom" })).toBe("Failed to open file: boom");
  });
  it("missing key falls back to the raw key", () => {
    expect(translate("en", "nope.missing")).toBe("nope.missing");
  });
});

describe("dictionary parity", () => {
  // Compile-time guard is `const en: Dict`; this is the runtime belt-and-suspenders.
  const keys = (obj: Record<string, unknown>, prefix = ""): string[] =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === "object" && v !== null
        ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
        : [`${prefix}${k}`]
    );
  it("en has exactly the same keys as ko", () => {
    expect(keys(en).sort()).toEqual(keys(ko).sort());
  });
});
