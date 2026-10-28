import { describe, it, expect } from "vitest";
import { classifyFsEvent, folderWatchPlan } from "./fsEventKind";

describe("classifyFsEvent", () => {
  it("maps create/modify/remove objects", () => {
    expect(classifyFsEvent({ create: { kind: "file" } })).toBe("created");
    expect(classifyFsEvent({ modify: { kind: "data" } })).toBe("modified");
    expect(classifyFsEvent({ remove: { kind: "file" } })).toBe("deleted");
  });
  it("returns null for ambiguous string kinds (macOS 'any', etc.)", () => {
    expect(classifyFsEvent("any")).toBeNull();
    expect(classifyFsEvent("other")).toBeNull();
    expect(classifyFsEvent({ access: {} })).toBeNull();
    expect(classifyFsEvent(undefined)).toBeNull();
    expect(classifyFsEvent(null)).toBeNull();
  });
});

describe("folderWatchPlan", () => {
  it("created → re-list (file appears) + green badge", () => {
    expect(folderWatchPlan("created")).toEqual({ mark: "created", clearBadge: false, reList: true });
  });
  it("deleted → re-list (file vanishes) + clear badge", () => {
    expect(folderWatchPlan("deleted")).toEqual({ mark: null, clearBadge: true, reList: true });
  });
  it("modified → amber badge, no re-list (already in tree)", () => {
    expect(folderWatchPlan("modified")).toEqual({ mark: "modified", clearBadge: false, reList: false });
  });
});
