import { describe, it, expect } from "vitest";
import { buildMenuLabels } from "./menuLabels";

// Regression guard: the 27 camelCase keys returned by buildMenuLabels() must map
// 1:1 to the MenuLabels struct fields (snake_case) in src-tauri/src/lib.rs.
// serde's #[serde(default)] is container-level, so if any key is missing or
// misspelled, both tsc and cargo check pass silently and only that field falls
// back to its hardcoded Korean default at runtime — this test is the only
// safety net that catches that failure mode.
describe("buildMenuLabels", () => {
  it("returns exactly the 27 keys the Rust MenuLabels struct expects (camelCase)", () => {
    const expected = [
      "about", "settings", "appMenu", "newFile", "openFile", "openFolder", "saveAs",
      "recentTitle", "recentEmpty", "clearRecent", "fileMenu", "editMenu",
      "toggleSidebar", "toggleOutline", "search", "zoomIn", "zoomOut", "zoomReset",
      "toggleEdit", "focusMode", "themeSystem", "themeDark", "themeLight",
      "themeMenu", "viewMenu", "manual", "helpMenu",
    ].sort();
    expect(Object.keys(buildMenuLabels()).sort()).toEqual(expected);
  });
});
