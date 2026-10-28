import { describe, it, expect, beforeEach, vi } from "vitest";

// manual.ts resolves candidate paths via resolveResource, then checks
// existence before ever calling openFile. Both are mocked here so the
// fallback branching can be exercised without a real Tauri runtime.
vi.mock("@tauri-apps/api/path", () => ({
  resolveResource: vi.fn(async (rel: string) => `/resources/${rel}`),
}));

const existsMock = vi.fn<(path: string) => Promise<boolean>>();
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: (path: string) => existsMock(path),
}));

const openFileMock = vi.fn(async () => {});
const showToastMock = vi.fn();
// manual.ts and src/lib/i18n both resolve to the same store module, so mocking
// it here also governs the settings.language that t() reads for translation.
vi.mock("../store/app", () => ({
  useAppStore: {
    getState: () => ({
      openFile: openFileMock,
      showToast: showToastMock,
      settings: { language: "en" },
    }),
  },
}));

import { openManual, openPrivacyPolicy } from "./manual";
import { setActiveLang } from "./i18n";
import { en } from "./i18n/en";

describe("openManual", () => {
  beforeEach(() => {
    existsMock.mockReset();
    openFileMock.mockClear();
    showToastMock.mockClear();
  });

  it("opens the English manual when it exists (no fallback attempted)", async () => {
    setActiveLang("en");
    existsMock.mockResolvedValue(true);

    await openManual();

    expect(openFileMock).toHaveBeenCalledTimes(1);
    expect(openFileMock).toHaveBeenCalledWith("/resources/docs/user-manual.en.md");
    expect(existsMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it("falls back to the Korean manual when the English one doesn't exist", async () => {
    setActiveLang("en");
    existsMock.mockImplementation(async (path) => !path.includes("en.md"));

    await openManual();

    expect(openFileMock).toHaveBeenCalledTimes(1);
    expect(openFileMock).toHaveBeenCalledWith("/resources/docs/user-manual.md");
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it("shows manualNotFound and never calls openFile when no candidate exists", async () => {
    setActiveLang("en");
    existsMock.mockResolvedValue(false);

    await openManual();

    expect(openFileMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith(en.toast.manualNotFound);
  });

  it("falls back to the next candidate when exists() rejects for the first one", async () => {
    setActiveLang("en");
    existsMock.mockImplementation(async (path) => {
      if (path.includes("en.md")) throw new Error("EPERM: permission denied");
      return true;
    });

    // Must resolve, not throw: a rejecting exists() on one candidate must not
    // propagate out of openManual() uncaught (see bug this test guards against).
    await expect(openManual()).resolves.toBeUndefined();

    expect(openFileMock).toHaveBeenCalledTimes(1);
    expect(openFileMock).toHaveBeenCalledWith("/resources/docs/user-manual.md");
    expect(showToastMock).not.toHaveBeenCalled();
  });
});

describe("openPrivacyPolicy", () => {
  beforeEach(() => {
    existsMock.mockReset();
    openFileMock.mockClear();
  });

  it("opens the English policy in English, Korean policy in Korean", async () => {
    existsMock.mockResolvedValue(true);

    setActiveLang("en");
    await openPrivacyPolicy();
    expect(openFileMock).toHaveBeenLastCalledWith("/resources/docs/privacy-policy.en.md");

    setActiveLang("ko");
    await openPrivacyPolicy();
    expect(openFileMock).toHaveBeenLastCalledWith("/resources/docs/privacy-policy.md");
  });
});
