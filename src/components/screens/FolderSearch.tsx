import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, X } from "lucide-react";
import { useAppStore } from "../../store/app";
import { useT } from "../../lib/i18n";

/**
 * Folder-wide full-text search. Self-contained overlay: registers its own
 * ⌘/Ctrl+Shift+F shortcut to toggle open. Searches the CONTENTS of all
 * .md/.markdown files under the open folder via the `search_in_folder`
 * command and lets the user jump to a file at the matching line.
 *
 * Reads `currentFolder` and `openFile` from the store (read-only); manages its
 * own open state so it can be mounted once without any store changes.
 */

interface SearchHit {
  path: string;
  name: string;
  line: number;
  text: string;
}

/** Mirrors the Rust `SearchResult`: the hit list plus a `truncated` flag set
 *  whenever a performance guard (hit cap / scanned-file cap / depth limit)
 *  stopped the walk before exhausting the tree. */
interface SearchResult {
  hits: SearchHit[];
  truncated: boolean;
}

const MIN_CHARS = 2;
const DEBOUNCE_MS = 200;

export function FolderSearch() {
  const t = useT();
  const currentFolder = useAppStore((s) => s.currentFolder);
  const openFile = useAppStore((s) => s.openFile);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Guards against out-of-order async results clobbering newer ones.
  const reqIdRef = useRef(0);

  // Global shortcut: ⌘/Ctrl+Shift+F toggles the overlay.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Reset transient state and focus the input when opening.
  useEffect(() => {
    if (open) {
      setActive(0);
      // Defer focus until the input is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setHits([]);
      setTruncated(false);
      setLoading(false);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < MIN_CHARS || !currentFolder) {
      setHits([]);
      setTruncated(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const myReq = ++reqIdRef.current;
    const t = setTimeout(() => {
      invoke<SearchResult>("search_in_folder", { folder: currentFolder, query: q })
        .then((res) => {
          if (myReq !== reqIdRef.current) return; // stale
          setHits(res.hits);
          setTruncated(res.truncated);
          setActive(0);
        })
        .catch(() => {
          if (myReq !== reqIdRef.current) return;
          setHits([]);
          setTruncated(false);
        })
        .finally(() => {
          if (myReq === reqIdRef.current) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, currentFolder, open]);

  const close = useCallback(() => setOpen(false), []);

  const choose = useCallback(
    (hit: SearchHit | undefined) => {
      if (!hit) return;
      openFile(hit.path);
      setOpen(false);
    },
    [openFile]
  );

  // Keep the active row scrolled into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (hits.length ? Math.min(i + 1, hits.length - 1) : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(hits[active]);
    }
  };

  const queryTrimmed = query.trim();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center no-print"
      style={{ background: "rgba(0,0,0,0.35)", paddingTop: "10vh" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="w-[680px] max-w-[94vw] max-h-[72vh] rounded-2xl overflow-hidden flex flex-col animate-fade-in outline-none"
        style={{ background: "var(--bg)", boxShadow: "var(--shadow-popover)" }}
        onKeyDown={onKeyDown}
      >
        {/* Search input row */}
        <div
          className="flex items-center gap-2 px-4 h-12 shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <Search size={16} style={{ color: "var(--muted)" }} className="shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("folderSearch.placeholder")}
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: "var(--text)" }}
            spellCheck={false}
          />
          <button onClick={close} className="icon-btn !p-1.5" title={t("settings.closeTooltip")}>
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {!currentFolder ? (
            <Empty text={t("fileTree.noFolderOpen")} />
          ) : queryTrimmed.length < MIN_CHARS ? (
            <Empty text={t("folderSearch.minCharsHint", { min: MIN_CHARS })} />
          ) : loading ? (
            <Empty text={t("folderSearch.searching")} />
          ) : hits.length === 0 ? (
            <Empty text={t("folderSearch.noResults")} />
          ) : (
            <>
              {hits.map((hit, i) => (
                <button
                  key={`${hit.path}:${hit.line}:${i}`}
                  data-idx={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(hit)}
                  className="w-full text-left px-4 py-2 flex flex-col gap-0.5"
                  style={{
                    background: i === active ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent",
                  }}
                >
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-[13px] font-medium truncate" style={{ color: "var(--text)" }}>
                      {hit.name}
                    </span>
                    <span className="text-[11px] shrink-0" style={{ color: "var(--muted)" }}>
                      {t("folderSearch.lineNumber", { line: hit.line })}
                    </span>
                  </div>
                  <div className="text-[12px] leading-snug break-words" style={{ color: "var(--muted)" }}>
                    {highlight(hit.text, queryTrimmed)}
                  </div>
                </button>
              ))}
              {truncated && (
                <div
                  className="px-4 py-2 text-[11px] text-center"
                  style={{ color: "var(--muted)", borderTop: "1px solid var(--border)" }}
                >
                  {t("folderSearch.truncatedNotice")}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="px-4 py-8 text-center text-[12px]" style={{ color: "var(--muted)" }}>
      {text}
    </div>
  );
}

/** Highlight every case-insensitive occurrence of `query` within `text`. */
function highlight(text: string, query: string) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  let key = 0;
  while (true) {
    const idx = lower.indexOf(needle, from);
    if (idx === -1) {
      parts.push(text.slice(from));
      break;
    }
    if (idx > from) parts.push(text.slice(from, idx));
    parts.push(
      <mark
        key={key++}
        style={{
          background: "color-mix(in srgb, var(--accent) 30%, transparent)",
          color: "var(--text)",
          borderRadius: 2,
        }}
      >
        {text.slice(idx, idx + needle.length)}
      </mark>
    );
    from = idx + needle.length;
  }
  return parts;
}
