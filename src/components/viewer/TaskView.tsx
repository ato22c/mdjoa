import { useEffect, useRef, useState } from "react";
import { X, FilePlus, Eye, Pencil, Copy } from "lucide-react";
import { useAppStore } from "../../store/app";
import { MOD_LABEL } from "../../lib/platform";
import { useT } from "../../lib/i18n";
import { renderMarkdown, initHighlighter, highlightPendingCode } from "../../lib/markdown";
import { cancelClaudeTask, getTask, saveTaskResultAsNew, type OutputKind } from "../../lib/aiTasks";
import "../../styles/markdown.css";

// One side (source or translation) panel.
// - raw=false: Markdown render + Shiki coloring (reuses MarkdownViewer's render path).
// - raw=true: shows the raw Markdown text in an editable textarea (for copying), with a "복사" button.
function Pane({
  content,
  baseDir,
  isDark,
  raw,
  scrollRef,
  onScroll,
}: {
  content: string;
  baseDir: string | null;
  isDark: boolean;
  raw: boolean;
  scrollRef?: React.RefObject<HTMLDivElement>;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [html, setHtml] = useState("");
  const showToast = useAppStore((s) => s.showToast);
  const t = useT();

  useEffect(() => {
    initHighlighter();
  }, []);
  useEffect(() => {
    if (raw) return; // no rendering in text mode
    let cancelled = false;
    renderMarkdown(content, baseDir, isDark, { highlight: false }).then(({ html: rendered }) => {
      if (!cancelled) setHtml(rendered);
    });
    return () => {
      cancelled = true;
    };
  }, [content, baseDir, isDark, raw]);
  useEffect(() => {
    if (raw) return;
    if (ref.current) void highlightPendingCode(ref.current, isDark);
  }, [html, isDark, raw]);

  const copy = () => {
    const text = taRef.current?.value ?? content;
    navigator.clipboard
      .writeText(text)
      .then(() => showToast(t("editor.copiedToClipboard")))
      .catch(() => showToast(t("editor.copyFailed")));
  };

  if (raw) {
    return (
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="shrink-0 flex justify-end px-2 py-1" style={{ borderBottom: "1px solid var(--border)" }}>
          <button
            onClick={copy}
            className="flex items-center gap-1 rounded-md px-2 h-7 text-[12px]"
            style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
            title={t("taskView.copyPaneTooltip")}
          >
            <Copy size={13} /> {t("common.copy")}
          </button>
        </div>
        <textarea
          ref={taRef}
          defaultValue={content}
          spellCheck={false}
          className="flex-1 w-full resize-none outline-none font-mono text-[13px] px-4 py-3"
          style={{ background: "var(--bg)", color: "var(--fg)", lineHeight: 1.6 }}
        />
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="flex-1 min-w-0 overflow-auto"
      style={{
        padding: "28px 32px",
        // Query container for `.md-table-wrap`'s cqw-based sizing in
        // markdown.css (see MarkdownViewer.tsx) — this pane can render a
        // table too (AI task output), so it needs the same container.
        containerType: "inline-size",
      }}
    >
      <div className="md-content" style={{ maxWidth: 760, margin: "0 auto" }}>
        <div ref={ref} className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

// Side-by-side 2-pane view of an AI document task result (source / result). Closes with Esc/✕.
// Header buttons, scroll sync and body editability depend on output (only replace is editable).
export function TaskView() {
  const t = useT();
  const { currentContent, currentFile, settings } = useAppStore();
  const showToast = useAppStore((s) => s.showToast);
  const taskDoc = useAppStore((s) => s.taskDoc);
  const closeTaskResult = useAppStore((s) => s.closeTaskResult);

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  // Remember the element whose scrollTop was changed programmatically.
  // Instead of RAF, clear the flag when that element's scroll event arrives, which
  // blocks the feedback loop: RAF clears first -> event arrives late -> reverse sync.
  const programmaticTarget = useRef<HTMLDivElement | null>(null);

  const syncScroll = (source: HTMLDivElement, target: HTMLDivElement) => {
    const max = source.scrollHeight - source.clientHeight;
    const ratio = max > 0 ? source.scrollTop / max : 0;
    programmaticTarget.current = target;
    target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
  };

  const onLeftScroll: React.UIEventHandler<HTMLDivElement> = (e) => {
    if (programmaticTarget.current === e.currentTarget) {
      programmaticTarget.current = null;
      return;
    }
    if (rightRef.current) syncScroll(e.currentTarget, rightRef.current);
  };
  const onRightScroll: React.UIEventHandler<HTMLDivElement> = (e) => {
    if (programmaticTarget.current === e.currentTarget) {
      programmaticTarget.current = null;
      return;
    }
    if (leftRef.current) syncScroll(e.currentTarget, leftRef.current);
  };
  // Text (edit) mode: both panels become raw Markdown textareas, for copying/checking.
  // Kept in the store so the global ⌘E shortcut (AppShell) can toggle it while keeping the split.
  const raw = useAppStore((s) => s.translationRaw);
  const toggleRaw = useAppStore((s) => s.toggleTranslationRaw);
  const translating = useAppStore((s) => s.translating);

  const isDark =
    settings.theme === "dark" ||
    (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  // Close (X/Esc): also cancels the task if it is still running, so a result finishing
  // after close cannot reopen the split or keep running in the background. No-op if idle.
  const close = () => {
    void cancelClaudeTask();
    closeTaskResult();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void cancelClaudeTask();
        closeTaskResult();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeTaskResult]);

  if (!taskDoc) return null;
  const task = getTask(taskDoc.taskId);
  const output: OutputKind = task?.output ?? "replace";
  const label = task ? t(task.labelKey) : "";
  const effectiveRaw = output === "replace" && raw; // edit/view toggle only for replace
  const copyResult = () => {
    navigator.clipboard
      .writeText(taskDoc.content)
      .then(() => showToast(t("editor.copiedToClipboard")))
      .catch(() => showToast(t("editor.copyFailed")));
  };

  const baseDir = currentFile ? currentFile.replace(/[\\/][^\\/]+$/, "") : null;

  return (
    <div className="relative flex-1 overflow-hidden flex flex-col">
      {/* Header: task name + (replace only) text/render toggle + copy + (if saveSuffix) save + close */}
      <div
        className="no-print shrink-0 flex items-center gap-2 px-4 h-9 text-[12px]"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)" }}
      >
        <span style={{ color: "var(--muted)" }}>{t("taskView.header", { label })}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {output === "replace" && (
            <button
              onClick={toggleRaw}
              className="flex items-center gap-1 rounded-md px-2 h-7 text-[12px]"
              style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
              title={raw ? t("topbar.viewModeTooltip", { mod: MOD_LABEL }) : t("topbar.editModeTooltip", { mod: MOD_LABEL })}
            >
              {raw ? <Eye size={13} /> : <Pencil size={13} />}
              {raw ? t("taskView.viewModeLabel") : t("taskView.editModeLabel")}
            </button>
          )}
          <button
            onClick={copyResult}
            className="flex items-center gap-1 rounded-md px-2 h-7 text-[12px]"
            style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
            title={t("common.copy")}
          >
            <Copy size={13} /> {t("common.copy")}
          </button>
          {task?.saveSuffix && (
            <button
              onClick={() => void saveTaskResultAsNew()}
              className="flex items-center gap-1 rounded-md px-2 h-7 text-[12px]"
              style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
              title={t("taskView.saveAsNewButton")}
            >
              <FilePlus size={13} /> {t("taskView.saveAsNewButton")}
            </button>
          )}
          <button onClick={close} className="icon-btn !p-1" title={t("settings.closeTooltip")}>
            <X size={14} />
          </button>
        </div>
      </div>
      {/* Body: source on the left / task result on the right (in edit mode both are textareas, replace only) */}
      <div className="flex-1 min-h-0 flex">
        <Pane
          content={currentContent ?? ""}
          baseDir={baseDir}
          isDark={isDark}
          raw={effectiveRaw}
          scrollRef={leftRef}
          onScroll={output === "replace" ? onLeftScroll : undefined}
        />
        <div className="w-px shrink-0" style={{ background: "var(--border)" }} />
        {translating && !taskDoc.content ? (
          <div className="flex-1 flex items-center justify-center" style={{ color: "var(--muted)" }}>
            <span className="text-sm">{t("taskView.workingLabel", { label })}</span>
          </div>
        ) : (
          <Pane
            content={taskDoc.content}
            baseDir={baseDir}
            isDark={isDark}
            raw={effectiveRaw}
            scrollRef={rightRef}
            onScroll={output === "replace" ? onRightScroll : undefined}
          />
        )}
      </div>
    </div>
  );
}
