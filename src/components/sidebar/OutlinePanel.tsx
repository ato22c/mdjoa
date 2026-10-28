import { Bookmark as BookmarkIcon } from "lucide-react";
import { useAppStore } from "../../store/app";
import { useT } from "../../lib/i18n";
import { isMarkdownPath } from "../../lib/fileType";

function scrollTo(id: string) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function OutlinePanel() {
  const t = useT();
  const headings = useAppStore((s) => s.headings);
  const activeHeadingId = useAppStore((s) => s.activeHeadingId);
  const bookmarks = useAppStore((s) => s.bookmarks);
  const toggleBookmark = useAppStore((s) => s.toggleBookmark);
  const currentFile = useAppStore((s) => s.currentFile);

  if (headings.length === 0) {
    // Distinguish an empty outline because a Markdown doc has no headings from file types
    // that can't have an outline at all (code/text, PDF/HTML, no file open).
    const canHaveOutline = !!currentFile && isMarkdownPath(currentFile);
    return (
      <div className="px-4 py-2 text-[14px]" style={{ color: "var(--muted)" }}>
        {t(canHaveOutline ? "outlinePanel.empty" : "outlinePanel.unsupported")}
      </div>
    );
  }

  const bookmarkedIds = new Set(bookmarks.map((b) => b.heading_id));

  return (
    <div className="overflow-y-auto h-full">
      {/* Bookmarks sub-section (only when this file has any) */}
      {bookmarks.length > 0 && (
        <div className="pb-2 px-2" style={{ borderBottom: "1px solid var(--border)" }}>
          <div
            className="flex items-center gap-1.5 h-7 px-2 text-[12px] font-medium"
            style={{ color: "var(--muted)" }}
          >
            <BookmarkIcon size={11} fill="currentColor" />
            {t("outlinePanel.bookmarksHeader")}
          </div>
          {bookmarks.map((b) => (
            <button
              key={b.heading_id}
              onClick={() => scrollTo(b.heading_id)}
              className="row-hover w-full text-left px-2 py-1 rounded-md truncate block text-[0.75rem]"
              style={{ color: "var(--fg-secondary)", paddingLeft: `${8 + (b.level - 1) * 10}px` }}
            >
              {b.text}
            </button>
          ))}
        </div>
      )}

      {/* Full outline */}
      <div className="pb-2 px-2">
        {headings.map((h) => {
          const isActive = h.id === activeHeadingId;
          const marked = bookmarkedIds.has(h.id);
          return (
            <div
              key={h.id}
              className="row-hover group flex items-center rounded-md"
              style={{ background: isActive ? "var(--hover)" : undefined }}
            >
              <button
                onClick={() => scrollTo(h.id)}
                className="flex-1 text-left px-2 py-1 truncate min-w-0"
                style={{
                  paddingLeft: `${8 + (h.level - 1) * 12}px`,
                  color: isActive
                    ? "var(--accent)"
                    : h.level <= 2
                      ? "var(--fg-secondary)"
                      : "var(--muted)",
                  fontWeight: isActive ? 600 : h.level === 1 ? 500 : 400,
                  fontSize: h.level === 1 ? "0.8rem" : "0.75rem",
                }}
              >
                {h.text}
              </button>
              <button
                onClick={() => toggleBookmark(h)}
                className={`shrink-0 p-1 mr-1 rounded hover:bg-[var(--hover)] transition-opacity ${
                  marked ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
                title={marked ? t("outlinePanel.removeBookmarkTooltip") : t("outlinePanel.addBookmarkTooltip")}
              >
                <BookmarkIcon
                  size={12}
                  fill={marked ? "currentColor" : "none"}
                  style={{ color: marked ? "var(--accent)" : "var(--muted)" }}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
