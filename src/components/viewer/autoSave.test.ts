import { describe, it, expect } from "vitest";
import { shouldAutoSave, AUTO_SAVE_IDLE_MS } from "../../lib/autoSave";

// Importing Editor.tsx pulls in React/Tauri-flavored modules, but shouldAutoSave
// is a pure function with no DOM/store dependency, so it evaluates fine here.

const base = {
  autoSave: true,
  hasFile: true,
  isDirty: true,
  externalChanged: false,
};

describe("shouldAutoSave (auto-save decision)", () => {
  it("saves when on, dirty, has a file, and no external change", () => {
    expect(shouldAutoSave(base)).toBe(true);
  });

  it("does NOT save when auto_save is off (manual ⌘S only)", () => {
    expect(shouldAutoSave({ ...base, autoSave: false })).toBe(false);
  });

  it("does NOT save when there is no open file", () => {
    expect(shouldAutoSave({ ...base, hasFile: false })).toBe(false);
  });

  it("does NOT save when the buffer is not dirty", () => {
    expect(shouldAutoSave({ ...base, isDirty: false })).toBe(false);
  });

  it("does NOT save when the file changed externally (no silent clobber)", () => {
    // Most important guard: the open file changed on disk while editing.
    // Auto-save must refuse and leave the conflict warning for the user.
    expect(shouldAutoSave({ ...base, externalChanged: true })).toBe(false);
  });

  it("externalChanged wins even when everything else says save", () => {
    expect(
      shouldAutoSave({ autoSave: true, hasFile: true, isDirty: true, externalChanged: true })
    ).toBe(false);
  });

  it("uses a non-zero idle debounce so typing is never interrupted", () => {
    expect(AUTO_SAVE_IDLE_MS).toBeGreaterThan(0);
  });
});
