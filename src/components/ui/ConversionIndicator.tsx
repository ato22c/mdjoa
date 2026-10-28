import { Loader2 } from "lucide-react";
import { useAppStore } from "../../store/app";
import { usePandocProgress } from "../../hooks/usePandocProgress";
import { useT } from "../../lib/i18n";
import { ToastPill } from "./ToastPill";

/**
 * Global progress indicator for the pandoc download / DOCX conversion that the
 * export flow (lib/convert.ts) drives via the store flags. Without this the
 * ExportMenu → Word path gave no feedback during a ~100MB download. The
 * SettingsModal shows the same progress inline while it is open.
 */
export function ConversionIndicator() {
  const downloading = useAppStore((s) => s.pandocDownloading);
  const converting = useAppStore((s) => s.converting);
  const pct = usePandocProgress(downloading);
  const t = useT();

  if (!downloading && !converting) return null;

  const label = downloading ? t("conversionIndicator.downloading") : t("conversionIndicator.converting");

  return (
    <ToastPill>
      <Loader2 size={14} className="animate-spin" />
      <span className="tabular-nums">
        {label}
        {pct !== null ? ` · ${pct}%` : "…"}
      </span>
    </ToastPill>
  );
}
