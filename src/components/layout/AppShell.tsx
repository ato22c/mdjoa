import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Star, Home, ChevronRight, FileText, FilePlus, FolderOpen, RefreshCw, GitCompare, Filter } from "lucide-react";
import { useAppStore } from "../../store/app";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import { createNewFileViaDialog, saveCurrentFileAs } from "../../lib/newFile";
import { baseName } from "../../lib/pathUtil";
import { isMarkdownPath, opensInFrame, buildOpenDialogFilters } from "../../lib/fileType";
import { useFileWatcher } from "../../hooks/useFileWatcher";
import { rebuildNativeMenu } from "../../lib/menuLabels";
import { openManual } from "../../lib/manual";
import { useT } from "../../lib/i18n";
import { TopBar } from "./TopBar";
import { FileTree } from "../sidebar/FileTree";
import { SidebarShelf } from "../sidebar/SidebarShelf";
import { ContextGaugePanel } from "../sidebar/ContextGaugePanel";
import { BacklinksPanel } from "../sidebar/BacklinksPanel";
import { OutlinePanel } from "../sidebar/OutlinePanel";
// Document renderers are lazy-loaded so the heavy markdown stack (markdown-it,
// Shiki, KaTeX, DOMPurify) is NOT parsed at startup — the app opens straight to
// the lightweight Welcome screen / sidebar, and this chunk loads (from local
// disk, instantly) only when the first document is opened.
const MarkdownViewer = lazy(() =>
  import("../viewer/MarkdownViewer").then((m) => ({ default: m.MarkdownViewer }))
);
const Editor = lazy(() => import("../viewer/Editor").then((m) => ({ default: m.Editor })));
const CodeFileViewer = lazy(() =>
  import("../viewer/CodeFileViewer").then((m) => ({ default: m.CodeFileViewer }))
);
const FrameViewer = lazy(() =>
  import("../viewer/FrameViewer").then((m) => ({ default: m.FrameViewer }))
);
const CompareView = lazy(() =>
  import("../viewer/CompareView").then((m) => ({ default: m.CompareView }))
);
const TaskView = lazy(() =>
  import("../viewer/TaskView").then((m) => ({ default: m.TaskView }))
);
import { WelcomeScreen } from "../screens/WelcomeScreen";
import { SettingsModal } from "../screens/SettingsModal";
import { AboutModal } from "../screens/AboutModal";
import { QuickOpen } from "../screens/QuickOpen";
import { CommandPalette } from "../screens/CommandPalette";
import { ReviewCenter } from "../screens/ReviewCenter";
import { FolderSearch } from "../screens/FolderSearch";
import { Toast } from "../ui/Toast";
import { DefaultAppBanner } from "../ui/DefaultAppBanner";
import { ConversionIndicator } from "../ui/ConversionIndicator";
import { TranslationIndicator } from "../ui/TranslationIndicator";
import { useDragDrop } from "../../hooks/useDragDrop";

export function AppShell() {
  const t = useT();
  const {
    currentFile,
    currentFolder,
    settings,
    setSettings,
    saveSettings,
    openFile,
    setFolder,
    toggleFavorite,
    favorites,
    zoom,
    setZoom,
    recentFiles,
    editMode,
    isDirty,
    saveFile,
    compareWith,
    taskDoc,
    focusMode,
    setFocusMode,
  } = useAppStore();

  // Reflect the body font setting on the html element via the data-content-font attribute
  useEffect(() => {
    document.documentElement.dataset.contentFont = settings.content_font ?? "pretendard";
  }, [settings.content_font]);

  // Whether the currently-open root folder is favorited (re-renders on change
  // because `favorites` is read above).
  const folderFavorited = !!currentFolder && favorites.some((f) => f.path === currentFolder);

  // AI change review (killer #1): number of documents changed on disk. Only when 1+,
  // show a minimal entry point ("변경 N건 검토") in the sidebar.
  const changedCount = useAppStore((s) => Object.keys(s.changedFiles).length);
  const setReviewOpen = useAppStore((s) => s.setReviewOpen);

  const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const outlineDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // Explorer (file tree) collapse — matches the 컨텍스트/즐겨찾기 section toggles.
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  // App-owned right-click menu for the explorer header/empty area (so it doesn't
  // surface the browser's default menu). null = closed.
  const [explorerMenu, setExplorerMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const onExplorerContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const s = useAppStore.getState();
    const items: ContextMenuItem[] = [
      {
        label: t("welcome.openFile"),
        icon: FileText,
        onClick: async () => {
          const sel = await open({ multiple: false, filters: buildOpenDialogFilters() });
          if (typeof sel === "string") await s.openFile(sel);
        },
      },
      {
        label: t("hamburgerMenu.newFile"),
        icon: FilePlus,
        onClick: () => void createNewFileViaDialog(),
      },
      {
        label: t("welcome.openFolder"),
        icon: FolderOpen,
        onClick: async () => {
          const sel = await open({ directory: true, multiple: false });
          if (typeof sel === "string") s.setFolder(sel);
        },
      },
      ...(s.currentFolder
        ? [
            {
              label: t("commandPalette.refreshExplorer"),
              icon: RefreshCw,
              onClick: () => s.bumpTreeRefresh(),
            },
          ]
        : []),
    ];
    setExplorerMenu({ x: e.clientX, y: e.clientY, items });
  }, [t]);

  // Explorer display filter (check menu): opens below the clicked icon. Items are built
  // from the settings at click time, so check states are always current.
  const filterActive = settings.md_only_folders || settings.show_non_md;
  const onFilterClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      const s = useAppStore.getState().settings;
      const toggle = (key: "md_only_folders" | "show_non_md") => () => {
        useAppStore.getState().setSettings({ [key]: !s[key] });
        useAppStore.getState().saveSettings();
      };
      setExplorerMenu({
        x: r.left,
        y: r.bottom + 4,
        items: [
          { label: t("settings.mdOnlyFolders"), checked: s.md_only_folders, onClick: toggle("md_only_folders") },
          { label: t("settings.showNonMd"), checked: s.show_non_md, onClick: toggle("show_non_md") },
        ],
      });
    },
    [t]
  );

  // Listen for file open events (from single-instance or CLI)
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<string>("open-file", (event) => {
      openFile(event.payload);
    }).then((u) => { unlisten = u; });
    return () => { unlisten?.(); };
  }, [openFile]);

  // Watch the open file in BOTH view and edit mode (lifted here from
  // MarkdownViewer so editing doesn't blind us to external changes). The store
  // action decides what to do (reload / reflect / conflict / missing) safely.
  useFileWatcher(currentFile, () => void useAppStore.getState().refreshOpenFileFromDisk());

  // Drag & drop: .md → open file, folder → open as working folder. Both
  // callbacks are stable store actions so the listener subscribes once.
  useDragDrop(openFile, setFolder);

  // Block the webview's default context menu (Back/Reload/Inspect/Save image, etc.)
  // EVERYWHERE — a desktop app should never expose those. The app's own context
  // menus call preventDefault + setMenu at the target; this window-level (bubble)
  // listener is the catch-all for any area without its own menu, so no region
  // shows the browser menu (dev included). The inspector is still reachable via
  // ⌘⌥I / Ctrl+Shift+I.
  useEffect(() => {
    const block = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", block);
    return () => window.removeEventListener("contextmenu", block);
  }, []);

  // When switching between view and edit mode, automatically close the search bar
  // (SearchBar) and the find/replace bar (EditorFindBar) — both are shown via the
  // global searchOpen, so one place turns them off.
  useEffect(() => {
    useAppStore.getState().setSearchOpen(false);
  }, [editMode]);

  // Toggle simple edit mode, guarding against losing unsaved changes. Shared by
  // the ⌘E keyboard shortcut and the View menu's "편집·보기 모드 전환" item so both
  // behave identically.
  const toggleEditMode = useCallback(async () => {
    const s = useAppStore.getState();
    // Not editable if it isn't a text document, e.g. PDF (currentContent===null) — ignore Cmd/Ctrl+E.
    if (!s.currentFile || s.currentContent == null) return;
    // Leaving edit mode auto-saves (or asks) — see store.maybeSaveBeforeLeave.
    if (!(await s.maybeSaveBeforeLeave())) return;
    s.setEditMode(!s.editMode);
  }, []);

  // Keyboard shortcuts — owned entirely by this handler. Accelerators have been
  // removed from lib.rs so the native menu never double-fires these.
  useEffect(() => {
    // True when focus is in a text input/textarea/contenteditable — so nav
    // shortcuts (⌘←/→, ⌘[ /]) yield to normal caret movement / typing there.
    const isEditableTarget = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const handler = async (e: KeyboardEvent) => {
      // Esc handling order (all are plain Esc, so before the mod guard): palette (closes itself) ->
      // exit compare (#27) -> leave focus mode -> close find/search bar -> back to view mode if editing.
      // When the find bar input has focus, EditorFindBar handles it first via stopPropagation.
      if (e.key === "Escape") {
        const st = useAppStore.getState();
        if (st.paletteOpen) return; // the palette closes itself
        if (st.compareWith) {
          e.preventDefault();
          st.exitCompare();
          return;
        }
        if (st.focusMode) {
          e.preventDefault();
          st.setFocusMode(false);
          return;
        }
        if (st.searchOpen) {
          // In either view or edit mode, close an open search/find bar first (edit mode stays).
          e.preventDefault();
          st.setSearchOpen(false);
          return;
        }
        if (st.editMode) {
          // Esc in edit mode -> view mode. The save guard is handled by toggleEditMode.
          e.preventDefault();
          void toggleEditMode();
          return;
        }
      }

      // F1: open the user manual (no modifier needed)
      if (e.key === "F1") {
        e.preventDefault();
        await openManual();
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // Command palette (⌘/Ctrl+K): global. It must open regardless of edit textarea/input
      // focus, so handle it before the isEditableTarget guard, with no other modifiers.
      if (e.key.toLowerCase() === "k" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const st = useAppStore.getState();
        // If already open, toggle it closed (prevents double toggling).
        st.setPaletteOpen(!st.paletteOpen);
        return;
      }

      if (e.key === "+" || e.key === "=") {
        // Zoom in: handle both + (Shift+=) and = (Equal).
        e.preventDefault();
        const st = useAppStore.getState();
        st.setZoom(st.zoom + 0.1);
      } else if (e.key === "-") {
        e.preventDefault();
        const st = useAppStore.getState();
        st.setZoom(st.zoom - 0.1);
      } else if (e.key === "0") {
        e.preventDefault();
        useAppStore.getState().setZoom(1.0);
      } else if (e.key.toLowerCase() === "b" && !e.shiftKey) {
        e.preventDefault();
        const st = useAppStore.getState();
        st.setSettings({ sidebar_open: !st.settings.sidebar_open });
        st.saveSettings();
      } else if (e.key.toLowerCase() === "f" && !e.shiftKey) {
        e.preventDefault();
        const st = useAppStore.getState();
        st.setSearchOpen(!st.searchOpen);
      } else if (e.key.toLowerCase() === "e" && !e.shiftKey) {
        e.preventDefault();
        // While in the AI task result split view (shared by review/improve/summarize/translate),
        // instead of global edit mode (which closes the split), toggle both panels between
        // text (edit) and render — the split is kept.
        const st = useAppStore.getState();
        if (st.taskDoc) {
          st.toggleTranslationRaw();
        } else {
          await toggleEditMode();
        }
      } else if (e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault();
        void createNewFileViaDialog();
      } else if (e.key.toLowerCase() === "a" && !e.shiftKey) {
        // View mode ⌘/Ctrl+A: select only the document body (.md-body), replacing the
        // browser's default select-all that would also select UI such as the sidebar and top bar.
        // In edit mode or input fields (find, edit textarea, etc.), keep the default behavior.
        const st = useAppStore.getState();
        if (st.editMode || isEditableTarget()) return;
        const body = document.querySelector(".md-body");
        if (!body) return; // no body (welcome screen, PDF viewer, etc.) -> default behavior
        e.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(body);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } else if (e.key.toLowerCase() === "o" && e.shiftKey) {
        // Open folder (⌘/Ctrl+Shift+O) — Ctrl+O alone is handled by QuickOpen
        e.preventDefault();
        try {
          const sel = await open({ directory: true, multiple: false });
          if (typeof sel === "string") useAppStore.getState().setFolder(sel);
        } catch { /* cancelled */ }
      } else if (e.key === "Enter" && e.shiftKey) {
        // Focus mode (⌘/Ctrl+Shift+Enter)
        e.preventDefault();
        const st = useAppStore.getState();
        st.setFocusMode(!st.focusMode);
      } else if (e.key === "p") {
        e.preventDefault();
        window.print();
      } else if (e.key === "d") {
        e.preventDefault();
        if (currentFile) toggleFavorite(currentFile, false);
      } else if (e.key.toLowerCase() === "s" && e.shiftKey) {
        // Save As — works in both view and edit mode.
        e.preventDefault();
        void saveCurrentFileAs();
      } else if (e.key === "s") {
        if (editMode) {
          e.preventDefault();
          const st = useAppStore.getState();
          // Untitled scratch doc → always trigger (opens the name dialog) even when
          // not dirty (idle auto-save may have cleared the flag). Normal file →
          // only when there are unsaved edits.
          if (st.untitledPath || st.isDirty) await st.saveFile();
        }
      } else if (e.key === "[" || e.key === "ArrowLeft") {
        if (editMode || isEditableTarget()) return;
        e.preventDefault();
        await useAppStore.getState().goBack();
      } else if (e.key === "]" || e.key === "ArrowRight") {
        if (editMode || isEditableTarget()) return;
        e.preventDefault();
        await useAppStore.getState().goForward();
      } else if (e.key === "\\") {
        if (editMode) return;
        const st = useAppStore.getState();
        if (!st.currentFile) return;
        e.preventDefault();
        st.setQuickOpenMode("compare");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentFile, toggleFavorite, editMode, isDirty, saveFile, toggleEditMode, t]);

  // Mouse back/forward (the dedicated thumb buttons): button 3 = back, 4 =
  // forward. These navigate the document history regardless of focus; we read
  // the freshest actions via getState() so this listener needs no deps.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        void useAppStore.getState().goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        void useAppStore.getState().goForward();
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, []);

  // Native menu events. The menu (lib.rs) emits `menu:*` events; we reuse the
  // existing store actions / dialogs here. Handlers read the freshest state via
  // getState(), so this only re-registers when `t` changes (language switch).
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let cancelled = false;
    const reg = (event: string, fn: (payload: unknown) => void) => {
      listen(event, (e) => fn(e.payload)).then((u) => {
        if (cancelled) u();
        else unlisteners.push(u);
      });
    };
    const s = () => useAppStore.getState();

    reg("menu:new-file", () => void createNewFileViaDialog());
    reg("menu:save-as", () => void saveCurrentFileAs());
    reg("menu:open-file", async () => {
      try {
        const sel = await open({
          multiple: false,
          filters: buildOpenDialogFilters(),
        });
        if (typeof sel === "string") await s().openFile(sel);
      } catch (err) {
        s().showToast(t("toast.openFailed", { err: String(err) }));
      }
    });
    reg("menu:open-folder", async () => {
      try {
        const sel = await open({ directory: true, multiple: false });
        if (typeof sel === "string") s().setFolder(sel);
      } catch (err) {
        s().showToast(t("toast.folderOpenFailed", { err: String(err) }));
      }
    });
    reg("menu:open-recent", async (p) => {
      const r = p as { path: string; is_dir: boolean } | null;
      if (!r) return;
      await s().openRecent(r.path, r.is_dir); // prunes the entry if it's gone
    });
    reg("menu:clear-recent", async () => {
      await invoke("clear_recent_files");
      await s().loadRecent();
    });
    reg("menu:settings", () => s().setSettingsOpen(true));
    reg("menu:about", () => s().setAboutOpen(true));
    reg("menu:toggle-sidebar", () => {
      const st = s();
      st.setSettings({ sidebar_open: !st.settings.sidebar_open });
      st.saveSettings();
    });
    reg("menu:toggle-outline", () => {
      const st = s();
      st.setSettings({ outline_open: !st.settings.outline_open });
      st.saveSettings();
    });
    reg("menu:search", () => {
      const st = s();
      st.setSearchOpen(!st.searchOpen);
    });
    reg("menu:zoom-in", () => s().setZoom(s().zoom + 0.1));
    reg("menu:zoom-out", () => s().setZoom(s().zoom - 0.1));
    reg("menu:zoom-reset", () => s().setZoom(1.0));
    reg("menu:toggle-edit", () => {
      void toggleEditMode();
    });
    reg("menu:focus-mode", () => {
      const st = s();
      st.setFocusMode(!st.focusMode);
    });
    reg("menu:open-manual", async () => {
      await openManual();
    });
    // Theme submenu: pick a theme directly (same as the right-click menu).
    const setTheme = (theme: "light" | "dark" | "system") => {
      s().setSettings({ theme });
      s().saveSettings();
    };
    reg("menu:theme-system", () => setTheme("system"));
    reg("menu:theme-dark", () => setTheme("dark"));
    reg("menu:theme-light", () => setTheme("light"));

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, [t]);

  // Keep the native "최근 항목" submenu in sync: rebuild the menu in Rust whenever
  // the recents list changes (recent.json is already written by then).
  useEffect(() => {
    rebuildNativeMenu();
  }, [recentFiles]);

  // Scroll zoom with Cmd/Ctrl
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        setZoom(zoom + (e.deltaY < 0 ? 0.05 : -0.05));
      }
    };
    window.addEventListener("wheel", handler, { passive: false });
    return () => window.removeEventListener("wheel", handler);
  }, [zoom]);

  // Sidebar resize drag
  const onSidebarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      sidebarDragRef.current = { startX: e.clientX, startWidth: settings.sidebar_width };
      const onMove = (ev: MouseEvent) => {
        if (!sidebarDragRef.current) return;
        const delta = ev.clientX - sidebarDragRef.current.startX;
        const newWidth = Math.max(160, Math.min(480, sidebarDragRef.current.startWidth + delta));
        setSettings({ sidebar_width: newWidth });
      };
      const onUp = () => {
        sidebarDragRef.current = null;
        saveSettings();
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [settings.sidebar_width, setSettings, saveSettings]
  );

  // Outline panel resize drag — it's the right-hand panel so you drag its left edge,
  // and unlike the sidebar it must widen as the mouse moves left (negative delta).
  const onOutlineMouseDown = useCallback(
    (e: React.MouseEvent) => {
      outlineDragRef.current = { startX: e.clientX, startWidth: settings.outline_width };
      const onMove = (ev: MouseEvent) => {
        if (!outlineDragRef.current) return;
        const delta = outlineDragRef.current.startX - ev.clientX;
        const newWidth = Math.max(160, Math.min(480, outlineDragRef.current.startWidth + delta));
        setSettings({ outline_width: newWidth });
      };
      const onUp = () => {
        outlineDragRef.current = null;
        saveSettings();
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [settings.outline_width, setSettings, saveSettings]
  );

  // Focus mode (focusMode): hide all chrome (top bar, sidebar, outline, etc.) and show
  // only the body (close reading / presenting). The compare/edit/view branches work as
  // usual. Esc exits.
  const sidebarVisible = settings.sidebar_open && !focusMode;
  const outlineVisible = settings.outline_open && !focusMode;

  const folderName = currentFolder ? baseName(currentFolder) : "";

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg)" }}>
      {!focusMode && <TopBar />}
      {!focusMode && <DefaultAppBanner />}

      {/* Focus mode: just one tiny exit hint at the top right of the body (minimal). */}
      {focusMode && (
        <button
          onClick={() => setFocusMode(false)}
          className="no-print fixed top-2 right-3 z-50 text-[11px] px-2 py-1 rounded-md opacity-30 hover:opacity-100 transition-opacity"
          style={{ color: "var(--muted)", background: "var(--bg)" }}
          title={t("appShell.exitFocusMode")}
        >
          {t("appShell.exitFocusModeHint")}
        </button>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        {sidebarVisible && (
          <div
            className="sidebar shrink-0 flex flex-col overflow-hidden relative"
            style={{
              width: `${settings.sidebar_width}px`,
              background: "var(--sidebar-bg)",
              borderRight: "1px solid var(--border)",
              paddingTop: 5,
              paddingBottom: 5,
            }}
          >
            {/* AI change review entry point (killer #1): a minimal single line shown only
                when documents changed on disk. Clicking opens the review center. The
                FileTree dot badge stays as is; this is a separate summary entry point. */}
            {changedCount > 0 && (
              <button
                onClick={() => setReviewOpen(true)}
                className="row-hover shrink-0 flex items-center gap-2 mx-2 mt-1 mb-0.5 px-2.5 h-8 rounded-md text-[13px]"
                style={{ color: "var(--fg)" }}
                title={t("appShell.reviewChangesTooltip")}
              >
                <GitCompare size={14} className="shrink-0" style={{ color: "var(--accent)" }} />
                <span className="truncate flex-1 text-left">
                  {t("appShell.reviewChangesLabel", { count: changedCount })}
                </span>
              </button>
            )}
            <div
              className="group shrink-0 flex items-center h-9 pr-2"
              style={{ color: "var(--muted)", paddingLeft: 7 }}
              onContextMenu={onExplorerContextMenu}
            >
              {/* Collapsible header — same chevron+icon pattern as 컨텍스트/즐겨찾기. */}
              <button
                onClick={() => setExplorerCollapsed((v) => !v)}
                className="flex items-center gap-1 flex-1 min-w-0 h-9 text-[11px] font-semibold uppercase tracking-wide text-left"
                style={{ letterSpacing: "0.04em" }}
              >
                <ChevronRight
                  size={12}
                  className="shrink-0"
                  style={{
                    transform: explorerCollapsed ? undefined : "rotate(90deg)",
                    transition: "transform 120ms ease",
                  }}
                />
                <Home size={11} className="shrink-0" />
                <span className="truncate">{folderName || t("appShell.explorerFallbackName")}</span>
              </button>
              {currentFolder && (
                <button
                  onClick={() => toggleFavorite(currentFolder, true)}
                  className={`shrink-0 p-0.5 rounded hover:bg-[var(--hover)] transition-opacity ${
                    folderFavorited ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  title={folderFavorited ? t("appShell.unfavoriteFolderTooltip") : t("appShell.favoriteFolderTooltip")}
                >
                  <Star
                    size={12}
                    fill={folderFavorited ? "currentColor" : "none"}
                    style={{ color: folderFavorited ? "var(--accent)" : "var(--muted)" }}
                  />
                </button>
              )}
              {/* The two display filters (MD folders only / code files too) merged into one icon.
                  Always visible and accented if either is on — refresh lives in the right-click menu. */}
              {currentFolder && (
                <button
                  onClick={onFilterClick}
                  className={`shrink-0 p-0.5 rounded hover:bg-[var(--hover)] transition-opacity ${
                    filterActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  title={t("appShell.explorerFilterTooltip")}
                  aria-label={t("appShell.explorerFilterTooltip")}
                  aria-haspopup="menu"
                >
                  <Filter
                    size={12}
                    fill={filterActive ? "currentColor" : "none"}
                    style={{ color: filterActive ? "var(--accent)" : "var(--muted)" }}
                  />
                </button>
              )}
            </div>
            {!explorerCollapsed && (
              // Right-click anywhere in the tree area (incl. empty space below the
              // rows) shows the explorer menu — which includes "탐색기 새로고침". Row
              // right-clicks have their own menu (they stopPropagation) and carry
              // 탐색기 새로고침 too, so refresh is reachable from any explorer region.
              <div className="flex-1 overflow-hidden" onContextMenu={onExplorerContextMenu}>
                <FileTree />
              </div>
            )}
            {/* Context, Skills and Favorites go in the tab shelf below the explorer (collapsed by default). */}
            <SidebarShelf />
            {/* Sum-token gauge (feature D): sits directly under the shelf (its
                selection source is the 컨텍스트 tab). Shows once 1+ files are
                checked; renders nothing otherwise (minimal chrome). */}
            <ContextGaugePanel />
            {/* Resize handle */}
            <div
              onMouseDown={onSidebarMouseDown}
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent)] opacity-0 hover:opacity-30 transition-opacity"
            />
          </div>
        )}

        {/* Main content. In edit mode, the simple textarea Editor replaces the
            viewer over the same region; both require an open document. */}
        <div className="flex-1 flex overflow-hidden">
          {currentFile ? (
            // Show the body area whenever a document is open (even if empty) — fixes the bug
            // where an empty new doc (currentContent==="") fell through to Welcome. Compare
            // mode takes top priority, then edit/view (#27). Renderers are lazy-loaded, so wrap in Suspense.
            <Suspense fallback={<div className="flex-1" />}>
              {taskDoc ? (
                <TaskView />
              ) : compareWith ? (
                <CompareView />
              ) : currentFile && opensInFrame(currentFile) ? (
                <FrameViewer />
              ) : editMode ? (
                <Editor />
              ) : currentFile && !isMarkdownPath(currentFile) ? (
                <CodeFileViewer />
              ) : (
                <MarkdownViewer />
              )}
            </Suspense>
          ) : (
            <WelcomeScreen />
          )}
        </div>

        {/* Outline panel */}
        {outlineVisible && (
          <div
            className="relative shrink-0 flex flex-col overflow-hidden no-print"
            style={{
              width: `${settings.outline_width}px`,
              background: "var(--sidebar-bg)",
              borderLeft: "1px solid var(--border)",
              paddingTop: 5,
              paddingBottom: 5,
            }}
          >
            <div
              className="shrink-0 flex items-center h-9 pr-4 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--muted)", letterSpacing: "0.04em", paddingLeft: 7 }}
            >
              {t("menu.toggleOutline")}
            </div>
            <div className="flex-1 overflow-hidden">
              <OutlinePanel />
            </div>
            {/* Backlinks (feature F / #10) — moved here, below 목차. Files that
                reference the open doc via `[[…]]`. Renders nothing when empty. */}
            <BacklinksPanel />
            {/* Resize handle — left edge, mirrors the left sidebar's own handle. */}
            <div
              onMouseDown={onOutlineMouseDown}
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent)] opacity-0 hover:opacity-30 transition-opacity"
            />
          </div>
        )}
      </div>

      <SettingsModal />
      <AboutModal />
      <QuickOpen />
      <CommandPalette />
      <ReviewCenter />
      <FolderSearch />
      {explorerMenu && (
        <ContextMenu
          x={explorerMenu.x}
          y={explorerMenu.y}
          items={explorerMenu.items}
          onClose={() => setExplorerMenu(null)}
        />
      )}

      {/* Bottom-center toast region: stacks the conversion indicator above any
          message toast so they never overlap at the same position. */}
      <div className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
        <ConversionIndicator />
        <TranslationIndicator />
        <Toast />
      </div>
    </div>
  );
}
