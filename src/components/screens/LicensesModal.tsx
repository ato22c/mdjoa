import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useT } from "../../lib/i18n";
import rawLicensesText from "../../generated/third-party-licenses.txt?raw";

// The generated file carries a build-time note ("이 파일은 빌드 시 자동
// 생성됩니다 …") that is meaningful to developers but noise to end users.
// Strip that notice (and its trailing follow-up line) at render time so the
// viewer shows only license content. The source .txt stays untouched.
const licensesText = rawLicensesText.replace(
  /^이 파일은 빌드 시 자동 생성됩니다.*(?:\r?\n.*동봉.*의 라이선스를 포함합니다\.)?\r?\n?/m,
  "",
);

/**
 * Full-text open-source license viewer. Opened from the About section of the
 * settings modal. Shows the bundled-font OFL notices plus every production
 * dependency's license (generated at build time by scripts/gen-licenses.mjs).
 */
export function LicensesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  // Move focus into the panel on open so keyboard interactions are scoped here.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center no-print"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-[760px] max-w-[94vw] h-[80vh] rounded-2xl overflow-hidden flex flex-col animate-fade-in outline-none"
        style={{ background: "var(--bg)", boxShadow: "var(--shadow-popover)" }}
      >
        <div
          className="flex items-center justify-between px-5 h-12 shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <span className="text-sm font-semibold">{t("aboutModal.openSourceLicenses")}</span>
          <button onClick={onClose} className="icon-btn !p-1.5" title={t("settings.closeTooltip")}>
            <X size={16} />
          </button>
        </div>
        <pre
          className="flex-1 overflow-y-auto m-0 px-5 py-4 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono"
          style={{ color: "var(--text)" }}
        >
          {licensesText}
        </pre>
      </div>
    </div>
  );
}
