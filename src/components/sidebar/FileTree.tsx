import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Folder, FolderOpen, FileText, FilePlus, ChevronRight, Star, RefreshCw, Pencil, Trash2 } from "lucide-react";
import { useAppStore } from "../../store/app";
import { useT } from "../../lib/i18n";
import { errorMessage } from "../../lib/i18n/errorMessage";
import { createNewFileInFolder } from "../../lib/newFile";
import { useFolderWatch } from "../../hooks/useFolderWatch";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import { buildFileMenuItems } from "../../lib/fileActionMenuItems";
import { isTextLikePath, isPdfPath } from "../../lib/fileType";
import { parentDir, joinPath } from "../../lib/pathUtil";
import type { DirEntry } from "../../types";

// When show_non_md is on, the backend returns every file, so the tree keeps only folders,
// Markdown, text/code (whitelist) and PDF, and hides the remaining binaries.
const visible = (e: DirEntry) =>
  e.is_dir || e.is_md || isTextLikePath(e.path) || isPdfPath(e.path);

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  currentFile: string | null;
  onFileClick: (path: string) => void;
  showNonMd: boolean;
}

function TreeNode({ entry, depth, currentFile, onFileClick, showNonMd }: TreeNodeProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const favorites = useAppStore((s) => s.favorites);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const favorited = favorites.some((f) => f.path === entry.path);
  // Change badge kind for this file (undefined = unchanged). created=green,
  // modified=amber — deleted files leave the tree entirely so have no badge.
  const changeKind = useAppStore((s) => s.changedFiles[entry.path]);
  const treeRefreshNonce = useAppStore((s) => s.treeRefreshNonce);
  // The "마크다운 있는 폴더만" (only folders with Markdown) setting. When on, list_dir filters out subfolders without md.
  // Lazy: only expanded folders (this level) are re-listed, so the whole tree isn't scanned up front.
  const mdOnly = useAppStore((s) => s.settings.md_only_folders);
  // showNonMd is passed as a prop (root FileTree -> settings.show_non_md). Default ON.
  const [children, setChildren] = useState<DirEntry[]>([]);

  // Re-list an OPEN folder's children when the tree is asked to refresh (e.g.
  // after a new file is created here) or the md-only setting changes. Collapsed
  // folders re-list on expand.
  useEffect(() => {
    if (!entry.is_dir || !open) return;
    invoke<DirEntry[]>("list_dir", { path: entry.path, mdOnly, showNonMd })
      .then((es) => setChildren(es.filter(visible)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeRefreshNonce, mdOnly, showNonMd]);
  // App-owned right-click menu for this row. null = closed.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Inline rename: when set, this row renders an <input> seeded with the current
  // name instead of the label. null = not renaming. `renaming` is the draft text.
  const [renaming, setRenaming] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Guards the blur-save from firing again after Enter/Esc already resolved it
  // (Enter saves then blurs → would double-fire; Esc cancels then blurs → would save).
  const renameResolved = useRef(false);

  // Focus + select the rename input when it appears (select the base name only,
  // excluding the extension, would be nicer but a full select keeps it simple).
  useEffect(() => {
    if (renaming !== null && renameInputRef.current) {
      const el = renameInputRef.current;
      el.focus();
      el.select();
    }
  }, [renaming]);

  const beginRename = useCallback(() => {
    renameResolved.current = false;
    setRenaming(entry.name);
  }, [entry.name]);

  const cancelRename = useCallback(() => {
    renameResolved.current = true;
    setRenaming(null);
  }, []);

  const commitRename = useCallback(async () => {
    if (renameResolved.current) return;
    renameResolved.current = true;
    const next = (renaming ?? "").trim();
    setRenaming(null);
    const store = useAppStore.getState();
    // Reject empty names, unchanged names and names containing separators (prevents overwrite/move accidents).
    if (!next || next === entry.name) return;
    if (next.includes("/") || next.includes("\\")) {
      store.showToast(t("fileTree.renameInvalidChars"));
      return;
    }
    const dir = parentDir(entry.path);
    const newPath = joinPath(dir, next);
    try {
      await invoke("rename_path", { oldPath: entry.path, newPath });
      await store.notifyPathRenamed(entry.path, newPath, entry.is_dir);
      store.bumpTreeRefresh();
    } catch (e) {
      store.showToast(t("fileTree.renameFailed", { err: errorMessage(String(e)) }));
    }
  }, [renaming, entry.path, entry.name, entry.is_dir, t]);

  const handleDelete = useCallback(async () => {
    const store = useAppStore.getState();
    try {
      await invoke("trash_path", { path: entry.path });
      await store.notifyPathDeleted(entry.path, entry.is_dir);
      store.bumpTreeRefresh();
      store.showToast(t("fileTree.movedToTrash"));
    } catch (e) {
      store.showToast(t("settings.deleteFailed", { err: errorMessage(String(e)) }));
    }
  }, [entry.path, entry.is_dir, t]);

  const handleToggle = useCallback(async () => {
    if (!entry.is_dir) {
      onFileClick(entry.path);
      return;
    }
    if (!open) {
      try {
        const entries = await invoke<DirEntry[]>("list_dir", { path: entry.path, mdOnly, showNonMd });
        setChildren(entries.filter(visible));
      } catch {}
    }
    setOpen((v) => !v);
  }, [entry, open, onFileClick]);

  const isActive = !entry.is_dir && entry.path === currentFile;

  // Build the right-click menu for this row. Every item reuses an existing
  // action: open (onFileClick→openFile / expand), favorite toggle, and
  // reveal-in-Finder/Explorer (revealItemInDir, same as the hamburger menu).
  const menuItems: ContextMenuItem[] = [
    {
      label: entry.is_dir ? t("welcome.openFolder") : t("common.open"),
      icon: entry.is_dir ? FolderOpen : FileText,
      onClick: () => {
        // Files open; folders expand (only when collapsed) — mirrors a click.
        if (!entry.is_dir) onFileClick(entry.path);
        else if (!open) void handleToggle();
      },
    },
    // Folders: create a new .md inside this folder (auto unique name) and edit it.
    ...(entry.is_dir
      ? [
          {
            label: t("fileTree.newFileInFolder"),
            icon: FilePlus,
            onClick: () => {
              void createNewFileInFolder(entry.path);
            },
          },
        ]
      : []),
    // File actions (open in new window / favorite / compare with another document / reveal in
    // explorer) use a shared builder — same items, behavior and labels as the document-area right-click.
    ...buildFileMenuItems({ path: entry.path, isDir: entry.is_dir }),
    { separator: true },
    {
      // Rename via inline editing (files and folders). The row turns into an input.
      label: t("fileTree.rename"),
      icon: Pencil,
      onClick: () => beginRename(),
    },
    {
      // Move to the system trash (not permanent deletion) — the trash itself is the safety net, so no confirmation dialog.
      label: t("common.delete"),
      icon: Trash2,
      onClick: () => void handleDelete(),
    },
    { separator: true },
    {
      // Reachable from any explorer region (row menu, empty-area menu, header).
      label: t("commandPalette.refreshExplorer"),
      icon: RefreshCw,
      onClick: () => useAppStore.getState().bumpTreeRefresh(),
    },
  ];

  return (
    <div>
      <div
        onClick={renaming !== null ? undefined : handleToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        className="row-hover group flex items-center w-full text-left h-7 px-2 rounded-md text-[14px] gap-1 cursor-pointer"
        style={{
          paddingLeft: `${6 + depth * 14}px`,
          background: isActive ? "var(--active)" : undefined,
          color: "var(--fg)",
          fontWeight: isActive ? 500 : 400,
        }}
      >
        {entry.is_dir ? (
          <ChevronRight
            size={13}
            className="shrink-0"
            style={{
              transform: open ? "rotate(90deg)" : undefined,
              transition: "transform 120ms ease",
              color: "var(--muted)",
            }}
          />
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        {entry.is_dir ? (
          open ? (
            <FolderOpen size={14} className="shrink-0" style={{ color: "var(--muted)" }} />
          ) : (
            <Folder size={14} className="shrink-0" style={{ color: "var(--muted)" }} />
          )
        ) : (
          <FileText
            size={14}
            className="shrink-0"
            style={{ color: isActive ? "var(--accent)" : "var(--muted)" }}
          />
        )}
        {renaming !== null ? (
          <input
            ref={renameInputRef}
            value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                void commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
            onBlur={() => void commitRename()}
            spellCheck={false}
            className="flex-1 min-w-0 px-1 py-0 rounded text-[14px] outline-none"
            style={{
              background: "var(--bg)",
              color: "var(--fg)",
              border: "1px solid var(--accent)",
            }}
          />
        ) : (
          <span className="truncate flex-1">{entry.name}</span>
        )}
        {renaming === null && changeKind && (
          <span
            className="shrink-0 w-1.5 h-1.5 rounded-full"
            style={{ background: changeKind === "created" ? "#2ea043" : "#d29922" }}
            title={changeKind === "created" ? t("fileTree.createdExternallyTooltip") : t("fileTree.modifiedExternallyTooltip")}
            aria-label={changeKind === "created" ? t("fileTree.createdBadgeLabel") : t("fileTree.modifiedBadgeLabel")}
          />
        )}
        {renaming === null && (
          <button
            onClick={(e) => {
              // stopPropagation so starring a folder doesn't expand/collapse it.
              e.stopPropagation();
              toggleFavorite(entry.path, entry.is_dir);
            }}
            className={`shrink-0 p-0.5 rounded hover:bg-[var(--hover)] transition-opacity ${
              favorited ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            title={favorited ? t("topbar.unfavorite") : t("topbar.favorite")}
          >
            <Star
              size={12}
              fill={favorited ? "currentColor" : "none"}
              style={{ color: favorited ? "var(--accent)" : "var(--muted)" }}
            />
          </button>
        )}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
      {open &&
        children.map((child) => (
          <TreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            currentFile={currentFile}
            onFileClick={onFileClick}
            showNonMd={showNonMd}
          />
        ))}
    </div>
  );
}

export function FileTree() {
  const t = useT();
  const { currentFolder, currentFile, openFile, setFolder, showToast, settings } = useAppStore();
  const treeRefreshNonce = useAppStore((s) => s.treeRefreshNonce);
  const [roots, setRoots] = useState<DirEntry[]>([]);

  // Watch the open folder and badge .md files that change on disk (e.g. AI edits).
  useFolderWatch(currentFolder);

  // Re-list on folder change AND on an explicit refresh request (treeRefreshNonce),
  // so a newly created file in the root folder shows up immediately.
  useEffect(() => {
    if (!currentFolder) return;
    invoke<DirEntry[]>("list_dir", {
      path: currentFolder,
      mdOnly: settings.md_only_folders,
      showNonMd: settings.show_non_md,
    })
      .then((es) => setRoots(es.filter(visible)))
      .catch(() => setRoots([]));
  }, [currentFolder, treeRefreshNonce, settings.md_only_folders, settings.show_non_md]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") setFolder(selected);
    } catch (e) {
      showToast(t("toast.folderOpenFailed", { err: String(e) }));
    }
  }, [setFolder, showToast, t]);

  if (!currentFolder) {
    return (
      <div className="flex flex-col items-start gap-2 px-3 py-3">
        <p className="text-[14px] leading-relaxed" style={{ color: "var(--muted)" }}>
          {t("fileTree.noFolderOpen")}
        </p>
        <button
          onClick={handleOpenFolder}
          className="row-hover flex items-center gap-2 px-2.5 h-8 rounded-md text-[14px] font-medium"
          style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
        >
          <FolderOpen size={14} style={{ color: "var(--muted)" }} />
          {t("welcome.openFolder")}
        </button>
      </div>
    );
  }

  return (
    <div className="pb-2 px-2 overflow-y-auto h-full">
      {roots.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          currentFile={currentFile}
          onFileClick={openFile}
          showNonMd={settings.show_non_md}
        />
      ))}
    </div>
  );
}
