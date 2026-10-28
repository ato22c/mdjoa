import { describe, it, expect } from "vitest";
import { clampMenuPosition } from "./ContextMenu";

const VW = 1000;
const VH = 800;
const MW = 180;
const MH = 200;

describe("clampMenuPosition", () => {
  it("keeps the requested position when it fits", () => {
    expect(clampMenuPosition(100, 100, MW, MH, VW, VH)).toEqual({ left: 100, top: 100 });
  });

  it("nudges left when overflowing the right edge", () => {
    const { left } = clampMenuPosition(950, 100, MW, MH, VW, VH);
    // 950 + 180 = 1130 > 1000 - 8 → clamp to 1000 - 180 - 8 = 812
    expect(left).toBe(VW - MW - 8);
    expect(left + MW).toBeLessThanOrEqual(VW);
  });

  it("nudges up when overflowing the bottom edge", () => {
    const { top } = clampMenuPosition(100, 750, MW, MH, VW, VH);
    expect(top).toBe(VH - MH - 8);
    expect(top + MH).toBeLessThanOrEqual(VH);
  });

  it("clamps both axes near the bottom-right corner", () => {
    const { left, top } = clampMenuPosition(999, 799, MW, MH, VW, VH);
    expect(left).toBe(VW - MW - 8);
    expect(top).toBe(VH - MH - 8);
  });

  it("never produces negative coordinates (menu larger than viewport)", () => {
    const { left, top } = clampMenuPosition(0, 0, 2000, 2000, VW, VH);
    expect(left).toBe(8);
    expect(top).toBe(8);
  });

  it("respects a custom margin", () => {
    const { left } = clampMenuPosition(950, 100, MW, MH, VW, VH, 20);
    expect(left).toBe(VW - MW - 20);
  });
});
