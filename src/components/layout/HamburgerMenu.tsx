import { useState, useRef, useEffect, useCallback } from "react";
import { Menu, FileText, FilePlus, Save, FolderOpen, FolderSearch, Folder, Clock, Settings, Info, Trash2, GitCompare, SquareArrowOutUpRight, BookOpen, FileType, ClipboardCopy, Download, ChevronRight, LayoutList } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store/app";
import { createNewFileViaDialog, saveCurrentFileAs } from "../../lib/newFile";
import { buildOpenDialogFilters } from "../../lib/fileType";
import { parentDir, joinPath } from "../../lib/pathUtil";
import { exportPdf, copyAsHtml } from "../../lib/export";
import { exportDocx } from "../../lib/convert";
import { AI_TASK_GROUPS, runDocumentTask, tasksInGroup, type AiTaskGroup } from "../../lib/aiTasks";
import { openManual } from "../../lib/manual";
import { useT } from "../../lib/i18n";
import { isMac } from "../../lib/platform";

export function HamburgerMenu() {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState<AiTaskGroup | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { recentFiles, currentFile, currentFolder, currentContent, openFile, setFolder, showToast, loadRecent, openRecent, setSettingsOpen, setAboutOpen, setQuickOpenMode } =
    useAppStore();

  const handleOpenBacklogDashboard = useCallback(() => {
    setIsOpen(false);
    const base = currentFolder ?? (currentFile ? parentDir(currentFile) : null);
    if (!base) {
      showToast(t("hamburgerMenu.backlogNoFolder"));
      return;
    }
    invoke("open_dashboard_window", { backlogPath: joinPath(base, "BACKLOG.md") }).catch((e) =>
      showToast(t("hamburgerMenu.backlogDashboardOpenFailed", { err: String(e) }))
    );
  }, [currentFolder, currentFile, showToast, t]);

  const handleRunTask = useCallback(async (taskId: string) => {
    setIsOpen(false);
    setAiOpen(null);
    await runDocumentTask(taskId);
  }, []);

  const handleOpenManual = useCallback(async () => {
    setIsOpen(false);
    await openManual();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!isOpen) { setExportOpen(false); setAiOpen(null); }
  }, [isOpen]);

  const handleOpenFile = useCallback(async () => {
    setIsOpen(false);
    try {
      const selected = await open({ multiple: false, filters: buildOpenDialogFilters() });
      if (typeof selected === "string") await openFile(selected);
    } catch (e) {
      showToast(t("toast.openFailed", { err: String(e) }));
    }
  }, [openFile, showToast, t]);

  const handleOpenFolder = useCallback(async () => {
    setIsOpen(false);
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") setFolder(selected);
    } catch (e) {
      showToast(t("toast.folderOpenFailed", { err: String(e) }));
    }
  }, [setFolder, showToast, t]);

  const handleNewFile = useCallback(async () => {
    setIsOpen(false);
    await createNewFileViaDialog();
  }, []);

  const handleSaveAs = useCallback(async () => {
    setIsOpen(false);
    await saveCurrentFileAs();
  }, []);

  const handleOpenInNewWindow = useCallback(async () => {
    setIsOpen(false);
    if (!currentFile) return;
    try {
      await invoke("open_in_new_window", { path: currentFile });
    } catch (e) {
      showToast(t("commandPalette.openInNewWindowFailed", { err: String(e) }));
    }
  }, [currentFile, showToast, t]);

  const handleRevealInFinder = useCallback(async () => {
    setIsOpen(false);
    if (!currentFile) return;
    try {
      await revealItemInDir(currentFile);
    } catch (e) {
      showToast(
        isMac
          ? t("hamburgerMenu.revealInFinderFailed", { err: String(e) })
          : t("hamburgerMenu.revealInExplorerFailed", { err: String(e) })
      );
    }
  }, [currentFile, showToast, t]);

  const handleClearRecent = useCallback(async () => {
    await invoke("clear_recent_files");
    await loadRecent();
    setIsOpen(false);
  }, [loadRecent]);

  // Export (moved from the top bar into the hamburger). Reuses the same lib functions as ExportMenu.
  const handleExportPdf = useCallback(() => {
    setIsOpen(false);
    // Delay slightly so the print panel captures the page after the menu has closed.
    setTimeout(exportPdf, 50);
  }, []);

  const handleExportDocx = useCallback(() => {
    setIsOpen(false);
    if (currentFile) exportDocx(currentFile);
  }, [currentFile]);

  const handleCopyHtml = useCallback(async () => {
    setIsOpen(false);
    const body = document.querySelector<HTMLElement>(".md-body");
    if (!body) return;
    try {
      await copyAsHtml(body, currentContent ?? "");
      showToast(t("hamburgerMenu.htmlCopySuccess"));
    } catch {
      showToast(t("editor.copyFailed"));
    }
  }, [currentContent, showToast, t]);

  const itemClass =
    "row-hover flex items-center gap-2.5 w-full px-2.5 h-8 text-[13px] rounded-md text-left";

  return (
    <div ref={menuRef} className="relative no-print">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="icon-btn"
        data-tooltip={t("hamburgerMenu.tooltip")}
      >
        <Menu size={17} />
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-10 z-50 w-60 rounded-[10px] py-1.5 px-1.5"
          style={{ background: "var(--bg)", boxShadow: "var(--shadow-popover)" }}
        >
          <button onClick={handleOpenFile} className={itemClass}>
            <FileText size={14} style={{ color: "var(--muted)" }} />
            {t("hamburgerMenu.openFile")}
          </button>
          <button onClick={handleOpenFolder} className={itemClass}>
            <FolderOpen size={14} style={{ color: "var(--muted)" }} />
            {t("hamburgerMenu.openFolder")}
          </button>
          <button onClick={handleNewFile} className={itemClass}>
            <FilePlus size={14} style={{ color: "var(--muted)" }} />
            {t("hamburgerMenu.newFile")}
          </button>

          {/* ── Current-document actions group (only when a document is open) ── */}
          {currentFile && (
            <div className="my-1.5 -mx-1.5 border-t" style={{ borderColor: "var(--border)" }} />
          )}
          {currentContent != null && (
            <button onClick={handleSaveAs} className={itemClass}>
              <Save size={14} style={{ color: "var(--muted)" }} />
              {t("hamburgerMenu.saveAs")}
            </button>
          )}

          {/* Export (flyout) — right below Save As. Expands sideways on hover. */}
          {currentContent != null && (
            <div
              className="relative"
              onMouseEnter={() => setExportOpen(true)}
              onMouseLeave={() => setExportOpen(false)}
            >
              <button
                onClick={() => setExportOpen(true)}
                className={itemClass}
                aria-haspopup="menu"
                aria-expanded={exportOpen}
              >
                <Download size={14} style={{ color: "var(--muted)" }} />
                {t("hamburgerMenu.export")}
                <ChevronRight size={13} className="ml-auto" style={{ color: "var(--muted)" }} />
              </button>
              {exportOpen && (
                <div
                  className="absolute left-full top-0 ml-1 z-50 w-52 rounded-[10px] py-1.5 px-1.5"
                  style={{ background: "var(--bg)", boxShadow: "var(--shadow-popover)" }}
                  role="menu"
                >
                  <button onClick={handleExportPdf} className={itemClass}>
                    <FileText size={14} style={{ color: "var(--muted)" }} />
                    {t("hamburgerMenu.exportPdf")}
                  </button>
                  <button onClick={handleExportDocx} className={itemClass}>
                    <FileType size={14} style={{ color: "var(--muted)" }} />
                    Word (DOCX)
                  </button>
                  <button onClick={handleCopyHtml} className={itemClass}>
                    <ClipboardCopy size={14} style={{ color: "var(--muted)" }} />
                    {t("hamburgerMenu.exportHtml")}
                  </button>
                </div>
              )}
            </div>
          )}

          {currentFile && (
            <button onClick={handleRevealInFinder} className={itemClass}>
              <FolderSearch size={14} style={{ color: "var(--muted)" }} />
              {isMac ? t("hamburgerMenu.revealInFinder") : t("hamburgerMenu.revealInExplorer")}
            </button>
          )}
          {currentFile && (
            <button onClick={handleOpenInNewWindow} className={itemClass}>
              <SquareArrowOutUpRight size={14} style={{ color: "var(--muted)" }} />
              {t("commandPalette.openInNewWindow")}
            </button>
          )}
          {currentContent != null && (
            <button
              onClick={() => {
                setIsOpen(false);
                // Open QuickOpen in compare mode to pick the target document (#27).
                setQuickOpenMode("compare");
              }}
              className={itemClass}
            >
              <GitCompare size={14} style={{ color: "var(--muted)" }} />
              {t("hamburgerMenu.compareDocument")}
            </button>
          )}

          {/* AI task submenu — one flyout per group (translate/summarize). Items are picked
              by group from the registry (same layout as the top bar popup). New tasks show up automatically. */}
          {currentContent != null &&
            AI_TASK_GROUPS.map((g) => {
              const Icon = g.icon;
              return (
                <div key={g.id} className="relative"
                     onMouseEnter={() => setAiOpen(g.id)}
                     onMouseLeave={() => setAiOpen(null)}>
                  <button onClick={() => setAiOpen(g.id)} className={itemClass}
                          aria-haspopup="menu" aria-expanded={aiOpen === g.id}>
                    <Icon size={14} style={{ color: "var(--muted)" }} />
                    {t(g.labelKey)}
                    <ChevronRight size={13} className="ml-auto" style={{ color: "var(--muted)" }} />
                  </button>
                  {aiOpen === g.id && (
                    <div className="absolute left-full top-0 ml-1 z-50 w-44 rounded-[10px] py-1.5 px-1.5"
                         style={{ background: "var(--bg)", boxShadow: "var(--shadow-popover)" }} role="menu">
                      {tasksInGroup(g.id).map((task) => (
                        <button key={task.id} onClick={() => void handleRunTask(task.id)} className={itemClass}>
                          {t(task.labelKey)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

          <button onClick={handleOpenBacklogDashboard} className={itemClass}>
            <LayoutList size={14} style={{ color: "var(--muted)" }} />
            {t("hamburgerMenu.backlogDashboard")}
          </button>

          <div
            className="my-1.5 -mx-1.5 border-t"
            style={{ borderColor: "var(--border)" }}
          />
          <button onClick={handleOpenManual} className={itemClass}>
            <BookOpen size={14} style={{ color: "var(--muted)" }} />
            {t("menu.manual")}
          </button>
          <button
            onClick={() => {
              setIsOpen(false);
              setSettingsOpen(true);
            }}
            className={itemClass}
          >
            <Settings size={14} style={{ color: "var(--muted)" }} />
            {t("hamburgerMenu.settings")}
          </button>
          <button
            onClick={() => {
              setIsOpen(false);
              setAboutOpen(true);
            }}
            className={itemClass}
          >
            <Info size={14} style={{ color: "var(--muted)" }} />
            {t("hamburgerMenu.about")}
          </button>

          {/* Recent — a list of uneven length, so it goes at the very bottom. This keeps
              the fixed items above (Settings, About) always in the same place. */}
          {recentFiles.length > 0 && (
            <>
              <div className="my-1.5 -mx-1.5 border-t" style={{ borderColor: "var(--border)" }} />
              <div className="flex items-center justify-between px-2.5 py-1">
                <span className="text-[11px] font-medium" style={{ color: "var(--muted)" }}>
                  {t("welcome.recent")}
                </span>
                <button onClick={handleClearRecent} className="icon-btn !p-1" title={t("hamburgerMenu.clearRecentTooltip")}>
                  <Trash2 size={11} />
                </button>
              </div>
              {recentFiles.slice(0, 10).map((f) => (
                <button
                  key={f.path}
                  onClick={() => {
                    void openRecent(f.path, f.is_dir);
                    setIsOpen(false);
                  }}
                  className={itemClass}
                >
                  {f.is_dir ? (
                    <Folder size={12} className="shrink-0" style={{ color: "var(--muted)" }} />
                  ) : (
                    <Clock size={12} className="shrink-0" style={{ color: "var(--muted)" }} />
                  )}
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
