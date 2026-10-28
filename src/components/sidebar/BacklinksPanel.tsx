import { Link2 } from "lucide-react";
import { useAppStore } from "../../store/app";
import { useT } from "../../lib/i18n";

/**
 * Backlinks panel (feature F / #10). Lists files in the current folder that
 * reference the open document via `[[…]]`. The scan is kicked off on-demand by
 * `openFile` → `scanBacklinks` (cached per path). Renders NOTHING when there are
 * no backlinks (minimal chrome — the panel only appears when it has content).
 * Clicking an item opens that file.
 */
export function BacklinksPanel() {
  const t = useT();
  const backlinks = useAppStore((s) => s.backlinks);
  const truncated = useAppStore((s) => s.backlinksTruncated);
  const openFile = useAppStore((s) => s.openFile);

  // Hide the panel when there are 0 results (spec).
  if (backlinks.length === 0) return null;

  return (
    <div
      className="shrink-0 px-2 pt-2 pb-1"
      style={{ borderTop: "1px solid var(--border)" }}
    >
      <div
        className="flex items-center gap-1.5 h-7 px-2 text-[12px] font-medium"
        style={{ color: "var(--muted)" }}
        title={t("backlinksPanel.headerTooltip")}
      >
        <Link2 size={11} className="shrink-0" />
        <span className="truncate">{t("backlinksPanel.header")}</span>
        <span className="shrink-0" style={{ opacity: 0.7 }}>{backlinks.length}</span>
      </div>
      <div className="max-h-40 overflow-y-auto">
        {backlinks.map((b) => (
          <button
            key={b.path}
            onClick={() => openFile(b.path)}
            title={b.path}
            className="row-hover w-full text-left px-2 py-1 rounded-md truncate block text-[0.75rem]"
            style={{ color: "var(--fg-secondary)" }}
          >
            {b.name}
          </button>
        ))}
      </div>
      {truncated && (
        <div className="px-2 py-0.5 text-[10px]" style={{ color: "var(--muted)" }}>
          {t("backlinksPanel.truncatedNotice")}
        </div>
      )}
    </div>
  );
}
