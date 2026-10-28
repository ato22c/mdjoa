import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import { Search, List, PanelLeft, Minus, Plus, Star, RefreshCw, FileText, FilePlus, FolderOpen, Pencil, ArrowLeft, ArrowRight, Maximize2, Square, X } from "lucide-react";
import { useAppStore } from "../../store/app";
import { useT, getActiveLang } from "../../lib/i18n";
import { isMac, isWindows, isTauri, MOD_LABEL } from "../../lib/platform";
import { baseName, parentDir } from "../../lib/pathUtil";
import { createNewFileViaDialog } from "../../lib/newFile";
import { AI_TASK_GROUPS, runDocumentTask, tasksInGroup } from "../../lib/aiTasks";
import { buildOpenDialogFilters } from "../../lib/fileType";
import { computeTextStats } from "../../lib/textStats";
import { countTokensExact } from "../../lib/tokenizer";
import { relativeTime } from "../../lib/relativeTime";
import { HamburgerMenu } from "./HamburgerMenu";
import type { FileMeta } from "../../types";

function WinBtn({ onClick, title, isClose, children }: {
  onClick: () => void; title: string; isClose?: boolean; children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 40, height: "100%",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: hovered ? (isClose ? "#c42b1c" : "var(--hover)") : "transparent",
        border: "none",
        color: hovered && isClose ? "#fff" : "var(--fg-secondary)",
        cursor: "default", flexShrink: 0,
        transition: "background 100ms ease",
      }}
    >
      {children}
    </button>
  );
}

// One popup button per AI task group (translate/summarize). Items are picked by group
// from the registry (AI_TASKS) and rendered, so new tasks added there show up automatically.
function AiTaskDropdown({ group }: { group: (typeof AI_TASK_GROUPS)[number] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const Icon = group.icon;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const run = (taskId: string) => {
    setOpen(false);
    void runDocumentTask(taskId);
  };

  return (
    <div ref={ref} style={{ position: "relative", WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="icon-btn shrink-0"
        data-tooltip={t(group.labelKey)}
      >
        <Icon size={18} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0,
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,.12)",
            zIndex: 200, minWidth: 140, padding: "4px 0",
          }}
        >
          {tasksInGroup(group.id).map((task) => (
            <button
              key={task.id}
              onClick={() => run(task.id)}
              style={{ display: "flex", width: "100%", padding: "7px 14px", gap: 8, alignItems: "center", fontSize: 13, background: "none", border: "none", cursor: "pointer", color: "var(--fg)", whiteSpace: "nowrap" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              {t(task.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtDate(ms: number | null): string | null {
  if (!ms) return null;
  return new Date(ms).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Relative-time suffix for the modified date, e.g. " (5분 전)" / " (5 minutes ago)".
// No age cap — larger units keep it readable at any age (the absolute date is
// always shown alongside). Future timestamps (clock skew) → "".
function relativeSuffix(ms: number | null): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 0) return "";
  return ` (${relativeTime(diff, getActiveLang())})`;
}

export function TopBar() {
  const t = useT();
  const {
    currentFile,
    currentContent,
    untitledPath,
    settings,
    setSettings,
    saveSettings,
    setSearchOpen,
    zoom,
    setZoom,
    isFavorite,
    toggleFavorite,
    favorites,
    reloadedFlash,
    openFile,
    setFolder,
    showToast,
    editMode,
    focusMode,
    setFocusMode,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
  } = useAppStore();

  // Windows: track maximized state for the window control buttons. Calling
  // getCurrentWebviewWindow() outside a real Tauri webview (web preview / headless
  // browser in design review) throws during render, so guard with isTauri first.
  const [isMaximized, setIsMaximized] = useState(false);
  const winRef = useRef(isWindows && isTauri ? getCurrentWebviewWindow() : null);
  useEffect(() => {
    if (!isWindows || !winRef.current) return;
    const w = winRef.current;
    w.isMaximized().then(setIsMaximized).catch(() => {});
    let unlisten: (() => void) | null = null;
    w.onResized(async () => {
      setIsMaximized(await w.isMaximized().catch(() => false));
    }).then((u) => { unlisten = u; }).catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  // Quick open file / folder (same dialogs as the hamburger/native menu) — a
  // frequently-used pair, surfaced as icons next to the menu.
  const onOpenFile = useCallback(async () => {
    try {
      const sel = await open({ multiple: false, filters: buildOpenDialogFilters() });
      if (typeof sel === "string") await openFile(sel);
    } catch (err) {
      showToast(t("toast.openFailed", { err: String(err) }));
    }
  }, [openFile, showToast, t]);
  const onOpenFolder = useCallback(async () => {
    try {
      const sel = await open({ directory: true, multiple: false });
      if (typeof sel === "string") setFolder(sel);
    } catch (err) {
      showToast(t("toast.folderOpenFailed", { err: String(err) }));
    }
  }, [setFolder, showToast, t]);

  // New document: same as the hamburger's "새 문서…" (starts editing an unnamed temp doc).
  const onNewFile = useCallback(() => {
    void createNewFileViaDialog();
  }, []);

  // Toggle edit/view. Mirrors AppShell's ⌘E flow (auto-save/confirm guard).
  const onToggleEdit = useCallback(async () => {
    const st = useAppStore.getState();
    // Not editable if it isn't a text document, e.g. PDF (currentContent===null).
    if (!st.currentFile || st.currentContent == null) return;
    if (!(await st.maybeSaveBeforeLeave())) return;
    st.setEditMode(!st.editMode);
  }, []);

  // Unnamed scratch docs show "제목 없는 문서" instead of their (internal) temp file name.
  const isUntitled = !!untitledPath && currentFile === untitledPath;
  const fileName = isUntitled ? t("common.untitled") : currentFile ? baseName(currentFile) : "";

  // Immediate parent folder name shown inline before the filename (e.g. "notes\README.md").
  // One level only — disambiguates same-named files without cluttering the title bar.
  const immediateFolder = !isUntitled && currentFile ? baseName(parentDir(currentFile)) || null : null;

  // Document stats shown next to the filename (token count for AI-dev workflows).
  // Heuristic is instant; the exact BPE count loads lazily and replaces it.
  const stats = useMemo(() => computeTextStats(currentContent ?? ""), [currentContent]);
  const [exactTokens, setExactTokens] = useState<number | null>(null);
  useEffect(() => {
    setExactTokens(null);
    const text = currentContent;
    if (!text) return;
    let alive = true;
    // Defer slightly so a quick file-switch doesn't tokenize intermediate state.
    const t = setTimeout(() => {
      countTokensExact(text, "o200k")
        .then((n) => alive && setExactTokens(n))
        .catch(() => {
          /* tokenizer chunk failed → keep heuristic */
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [currentContent]);

  // File metadata for the filename hover tooltip (full path + created/modified).
  const [meta, setMeta] = useState<FileMeta | null>(null);
  useEffect(() => {
    if (!currentFile) {
      setMeta(null);
      return;
    }
    let alive = true;
    invoke<FileMeta>("file_meta", { path: currentFile })
      .then((m) => alive && setMeta(m))
      .catch(() => alive && setMeta(null));
    return () => {
      alive = false;
    };
    // Re-fetch on content change too (save / external reload / checkbox toggle)
    // so the modified time stays fresh — keying on currentFile alone left it stale.
  }, [currentFile, currentContent]);

  const fileInfo = currentFile
    ? [
        currentFile,
        fmtDate(meta?.created_ms ?? null) &&
          t("topbar.created", { date: fmtDate(meta!.created_ms) ?? "" }),
        fmtDate(meta?.modified_ms ?? null) &&
          // Hide the relative suffix when the file hasn't actually been modified
          // since creation (modified ≈ created, within 2s) — "(방금 전)" there is
          // just noise duplicating the 생성 line.
          t("topbar.modified", {
            date: fmtDate(meta!.modified_ms) ?? "",
            suffix:
              meta?.created_ms != null && Math.abs(meta.modified_ms! - meta.created_ms) < 2000
                ? ""
                : relativeSuffix(meta!.modified_ms),
          }),
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  // `favorites` is referenced so the star re-renders when the set changes.
  const fileFavorited = currentFile ? favorites.some((f) => f.path === currentFile) : false;
  void isFavorite;

  const toggleSidebar = useCallback(() => {
    setSettings({ sidebar_open: !settings.sidebar_open });
    saveSettings();
  }, [settings.sidebar_open, setSettings, saveSettings]);

  const toggleOutline = useCallback(() => {
    setSettings({ outline_open: !settings.outline_open });
    saveSettings();
  }, [settings.outline_open, setSettings, saveSettings]);

  return (
    <div
      data-tauri-drag-region
      className="topbar no-print flex items-center gap-1 px-2 h-11 shrink-0 select-none"
      style={{
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
        // macOS: the title bar is an overlay (titleBarStyle "Overlay"), so the
        // traffic-light buttons float over our bar's top-left. Pad left to clear
        // them with an ergonomic gap (~13pt past the green button's right edge)
        // so the first icon's hit area can't be mis-clicked for a window control.
        // No-op on Windows/Linux (native title bar sits above this bar).
        paddingLeft: isMac ? 92 : undefined,
      }}
    >
      <HamburgerMenu />

      <button
        onClick={toggleSidebar}
        className={`icon-btn ${settings.sidebar_open ? "is-active" : ""}`}
        data-tooltip={t("menu.toggleSidebar", { mod: MOD_LABEL })}
      >
        <PanelLeft size={18} />
      </button>

      <div className="w-px h-4 mx-0.5 shrink-0" style={{ background: "var(--border)" }} />

      {/* Frequently-used quick actions: open file / open folder / new doc. */}
      <button onClick={onOpenFile} className="icon-btn" data-tooltip={t("topbar.openFileTooltip", { mod: MOD_LABEL })}>
        <FileText size={18} />
      </button>
      <button onClick={onOpenFolder} className="icon-btn" data-tooltip={t("topbar.openFolderTooltip", { mod: MOD_LABEL })}>
        <FolderOpen size={18} />
      </button>
      <button onClick={onNewFile} className="icon-btn" data-tooltip={t("topbar.newFileTooltip", { mod: MOD_LABEL })}>
        <FilePlus size={18} />
      </button>

      <div className="w-px h-4 mx-0.5 shrink-0" style={{ background: "var(--border)" }} />

      {/* Document navigation history (#26): browser/IDE-style back/forward. */}
      <button
        onClick={() => void goBack()}
        disabled={!canGoBack}
        className="icon-btn"
        data-tooltip={t("topbar.goBack", { mod: MOD_LABEL })}
      >
        <ArrowLeft size={18} />
      </button>
      <button
        onClick={() => void goForward()}
        disabled={!canGoForward}
        className="icon-btn"
        data-tooltip={t("topbar.goForward", { mod: MOD_LABEL })}
      >
        <ArrowRight size={18} />
      </button>

      {/* Edit/view + Focus mode — moved right next to the document navigation arrows.
          Only meaningful when a file is open, so guarded by currentFile. */}
      {currentFile && currentContent != null && (
        <>
          <div className="w-px h-4 mx-0.5 shrink-0" style={{ background: "var(--border)" }} />
          <button
            onClick={onToggleEdit}
            className={`icon-btn ${editMode ? "is-active" : ""}`}
            data-tooltip={
              editMode
                ? t("topbar.viewModeTooltip", { mod: MOD_LABEL })
                : t("topbar.editModeTooltip", { mod: MOD_LABEL })
            }
          >
            <Pencil size={18} />
          </button>
        </>
      )}

      <div
        data-tauri-drag-region
        className="flex-1 flex items-center justify-center min-w-0 px-2 gap-1.5"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
        {fileName && (
          <>
            {/* The favorite button must be no-drag to be clickable */}
            <button
              onClick={() => currentFile && toggleFavorite(currentFile, false)}
              className={`icon-btn !p-1 ${fileFavorited ? "is-active" : ""}`}
              data-tooltip={fileFavorited ? t("topbar.unfavorite") : t("topbar.favorite")}
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <Star size={14} fill={fileFavorited ? "currentColor" : "none"} />
            </button>
            {/* File name: no-drag + tooltip attached to the text only, so the path/date tooltip shows only over the name */}
            <span
              className="relative max-w-xs cursor-default"
              data-tooltip={fileInfo || undefined}
              data-tooltip-multiline={fileInfo ? "" : undefined}
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <span className="block truncate" style={{ color: "var(--fg)" }}>
                {immediateFolder && (
                  <span className="text-[12px]" style={{ color: "var(--fg-secondary)" }}>
                    {immediateFolder} /
                  </span>
                )}
                <span className="text-[16px]" style={{ color: "var(--accent)" }}>{fileName}</span>
              </span>
            </span>
            {currentContent != null && (
              <span
                className="relative shrink-0 text-[11px] tabular-nums whitespace-nowrap cursor-default"
                style={{ color: "var(--fg)", pointerEvents: "none" }}
              >
                {/* Reserve the token slot from the start (heuristic width, hidden)
                    so the exact value fades in WITHOUT shifting the layout — no
                    number jump (exact-only) and no width jump (space reserved). */}
                <span className={exactTokens != null ? "transition-opacity duration-150" : "invisible"}>
                  {t("topbar.tokenCount", { n: (exactTokens ?? stats.tokens).toLocaleString() })} ·{" "}
                </span>
                {t("topbar.wordCount", { n: stats.words.toLocaleString() })} · {t("topbar.charCount", { n: stats.chars.toLocaleString() })}
              </span>
            )}
            {reloadedFlash && (
              <span
                className="shrink-0 flex items-center gap-1 text-[11px] animate-fade-in"
                style={{ color: "var(--accent)", pointerEvents: "none" }}
                title={t("topbar.externalChangeApplied")}
              >
                <RefreshCw size={11} />
                {t("topbar.updated")}
              </span>
            )}
            {currentContent != null &&
              AI_TASK_GROUPS.map((g) => <AiTaskDropdown key={g.id} group={g} />)}
          </>
        )}
      </div>

      {/* Zoom group */}
      <div className="flex items-center rounded-md" style={{ background: "var(--hover)" }}>
        <button onClick={() => setZoom(zoom - 0.1)} className="icon-btn" data-tooltip={t("menu.zoomOut", { mod: MOD_LABEL })}>
          <Minus size={15} />
        </button>
        <button
          onClick={() => setZoom(1.0)}
          className="text-[12px] tabular-nums px-0.5 rounded transition-colors min-w-9 text-center"
          style={{ color: zoom !== 1.0 ? "var(--fg-secondary)" : "var(--muted)" }}
          data-tooltip={t("topbar.zoomResetTooltip", { mod: MOD_LABEL })}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={() => setZoom(zoom + 0.1)} className="icon-btn" data-tooltip={t("topbar.zoomInTooltip", { mod: MOD_LABEL })}>
          <Plus size={15} />
        </button>
      </div>

      {/* Focus mode — moved to the right of zoom in/out. Only meaningful when a file is open, so guarded. */}
      {currentFile && (
        <button
          onClick={() => setFocusMode(!focusMode)}
          className={`icon-btn ${focusMode ? "is-active" : ""}`}
          data-tooltip={t("menu.focusMode", { mod: MOD_LABEL })}
        >
          <Maximize2 size={18} />
        </button>
      )}

      <div className="w-px h-4 mx-1 shrink-0" style={{ background: "var(--border)" }} />

      <button onClick={() => setSearchOpen(true)} className="icon-btn" data-tooltip={t("menu.search", { mod: MOD_LABEL })}>
        <Search size={18} />
      </button>

      <button
        onClick={toggleOutline}
        className={`icon-btn ${settings.outline_open ? "is-active" : ""}`}
        data-tooltip={t("menu.toggleOutline")}
        data-tooltip-align="end"
      >
        <List size={18} />
      </button>

      {/* Windows window control buttons */}
      {isWindows && winRef.current && (
        <>
          <div className="w-px h-4 mx-1 shrink-0" style={{ background: "var(--border)" }} />
          <div
            className="flex items-stretch h-full shrink-0"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <WinBtn onClick={() => winRef.current!.minimize()} title={t("topbar.minimize")}>
              <Minus size={11} />
            </WinBtn>
            <WinBtn onClick={() => winRef.current!.toggleMaximize()} title={isMaximized ? t("topbar.restore") : t("topbar.maximize")}>
              {isMaximized ? (
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.1">
                  <rect x="3" y="1" width="7" height="7" />
                  <polyline points="1,3 1,10 8,10" />
                </svg>
              ) : (
                <Square size={10} strokeWidth={1.3} />
              )}
            </WinBtn>
            <WinBtn onClick={() => winRef.current!.close()} title={t("common.close")} isClose>
              <X size={11} />
            </WinBtn>
          </div>
        </>
      )}
    </div>
  );
}
