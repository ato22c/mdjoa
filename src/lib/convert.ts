// DOCX conversion orchestration (frontend side).
// Conversion runs via pandoc in the Rust backend; this module handles the
// user-facing flow: status check, consent + download (with progress), save
// dialog, and async conversion. Backend commands: pandoc_status,
// pandoc_download, convert_docx (see src-tauri/src/commands/pandoc.rs).
import { invoke } from "@tauri-apps/api/core";
import { save, ask, message } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store/app";
import type { PandocStatus } from "../types";
import { baseName as lastSegment } from "./pathUtil";
import { t } from "./i18n";
import { errorMessage } from "./i18n/errorMessage";

// Default save name = the document's file name without its .md extension.
// Uses the cross-platform basename so Windows backslash paths work too.
function baseName(path: string): string {
  return lastSegment(path).replace(/\.(md|markdown)$/i, "") || "document";
}

/** Ensure pandoc is available, downloading it (with consent) if needed. */
async function ensurePandoc(): Promise<boolean> {
  const store = useAppStore.getState();
  let status: PandocStatus;
  try {
    status = await invoke<PandocStatus>("pandoc_status");
  } catch {
    status = { state: "none", version: null, path: null };
  }

  if (status.state !== "none") return true;

  const consent = await ask(
    t("convert.pandocConsentMessage"),
    { title: t("convert.pandocConsentTitle"), kind: "info", okLabel: t("settings.download"), cancelLabel: t("common.cancel") }
  );
  if (!consent) return false;

  store.setPandocDownloading(true);
  try {
    await invoke("pandoc_download");
    store.showToast(t("settings.pandocInstallSuccess"));
    return true;
  } catch (e) {
    const retry = await ask(
      t("convert.pandocDownloadFailedMessage", { err: errorMessage(String(e)) }),
      { title: t("convert.downloadFailedTitle"), kind: "error", okLabel: t("convert.retry"), cancelLabel: t("convert.manualInstallTitle") }
    );
    if (retry) {
      store.setPandocDownloading(true);
      try {
        await invoke("pandoc_download");
        store.showToast(t("settings.pandocInstallSuccess"));
        return true;
      } catch (e2) {
        await showManualInstall(errorMessage(String(e2)));
        return false;
      } finally {
        store.setPandocDownloading(false);
      }
    }
    await showManualInstall(errorMessage(String(e)));
    return false;
  } finally {
    store.setPandocDownloading(false);
  }
}

async function showManualInstall(err: string): Promise<void> {
  await message(
    t("convert.manualInstallMessage", { err }),
    { title: t("convert.manualInstallTitle"), kind: "warning" }
  );
}

/** Export the given markdown file to DOCX. Async, never blocks the UI. */
export async function exportDocx(mdPath: string): Promise<void> {
  const store = useAppStore.getState();
  if (!(await ensurePandoc())) return;

  const out = await save({
    defaultPath: `${baseName(mdPath)}.docx`,
    filters: [{ name: t("convert.docxFilterName"), extensions: ["docx"] }],
  });
  if (!out) return;

  store.setConverting(true);
  try {
    await invoke("convert_docx", { input: mdPath, output: out });
    store.showToast(t("convert.exportSuccess"));
  } catch (e) {
    store.showToast(t("convert.exportFailed", { err: errorMessage(String(e)) }));
    await invoke("write_log", { level: "error", message: `convert_docx failed: ${e}` }).catch(() => {});
  } finally {
    store.setConverting(false);
  }
}

