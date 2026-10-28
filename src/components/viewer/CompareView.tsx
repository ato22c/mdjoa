import { useMemo } from "react";
import { X } from "lucide-react";
import { useAppStore } from "../../store/app";
import { useT } from "../../lib/i18n";
import { lineDiff } from "../../lib/lineDiff";
import "../../styles/markdown.css";

/**
 * On-demand two-document compare (#27): a unified (single-column) line diff
 * between the current document and one the user picked. Git-style — additions
 * (대상 문서에만, green), removals (현재 문서에만, red), context (공통) in one
 * column. View-only; Esc/✕ returns to the single view.
 *
 * Direction is fixed: base = current document (currentContent), other = picked
 * document (compareContent). This matches the header legend.
 */

function nameOf(path: string | null): string {
  if (!path) return "";
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

export function CompareView() {
  const t = useT();
  const currentFile = useAppStore((s) => s.currentFile);
  const currentContent = useAppStore((s) => s.currentContent);
  const compareWith = useAppStore((s) => s.compareWith);
  const compareContent = useAppStore((s) => s.compareContent);
  const exitCompare = useAppStore((s) => s.exitCompare);
  const zoom = useAppStore((s) => s.zoom);

  const lines = useMemo(
    () => lineDiff(currentContent ?? "", compareContent ?? ""),
    [currentContent, compareContent]
  );

  // Guard: only render when actually comparing (AppShell already gates on this,
  // but keeps the component self-safe).
  if (compareWith == null || compareContent == null) return null;

  const currentName = nameOf(currentFile);
  const otherName = nameOf(compareWith);

  return (
    <div className="relative flex-1 overflow-hidden flex flex-col">
      {/* Header: which side is which + color legend + close. */}
      <div
        className="no-print shrink-0 flex items-center gap-3 px-4 h-11 text-[12px]"
        style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", color: "var(--fg)" }}
      >
        <span className="font-medium truncate min-w-0">
          {t("compareView.currentLabel")}<span style={{ color: "var(--fg-secondary)" }}>{currentName}</span>
          {"  ↔  "}{t("compareView.otherLabel")}<span style={{ color: "var(--fg-secondary)" }}>{otherName}</span>
        </span>
        <span className="shrink-0 flex items-center gap-3 text-[11px]" style={{ color: "var(--muted)" }}>
          <span className="flex items-center gap-1">
            <span className="compare-legend-swatch compare-remove" />
            {t("compareView.currentOnlyLegend")}
          </span>
          <span className="flex items-center gap-1">
            <span className="compare-legend-swatch compare-add" />
            {t("compareView.otherOnlyLegend")}
          </span>
        </span>
        <button
          onClick={exitCompare}
          className="icon-btn !p-1 ml-auto shrink-0"
          data-tooltip={t("compareView.closeTooltip")}
          title={t("compareView.closeTooltip")}
        >
          <X size={14} />
        </button>
      </div>

      {/* Body: unified single-column diff. Content-width-capped, horizontal
          scroll when a line overflows. */}
      <div
        className="flex-1 min-h-0 overflow-auto flex flex-col items-center"
        style={{ paddingTop: 24, paddingBottom: 120, paddingLeft: 32, paddingRight: 32 }}
      >
        <div className="md-content w-full" style={{ maxWidth: "900px", zoom }}>
          <div className="compare-diff">
            {lines.map((d, i) => (
              <div key={i} className={`compare-line compare-${d.type}`}>
                {/* Line numbers: current document / target document. Lines absent from a document are blank. */}
                <span className="compare-lineno" aria-hidden="true">{d.baseLineNo ?? ""}</span>
                <span className="compare-lineno" aria-hidden="true">{d.otherLineNo ?? ""}</span>
                <span className="compare-sign" aria-hidden="true">
                  {d.type === "add" ? "+" : d.type === "remove" ? "-" : " "}
                </span>
                {/* Render empty lines with a non-breaking space so the row has
                    height; real text preserves leading whitespace. */}
                <span className="compare-text">{d.text === "" ? " " : d.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
