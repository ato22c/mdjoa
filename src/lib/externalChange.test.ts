import { describe, it, expect } from "vitest";
import { decideExternalChange, type ExternalChangeInput } from "./externalChange";

const base: ExternalChangeInput = {
  exists: true,
  contentChanged: true,
  editMode: false,
  isDirty: false,
  autoReload: true,
};

describe("decideExternalChange", () => {
  it("deleted file → missing (any mode/dirtiness)", () => {
    expect(decideExternalChange({ ...base, exists: false })).toBe("missing");
    expect(decideExternalChange({ ...base, exists: false, editMode: true, isDirty: true })).toBe("missing");
  });

  it("no content change → none (e.g. our own save / touch)", () => {
    expect(decideExternalChange({ ...base, contentChanged: false })).toBe("none");
    expect(decideExternalChange({ ...base, contentChanged: false, editMode: true })).toBe("none");
  });

  it("view mode + modified + auto-reload → reloadView", () => {
    expect(decideExternalChange({ ...base, editMode: false, autoReload: true })).toBe("reloadView");
  });

  it("view mode + modified + auto-reload OFF → notifyView", () => {
    expect(decideExternalChange({ ...base, editMode: false, autoReload: false })).toBe("notifyView");
  });

  it("edit mode + modified + clean buffer → reflectEdit", () => {
    expect(decideExternalChange({ ...base, editMode: true, isDirty: false })).toBe("reflectEdit");
  });

  it("edit mode + modified + unsaved edits → conflictEdit (never auto-overwrite)", () => {
    expect(decideExternalChange({ ...base, editMode: true, isDirty: true })).toBe("conflictEdit");
  });

  it("recreated-with-different-content (exists again) is handled like a modify", () => {
    // After a delete the watcher keeps firing; a re-create is just exists=true.
    expect(decideExternalChange({ ...base, exists: true, contentChanged: true, editMode: false, autoReload: true })).toBe("reloadView");
    expect(decideExternalChange({ ...base, exists: true, contentChanged: true, editMode: true, isDirty: false })).toBe("reflectEdit");
  });

  it("recreated-identical → none (caller still clears the missing flag)", () => {
    expect(decideExternalChange({ ...base, exists: true, contentChanged: false })).toBe("none");
  });
});
