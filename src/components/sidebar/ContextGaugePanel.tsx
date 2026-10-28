import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, ClipboardCopy } from "lucide-react";
import { useAppStore } from "../../store/app";
import { useT } from "../../lib/i18n";
import { countTokensExact } from "../../lib/tokenizer";
import { buildContextPrompt } from "../../lib/contextPrompt";
import {
  approxTokens,
  sumTokens,
  displayPercent,
  gaugeFillPercent,
  isOverBudget,
  isStaleSelection,
  normalizeWindow,
  MODEL_PRESETS,
} from "../../lib/contextTokens";

/**
 * Combined tokens + context window gauge (feature D).
 *
 * Appears at the bottom of the sidebar when 2+ files are selected in the Context section.
 * Minimal guard: with 0/1 selected it renders NOTHING (return null) — no gauge chrome.
 *
 * Calculation flow (spec):
 *  1) When the selection changes, read each file serially with read_file and first fill
 *     in the total with a chars/4 "approximation" right away (feels fast).
 *  2) Then sum the same text serially with countTokensExact (lazy BPE) and update to the
 *     "exact value".
 *  3) Cancellable: take a selection snapshot when the calculation starts, and after every
 *     await compare it with the current selection (isStaleSelection); if it differs, discard
 *     the result (stale discard). Effect cleanup (alive=false) aborts immediately when the
 *     panel closes or the selection changes again.
 */
export function ContextGaugePanel() {
  const t = useT();
  const selectedContextPaths = useAppStore((s) => s.selectedContextPaths);
  const clearContextSelection = useAppStore((s) => s.clearContextSelection);
  const showToast = useAppStore((s) => s.showToast);
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  // (No right-click menu — the sidebar has no zoom/theme items. The browser's default
  //  menu is blocked by AppShell's window-level handler.)

  // total tokens; `exact` flips true once the BPE pass completes for the
  // current selection. While false the number is the chars/4 approximation.
  const [total, setTotal] = useState(0);
  const [exact, setExact] = useState(false);
  const [busy, setBusy] = useState(false);
  // Guards a double-click while files are still being read for the prompt copy.
  const [copying, setCopying] = useState(false);
  // direct-input draft (string so the field can be edited freely).
  const [windowDraft, setWindowDraft] = useState(String(settings.context_window));
  const draftFocused = useRef(false);

  const window = settings.context_window;
  const count = selectedContextPaths.length;
  // Show as soon as 1 context file is checked (per user request).
  const show = count >= 1;

  // Keep the direct-input field in sync when the stored window changes
  // (preset click, settings load) — but not while the user is typing in it.
  useEffect(() => {
    if (!draftFocused.current) setWindowDraft(String(window));
  }, [window]);

  // Serial + cancelable sum. Re-runs whenever the selection changes.
  useEffect(() => {
    if (!show) {
      setTotal(0);
      setExact(false);
      setBusy(false);
      return;
    }
    let alive = true;
    // Snapshot the selection that THIS run is computing for. If the live
    // selection diverges mid-flight we throw the partial/final result away.
    const snapshot = [...selectedContextPaths];
    const liveSelection = () => useAppStore.getState().selectedContextPaths;

    setExact(false);
    setBusy(true);

    (async () => {
      // Phase 1: serial read + chars/4 approximation, accumulated as we go so
      // the gauge fills progressively rather than only at the end.
      const texts: string[] = [];
      let approxAcc = 0;
      for (const path of snapshot) {
        let content: string;
        try {
          const res = await invoke<{ content: string }>("read_file", { path });
          content = res.content;
        } catch {
          content = ""; // unreadable file contributes 0 — never breaks the sum
        }
        if (!alive || isStaleSelection(snapshot, liveSelection())) return; // stale → drop
        texts.push(content);
        approxAcc += approxTokens(content);
        setTotal(approxAcc);
      }

      // Phase 2: exact BPE, serial. Replace the approximation when done.
      const exactCounts: number[] = [];
      for (const text of texts) {
        let n: number;
        try {
          n = await countTokensExact(text, "o200k");
        } catch {
          n = approxTokens(text); // tokenizer chunk failed → keep approximation
        }
        if (!alive || isStaleSelection(snapshot, liveSelection())) return; // stale → drop
        exactCounts.push(n);
      }
      if (!alive || isStaleSelection(snapshot, liveSelection())) return;
      setTotal(sumTokens(exactCounts));
      setExact(true);
      setBusy(false);
    })();

    return () => {
      alive = false;
    };
  }, [show, selectedContextPaths]);

  if (!show) return null;

  const over = isOverBudget(total, window);
  const fill = gaugeFillPercent(total, window);
  const pct = displayPercent(total, window);
  const barColor = over ? "var(--danger, #e05252)" : "var(--accent)";

  // "프롬프트로 복사" (copy as prompt): read the selected docs in selection order, join them with
  // file-boundary headers, and copy to the clipboard. A file that can't be read
  // is skipped (never throws) and reported in the toast. The selection snapshot
  // is captured up front so it stays stable even if the user toggles mid-read.
  const copyAsPrompt = async () => {
    if (copying) return;
    const snapshot = [...selectedContextPaths];
    if (snapshot.length === 0) return; // panel hides at 0; defensive guard
    setCopying(true);
    try {
      const files: { name: string; content: string }[] = [];
      let failed = 0;
      let approxAcc = 0;
      for (const path of snapshot) {
        try {
          const res = await invoke<{ content: string }>("read_file", { path });
          // Prefer the file name; the gauge/section already disambiguate via dir.
          const name = path.replace(/^.*[\\/]/, "") || path;
          files.push({ name, content: res.content });
          approxAcc += approxTokens(res.content);
        } catch {
          failed += 1; // skip this file, keep going — never break the whole copy
        }
      }
      if (files.length === 0) {
        showToast(t("contextGauge.copyReadFailed"));
        return;
      }
      const prompt = buildContextPrompt(files);
      await navigator.clipboard.writeText(prompt);
      const base = t("contextGauge.copySuccess", { count: files.length, tokens: approxAcc.toLocaleString() });
      showToast(failed > 0 ? `${base}${t("contextGauge.copySkippedSuffix", { count: failed })}` : base);
    } catch {
      showToast(t("contextGauge.copyFailed"));
    } finally {
      setCopying(false);
    }
  };

  const commitDraft = () => {
    draftFocused.current = false;
    const normalized = normalizeWindow(Number(windowDraft));
    if (normalized == null) {
      setWindowDraft(String(window)); // invalid → revert to stored
      return;
    }
    if (normalized !== window) {
      setSettings({ context_window: normalized });
      saveSettings();
    }
    setWindowDraft(String(normalized));
  };

  const pickPreset = (w: number) => {
    setSettings({ context_window: w });
    saveSettings();
  };

  return (
    <div
      className="shrink-0 px-3 py-2.5"
      style={{ borderTop: "1px solid var(--border)", background: "var(--sidebar-bg)" }}
    >
      <div className="flex items-center gap-1 mb-1.5">
        <span
          className="text-[12px] font-semibold uppercase tracking-wide"
          style={{ color: "var(--muted)", letterSpacing: "0.04em" }}
        >
          {t("contextGauge.totalTokensLabel")}
        </span>
        <span className="text-[12px] tabular-nums" style={{ color: "var(--muted)" }}>
          {t("contextGauge.selectedCount", { count })}
        </span>
        <button
          onClick={copyAsPrompt}
          disabled={copying}
          className="ml-auto p-0.5 rounded hover:bg-[var(--hover)] disabled:opacity-50"
          title={t("contextGauge.copyPromptTooltip")}
          aria-label={t("contextGauge.copyPromptLabel")}
        >
          <ClipboardCopy size={12} style={{ color: "var(--muted)" }} />
        </button>
        <button
          onClick={clearContextSelection}
          className="p-0.5 rounded hover:bg-[var(--hover)]"
          title={t("contextGauge.clearSelectionTooltip")}
          aria-label={t("contextGauge.clearSelectionTooltip")}
        >
          <X size={12} style={{ color: "var(--muted)" }} />
        </button>
      </div>

      {/* Numbers: total / window = pct%. The exact value fades in over the
          approximation without a layout shift (number swaps in place). */}
      <div className="flex items-baseline gap-1 mb-1.5 text-[14px] tabular-nums">
        <span
          className={busy && !exact ? "opacity-60" : "transition-opacity duration-150"}
          style={{ color: over ? "var(--danger, #e05252)" : "var(--fg)", fontWeight: 600 }}
        >
          {total.toLocaleString()}
        </span>
        <span style={{ color: "var(--muted)" }}>/ {window.toLocaleString()}</span>
        <span
          className="ml-auto"
          style={{ color: over ? "var(--danger, #e05252)" : "var(--muted)", fontWeight: over ? 600 : 400 }}
        >
          {pct}%{over ? t("contextGauge.overSuffix") : ""}
        </span>
      </div>

      {/* Bar gauge. Fill clamps to 100% even when over budget; over-budget is
          conveyed by the warning color + "초과" label above. */}
      <div
        className="w-full rounded-full overflow-hidden"
        style={{ height: 6, background: "var(--hover)" }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          style={{
            width: `${fill}%`,
            height: "100%",
            background: barColor,
            transition: "width 150ms ease",
          }}
        />
      </div>

      {/* Model presets + direct input. No cost($) estimate (spec). */}
      <div className="flex items-center gap-1 mt-2">
        {MODEL_PRESETS.map((p) => {
          const activePreset = p.window === window;
          return (
            <button
              key={p.label}
              onClick={() => pickPreset(p.window)}
              className="text-[12px] px-1.5 py-0.5 rounded transition-colors"
              style={{
                background: activePreset ? "var(--active)" : "var(--hover)",
                color: activePreset ? "var(--fg)" : "var(--muted)",
                fontWeight: activePreset ? 600 : 400,
              }}
              title={t("contextGauge.presetTooltip", { window: p.window.toLocaleString() })}
            >
              {p.label}
            </button>
          );
        })}
        <input
          type="number"
          value={windowDraft}
          min={1000}
          step={1000}
          onFocus={() => {
            draftFocused.current = true;
          }}
          onChange={(e) => setWindowDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="ml-auto w-20 text-[12px] tabular-nums px-1 py-0.5 rounded bg-transparent outline-none text-right"
          style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
          title={t("contextGauge.windowInputTooltip")}
          aria-label={t("contextGauge.windowInputLabel")}
        />
      </div>
    </div>
  );
}
