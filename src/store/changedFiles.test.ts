import { describe, it, expect, beforeEach, vi } from "vitest";

// The store imports `invoke` from the Tauri API at module load. These tests
// exercise only the pure change-badge reducers (markChanged / clearChanged /
// clearAllChanged), which never call invoke, so a no-op stub is enough.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { useAppStore } from "./app";

const reset = () => useAppStore.setState({ changedFiles: {}, currentFile: null });

describe("change-badge store reducers (kind map)", () => {
  beforeEach(reset);

  it("marks a file with its change kind", () => {
    useAppStore.getState().markChanged("/a.md", "modified");
    expect(useAppStore.getState().changedFiles).toEqual({ "/a.md": "modified" });
  });

  it("records a created file distinctly", () => {
    useAppStore.getState().markChanged("/new.md", "created");
    expect(useAppStore.getState().changedFiles).toEqual({ "/new.md": "created" });
  });

  it("does not badge the file currently being viewed", () => {
    useAppStore.setState({ currentFile: "/open.md" });
    useAppStore.getState().markChanged("/open.md", "modified");
    expect(useAppStore.getState().changedFiles).toEqual({});
  });

  it("'created' is sticky — a later modify does not downgrade it", () => {
    const { markChanged } = useAppStore.getState();
    markChanged("/n.md", "created");
    markChanged("/n.md", "modified");
    expect(useAppStore.getState().changedFiles).toEqual({ "/n.md": "created" });
  });

  it("repeated marks are idempotent", () => {
    const { markChanged } = useAppStore.getState();
    markChanged("/a.md", "modified");
    markChanged("/a.md", "modified");
    expect(useAppStore.getState().changedFiles).toEqual({ "/a.md": "modified" });
  });

  it("accumulates distinct files", () => {
    const { markChanged } = useAppStore.getState();
    markChanged("/a.md", "modified");
    markChanged("/b.md", "created");
    expect(useAppStore.getState().changedFiles).toEqual({ "/a.md": "modified", "/b.md": "created" });
  });

  it("clears a single file's badge, leaving others", () => {
    useAppStore.setState({ changedFiles: { "/a.md": "modified", "/b.md": "created", "/c.md": "modified" } });
    useAppStore.getState().clearChanged("/b.md");
    expect(useAppStore.getState().changedFiles).toEqual({ "/a.md": "modified", "/c.md": "modified" });
  });

  it("clearChanged on an unbadged path is a no-op", () => {
    useAppStore.setState({ changedFiles: { "/a.md": "modified" } });
    useAppStore.getState().clearChanged("/missing.md");
    expect(useAppStore.getState().changedFiles).toEqual({ "/a.md": "modified" });
  });

  it("clears all badges", () => {
    useAppStore.setState({ changedFiles: { "/a.md": "modified", "/b.md": "created" } });
    useAppStore.getState().clearAllChanged();
    expect(useAppStore.getState().changedFiles).toEqual({});
  });
});
