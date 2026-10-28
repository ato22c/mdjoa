import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, FileText, Folder, Clock, Globe } from "lucide-react";
import { useAppStore } from "../../store/app";
import { useT } from "../../lib/i18n";
import { fuzzyScore } from "../../lib/fuzzy";
import { makeFileItem, makeFolderItem, nameMatchBonus, type FileItem } from "../../lib/quickOpenItem";
import { isRemoteUrl, normalizeRemoteUrl, remoteDisplayName } from "../../lib/remoteUrl";
import { baseName } from "../../lib/pathUtil";
import type { DirEntry, RecentFile } from "../../types";

/**
 * Quick Open — keyboard file/folder switcher (⌘/Ctrl+O).
 *
 * Self-contained: registers its own global keydown listener, manages its own
 * open state, and reads (never mutates) the store. When opened it recursively
 * gathers .md/.markdown files AND folders under a working set (the open folder
 * plus favorite/recent folders), caches them for that open session, and lets
 * the user fuzzy-match by folder name or filename. A scope filter (전체/폴더/
 * 파일) narrows results. Picking a file opens it in the viewer; picking a folder
 * opens it as the current folder. Files whose name identifies their folder
 * (SKILL.md, README.md, index.md) display the folder name as the primary label.
 *
 * Mounted once in AppShell; no props.
 */

const MAX_FILES = 4000; // safety bound for very large trees
const SKIP_DIRS = new Set(["node_modules", ".git"]);
type ScopeFilter = "all" | "folders" | "files";
// i18n key per scope, looked up with t() at render time (labels are localized).
const FILTER_LABEL_KEYS: Record<ScopeFilter, string> = {
  all: "quickOpen.filterAll",
  folders: "quickOpen.filterFolders",
  files: "quickOpen.filterFiles",
};
// Derived (not hand-maintained) so tab order/membership can never drift from
// FILTER_LABEL_KEYS — Record completeness above guarantees every ScopeFilter
// member is a key here, in declaration order (all, folders, files).
const FILTER_TABS = Object.keys(FILTER_LABEL_KEYS) as ScopeFilter[];

export function QuickOpen() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Downloading a URL entered as the query (renders the remote row as busy).
  const [fetching, setFetching] = useState(false);
  const [selected, setSelected] = useState(0);
  // Scope filter persists across opens within the session (default: 전체).
  const [filter, setFilter] = useState<ScopeFilter>("all");

  const currentFolder = useAppStore((s) => s.currentFolder);
  const currentFile = useAppStore((s) => s.currentFile);
  const openFile = useAppStore((s) => s.openFile);
  const setFolder = useAppStore((s) => s.setFolder);
  const recentFiles = useAppStore((s) => s.recentFiles);
  // `.claude` assets (skills/agents/commands) are scanned separately and live
  // under a dot-dir the recursive gather skips — fold them in below.
  const claudeAssets = useAppStore((s) => s.claudeAssets);
  // Favorite files are folded into the searchable corpus (favorite FOLDERS are
  // gathered as roots, alongside recent files/folders).
  const favorites = useAppStore((s) => s.favorites);
  // Reuse mode (#27): 'open' opens the picked file; 'compare' compares it
  // against the current document.
  const quickOpenMode = useAppStore((s) => s.quickOpenMode);
  const startCompare = useAppStore((s) => s.startCompare);
  const setQuickOpenMode = useAppStore((s) => s.setQuickOpenMode);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const gatherToken = useRef(0);
  // Bumped on close so a URL fetch finishing after Esc doesn't open anything.
  const fetchToken = useRef(0);

  // Query typed as a URL → the list is replaced by a single "원격 파일 열기" row.
  const remoteUrl = isRemoteUrl(query) ? normalizeRemoteUrl(query) : null;

  // Global shortcut: ⌘/Ctrl+O toggles the launcher (always in 'open' mode — a
  // compare is entered via the dedicated shortcut/menu which sets the mode).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setQuickOpenMode("open");
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [setQuickOpenMode]);

  // Compare entry (#27): AppShell sets quickOpenMode to 'compare' (via shortcut
  // or menu) to summon the picker for choosing the 대상 document. Opening it
  // here keeps QuickOpen the single owner of its visibility.
  useEffect(() => {
    if (quickOpenMode === "compare") setOpen(true);
  }, [quickOpenMode]);

  // Recursively gather markdown files under one or more root folders (the open
  // folder plus any favorite/recent folders). Dot-dirs and SKIP_DIRS are
  // skipped; visited dirs and files are deduped so overlapping roots cost once.
  const gather = useCallback(async (roots: string[]) => {
    const token = ++gatherToken.current;
    setLoading(true);
    const out: FileItem[] = [];
    const seenFiles = new Set<string>();
    const visited = new Set<string>();
    const stack: string[] = [...roots];
    try {
      while (stack.length && out.length < MAX_FILES) {
        const dir = stack.pop()!;
        if (visited.has(dir)) continue;
        visited.add(dir);
        let entries: DirEntry[];
        try {
          entries = await invoke<DirEntry[]>("list_dir", { path: dir });
        } catch {
          continue;
        }
        if (token !== gatherToken.current) return; // a newer open superseded us
        for (const e of entries) {
          if (e.is_dir) {
            const base = e.name;
            if (base.startsWith(".") || SKIP_DIRS.has(base)) continue;
            stack.push(e.path);
            if (seenFiles.has(e.path)) continue;
            seenFiles.add(e.path);
            out.push(makeFolderItem(e.path));
            if (out.length >= MAX_FILES) break;
          } else if (e.is_md || /\.(md|markdown)$/i.test(e.name)) {
            if (seenFiles.has(e.path)) continue;
            seenFiles.add(e.path);
            out.push(makeFileItem(e.name, e.path));
            if (out.length >= MAX_FILES) break;
          }
        }
      }
      if (token === gatherToken.current) setFiles(out);
    } finally {
      if (token === gatherToken.current) setLoading(false);
    }
  }, []);

  // On open: reset query/selection, focus input, kick off a fresh gather
  // (cached for the duration of this open session).
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    setFiles([]);
    // Working set = open folder + favorite/recent FOLDERS (snapshot at open).
    // Favorite/recent FILES are folded into the corpus separately below.
    const st = useAppStore.getState();
    const seen = new Set<string>();
    const roots: string[] = [];
    for (const p of [
      st.currentFolder,
      ...st.favorites.filter((f) => f.is_dir).map((f) => f.path),
      ...st.recentFiles.filter((r) => r.is_dir).map((r) => r.path),
    ]) {
      if (!p || seen.has(p)) continue;
      seen.add(p);
      roots.push(p);
    }
    if (roots.length) gather(roots);
    // Focus after paint so autofocus lands reliably.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, currentFolder, gather]);

  // Map recent files (markdown only) to FileItems, in recency order.
  const recentItems = useMemo<FileItem[]>(() => {
    const seen = new Set<string>();
    const items: FileItem[] = [];
    for (const r of recentFiles as RecentFile[]) {
      if (r.is_dir) continue;
      if (!/\.(md|markdown)$/i.test(r.name)) continue;
      if (seen.has(r.path)) continue;
      seen.add(r.path);
      items.push(makeFileItem(r.name, r.path));
    }
    return items;
  }, [recentFiles]);

  // Recency rank by path, used to break ties / boost recent files.
  const recencyRank = useMemo(() => {
    const m = new Map<string, number>();
    recentItems.forEach((it, i) => m.set(it.path, i));
    return m;
  }, [recentItems]);

  // The recursive gather skips dot-dirs (so it never descends `.claude`, which
  // would also pull in `.claude/worktrees` checkouts). Fold the already-scanned
  // `.claude` assets into the searchable corpus instead — bounded, deduped, and
  // matching the sidebar. A SKILL.md surfaces under its folder name (e.g. ui-ux).
  const assetItems = useMemo<FileItem[]>(
    () => claudeAssets.map((a) => makeFileItem(baseName(a.path), a.path)),
    [claudeAssets]
  );
  // Favorite markdown FILES + favorite FOLDERS (so the roots themselves are
  // openable; their contents come from the gather above).
  const favFileItems = useMemo<FileItem[]>(
    () =>
      favorites
        .filter((f) => !f.is_dir && /\.(md|markdown)$/i.test(f.name))
        .map((f) => makeFileItem(f.name, f.path)),
    [favorites]
  );
  const folderRootItems = useMemo<FileItem[]>(() => {
    const dirs = [
      ...favorites.filter((f) => f.is_dir).map((f) => f.path),
      ...(recentFiles as RecentFile[]).filter((r) => r.is_dir).map((r) => r.path),
    ];
    return dirs.map((p) => makeFolderItem(p));
  }, [favorites, recentFiles]);
  // Searchable corpus = gathered files+folders (open + favorite/recent folders)
  // + `.claude` assets + favorite files + recent files + favorite/recent folder
  // roots, deduped by path.
  const corpus = useMemo<FileItem[]>(() => {
    const seen = new Set<string>();
    const merged: FileItem[] = [];
    for (const it of [...files, ...assetItems, ...favFileItems, ...recentItems, ...folderRootItems]) {
      if (seen.has(it.path)) continue;
      seen.add(it.path);
      merged.push(it);
    }
    return merged;
  }, [files, assetItems, favFileItems, recentItems, folderRootItems]);

  // Results: empty query → recent files first; otherwise fuzzy-ranked matches.
  // In compare mode the current document is excluded (can't compare with itself).
  const results = useMemo<FileItem[]>(() => {
    const isCompare = quickOpenMode === "compare";
    // Compare mode is document-only (can't compare a folder); force file scope.
    const scope: ScopeFilter = isCompare ? "files" : filter;
    const keep = (f: FileItem) =>
      !(isCompare && f.path === currentFile) &&
      (scope === "all" || (scope === "folders" ? f.kind === "folder" : f.kind === "file"));
    const q = query.trim();
    if (!q) {
      const recents = recentItems.filter(keep);
      if (recents.length) {
        // Recent files first, then any remaining matching items.
        const recentPaths = new Set(recents.map((r) => r.path));
        const rest = corpus.filter((f) => keep(f) && !recentPaths.has(f.path)).slice(0, 200);
        return [...recents, ...rest].slice(0, 200);
      }
      return corpus.filter(keep).slice(0, 200);
    }
    const scored: { item: FileItem; score: number }[] = [];
    for (const f of corpus) {
      if (!keep(f)) continue;
      // Match against folder context + name so a query can hit either the
      // folder name (e.g. "ui-ux") or the filename (e.g. "SKILL").
      const s = fuzzyScore(q, f.searchText);
      if (s === null) continue;
      const rank = recencyRank.get(f.path);
      const recencyBonus = rank === undefined ? 0 : Math.max(0, 12 - rank) * 0.8;
      // If a folder/file's own name exactly (or prefix-) matches the query, rank it above
      // other sub-path matches (e.g. the "mdjoa" folder itself comes first).
      scored.push({ item: f, score: s + recencyBonus + nameMatchBonus(f.name, q) });
    }
    scored.sort((a, b) => b.score - a.score || a.item.primary.localeCompare(b.item.primary));
    return scored.slice(0, 200).map((s) => s.item);
  }, [query, corpus, recentItems, recencyRank, quickOpenMode, currentFile, filter]);

  // Keep selection in range when results change.
  useEffect(() => {
    setSelected((s) => (results.length === 0 ? 0 : Math.min(s, results.length - 1)));
  }, [results]);

  // Scroll the selected row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Closing always returns the launcher to the default 'open' mode so the next
  // ⌘O behaves normally.
  const close = useCallback(() => {
    fetchToken.current++;
    setFetching(false);
    setOpen(false);
    setQuickOpenMode("open");
  }, [setQuickOpenMode]);

  // Download the URL into the remote cache (Rust: open_remote_md), then open
  // the cached copy through the normal pipeline (compare mode compares it).
  const chooseRemote = useCallback(
    async (url: string) => {
      const token = ++fetchToken.current;
      setFetching(true);
      try {
        const doc = await invoke<{ path: string; name: string }>("open_remote_md", { url });
        if (token !== fetchToken.current) return; // closed/superseded meanwhile
        const compare = useAppStore.getState().quickOpenMode === "compare";
        setFetching(false);
        setOpen(false);
        setQuickOpenMode("open");
        if (compare) startCompare(doc.path);
        else openFile(doc.path);
      } catch (e) {
        if (token !== fetchToken.current) return;
        setFetching(false);
        useAppStore.getState().showToast(t("quickOpen.openRemoteFailed", { err: String(e) }));
      }
    },
    [openFile, startCompare, setQuickOpenMode, t]
  );

  const choose = useCallback(
    (item: FileItem, newWindow = false) => {
      const compare = useAppStore.getState().quickOpenMode === "compare";
      setOpen(false);
      setQuickOpenMode("open");
      // Folders open as the current folder (compare / new-window N/A).
      if (item.kind === "folder") {
        setFolder(item.path);
        return;
      }
      // ⌘/Ctrl+Enter → open the picked document in a new independent window.
      // Compare mode ignores the modifier (it always compares in-place).
      if (newWindow && !compare) {
        invoke("open_in_new_window", { path: item.path }).catch((e) =>
          useAppStore.getState().showToast(t("commandPalette.openInNewWindowFailed", { err: String(e) }))
        );
        return;
      }
      if (compare) startCompare(item.path);
      else openFile(item.path);
    },
    [openFile, startCompare, setQuickOpenMode, setFolder, t]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => (results.length ? (s + 1) % results.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => (results.length ? (s - 1 + results.length) % results.length : 0));
      } else if (e.key === "Tab") {
        // Cycle scope filter: 전체 → 폴더 → 파일 → 전체.
        e.preventDefault();
        setFilter((f) => {
          const i = FILTER_TABS.findIndex((k) => k === f);
          return FILTER_TABS[(i + 1) % FILTER_TABS.length];
        });
        setSelected(0);
      } else if (e.key === "Enter") {
        e.preventDefault();
        // URL query → fetch and open the remote document (ignore re-Enter
        // while a fetch is already running).
        if (remoteUrl) {
          if (!fetching) chooseRemote(remoteUrl);
          return;
        }
        const item = results[selected];
        // ⌘/Ctrl+Enter opens in a new window; plain Enter opens in-place.
        if (item) choose(item, e.metaKey || e.ctrlKey);
      }
    },
    [results, selected, close, choose, remoteUrl, fetching, chooseRemote]
  );

  if (!open) return null;

  const showingRecent =
    query.trim() === "" && filter !== "folders" && quickOpenMode !== "compare" && recentItems.length > 0;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center no-print"
      style={{ background: "rgba(0,0,0,0.35)", paddingTop: "12vh" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="w-[600px] max-w-[92vw] max-h-[70vh] rounded-2xl overflow-hidden flex flex-col animate-fade-in"
        style={{ background: "var(--bg)", boxShadow: "var(--shadow-popover)" }}
        onKeyDown={onKeyDown}
      >
        <div
          className="flex items-center gap-2.5 px-4 h-12 shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <Search size={16} style={{ color: "var(--muted)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder={
              quickOpenMode === "compare" ? t("quickOpen.comparePlaceholder") : t("quickOpen.searchPlaceholder")
            }
            className="flex-1 bg-transparent outline-none border-none text-[15px]"
            style={{ color: "var(--text)" }}
            spellCheck={false}
            autoComplete="off"
          />
          {quickOpenMode !== "compare" && (
            <div className="flex items-center gap-0.5 shrink-0 text-[12px]" title={t("quickOpen.scopeTooltip")}>
              {FILTER_TABS.map((key) => (
                <button
                  key={key}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setFilter(key);
                    setSelected(0);
                  }}
                  className="px-2 py-0.5 rounded-md"
                  style={{
                    background: filter === key ? "var(--active, rgba(127,127,127,0.16))" : "transparent",
                    color: filter === key ? "var(--accent)" : "var(--muted)",
                    fontWeight: filter === key ? 600 : 400,
                  }}
                >
                  {t(FILTER_LABEL_KEYS[key])}
                </button>
              ))}
            </div>
          )}
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5">
          {showingRecent && (
            <div
              className="px-4 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide flex items-center gap-1.5"
              style={{ color: "var(--muted)" }}
            >
              <Clock size={11} />
              {t("quickOpen.recentFiles")}
            </div>
          )}

          {remoteUrl ? (
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                if (!fetching) chooseRemote(remoteUrl);
              }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-left"
              style={{ background: "var(--hover, rgba(127,127,127,0.12))" }}
              disabled={fetching}
            >
              <Globe size={15} className="shrink-0" style={{ color: "var(--accent)" }} />
              <span className="text-[13px] truncate" style={{ color: "var(--text)" }}>
                {fetching
                  ? t("quickOpen.fetchingRemote")
                  : t("quickOpen.openRemote", { name: remoteDisplayName(remoteUrl) })}
              </span>
              <span className="text-[12px] truncate ml-auto pl-3" style={{ color: "var(--muted)" }}>
                {remoteUrl}
              </span>
            </button>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-[13px] text-center" style={{ color: "var(--muted)" }}>
              {!currentFolder
                ? t("quickOpen.openFolderFirst")
                : loading
                ? t("quickOpen.searching")
                : query.trim()
                ? filter === "folders"
                  ? t("quickOpen.noMatchingFolders")
                  : filter === "files"
                  ? t("quickOpen.noMatchingFiles")
                  : t("quickOpen.noMatchingItems")
                : t("quickOpen.noItemsToShow")}
            </div>
          ) : (
            results.map((item, i) => {
              const Icon = item.kind === "folder" ? Folder : FileText;
              return (
                <button
                  key={item.path}
                  data-idx={i}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(item);
                  }}
                  onMouseMove={() => setSelected(i)}
                  className="w-full flex items-center gap-2.5 px-4 py-1.5 text-left"
                  style={{
                    background: i === selected ? "var(--hover, rgba(127,127,127,0.12))" : "transparent",
                  }}
                >
                  <Icon size={15} className="shrink-0" style={{ color: "var(--muted)" }} />
                  <span className="text-[13px] truncate" style={{ color: "var(--text)" }}>
                    {item.primary}
                  </span>
                  {item.secondary && (
                    <span className="text-[12px] truncate ml-auto pl-3" style={{ color: "var(--muted)" }}>
                      {item.secondary}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
