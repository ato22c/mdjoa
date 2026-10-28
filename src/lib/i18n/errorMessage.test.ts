import { describe, it, expect, beforeEach, vi } from "vitest";

// errorMessage() calls t(), which reads settings.language from the store.
// Mock the store the same way src/lib/manual.test.ts does so t() resolves
// against a controllable language without a real Tauri runtime.
let mockLanguage = "en";
vi.mock("../../store/app", () => ({
  useAppStore: {
    getState: () => ({ settings: { language: mockLanguage } }),
  },
}));

import { errorMessage } from "./errorMessage";
import { ko } from "./ko";
import { en } from "./en";

describe("errorMessage", () => {
  beforeEach(() => {
    mockLanguage = "en";
  });

  it("maps a known code with params to the localized message, substituted", () => {
    expect(errorMessage("file_too_large|12.3|10")).toBe(
      en.error.fileTooLarge.replace("{size}", "12.3").replace("{max}", "10"),
    );
  });

  it("maps the same code in Korean mode with no leftover Korean-then-English mixing", () => {
    mockLanguage = "ko";
    expect(errorMessage("file_too_large|12.3|10")).toBe(
      ko.error.fileTooLarge.replace("{size}", "12.3").replace("{max}", "10"),
    );
  });

  it("maps a known code without params", () => {
    expect(errorMessage("source_not_found")).toBe(en.error.sourceNotFound);
  });

  it("returns the raw string unchanged for an unrecognized code (graceful fallback)", () => {
    const raw = "some_future_error_code|with|args";
    expect(errorMessage(raw)).toBe(raw);
  });

  it("passes through a plain e.to_string() style message (no pipe, no known code)", () => {
    const raw = "No such file or directory (os error 2)";
    expect(errorMessage(raw)).toBe(raw);
  });

  it("keeps embedded '|' characters in the trailing free-text param intact", () => {
    const raw = "pandoc_exec_failed|stderr line one | stderr line two";
    expect(errorMessage(raw)).toBe(
      en.error.pandocExecFailed.replace("{err}", "stderr line one | stderr line two"),
    );
  });

  it("handles a no-param code (pandoc_engine_not_found)", () => {
    expect(errorMessage("pandoc_engine_not_found")).toBe(en.error.pandocEngineNotFound);
  });

  it("handles a single-param code with an empty trailing arg", () => {
    expect(errorMessage("pandoc_exec_failed|")).toBe(en.error.pandocExecFailed.replace("{err}", ""));
  });
});
