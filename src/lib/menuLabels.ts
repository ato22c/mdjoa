import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "./i18n";
import { MOD_LABEL, isTauri } from "./platform";

// Native menu label object (camelCase keys = Rust MenuLabels fields). The {mod}
// token is replaced with the current OS modifier (⌘ / Ctrl+). It must map 1:1 to
// the 27 fields of the Rust MenuLabels — if any is missing or a key name is
// wrong, serde's container-level #[serde(default)] silently falls back to
// Korean for just that field.
export function buildMenuLabels(): Record<string, string> {
  const mk = (key: string) => t(key, { mod: MOD_LABEL });
  return {
    about: mk("menu.about"),
    settings: mk("menu.settings"),
    appMenu: mk("menu.appMenu"),
    newFile: mk("menu.newFile"),
    openFile: mk("menu.openFile"),
    openFolder: mk("menu.openFolder"),
    saveAs: mk("menu.saveAs"),
    recentTitle: mk("menu.recentTitle"),
    recentEmpty: mk("menu.recentEmpty"),
    clearRecent: mk("menu.clearRecent"),
    fileMenu: mk("menu.fileMenu"),
    editMenu: mk("menu.editMenu"),
    toggleSidebar: mk("menu.toggleSidebar"),
    toggleOutline: mk("menu.toggleOutline"),
    search: mk("menu.search"),
    zoomIn: mk("menu.zoomIn"),
    zoomOut: mk("menu.zoomOut"),
    zoomReset: mk("menu.zoomReset"),
    toggleEdit: mk("menu.toggleEdit"),
    focusMode: mk("menu.focusMode"),
    themeSystem: mk("menu.themeSystem"),
    themeDark: mk("menu.themeDark"),
    themeLight: mk("menu.themeLight"),
    themeMenu: mk("menu.themeMenu"),
    viewMenu: mk("menu.viewMenu"),
    manual: mk("menu.manual"),
    helpMenu: mk("menu.helpMenu"),
  };
}

// Rebuild the native menu with labels in the current language. No-op in the web preview (non-Tauri).
export async function rebuildNativeMenu(): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke("rebuild_menu", { labels: buildMenuLabels() });
  } catch {
    /* A failed menu refresh is not fatal */
  }
}

// Update the main window's native title (shown in the Windows taskbar tooltip and
// Alt-Tab) to match the translated brand name. doc-* secondary windows use the
// file name as their title, so leave them alone.
export async function syncWindowTitle(): Promise<void> {
  if (!isTauri) return;
  const win = getCurrentWindow();
  if (win.label !== "main") return;
  try {
    await win.setTitle(t("menu.appMenu"));
  } catch {
    /* A failed title update is not fatal */
  }
}
