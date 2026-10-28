import { Loader2, X } from "lucide-react";
import { useAppStore } from "../../store/app";
import { ToastPill } from "./ToastPill";
import { cancelClaudeTask, getTask } from "../../lib/aiTasks";
import { useT } from "../../lib/i18n";

/**
 * AI task progress indicator + cancel. claude `-p` prints everything at completion, so
 * there is no progress (%), only an indeterminate spinner. cur/total only for chunked
 * (translation) runs. taskDoc supplies the task name shown.
 */
export function TranslationIndicator() {
  const t = useT();
  const translating = useAppStore((s) => s.translating);
  const progress = useAppStore((s) => s.translateProgress);
  const taskDoc = useAppStore((s) => s.taskDoc);
  if (!translating) return null;
  const task = taskDoc ? getTask(taskDoc.taskId) : undefined;
  const name = task ? t(task.labelKey) : "";
  const label = progress
    ? t("translationIndicator.progress", { name, cur: progress.cur, total: progress.total })
    : t("translationIndicator.label", { name });
  return (
    <ToastPill>
      <Loader2 size={14} className="animate-spin" />
      <span className="tabular-nums">{label}</span>
      <button
        onClick={() => void cancelClaudeTask()}
        className="ml-1 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[12px] opacity-80 hover:opacity-100"
        style={{ background: "rgba(127,127,127,0.25)" }}
        title={t("translationIndicator.cancelTooltip")}
      >
        <X size={12} />
        {t("common.cancel")}
      </button>
    </ToastPill>
  );
}
