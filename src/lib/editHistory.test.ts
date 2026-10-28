import { describe, it, expect, beforeEach } from "vitest";
import {
  shouldSnapshot,
  recordEdit,
  undo,
  redo,
  canUndo,
  canRedo,
  clearHistory,
  COALESCE_MS,
  MAX_DEPTH,
} from "./editHistory";

describe("editHistory.shouldSnapshot", () => {
  it("always snapshots the first edit (empty stack)", () => {
    expect(shouldSnapshot(0, 999_999, 1000)).toBe(true);
  });
  it("coalesces rapid edits within the window", () => {
    expect(shouldSnapshot(3, 1000, 1000 + COALESCE_MS - 1)).toBe(false);
  });
  it("opens a new step after the coalesce window", () => {
    expect(shouldSnapshot(3, 1000, 1000 + COALESCE_MS + 1)).toBe(true);
  });
});

describe("editHistory undo/redo", () => {
  const K = "file-A";
  beforeEach(() => clearHistory(K));

  it("undoes a single edit back to the prior value", () => {
    recordEdit(K, "x", 0); // before edit, buffer was "x"; now becomes "y"
    expect(canUndo(K)).toBe(true);
    expect(undo(K, "y")).toBe("x");
    expect(canUndo(K)).toBe(false);
    expect(canRedo(K)).toBe(true);
    expect(redo(K, "x")).toBe("y");
  });

  it("returns null when nothing to undo/redo", () => {
    expect(undo(K, "y")).toBeNull();
    expect(redo(K, "y")).toBeNull();
  });

  it("a new edit invalidates the redo branch", () => {
    recordEdit(K, "a", 0);
    undo(K, "b"); // back to "a", redo has "b"
    expect(canRedo(K)).toBe(true);
    recordEdit(K, "a", 10_000); // new edit
    expect(canRedo(K)).toBe(false);
  });

  it("walks multiple discrete steps (coalesce window respected)", () => {
    // Three edits spaced past the coalesce window → three undo steps.
    recordEdit(K, "v0", 0);
    recordEdit(K, "v1", COALESCE_MS + 10);
    recordEdit(K, "v2", 2 * (COALESCE_MS + 10));
    expect(undo(K, "v3")).toBe("v2");
    expect(undo(K, "v2")).toBe("v1");
    expect(undo(K, "v1")).toBe("v0");
    expect(undo(K, "v0")).toBeNull();
  });

  it("caps depth at MAX_DEPTH (oldest dropped)", () => {
    for (let i = 0; i <= MAX_DEPTH + 5; i++) recordEdit(K, `v${i}`, i * (COALESCE_MS + 1));
    let count = 0;
    let cur = "top";
    while (undo(K, cur) !== null) {
      count++;
      cur = `step${count}`;
    }
    expect(count).toBe(MAX_DEPTH);
  });
});

describe("editHistory persistence across remounts & reload", () => {
  const K = "file-B";
  beforeEach(() => clearHistory(K));

  it("survives an editor 'remount' (same key) so saved edits stay undoable", () => {
    // Edit X→Y, then 'save' (history untouched), then simulate edit↔view↔edit:
    // the module keeps the stack since it's keyed by path, not the component.
    recordEdit(K, "X", 0); // before edit buffer was "X"
    // ... user saved Y to disk; history NOT cleared on save ...
    // ... Editor unmounted (view mode) then remounted (edit mode) ...
    expect(canUndo(K)).toBe(true);
    expect(undo(K, "Y")).toBe("X"); // can revert the SAVED change back to X
  });

  it("clearHistory wipes a path (used on disk reload)", () => {
    recordEdit(K, "X", 0);
    clearHistory(K);
    expect(canUndo(K)).toBe(false);
    expect(undo(K, "Y")).toBeNull();
  });

  it("keeps separate histories per file path", () => {
    recordEdit("p1", "a", 0);
    expect(canUndo("p1")).toBe(true);
    expect(canUndo("p2")).toBe(false);
    clearHistory("p1");
  });
});
