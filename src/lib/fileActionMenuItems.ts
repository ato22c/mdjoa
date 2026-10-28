import { SquareArrowOutUpRight, Star, StarOff, GitCompare, FolderOpen } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useAppStore } from "../store/app";
import { isMac } from "./platform";
import { t } from "./i18n";
import type { ContextMenuItem } from "../components/common/ContextMenu";

/**
 * Shared right-click menu items for the "things you can do" with a file/folder.
 * Collected in one place so the explorer (FileTree), the document area
 * (MarkdownViewer), favorites/context, etc. all use the same items, behavior, and
 * labels. All actions reuse existing store actions/commands.
 *
 * Included items (only those that apply) — same order as the hamburger menu:
 *  - Reveal in Finder/Explorer
 *  - Open in new window (files only)
 *  - Compare with another document… (a file, with a current document open, and not itself)
 *  - Add/remove favorite
 */
export function buildFileMenuItems(opts: { path: string; isDir?: boolean; skipCompare?: boolean }): ContextMenuItem[] {
  const { path, isDir = false, skipCompare = false } = opts;
  const s = useAppStore.getState();
  const favorited = s.favorites.some((f) => f.path === path);
  const items: ContextMenuItem[] = [];

  // Same order as the hamburger menu: Finder → new window → compare → favorite.
  items.push({
    label: isMac ? t("common.revealInFinder") : t("common.revealInExplorer"),
    icon: FolderOpen,
    onClick: () => {
      revealItemInDir(path).catch(() =>
        useAppStore.getState().showToast(isMac ? t("common.revealInFinderFailed") : t("common.revealInExplorerFailed"))
      );
    },
  });

  if (!isDir) {
    items.push({
      label: t("commandPalette.openInNewWindow"),
      icon: SquareArrowOutUpRight,
      onClick: () => {
        invoke("open_in_new_window", { path }).catch(() =>
          useAppStore.getState().showToast(t("fileActionMenuItems.openInNewWindowFailed"))
        );
      },
    });
  }

  // Compare with another document: only when a document is currently open.
  //  - If this file is a "different" file from the current document → compare current ↔ this file directly (startCompare)
  //  - If this file is the current document (right-click in the document area) → pick a compare target (QuickOpen compare)
  if (!isDir && s.currentFile && !skipCompare) {
    const isCurrent = path === s.currentFile;
    items.push({
      label: t("hamburgerMenu.compareDocument"),
      icon: GitCompare,
      onClick: () => {
        const st = useAppStore.getState();
        if (isCurrent) st.setQuickOpenMode("compare");
        else void st.startCompare(path);
      },
    });
  }

  items.push({
    label: favorited ? t("topbar.unfavorite") : t("topbar.favorite"),
    icon: favorited ? StarOff : Star,
    onClick: () => void useAppStore.getState().toggleFavorite(path, isDir),
  });

  return items;
}
