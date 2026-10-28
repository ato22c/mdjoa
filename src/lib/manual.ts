import { invoke } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";
import { useAppStore } from "../store/app";
import { getActiveLang, t } from "./i18n";

// Open the user manual for the current language in the viewer. If the English
// version is missing (e.g. not bundled), fall back to Korean; if that also fails,
// show a toast. Single entry point shared by the four manual-opening call sites:
// F1, the native menu, the hamburger menu, and About (no duplication).
export async function openManual(): Promise<void> {
  const s = useAppStore.getState();
  const candidates =
    getActiveLang() === "en"
      ? ["docs/user-manual.en.md", "docs/user-manual.md"]
      : ["docs/user-manual.md"];
  for (const rel of candidates) {
    try {
      const path = await resolveResource(rel);
      // The store's openFile only shows its own toast on failure and never rejects,
      // so existence must be checked here first for the fallback to actually work
      // (otherwise the first candidate always counts as "success" and the Korean
      // fallback never fires).
      if (!(await exists(path))) continue;
      await s.openFile(path);
      return;
    } catch (e) {
      // If resolveResource/exists itself fails (Windows permission / long-path errors,
      // etc.), treat only this candidate as unusable and move on to the next one (or
      // the final toast). If we don't swallow it here, the exception propagates out of
      // openManual() (all 4 call sites await it unguarded) up to the global
      // unhandledrejection handler, which only logs and shows no toast — violating the
      // "toast + log on exception" rule (CLAUDE.md).
      await invoke("write_log", { level: "error", message: `openManual candidate failed (${rel}): ${e}` }).catch(() => {});
      continue;
    }
  }
  s.showToast(t("toast.manualNotFound"));
}
