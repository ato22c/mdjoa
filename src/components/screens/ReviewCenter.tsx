import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, FilePlus2, FilePenLine, FileX2, ExternalLink } from "lucide-react";
import { useAppStore } from "../../store/app";
import { useT } from "../../lib/i18n";
import { lineDiff, toSideBySideRows } from "../../lib/lineDiff";
import { sortReviewItems, resolveBeforeAfter, type ReviewItem, type ReviewKind } from "../../lib/reviewDiff";
import { parentSegments } from "../../lib/pathUtil";
import "../../styles/markdown.css";

/**
 * AI change review center (killer #1) — right after an AI agent edits several MD files on
 * disk, review "what changed" as a line-by-line diff on a single screen.
 *
 * Left: changedFiles list (kind badges). Right: diff between the selected file's baseline
 * and its current disk content (same look as CompareView, reusing lineDiff). Read-only —
 * never writes to disk.
 *
 * Visibility is owned solely by store.reviewOpen. Esc closes it.
 */

// Cap on lines processed per item so the diff can't blow up. Beyond it, truncate and show a notice.
const MAX_DIFF_LINES = 4000;

const KIND_COLOR_ICON: Record<ReviewKind, { color: string; Icon: typeof FilePlus2 }> = {
  created: { color: "#2ea043", Icon: FilePlus2 },
  modified: { color: "#d29922", Icon: FilePenLine },
  deleted: { color: "#f85149", Icon: FileX2 },
};

export function ReviewCenter() {
  const t = useT();
  const KIND_META: Record<ReviewKind, { label: string; color: string; Icon: typeof FilePlus2 }> = {
    created: { label: t("reviewCenter.kindCreated"), ...KIND_COLOR_ICON.created },
    modified: { label: t("reviewCenter.kindModified"), ...KIND_COLOR_ICON.modified },
    deleted: { label: t("reviewCenter.kindDeleted"), ...KIND_COLOR_ICON.deleted },
  };
  const reviewOpen = useAppStore((s) => s.reviewOpen);
  const setReviewOpen = useAppStore((s) => s.setReviewOpen);
  const changedFiles = useAppStore((s) => s.changedFiles);
  const reviewBaseline = useAppStore((s) => s.reviewBaseline);
  const clearAllChanges = useAppStore((s) => s.clearAllChanges);
  const openFile = useAppStore((s) => s.openFile);
  const zoom = useAppStore((s) => s.zoom);

  const items = useMemo<ReviewItem[]>(() => sortReviewItems(changedFiles), [changedFiles]);

  // Selected file path. When the list changes, correct it to a valid selection.
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // Current disk content of the selected file (null = not loaded yet / read failed = file missing).
  const [diskContent, setDiskContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // On open (or when the list changes), reset the selection to the first item.
  useEffect(() => {
    if (!reviewOpen) return;
    if (selectedPath && items.some((i) => i.path === selectedPath)) return;
    setSelectedPath(items.length > 0 ? items[0].path : null);
  }, [reviewOpen, items, selectedPath]);

  const selected = useMemo(
    () => items.find((i) => i.path === selectedPath) ?? null,
    [items, selectedPath]
  );

  // Parent folder hint (last 2 levels) — shown in the header next to the file name.
  const shortDir = useMemo(
    () => (selected ? parentSegments(selected.path).slice(-2).join("/") : ""),
    [selected]
  );

  // Read the selected file's disk content (selected file only — no precomputing for all).
  // A read failure is safely treated as "file missing (deleted)" and never throws.
  useEffect(() => {
    if (!reviewOpen || !selected) {
      setDiskContent(null);
      return;
    }
    // Deleted items don't read the disk (after = "").
    if (selected.kind === "deleted") {
      setDiskContent(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    invoke<{ content: string }>("read_file", { path: selected.path })
      .then((r) => {
        if (!cancelled) setDiskContent(r.content);
      })
      .catch(() => {
        // Read failed (the file may be gone) -> leave after empty.
        if (!cancelled) setDiskContent(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reviewOpen, selected]);

  // If the selected file vanished from disk, treat it as "deleted" and show a notice.
  const effectiveKind: ReviewKind | null = selected
    ? selected.kind !== "deleted" && diskContent === null && !loading
      ? "deleted"
      : selected.kind
    : null;

  const { lines, truncated } = useMemo(() => {
    if (!selected || effectiveKind === null) return { lines: [], truncated: false };
    const { before, after } = resolveBeforeAfter(
      effectiveKind,
      reviewBaseline[selected.path],
      diskContent
    );
    const all = lineDiff(before, after);
    if (all.length > MAX_DIFF_LINES) {
      return { lines: all.slice(0, MAX_DIFF_LINES), truncated: true };
    }
    return { lines: all, truncated: false };
  }, [selected, effectiveKind, reviewBaseline, diskContent]);

  // Convert to left/right 2-pane rows (left = before / right = current). lines is already memoized.
  const rows = useMemo(() => toSideBySideRows(lines), [lines]);

  const close = useCallback(() => setReviewOpen(false), [setReviewOpen]);

  // Close with Esc.
  useEffect(() => {
    if (!reviewOpen) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [reviewOpen, close]);

  const onOpenInViewer = useCallback(
    async (path: string) => {
      close();
      await openFile(path);
    },
    [close, openFile]
  );

  if (!reviewOpen) return null;

  const count = items.length;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center no-print"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="w-[920px] max-w-[94vw] h-[78vh] max-h-[78vh] rounded-2xl overflow-hidden flex flex-col animate-fade-in"
        style={{ background: "var(--bg)", boxShadow: "var(--shadow-popover)" }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 h-12 shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <span className="text-sm font-semibold">{t("reviewCenter.title")}</span>
          <span className="text-[12px]" style={{ color: "var(--muted)" }}>
            {t("reviewCenter.changeCount", { count })}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {count > 0 && (
              <button
                onClick={() => {
                  clearAllChanges();
                  close();
                }}
                className="row-hover flex items-center gap-1.5 rounded-lg px-3 h-8 text-[13px]"
                style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
                title={t("reviewCenter.markAllTooltip")}
              >
                {t("reviewCenter.markAllButton")}
              </button>
            )}
            <button onClick={close} className="icon-btn !p-1.5" title={t("settings.closeTooltip")}>
              <X size={16} />
            </button>
          </div>
        </div>

        {count === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[13px]" style={{ color: "var(--muted)" }}>
            {t("reviewCenter.noChanges")}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex">
            {/* Left: list of changed files */}
            <div
              className="w-[260px] shrink-0 overflow-y-auto py-1.5"
              style={{ borderRight: "1px solid var(--border)" }}
            >
              {items.map((item) => {
                const meta = KIND_META[item.kind];
                const Icon = meta.Icon;
                const active = item.path === selectedPath;
                return (
                  <button
                    key={item.path}
                    onClick={() => setSelectedPath(item.path)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
                    style={{ background: active ? "var(--active)" : "transparent" }}
                    title={item.path}
                  >
                    <Icon size={14} className="shrink-0" style={{ color: meta.color }} />
                    <span
                      className="text-[13px] truncate flex-1 min-w-0"
                      style={{
                        color: "var(--fg)",
                        textDecoration: item.kind === "deleted" ? "line-through" : undefined,
                      }}
                    >
                      {item.name}
                    </span>
                    <span
                      className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full"
                      style={{ background: "var(--hover)", color: meta.color }}
                    >
                      {meta.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Right: line-by-line diff of the selected file */}
            <div className="flex-1 min-w-0 flex flex-col">
              {selected && (
                <div
                  className="shrink-0 flex items-center gap-2 px-4 h-10 text-[12px]"
                  style={{ borderBottom: "1px solid var(--border)", color: "var(--fg)" }}
                >
                  <span className="font-medium truncate min-w-0" title={selected.path}>
                    {selected.name}
                    {shortDir && (
                      <span className="ml-1.5 font-normal" style={{ color: "var(--muted)" }}>
                        {shortDir}
                      </span>
                    )}
                  </span>
                  {effectiveKind !== "deleted" && (
                    <button
                      onClick={() => void onOpenInViewer(selected.path)}
                      className="icon-btn !p-1 ml-auto shrink-0"
                      title={t("welcome.openFile")}
                      aria-label={t("welcome.openFile")}
                    >
                      <ExternalLink size={14} />
                    </button>
                  )}
                </div>
              )}

              {/* Left/right column headers: state which side is before/current (needed because context lines are uncolored). */}
              {selected && !loading && (
                <div
                  className="shrink-0 grid text-[11px] font-medium"
                  style={{ gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}
                >
                  <div className="px-5 py-1">{t("reviewCenter.beforeColumn")}</div>
                  <div className="px-5 py-1" style={{ borderLeft: "1px solid var(--border)" }}>{t("reviewCenter.afterColumn")}</div>
                </div>
              )}

              <div
                className="flex-1 min-h-0 overflow-auto"
                style={{ padding: "16px 20px 40px" }}
              >
                {loading ? (
                  <div className="text-[13px]" style={{ color: "var(--muted)" }}>
                    {t("reviewCenter.loading")}
                  </div>
                ) : (
                  <>
                    {effectiveKind === "deleted" && (
                      <div className="text-[12px] mb-3" style={{ color: "#f85149" }}>
                        {t("reviewCenter.fileDeletedNotice")}
                      </div>
                    )}
                    {reviewBaseline[selected?.path ?? ""] === undefined &&
                      effectiveKind !== "deleted" &&
                      effectiveKind !== "created" && (
                        <div className="text-[12px] mb-3" style={{ color: "var(--muted)" }}>
                          {t("reviewCenter.noBaselineNotice")}
                        </div>
                      )}
                    <div className="md-content w-full" style={{ zoom }}>
                      <div className="compare-split">
                        {rows.map((r, i) => (
                          <div key={i} className="compare-split-row">
                            {/* Left: previous document (remove/context). Added lines are blank. */}
                            <div className={`compare-cell${r.left?.type === "remove" ? " compare-remove" : ""}`}>
                              <span className="compare-lineno" aria-hidden="true">{r.left?.baseLineNo ?? ""}</span>
                              <span className="compare-text">{r.left ? (r.left.text === "" ? " " : r.left.text) : ""}</span>
                            </div>
                            {/* Right: current document (add/context). Removed lines are blank. */}
                            <div className={`compare-cell${r.right?.type === "add" ? " compare-add" : ""}`}>
                              <span className="compare-lineno" aria-hidden="true">{r.right?.otherLineNo ?? ""}</span>
                              <span className="compare-text">{r.right ? (r.right.text === "" ? " " : r.right.text) : ""}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {truncated && (
                      <div className="text-[12px] mt-3" style={{ color: "var(--muted)" }}>
                        {t("reviewCenter.truncatedNotice", { max: MAX_DIFF_LINES.toLocaleString() })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
