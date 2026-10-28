import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { ask, save } from "@tauri-apps/plugin-dialog";
import type { AppSettings, RecentFile, HeadingItem, FavoriteItem, Bookmark, ContextFile, ClaudeAsset, Backlink, ChangeKind } from "../types";
import { DEFAULT_CONTEXT_WINDOW } from "../lib/contextTokens";
import { clearHistory as clearEditHistory } from "../lib/editHistory";
import { decideExternalChange } from "../lib/externalChange";
import { remapUnderRename, isPathAtOrUnder } from "../lib/pathUtil";
import { opensInFrame } from "../lib/fileType";
import { t } from "../lib/i18n";
import { errorMessage } from "../lib/i18n/errorMessage";
import {
  emptyNav,
  pushEntry,
  goBack as navGoBack,
  goForward as navGoForward,
  canGoBack as navCanGoBack,
  canGoForward as navCanGoForward,
  type NavState,
} from "../lib/navHistory";

/** Return a copy of `obj` without `key` (immutable delete for change-badge map). */
function omitKey<V>(obj: Record<string, V>, key: string): Record<string, V> {
  if (!(key in obj)) return obj;
  const next = { ...obj };
  delete next[key];
  return next;
}

interface AppState {
  // file
  currentFile: string | null;
  currentContent: string | null;
  // navigation
  currentFolder: string | null;
  // ui
  settings: AppSettings;
  recentFiles: RecentFile[];
  headings: HeadingItem[];
  activeHeadingId: string | null;
  searchQuery: string;
  searchOpen: boolean;
  // zoom
  zoom: number;
  // favorites & bookmarks
  favorites: FavoriteItem[];
  bookmarks: Bookmark[];
  // context documents auto-detected under the current folder (feature C)
  contextFiles: ContextFile[];
  // skills/agents/commands discovered under the open project's .claude/ dir
  claudeAssets: ClaudeAsset[];
  // multi-select for the sum-token gauge (feature D): absolute paths the user
  // has checked in the 컨텍스트 섹션. The gauge shows only when 2+ are selected.
  selectedContextPaths: string[];
  // conversion / settings UI
  settingsOpen: boolean;
  aboutOpen: boolean;
  /** Whether the default-.md-app notice banner is shown (App.tsx decides and turns it on at startup). */
  defaultAppBannerOpen: boolean;
  // Command palette (⌘K): global overlay to fuzzy-search and run every action.
  paletteOpen: boolean;
  // Focus mode: hides chrome (top bar, sidebar, etc.) and shows only the body (reading/presenting).
  focusMode: boolean;
  converting: boolean;
  translating: boolean;
  // Progress (current/total) when translating a long document in chunks. null for a single chunk.
  translateProgress: { cur: number; total: number } | null;
  pandocDownloading: boolean;
  updateInfo: { version: string; notes: string } | null;
  updateInstalled: boolean;
  // simple edit mode (#22)
  editMode: boolean;
  editContent: string;
  isDirty: boolean;
  // one-shot scroll ratio (0–1) handed between view↔edit on mode switch so the
  // visible position is preserved across the transition. null = none pending.
  // Mode-switch (view↔edit) scroll transfer: the source line at the viewport
  // top (line-anchor) plus a ratio fallback. Captured live on scroll.
  transferScroll: { line: number; ratio: number } | null;
  // external file-change handling
  externalChanged: boolean; // notify-only mode: open file changed on disk
  fileMissing: boolean; // open file was deleted/moved
  reloadedFlash: boolean; // transient "updated" badge after an auto-reload
  // folder change feed: absolute paths of files changed on disk since the folder was opened
  changedFiles: Record<string, ChangeKind>; // path → kind (created/modified)
  // Baseline for the AI change review center (killer #1): path → content the app "first saw" for that file.
  // Used as the diff's before (the version the user last knew); current disk content is the after.
  // Captured at only two points: ① right after the read in openFile (preserves the first-opened version),
  // ② just before an external change is applied to the current buffer (preserves the old currentContent). Read-only.
  reviewBaseline: Record<string, string>;
  // Whether the change review center modal is shown.
  reviewOpen: boolean;
  // backlinks (feature F / #10): files in the current folder that reference the
  // open document via `[[…]]`. Scanned on-demand (once per opened file) and
  // cached by absolute path so reopening the same file doesn't rescan.
  backlinks: Backlink[];
  backlinksTruncated: boolean;
  // After a wikilink with `#heading` opens a file (#9), this holds the target
  // heading text so the viewer can scroll to the matching heading once the new
  // content renders, then clear it. null = no pending scroll.
  pendingWikiHeading: string | null;
  // Document navigation history (#26): browser/IDE-style 뒤로/앞으로 across the
  // single-document focus. `nav` is the pure stack (see lib/navHistory); the
  // `canGoBack`/`canGoForward` mirrors are derived on each openFile so selectors
  // re-render the TopBar buttons without recomputing.
  nav: NavState;
  canGoBack: boolean;
  canGoForward: boolean;
  // On-demand two-document compare (#27): a unified (1-column) line diff between
  // the current document and one the user picks. `compareWith` is the chosen
  // file's absolute path (null = not comparing); `compareContent` is its loaded
  // text. Entered explicitly, exited on open/edit so it never lingers.
  compareWith: string | null;
  compareContent: string | null;
  // AI task result view: original on the left / result on the right (review, improve, summarize, translate). null = hidden.
  // taskId = key in the aiTasks registry. View-only (not saved) — cleared on file switch or entering edit mode.
  taskDoc: { taskId: string; content: string } | null;
  // Whether the AI task result split view (shared by review/improve/summarize/translate) is in text (edit) mode.
  // When true, both panes are textareas. Toggled with ⌘E.
  translationRaw: boolean;
  // QuickOpen reuse mode: 'open' (default) opens the picked file, 'compare'
  // starts a compare against it. Reset to 'open' when QuickOpen closes.
  quickOpenMode: "open" | "compare";
  // Bumped to ask the file tree to re-list (e.g. after creating a new file),
  // since tree nodes load their children lazily and won't otherwise refresh.
  treeRefreshNonce: number;
  // Path of a just-created blank document that hasn't gained real content yet.
  // If the user leaves it (opens another file) without typing anything, it's
  // deleted from disk so abandoned/mis-clicked "새 문서.md" files don't pile up.
  // Cleared the moment non-empty content is saved (then it's a real document).
  pendingNewFile: string | null;
  // Temp-file path of the current UNNAMED scratch document (제목 없는 문서), or null
  // when the open doc is a normal saved file. A new doc (⌘N) starts as one of these:
  // it auto-saves into the temp file, and only on 저장 / leaving-with-content does a
  // name+location dialog turn it into a real file (commitUntitled). currentFile holds
  // the temp path while this is set, so isUntitled ⇔ currentFile === untitledPath.
  untitledPath: string | null;

  // actions
  // `fromHistory` marks a back/forward navigation so it doesn't itself get
  // pushed onto the stack (only index moves). Omit it for normal opens.
  openFile: (path: string, opts?: { fromHistory?: boolean }) => Promise<void>;
  // Open a recent entry; if it no longer exists, toast and prune it from the
  // recents (get_recent_files filters out missing paths on reload). Lazy cleanup
  // so a recreated file/folder stays in the list until you actually click a dead one.
  openRecent: (path: string, isDir: boolean) => Promise<void>;
  // Navigate one document back/forward. No-op at the respective boundary.
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  // Enter compare mode against `path`: read the file and stash it as the
  // target (other) document. No-op (with a toast) when there's no current document
  // or the read fails. base = currentContent, other = compareContent.
  startCompare: (path: string) => Promise<void>;
  // Leave compare mode (back to the single view). Safe to call when not comparing.
  exitCompare: () => void;
  setQuickOpenMode: (mode: "open" | "compare") => void;
  // Ask the file tree to re-list its (open) directories.
  bumpTreeRefresh: () => void;
  // Mark `path` as the pending blank new document (or clear with null). Set by
  // the new-file flow right after creation; consumed by discardPendingNewFileIfEmpty.
  markPendingNewFile: (path: string | null) => void;
  // Open `tempPath` (from create_untitled_file) as a fresh unnamed scratch doc in
  // edit mode. No recents/nav pollution — the temp path isn't a real document yet.
  enterUntitled: (tempPath: string) => void;
  // Name+save the current unnamed doc via a dialog, write it to the chosen path,
  // remove the temp file, and switch the open document to the real file (preserving
  // edit mode). Returns false if the user cancels the dialog or the write fails.
  commitUntitled: () => Promise<boolean>;
  // Throw away the current unnamed doc's temp file and clear the flag (used when an
  // empty scratch doc is abandoned). Safe no-op when there's no untitled doc.
  discardUntitled: () => Promise<void>;
  // If a pending blank new file is set (and isn't `exceptPath`), delete it from
  // disk when it's still empty, then clear the pending marker. The Rust side only
  // removes a genuinely empty file, so a doc that gained content is never lost.
  discardPendingNewFileIfEmpty: (exceptPath?: string) => Promise<void>;
  // Resolve a `[[target]]` wikilink (feature E / #9) against the current folder
  // and open the matching file. `heading` (from `[[target#heading]]`) is passed
  // through so the viewer can scroll to it after the file renders. Shows a toast
  // when nothing matches.
  openWikiLink: (target: string, heading: string | null) => Promise<void>;
  // Scan the current folder for files referencing the open document (#10). Lazy
  // + cached: a no-op when there's no open file/folder; reuses a cached result
  // for a path already scanned this session.
  scanBacklinks: () => Promise<void>;
  // Clear the staged wikilink heading once the viewer has consumed it (#9).
  clearPendingWikiHeading: () => void;
  // Toggle the index-th task-list checkbox in the open file, persist, and
  // refresh currentContent from the returned new content (triggers re-render).
  toggleTask: (index: number, checked: boolean) => Promise<void>;
  setFolder: (path: string) => void;
  // Scan the current folder for context documents (feature C). Safe no-op when
  // no folder is open. Called automatically by setFolder.
  scanContextFiles: () => Promise<void>;
  // Scan the current folder for .claude/ skills/agents/commands. Safe no-op when
  // no folder is open or no .claude/ dir exists. Called automatically by setFolder.
  scanClaudeAssets: () => Promise<void>;
  // multi-select actions for the sum-token gauge (feature D)
  toggleContextSelection: (path: string) => void;
  clearContextSelection: () => void;
  setSettings: (patch: Partial<AppSettings>) => void;
  saveSettings: () => Promise<void>;
  loadSettings: () => Promise<void>;
  loadRecent: () => Promise<void>;
  setHeadings: (headings: HeadingItem[]) => void;
  setActiveHeading: (id: string | null) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchQuery: (q: string) => void;
  setZoom: (z: number) => void;
  toastMessage: string | null;
  // Optional action button rendered inside the current toast (e.g. 되돌리기).
  // null = a plain message toast. Cleared alongside toastMessage.
  toastAction: { label: string; onAction: () => void } | null;
  // `action` adds a single inline button (label + handler) to the toast; the
  // toast auto-dismisses it after the handler runs. Omit it for a plain toast —
  // every existing caller passes only `msg` and is unaffected.
  showToast: (msg: string, action?: { label: string; onAction: () => void }) => void;
  // favorites
  loadFavorites: () => Promise<void>;
  toggleFavorite: (path: string, isDir: boolean) => Promise<void>;
  reorderFavorites: (paths: string[]) => Promise<void>;
  // Remove all favorites at once, keeping a snapshot for one-tap undo. No-op
  // when the list is already empty.
  clearFavorites: () => Promise<void>;
  isFavorite: (path: string) => boolean;
  // bookmarks (per current file)
  loadBookmarks: (path: string) => Promise<void>;
  toggleBookmark: (h: HeadingItem) => Promise<void>;
  isBookmarked: (headingId: string) => boolean;
  // settings modal & conversion flags
  setSettingsOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
  setDefaultAppBannerOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setFocusMode: (on: boolean) => void;
  setConverting: (v: boolean) => void;
  setTranslating: (v: boolean) => void;
  setTranslateProgress: (p: { cur: number; total: number } | null) => void;
  showTaskResult: (taskId: string, content: string) => void;
  updateTaskContent: (content: string) => void;
  closeTaskResult: () => void;
  toggleTranslationRaw: () => void;
  setPandocDownloading: (v: boolean) => void;
  setUpdateInfo: (info: { version: string; notes: string } | null) => void;
  setUpdateInstalled: (v: boolean) => void;
  // simple edit mode (#22)
  setEditMode: (on: boolean) => void;
  setEditContent: (s: string) => void;
  // Reflect a fresh disk content into the editor buffer (used when the open file
  // changes externally while editing and there are no unsaved edits to lose).
  applyDiskContent: (content: string) => void;
  // `silent` suppresses the "저장되었습니다" toast — used by auto-save so it
  // doesn't spam a toast on every idle flush. Manual ⌘S/버튼 stays loud.
  saveFile: (opts?: { silent?: boolean }) => Promise<void>;
  // Called before leaving the edit buffer (mode switch or file switch) while
  // dirty. Returns true if it's OK to proceed. With auto-save ON and no external
  // conflict, it silently saves (undo can revert, so no confirm needed). On a
  // conflict, auto-save off, or save failure, it asks the user instead.
  maybeSaveBeforeLeave: () => Promise<boolean>;
  setTransferScroll: (t: { line: number; ratio: number } | null) => void;
  // external file-change handling
  setExternalChanged: (v: boolean) => void;
  setFileMissing: (v: boolean) => void;
  flashReloaded: () => void;
  // Called by the open-file watcher (view AND edit mode). Reads disk, then routes
  // per decideExternalChange: reload view / reflect clean editor / flag conflict /
  // flag missing. Never overwrites unsaved edits; recovers when a deleted file is
  // recreated with the same name.
  refreshOpenFileFromDisk: () => Promise<void>;
  // Edit-mode conflict resolution: discard unsaved edits and load disk content.
  discardEditsReload: () => Promise<void>;
  // Recovery for a deleted open file: write the current buffer back to recreate it.
  recreateOpenFile: () => Promise<void>;
  // folder change feed
  markChanged: (path: string, kind: ChangeKind) => void;
  clearChanged: (path: string) => void;
  clearAllChanged: () => void;
  // AI change review center (killer #1).
  setReviewOpen: (v: boolean) => void;
  // "모두 확인" (confirm all): clears the change list (baseline is kept — reused as the reference for the next change).
  clearAllChanges: () => void;
  // After a rename in the explorer (file or folder), reconcile app state: update the favorite path,
  // refresh recents (get_recent_files filters out vanished paths), and if the open document is at that
  // path (or under the folder), follow it to the new path. A folder rename remaps child paths too.
  notifyPathRenamed: (oldPath: string, newPath: string, isDir: boolean) => Promise<void>;
  // After moving to the trash from the explorer (file or folder), reconcile app state: remove from favorites,
  // refresh recents, and close the open document if it is at that path (or under the folder).
  notifyPathDeleted: (path: string, isDir: boolean) => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  language: "system",
  zoom: 1.0,
  sidebar_open: true,
  sidebar_width: 240,
  outline_open: false,
  outline_width: 220,
  window_x: null,
  window_y: null,
  window_width: 1200,
  window_height: 800,
  last_folder: null,
  show_non_md: true,
  favorites_height: 192,
  context_height: 180,
  skills_height: 320,
  shelf_height: 220,
  auto_reload: true,
  auto_save: true,
  context_patterns: ["CLAUDE.md", "AGENTS.md", "SKILL.md", "README.md", "CONTEXT.md", "spec.md", "*.spec.md", "plan*.md", "*.plan.md"],
  context_window: DEFAULT_CONTEXT_WINDOW,
  content_font: "pretendard" as const,
  md_only_folders: false,
  claude_cli_path: null,
  update_check_enabled: false,
  update_check_prompted: false,
  default_app_prompt_at: null,
};

// Session-level backlink cache (feature F / #10): maps an absolute file path to
// its last scan result so reopening the same document doesn't trigger another
// full-folder scan. Lives outside zustand state — it's a pure memoization layer,
// not UI state. Cleared implicitly on app restart (no persistence by design,
// matching the "no permanent index" constraint).
const backlinkCache = new Map<string, { links: Backlink[]; truncated: boolean }>();

// Debounce the on-demand backlink scan: opening a file kicks a full-folder scan
// (#10) which is heavy in deep/complex trees. Firing it immediately on every open
// makes rapid file-switching feel laggy (scans pile up and contend with the next
// read_file). We defer ~300ms and cancel if the user moves to another file first,
// so only the file you actually settle on gets scanned. Cached results still show
// instantly via scanBacklinks's own cache.
let backlinkScanTimer: ReturnType<typeof setTimeout> | undefined;

// Auto-dismiss timer for the current toast. Kept module-level so a newer toast
// cancels the previous timer — otherwise an older toast's timeout could clear a
// freshly shown one (and its action button) early.
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useAppStore = create<AppState>((set, get) => ({
  currentFile: null,
  currentContent: null,
  currentFolder: null,
  settings: DEFAULT_SETTINGS,
  recentFiles: [],
  headings: [],
  activeHeadingId: null,
  searchQuery: "",
  searchOpen: false,
  zoom: 1.0,
  favorites: [],
  bookmarks: [],
  contextFiles: [],
  claudeAssets: [],
  selectedContextPaths: [],
  settingsOpen: false,
  aboutOpen: false,
  defaultAppBannerOpen: false,
  paletteOpen: false,
  focusMode: false,
  converting: false,
  translating: false,
  translateProgress: null,
  pandocDownloading: false,
  updateInfo: null,
  updateInstalled: false,
  editMode: false,
  editContent: "",
  isDirty: false,
  transferScroll: null,
  externalChanged: false,
  fileMissing: false,
  reloadedFlash: false,
  changedFiles: {},
  reviewBaseline: {},
  reviewOpen: false,
  backlinks: [],
  backlinksTruncated: false,
  pendingWikiHeading: null,
  nav: emptyNav(),
  canGoBack: false,
  canGoForward: false,
  compareWith: null,
  compareContent: null,
  taskDoc: null,
  translationRaw: false,
  quickOpenMode: "open",
  treeRefreshNonce: 0,
  pendingNewFile: null,
  untitledPath: null,
  toastMessage: null,
  toastAction: null,

  openRecent: async (path: string, isDir: boolean) => {
    const exists = await invoke<boolean>("file_exists", { path }).catch(() => true);
    if (!exists) {
      get().showToast(isDir ? t("store.folderNotFound") : t("store.fileNotFound"));
      await get().loadRecent(); // get_recent_files drops missing paths → entry disappears
      return;
    }
    if (isDir) get().setFolder(path);
    else await get().openFile(path);
  },

  openFile: async (path: string, opts?: { fromHistory?: boolean }) => {
    // Guard unsaved edits before switching files (auto-saves when enabled).
    if (!(await get().maybeSaveBeforeLeave())) return;
    // Leaving a blank, never-typed new document → clean it off disk (unless we're
    // opening that same file). Runs after the save guard so any typed-then-saved
    // content already cleared the pending marker and is preserved.
    await get().discardPendingNewFileIfEmpty(path);
    // PDF/HTML are not read as text via read_file; only the path is kept. FrameViewer
    // shows them through the webview renderer (convertFileSrc) (PDF = native, HTML = rendered like a browser).
    // currentContent === null is the "not a text document" signal → edit, translate,
    // export, outline, etc. are disabled.
    if (opensInFrame(path)) {
      set({
        currentFile: path,
        currentContent: null,
        externalChanged: false,
        fileMissing: false,
        editMode: false,
        isDirty: false,
        editContent: "",
        transferScroll: null,
        compareWith: null,
        compareContent: null,
        taskDoc: null,
        headings: [],
        backlinks: [],
        backlinksTruncated: false,
      });
      if (!opts?.fromHistory) {
        const nav = pushEntry(get().nav, path);
        set({ nav, canGoBack: navCanGoBack(nav), canGoForward: navCanGoForward(nav) });
      }
      await invoke("add_recent_file", { path, isDir: false });
      set({ recentFiles: await invoke<RecentFile[]>("get_recent_files") });
      return;
    }
    try {
      const result = await invoke<{ content: string; encoding: string; path: string }>(
        "read_file",
        { path }
      );
      // Fresh load from disk → drop any prior undo history for this path so undo
      // can't walk the buffer back into a stale (pre-reload) version.
      clearEditHistory(path);
      // A blank/empty doc has nothing to read, so open it straight in edit mode
      // (covers freshly created files and any empty .md); otherwise the read view.
      const isBlank = result.content.trim().length === 0;
      set((state) => ({
        currentFile: path,
        currentContent: result.content,
        // Review baseline capture ①: preserve the content from when this file was first seen (first-opened version).
        // Keep an existing baseline (e.g. the old content was already captured when applying an external change).
        reviewBaseline:
          state.reviewBaseline[path] === undefined
            ? { ...state.reviewBaseline, [path]: result.content }
            : state.reviewBaseline,
        externalChanged: false,
        fileMissing: false,
        editMode: isBlank,
        isDirty: false,
        editContent: isBlank ? result.content : "",
        transferScroll: null, // new file starts at top, not a mode-switch
        // Opening another document always leaves compare mode (the comparison
        // was against the previously-open doc; #27).
        compareWith: null,
        compareContent: null,
        taskDoc: null,

        // user has now seen this file; clear its "changed" badge
        changedFiles: omitKey(state.changedFiles, path),
        // new document → drop the previous file's backlinks until the lazy scan
        // for this one resolves (keeps the panel from showing stale results).
        backlinks: [],
        backlinksTruncated: false,
        // Fixes a bug where the previous file's outline stayed on the new file. For markdown,
        // MarkdownViewer refills it via setHeadings right after rendering (same pattern already used for PDF/HTML).
        headings: [],
      }));
      // Navigation history (#26): record normal opens; back/forward only move
      // the index (handled in goBack/goForward), and pushEntry itself is a no-op
      // when the target equals the current entry (refresh / reloadCurrent), so no
      // extra same-path guard is needed here.
      if (!opts?.fromHistory) {
        const nav = pushEntry(get().nav, path);
        set({ nav, canGoBack: navCanGoBack(nav), canGoForward: navCanGoForward(nav) });
      }
      await invoke("add_recent_file", { path, isDir: false });
      const recent = await invoke<RecentFile[]>("get_recent_files");
      set({ recentFiles: recent });
      get().loadBookmarks(path);
      // Backlink scan (#10): debounced + cancel-on-switch so flicking through a
      // deep folder stays snappy (only the file you land on gets scanned). The
      // session cache makes already-scanned files resolve instantly anyway.
      if (backlinkScanTimer) clearTimeout(backlinkScanTimer);
      backlinkScanTimer = setTimeout(() => {
        if (get().currentFile === path) get().scanBacklinks();
      }, 600);
    } catch (e) {
      get().showToast(t("store.fileOpenFailed", { err: errorMessage(String(e)) }));
      await invoke("write_log", { level: "error", message: `read_file failed: ${e}` });
    }
  },

  openWikiLink: async (target: string, heading: string | null) => {
    const folder = get().currentFolder;
    // Resolve relative to the open document's folder when no explicit root
    // folder is set (e.g. a single file was opened without a folder).
    const base =
      folder ??
      (get().currentFile ? get().currentFile!.replace(/[\\/][^\\/]+$/, "") : null);
    if (!base) {
      get().showToast(t("store.wikiTargetNotFound", { target }));
      return;
    }
    try {
      const resolved = await invoke<string | null>("resolve_wikilink", {
        folder: base,
        target,
      });
      if (!resolved) {
        get().showToast(t("store.wikiTargetNotFound", { target }));
        return;
      }
      // Stage the heading (if any) so the viewer scrolls to it after render.
      set({ pendingWikiHeading: heading });
      await get().openFile(resolved);
    } catch (e) {
      get().showToast(t("store.wikiLinkOpenFailed", { err: String(e) }));
    }
  },

  goBack: async () => {
    const { state, path } = navGoBack(get().nav);
    if (!path) return; // already at the start
    // Commit the index move first so canGoBack/canGoForward update immediately,
    // then open the target without re-pushing it.
    set({ nav: state, canGoBack: navCanGoBack(state), canGoForward: navCanGoForward(state) });
    await get().openFile(path, { fromHistory: true });
  },

  goForward: async () => {
    const { state, path } = navGoForward(get().nav);
    if (!path) return; // already at the end
    set({ nav: state, canGoBack: navCanGoBack(state), canGoForward: navCanGoForward(state) });
    await get().openFile(path, { fromHistory: true });
  },

  startCompare: async (path: string) => {
    // Compare only makes sense with a current document (base = currentContent).
    if (!get().currentFile) {
      get().showToast(t("store.compareNoDocument"));
      return;
    }
    try {
      const result = await invoke<{ content: string; encoding: string; path: string }>(
        "read_file",
        { path }
      );
      set({ compareWith: path, compareContent: result.content, taskDoc: null });
    } catch (e) {
      // Never enter compare on a failed read — just surface the error.
      get().showToast(t("store.compareOpenFailed", { err: errorMessage(String(e)) }));
      await invoke("write_log", { level: "error", message: `compare read_file failed: ${e}` }).catch(() => {});
    }
  },

  exitCompare: () => set({ compareWith: null, compareContent: null }),

  setQuickOpenMode: (mode) => set({ quickOpenMode: mode }),

  bumpTreeRefresh: () => set((s) => ({ treeRefreshNonce: s.treeRefreshNonce + 1 })),

  markPendingNewFile: (path) => set({ pendingNewFile: path }),

  enterUntitled: (tempPath) => {
    clearEditHistory(tempPath);
    set({
      currentFile: tempPath,
      currentContent: "",
      untitledPath: tempPath,
      editMode: true,
      editContent: "",
      isDirty: false,
      externalChanged: false,
      fileMissing: false,
      transferScroll: null,
      compareWith: null,
      compareContent: null,
      // Creating a new document during an AI task result split (e.g. translation) leaves the split and enters edit state.
      taskDoc: null,
      translationRaw: false,
      backlinks: [],
      backlinksTruncated: false,
      headings: [],
    });
  },

  commitUntitled: async () => {
    const s = get();
    const temp = s.untitledPath;
    if (!temp) return true;
    const content = s.editMode ? s.editContent : s.currentContent ?? "";
    const wasEditing = s.editMode;
    const dir = s.currentFolder ?? "";
    const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
    const untitledName = `${t("common.untitled")}.md`;
    const defaultPath = dir
      ? `${dir}${dir.endsWith("\\") || dir.endsWith("/") ? "" : sep}${untitledName}`
      : untitledName;
    const picked = await save({
      defaultPath,
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    if (!picked) return false; // cancelled → stay on the scratch doc
    const path = /\.(md|markdown)$/i.test(picked) ? picked : `${picked}.md`;
    try {
      await invoke("write_file", { path, content });
    } catch (e) {
      get().showToast(t("store.saveFailed", { err: String(e) }));
      return false;
    }
    // Temp is now copied to a real file — drop it and shed the untitled identity
    // BEFORE openFile so its leave-guard doesn't re-trigger the untitled branch.
    await invoke("remove_untitled_file", { path: temp }).catch(() => {});
    set({ untitledPath: null, isDirty: false });
    const parent = path.replace(/[\\/][^\\/]+$/, "");
    if (parent && parent !== get().currentFolder) get().setFolder(parent);
    await get().openFile(path);
    if (wasEditing) get().setEditMode(true);
    get().bumpTreeRefresh();
    get().showToast(t("store.savedAs", { name: path.replace(/^.*[\\/]/, "") }));
    return true;
  },

  discardUntitled: async () => {
    const p = get().untitledPath;
    if (!p) return;
    await invoke("remove_untitled_file", { path: p }).catch(() => {});
    set({ untitledPath: null });
  },

  discardPendingNewFileIfEmpty: async (exceptPath?: string) => {
    const pending = get().pendingNewFile;
    if (!pending) return;
    // Navigating into the pending file itself (e.g. the create flow's own open)
    // → keep the marker; it only resolves once we actually leave it.
    if (exceptPath && pending === exceptPath) return;
    try {
      const deleted = await invoke<boolean>("delete_file_if_empty", { path: pending });
      if (deleted) get().bumpTreeRefresh();
    } catch (e) {
      await invoke("write_log", {
        level: "error",
        message: `delete_file_if_empty failed: ${e}`,
      }).catch(() => {});
    }
    set({ pendingNewFile: null });
  },

  scanBacklinks: async () => {
    const path = get().currentFile;
    const folder = get().currentFolder;
    if (!path) {
      set({ backlinks: [], backlinksTruncated: false });
      return;
    }
    // Backlinks need a folder scope; with no folder open there's nothing to scan.
    const base =
      folder ?? path.replace(/[\\/][^\\/]+$/, "");
    // Serve from the session cache when we've already scanned this file.
    const cached = backlinkCache.get(path);
    if (cached) {
      set({ backlinks: cached.links, backlinksTruncated: cached.truncated });
      return;
    }
    // Derive the document name (file name) from the path for matching.
    const docName = path.replace(/^.*[\\/]/, "");
    try {
      const res = await invoke<{ links: Backlink[]; truncated: boolean }>(
        "scan_backlinks",
        { folder: base, docName, currentPath: path }
      );
      backlinkCache.set(path, { links: res.links, truncated: res.truncated });
      // Only commit if the user is still on the same file (scan may outlive a
      // quick file switch).
      if (get().currentFile === path) {
        set({ backlinks: res.links, backlinksTruncated: res.truncated });
      }
    } catch (e) {
      // A scan failure must never break anything — just leave the panel empty.
      set({ backlinks: [], backlinksTruncated: false });
      await invoke("write_log", {
        level: "error",
        message: `scan_backlinks failed: ${e}`,
      }).catch(() => {});
    }
  },

  clearPendingWikiHeading: () => set({ pendingWikiHeading: null }),

  toggleTask: async (index: number, checked: boolean) => {
    const path = get().currentFile;
    if (!path) return;
    try {
      const content = await invoke<string>("toggle_task", { path, index, checked });
      set({ currentContent: content });
    } catch (e) {
      get().showToast(t("store.checkboxToggleFailed", { err: String(e) }));
    }
  },

  setFolder: (path: string) => {
    set({ currentFolder: path });
    get().setSettings({ last_folder: path });
    get().saveSettings();
    get().scanContextFiles();
    get().scanClaudeAssets();
    invoke("add_recent_file", { path, isDir: true })
      .then(() => invoke<RecentFile[]>("get_recent_files"))
      .then((recent) => set({ recentFiles: recent }))
      .catch(() => {});
    // Auto-open README.md: if the folder has README.md or README.MD, open it right away.
    const sep = path.includes("\\") ? "\\" : "/";
    const candidates = ["README.md", "README.MD", "readme.md"];
    (async () => {
      for (const name of candidates) {
        const candidate = `${path}${sep}${name}`;
        const exists = await invoke<boolean>("file_exists", { path: candidate }).catch(() => false);
        if (exists) {
          await get().openFile(candidate);
          break;
        }
      }
    })();
  },

  scanContextFiles: async () => {
    const folder = get().currentFolder;
    if (!folder) {
      // New (or no) folder → the previous selection no longer applies.
      set({ contextFiles: [], selectedContextPaths: [] });
      return;
    }
    try {
      const files = await invoke<ContextFile[]>("scan_context_files", {
        folder,
        patterns: get().settings.context_patterns,
      });
      // Keep only selections that still exist in the new context group.
      const valid = new Set(files.map((f) => f.path));
      set((state) => ({
        contextFiles: files,
        selectedContextPaths: state.selectedContextPaths.filter((p) => valid.has(p)),
      }));
    } catch (e) {
      // A scan failure must never break folder opening — just clear the group.
      set({ contextFiles: [], selectedContextPaths: [] });
      await invoke("write_log", {
        level: "error",
        message: `scan_context_files failed: ${e}`,
      }).catch(() => {});
    }
  },

  scanClaudeAssets: async () => {
    const folder = get().currentFolder;
    if (!folder) {
      set({ claudeAssets: [] });
      return;
    }
    try {
      const assets = await invoke<ClaudeAsset[]>("scan_claude_assets", { folder });
      set({ claudeAssets: assets });
    } catch (e) {
      // No `.claude` (or a scan error) is normal — clear silently, never block
      // folder opening.
      set({ claudeAssets: [] });
      await invoke("write_log", {
        level: "error",
        message: `scan_claude_assets failed: ${e}`,
      }).catch(() => {});
    }
  },

  toggleContextSelection: (path: string) =>
    set((state) =>
      state.selectedContextPaths.includes(path)
        ? { selectedContextPaths: state.selectedContextPaths.filter((p) => p !== path) }
        : { selectedContextPaths: [...state.selectedContextPaths, path] }
    ),

  clearContextSelection: () => set({ selectedContextPaths: [] }),

  setSettings: (patch) => {
    set((state) => ({ settings: { ...state.settings, ...patch } }));
  },

  saveSettings: async () => {
    try {
      await invoke("save_settings", { settings: get().settings });
    } catch (e) {
      get().showToast(t("toast.saveFailed", { err: String(e) }));
    }
  },

  loadSettings: async () => {
    try {
      const s = await invoke<AppSettings>("load_settings");
      set({ settings: s, zoom: s.zoom });
    } catch (_) {
      set({ settings: DEFAULT_SETTINGS });
    }
  },

  loadRecent: async () => {
    try {
      const recent = await invoke<RecentFile[]>("get_recent_files");
      set({ recentFiles: recent });
    } catch (_) {}
  },

  setHeadings: (headings) => set({ headings }),

  setActiveHeading: (id) => {
    if (get().activeHeadingId !== id) set({ activeHeadingId: id });
  },

  setSearchOpen: (open) => set({ searchOpen: open, searchQuery: open ? get().searchQuery : "" }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  setZoom: (z: number) => {
    const clamped = Math.max(0.5, Math.min(3.0, z));
    set({ zoom: clamped });
    get().setSettings({ zoom: clamped });
    get().saveSettings();
  },

  showToast: (msg, action) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toastMessage: msg, toastAction: action ?? null });
    // Action toasts (e.g. 되돌리기) linger a bit longer so there's time to click.
    toastTimer = setTimeout(
      () => set({ toastMessage: null, toastAction: null }),
      action ? 8000 : 4000
    );
  },

  loadFavorites: async () => {
    try {
      const favs = await invoke<FavoriteItem[]>("get_favorites");
      set({ favorites: favs });
    } catch (_) {}
  },

  toggleFavorite: async (path: string, isDir: boolean) => {
    try {
      const favs = await invoke<FavoriteItem[]>("toggle_favorite", { path, isDir });
      set({ favorites: favs });
    } catch (e) {
      get().showToast(t("store.favoriteSaveFailed", { err: String(e) }));
    }
  },

  reorderFavorites: async (paths: string[]) => {
    // Optimistic reorder for an immediate, smooth drop, then persist.
    const byPath = new Map(get().favorites.map((f) => [f.path, f]));
    const next = paths.map((p) => byPath.get(p)).filter((f): f is FavoriteItem => !!f);
    set({ favorites: next });
    try {
      const favs = await invoke<FavoriteItem[]>("reorder_favorites", { paths });
      set({ favorites: favs });
    } catch (e) {
      get().showToast(t("store.favoriteReorderFailed", { err: String(e) }));
    }
  },

  clearFavorites: async () => {
    // Snapshot the current list (verbatim: order, name, added_at, is_dir) before
    // removing, so 되돌리기 can restore it exactly via set_favorites.
    const snapshot = get().favorites;
    if (snapshot.length === 0) return; // nothing to clear
    const count = snapshot.length;
    try {
      const favs = await invoke<FavoriteItem[]>("clear_favorites");
      set({ favorites: favs });
      get().showToast(t("store.favoritesCleared", { count }), {
        label: t("common.undo"),
        onAction: async () => {
          try {
            const restored = await invoke<FavoriteItem[]>("set_favorites", {
              items: snapshot,
            });
            set({ favorites: restored });
          } catch (e) {
            get().showToast(t("store.favoriteRestoreFailed", { err: String(e) }));
          }
        },
      });
    } catch (e) {
      get().showToast(t("store.favoriteClearFailed", { err: String(e) }));
    }
  },

  isFavorite: (path: string) => get().favorites.some((f) => f.path === path),

  loadBookmarks: async (path: string) => {
    try {
      const bms = await invoke<Bookmark[]>("get_bookmarks", { path });
      set({ bookmarks: bms });
    } catch (_) {
      set({ bookmarks: [] });
    }
  },

  toggleBookmark: async (h: HeadingItem) => {
    const path = get().currentFile;
    if (!path) return;
    try {
      const bms = await invoke<Bookmark[]>("toggle_bookmark", {
        path,
        headingId: h.id,
        text: h.text,
        level: h.level,
      });
      set({ bookmarks: bms });
    } catch (e) {
      get().showToast(t("store.bookmarkSaveFailed", { err: String(e) }));
    }
  },

  isBookmarked: (headingId: string) => get().bookmarks.some((b) => b.heading_id === headingId),

  setSettingsOpen: (open: boolean) => set({ settingsOpen: open }),
  setAboutOpen: (open: boolean) => set({ aboutOpen: open }),
  setDefaultAppBannerOpen: (open: boolean) => set({ defaultAppBannerOpen: open }),
  setPaletteOpen: (open: boolean) => set({ paletteOpen: open }),
  setFocusMode: (on: boolean) => set({ focusMode: on }),
  setConverting: (v: boolean) => set({ converting: v }),
  setTranslating: (v: boolean) => set({ translating: v }),
  setTranslateProgress: (p) => set({ translateProgress: p }),
  // Enter translation view: mutually exclusive with compare — turning it on clears compare.
  showTaskResult: (taskId, content) =>
    set({ taskDoc: { taskId, content }, translationRaw: false, compareWith: null, compareContent: null }),
  updateTaskContent: (content) =>
    set((s) => (s.taskDoc ? { taskDoc: { ...s.taskDoc, content } } : {})),
  closeTaskResult: () => set({ taskDoc: null, translationRaw: false }),
  toggleTranslationRaw: () => set((s) => ({ translationRaw: !s.translationRaw })),
  setPandocDownloading: (v: boolean) => set({ pandocDownloading: v }),
  setUpdateInfo: (info) => set({ updateInfo: info }),
  setUpdateInstalled: (v) => set({ updateInstalled: v }),

  // simple edit mode (#22)
  setEditMode: (on: boolean) => {
    if (on) {
      // Entering edit mode leaves compare mode (#27): compare is view-only.
      set({ editMode: true, editContent: get().currentContent ?? "", isDirty: false, compareWith: null, compareContent: null, taskDoc: null });
    } else {
      set({ editMode: false, isDirty: false });
    }
  },
  setEditContent: (s: string) =>
    set({ editContent: s, isDirty: s !== (get().currentContent ?? "") }),
  applyDiskContent: (content: string) =>
    set((state) => {
      // Review baseline capture ②: just before overwriting the current buffer with the external change,
      // preserve that file's old currentContent (the version the user last knew) as the baseline.
      // Keep it if already present (the version captured first is the older reference).
      const path = state.currentFile;
      const reviewBaseline =
        path && state.reviewBaseline[path] === undefined
          ? { ...state.reviewBaseline, [path]: state.currentContent ?? "" }
          : state.reviewBaseline;
      return { currentContent: content, editContent: content, isDirty: false, externalChanged: false, reviewBaseline };
    }),
  setTransferScroll: (t) => set({ transferScroll: t }),
  saveFile: async (opts) => {
    const s = get();
    // Unnamed scratch doc: a silent (idle auto-save) write goes to the temp file
    // quietly; an explicit 저장 (⌘S / button) instead opens the name+location
    // dialog to make it a real file.
    if (s.untitledPath && s.currentFile === s.untitledPath) {
      if (opts?.silent) {
        const content = s.editContent;
        try {
          await invoke("write_file", { path: s.untitledPath, content });
          set({ currentContent: content, isDirty: false });
        } catch (e) {
          get().showToast(t("store.tempSaveFailed", { err: String(e) }));
        }
        return;
      }
      await get().commitUntitled();
      return;
    }
    const path = get().currentFile;
    if (!path) return;
    const content = get().editContent;
    try {
      await invoke("write_file", { path, content });
      // The saved buffer is now the disk truth — sync viewer + clear flags.
      set({ currentContent: content, isDirty: false, externalChanged: false });
      // Non-empty content makes this a real document — it's no longer a throwaway
      // blank, so drop the pending marker (a later empty-out won't auto-delete it).
      if (content.trim().length > 0 && get().pendingNewFile === path) {
        set({ pendingNewFile: null });
      }
      if (!opts?.silent) get().showToast(t("store.saved"));
    } catch (e) {
      // Auto-save failures must still surface (atomic write failed, perms, etc.)
      // — the app keeps the buffer dirty and never silently loses edits.
      get().showToast(t("store.saveFailed", { err: String(e) }));
    }
  },

  maybeSaveBeforeLeave: async () => {
    const s = get();
    // Creating a new document or moving to another one makes any in-progress
    // translation meaningless (the source document changes) → cancel it quietly. Every
    // "before leaving the current document" path (openFile, createNewFileViaDialog,
    // createNewFileInFolder) goes through this guard, so handling it here covers all of them.
    // Uses a dynamic import to avoid a circular import.
    if (s.translating) {
      const { cancelClaudeTask } = await import("../lib/aiTasks");
      await cancelClaudeTask();
    }
    // Unnamed scratch doc: empty → silently discard the temp file; has content →
    // prompt for a name+location (commit). Cancelling the save dialog asks one more time
    // "버리고 계속할까요?" (discard and continue?), giving three branches (save / discard / keep editing) —
    // previously you could not leave without saving, so cancelling kept re-opening the dialog forever.
    if (s.untitledPath && s.currentFile === s.untitledPath) {
      const content = s.editMode ? s.editContent : s.currentContent ?? "";
      if (content.trim() === "") {
        await get().discardUntitled();
        return true;
      }
      if (await get().commitUntitled()) return true;
      const discard = await ask(t("store.discardUntitledConfirmMessage"), {
        title: t("store.unsavedChangesTitle"),
        kind: "warning",
        okLabel: t("store.discardAndContinue"),
        cancelLabel: t("common.cancel"),
      });
      if (!discard) return false; // keep editing (abort the move)
      await get().discardUntitled();
      return true;
    }
    if (!s.editMode || !s.isDirty) return true; // nothing to lose
    // Auto-save path: save silently and leave. Undo (which persists across the
    // mode switch) makes this safe — no confirm dialog needed.
    if (s.settings.auto_save && !s.externalChanged) {
      await get().saveFile({ silent: true });
      if (get().isDirty) {
        // Save failed (write error/perms) — don't silently discard the buffer.
        return await ask(
          t("store.saveFailedConfirmMessage"),
          { title: t("store.saveFailedConfirmTitle"), kind: "warning", okLabel: t("store.discardAndContinue"), cancelLabel: t("common.cancel") }
        );
      }
      return true;
    }
    // Auto-save off, or the file changed on disk externally (don't silently
    // clobber an AI/editor change) → ask the user before discarding edits.
    return await ask(
      t("store.unsavedChangesConfirmMessage"),
      { title: t("store.unsavedChangesTitle"), kind: "warning", okLabel: t("common.continue"), cancelLabel: t("common.cancel") }
    );
  },

  setExternalChanged: (v: boolean) => set({ externalChanged: v }),
  setFileMissing: (v: boolean) => set({ fileMissing: v }),
  flashReloaded: () => {
    set({ reloadedFlash: true });
    setTimeout(() => set({ reloadedFlash: false }), 4000);
  },

  refreshOpenFileFromDisk: async () => {
    const s = get();
    const path = s.currentFile;
    if (!path) return;
    // PDF/HTML are not read as text, so skip the content-compare/reload logic and
    // only update existence. ponytail: a PDF/HTML changed on disk is not auto-refreshed
    // (acceptable for a read-only viewer). If needed, add a nonce to the iframe key to force a reload.
    if (opensInFrame(path)) {
      const stillThere = await invoke<boolean>("file_exists", { path }).catch(() => true);
      set({ fileMissing: !stillThere });
      return;
    }
    const exists = await invoke<boolean>("file_exists", { path }).catch(() => true);
    let contentChanged = false;
    let diskContent = "";
    if (exists) {
      const result = await invoke<{ content: string }>("read_file", { path }).catch(() => null);
      if (!result) return; // transient read error — leave state as-is
      diskContent = result.content;
      contentChanged = diskContent !== (get().currentContent ?? "");
    }
    const action = decideExternalChange({
      exists,
      contentChanged,
      editMode: get().editMode,
      isDirty: get().isDirty,
      autoReload: get().settings.auto_reload,
    });
    switch (action) {
      case "missing":
        set({ fileMissing: true });
        return;
      case "none":
        // File is present (possibly recreated identical) → clear any stale flags.
        if (get().fileMissing || get().externalChanged) set({ fileMissing: false, externalChanged: false });
        return;
      case "reloadView":
        // Review baseline capture ②: before openFile overwrites currentContent with the disk
        // content, preserve the old currentContent (the version the user was viewing) as the baseline.
        // openFile doesn't overwrite an existing baseline (capture ①), so the ordering is safe.
        set((state) =>
          state.reviewBaseline[path] === undefined
            ? { fileMissing: false, reviewBaseline: { ...state.reviewBaseline, [path]: state.currentContent ?? "" } }
            : { fileMissing: false }
        );
        // Reuse the proven open path (re-reads, restores scroll via MarkdownViewer).
        await get().openFile(path);
        get().flashReloaded();
        return;
      case "notifyView":
        set({ externalChanged: true, fileMissing: false });
        return;
      case "reflectEdit":
        // Clean editor buffer → safely mirror the external change in.
        get().applyDiskContent(diskContent);
        set({ fileMissing: false });
        get().showToast(t("store.externalChangeApplied"));
        return;
      case "conflictEdit":
        // Unsaved edits → never auto-overwrite; surface the conflict (Editor banner).
        set({ externalChanged: true, fileMissing: false });
        return;
    }
  },

  discardEditsReload: async () => {
    const path = get().currentFile;
    if (!path) return;
    const result = await invoke<{ content: string }>("read_file", { path }).catch(() => null);
    if (!result) {
      get().showToast(t("store.diskReadFailed"));
      return;
    }
    get().applyDiskContent(result.content);
    set({ fileMissing: false });
    get().showToast(t("store.diskContentLoaded"));
  },

  recreateOpenFile: async () => {
    const path = get().currentFile;
    if (!path) return;
    // Write the buffer we still hold (editor buffer in edit mode, else the
    // rendered content) back to disk — recovers a file deleted out from under us.
    const content = get().editMode ? get().editContent : (get().currentContent ?? "");
    try {
      await invoke("write_file", { path, content });
      set({ currentContent: content, editContent: content, isDirty: false, fileMissing: false, externalChanged: false });
      get().bumpTreeRefresh();
      get().showToast(t("store.fileResaved"));
    } catch (e) {
      get().showToast(t("store.resaveFailed", { err: String(e) }));
    }
  },

  markChanged: (path: string, kind: ChangeKind) => {
    // Don't badge the file the user is currently viewing.
    if (path === get().currentFile) return;
    set((state) => {
      // "created" is sticky: a new file that's then modified still reads as new.
      if (state.changedFiles[path] === kind) return state;
      if (state.changedFiles[path] === "created" && kind === "modified") return state;
      return { changedFiles: { ...state.changedFiles, [path]: kind } };
    });
  },
  clearChanged: (path: string) =>
    set((state) => ({ changedFiles: omitKey(state.changedFiles, path) })),
  clearAllChanged: () => set({ changedFiles: {} }),

  setReviewOpen: (v: boolean) => set({ reviewOpen: v }),
  // "모두 확인" (confirm all): clears all change badges/lists. The baseline is intentionally kept — it is
  // reused as the reference for the next changes (the version the app first saw is the reference).
  clearAllChanges: () => set({ changedFiles: {} }),

  notifyPathRenamed: async (oldPath: string, newPath: string, _isDir: boolean) => {
    // Favorites: update the matching path (including children for a folder) to the new path, and the display name to the new basename.
    // Persist the whole list at once via set_favorites (path/name stay stable for both files and folders).
    const favs = get().favorites;
    const affected = favs.some(
      (f) => remapUnderRename(f.path, oldPath, newPath) !== f.path
    );
    if (affected) {
      const next = favs.map((f) => {
        const remapped = remapUnderRename(f.path, oldPath, newPath);
        if (remapped === f.path) return f;
        return { ...f, path: remapped, name: remapped.replace(/^.*[\\/]/, "") };
      });
      try {
        const saved = await invoke<FavoriteItem[]>("set_favorites", { items: next });
        set({ favorites: saved });
      } catch (e) {
        await invoke("write_log", { level: "error", message: `set_favorites (rename) failed: ${e}` }).catch(() => {});
      }
    }

    // Currently open document: if it is at that path (or under the renamed folder), follow it to the new path.
    const cur = get().currentFile;
    if (cur) {
      const remapped = remapUnderRename(cur, oldPath, newPath);
      if (remapped !== cur) {
        await get().openFile(remapped);
      }
    }
    // If the current folder itself is the renamed folder (or under it), update it too.
    const folder = get().currentFolder;
    if (folder) {
      const remapped = remapUnderRename(folder, oldPath, newPath);
      if (remapped !== folder) set({ currentFolder: remapped });
    }

    // Recents: re-read the list so the vanished old path is filtered out automatically.
    await get().loadRecent();
  },

  notifyPathDeleted: async (path: string, isDir: boolean) => {
    // Favorites: remove the deleted path (including children for a folder) and persist.
    const favs = get().favorites;
    const kept = favs.filter((f) => !isPathAtOrUnder(f.path, path));
    if (kept.length !== favs.length) {
      try {
        const saved = await invoke<FavoriteItem[]>("set_favorites", { items: kept });
        set({ favorites: saved });
      } catch (e) {
        await invoke("write_log", { level: "error", message: `set_favorites (delete) failed: ${e}` }).catch(() => {});
      }
    }

    // Close the currently open document if it was deleted (or is under a deleted folder).
    const cur = get().currentFile;
    if (cur && isPathAtOrUnder(cur, path)) {
      set({
        currentFile: null,
        currentContent: null,
        editMode: false,
        editContent: "",
        isDirty: false,
        headings: [],
        backlinks: [],
        backlinksTruncated: false,
        compareWith: null,
        compareContent: null,
        taskDoc: null,
        externalChanged: false,
        fileMissing: false,
      });
    }
    // Close the current folder if it is the deleted folder (or under it).
    const folder = get().currentFolder;
    if (isDir && folder && isPathAtOrUnder(folder, path)) {
      set({ currentFolder: null });
    }

    // Refresh recents (vanished paths are excluded automatically).
    await get().loadRecent();
  },
}));
