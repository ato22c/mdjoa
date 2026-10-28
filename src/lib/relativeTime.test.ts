import { describe, it, expect } from "vitest";
import { relativeTime } from "./relativeTime";

describe("relativeTime", () => {
  it("ko: 분 단위", () => {
    expect(relativeTime(5 * 60_000, "ko")).toContain("5분");
  });
  it("en: 복수형 처리", () => {
    expect(relativeTime(1 * 60_000, "en")).toBe("1 minute ago");
    expect(relativeTime(2 * 60_000, "en")).toBe("2 minutes ago");
  });
  it("방금 전 / just now (<1분)", () => {
    expect(relativeTime(10_000, "ko")).toBe("방금 전");
    expect(relativeTime(10_000, "en")).toBe("just now");
  });
});
