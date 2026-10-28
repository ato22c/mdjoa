import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Columns2, FileText, Save, Eye, Undo2, Redo2, Copy, ExternalLink, Link2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppStore } from "../../store/app";
import { useT } from "../../lib/i18n";
import { MOD_LABEL } from "../../lib/platform";
import { renderMarkdown, highlightCodeToHtml } from "../../lib/markdown";
import { isMarkdownPath, langFromPath } from "../../lib/fileType";
import * as editHistory from "../../lib/editHistory";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import { EditorFindBar } from "./EditorFindBar";
import { buildViewMenuItems } from "../../lib/contextMenuItems";
import { AUTO_SAVE_IDLE_MS, shouldAutoSave } from "../../lib/autoSave";
import { editorScrollTopForLine, editorLineAtScrollTop, editorLineTops } from "../../lib/editorScroll";
import "../../styles/markdown.css";

// Simple, typo-level edit mode: a plain <textarea> over the raw markdown with an
// optional split preview. Intentionally NOT a rich editor — no toolbar, no
// WYSIWYG. The textarea is the source of truth for `editContent`; saving and
// dirty-tracking live in the store.
export function Editor() {
  const {
    currentFile,
    untitledPath,
    editContent,
    setEditContent,
    isDirty,
    saveFile,
    setEditMode,
    settings,
    zoom,
    setZoom,
    setSettings,
    saveSettings,
    showToast,
    externalChanged,
    fileMissing,
    discardEditsReload,
    setHeadings,
  } = useAppStore();
  const t = useT();

  // Unnamed scratch doc (제목 없는 문서): 저장 always actionable (opens the name dialog)
  // even when the idle auto-save has already flushed to the temp file (isDirty false).
  const isUntitled = !!untitledPath && currentFile === untitledPath;
  const canSave = isDirty || isUntitled;

  // Leave edit mode → view mode. Auto-saves when enabled, or asks otherwise
  // (see store.maybeSaveBeforeLeave).
  const exitToView = async () => {
    if (!(await useAppStore.getState().maybeSaveBeforeLeave())) return;
    setEditMode(false);
  };

  // For non-Markdown source files (code, etc.) a rendered result is meaningless (markdown-it
  // would misread source code as Markdown), so no split preview is offered — always a single
  // edit pane. null (unnamed new doc) is treated as Markdown (same rule as AppShell's view branch).
  const isMd = !currentFile || isMarkdownPath(currentFile);
  // Shiki language for live syntax highlighting while editing a source file (unsupported extension -> "" = plain text).
  const codeLang = currentFile ? langFromPath(currentFile) : "";

  // Local-only view toggle: "편집만" vs "편집+미리보기 분할". No need to persist.
  // On first entry via Ctrl+E, split view is the default. Toggle with the toolbar's "편집만" button.
  const [split, setSplit] = useState(true);
  const [previewHtml, setPreviewHtml] = useState("");
  // Source files (non-Markdown) only: Shiki-colored HTML layered behind the transparent textarea.
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  // Line-number gutter: per-source-line wrap-aware tops (px) + single-row height.
  const gutterInnerRef = useRef<HTMLDivElement>(null);
  const [lineTops, setLineTops] = useState<number[]>([]);
  const [lineH, setLineH] = useState(22);
  // Current-line highlight (brighter gutter number + faint background on the body) — a
  // standard convention in code editors like VS Code. Shares the gutter's
  // translateY(-scrollTop) transform so it moves together when scrolling.
  const [currentLine, setCurrentLine] = useState(0);
  const highlightWrapperRef = useRef<HTMLDivElement>(null);
  // Only the pane the user is actively scrolling drives the other. This avoids
  // the two-way feedback drift (each sync's rounding error accumulating) that
  // made the mid-page position creep. Set on hover/focus.
  const activePane = useRef<"edit" | "preview">("edit");

  // Multi-level undo/redo for the editor buffer. The textarea is controlled
  // (value={editContent}), which breaks the browser's native undo — so we keep
  // our own stacks. They live in a module store keyed by file path (see
  // lib/editHistory), NOT in component refs, so the history survives the
  // unmount/remount that happens on every edit↔view toggle. That's what lets you
  // undo changes you already SAVED: edit → save → view → back to edit → undo.
  const histKey = currentFile ?? "";
  // History lives outside React, so mirror its emptiness into state to drive the
  // toolbar buttons' disabled look.
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const syncStackState = () => {
    setCanUndo(editHistory.canUndo(histKey));
    setCanRedo(editHistory.canRedo(histKey));
  };

  // On (re)entering edit mode or switching files, just reflect whatever history
  // already exists for this file. We do NOT clear here — clearing happens only
  // when the document is reloaded from disk (store.openFile), so re-entering edit
  // mode keeps the undo history intact.
  useEffect(() => {
    syncStackState();
    setCurrentLine(0); // so the previous file's current-line highlight doesn't linger when switching docs/files.
  }, [currentFile]);

  const onEdit = (next: string) => {
    editHistory.recordEdit(histKey, editContent, Date.now()); // snapshot pre-change value
    setEditContent(next);
    syncStackState();
  };

  // For current-line highlight: convert the cursor position (character offset) to a 0-based
  // line number. Clicks, arrow keys and typing all funnel here (onSelect covers selection/cursor moves).
  const updateCurrentLine = (value: string, selectionStart: number) => {
    setCurrentLine(value.slice(0, selectionStart).split("\n").length - 1);
  };

  const undo = () => {
    const prev = editHistory.undo(histKey, editContent);
    if (prev == null) return;
    setEditContent(prev);
    syncStackState();
  };
  const redo = () => {
    const next = editHistory.redo(histKey, editContent);
    if (next == null) return;
    setEditContent(next);
    syncStackState();
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((k === "z" && e.shiftKey) || k === "y") {
      e.preventDefault();
      redo();
    }
  };

  // App-owned right-click menu for the editor textarea: edit-workflow actions
  // (undo/redo/save/back-to-view) plus the shared zoom/theme items. Replaces the
  // browser's default menu in the editor. ⌘C/⌘V keyboard still work normally.
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const onTextareaContextMenu = (e: React.MouseEvent) => {
    const ta = textareaRef.current;
    const sel = ta && ta.selectionStart !== ta.selectionEnd
      ? editContent.slice(ta.selectionStart, ta.selectionEnd)
      : "";
    const items: ContextMenuItem[] = [
      { label: t("editor.undo"), icon: Undo2, disabled: !canUndo, onClick: undo },
      { label: t("editor.redo"), icon: Redo2, disabled: !canRedo, onClick: redo },
      { separator: true },
    ];
    if (sel) {
      items.push({
        label: t("editor.copySelection"),
        icon: Copy,
        onClick: () => {
          navigator.clipboard
            .writeText(sel)
            .then(() => showToast(t("editor.copiedToClipboard")))
            .catch(() => showToast(t("editor.copyFailed")));
        },
      });
      items.push({ separator: true });
    }
    items.push({ label: t("common.save"), icon: Save, disabled: !isDirty, onClick: () => void saveFile() });
    items.push({ label: t("editor.exitToView"), icon: Eye, onClick: () => void exitToView() });
    items.push({ separator: true });
    items.push(
      ...buildViewMenuItems({
        zoom,
        setZoom,
        theme: settings.theme,
        setTheme: (t) => {
          setSettings({ theme: t });
          saveSettings();
        },
      })
    );
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  // Right-click menu for the split-view PREVIEW pane. Without this the rendered
  // preview shows the browser's default web menu. Mirrors the read view's body
  // menu (link/selection) plus edit actions and zoom/theme.
  const onPreviewContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href") ?? "";
    const isWebLink = !!anchor && /^(https?:|mailto:)/i.test(href);
    const selection = window.getSelection()?.toString() ?? "";
    const items: ContextMenuItem[] = [];
    if (isWebLink) {
      items.push({
        label: t("editor.openLinkExternal"),
        icon: ExternalLink,
        onClick: () => openUrl(href).catch(() => showToast(t("editor.linkOpenFailed"))),
      });
      items.push({
        label: t("editor.copyLinkAddress"),
        icon: Link2,
        onClick: () =>
          navigator.clipboard
            .writeText(href)
            .then(() => showToast(t("editor.linkAddressCopied")))
            .catch(() => showToast(t("editor.copyFailed"))),
      });
      items.push({ separator: true });
    }
    if (selection.trim()) {
      items.push({
        label: t("editor.copySelection"),
        icon: Copy,
        onClick: () =>
          navigator.clipboard
            .writeText(selection)
            .then(() => showToast(t("editor.copiedToClipboard")))
            .catch(() => showToast(t("editor.copyFailed"))),
      });
      items.push({ separator: true });
    }
    items.push({ label: t("editor.undo"), icon: Undo2, disabled: !canUndo, onClick: undo });
    items.push({ label: t("editor.redo"), icon: Redo2, disabled: !canRedo, onClick: redo });
    items.push({ separator: true });
    items.push({ label: t("editor.exitToView"), icon: Eye, onClick: () => void exitToView() });
    items.push({ separator: true });
    items.push(
      ...buildViewMenuItems({
        zoom,
        setZoom,
        theme: settings.theme,
        setTheme: (t) => {
          setSettings({ theme: t });
          saveSettings();
        },
      })
    );
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  // Editor scroll-sync maps source line ↔ textarea pixel offset with a wrap-aware
  // mirror measurement (lib/editorScroll) instead of flat line×height arithmetic,
  // so soft-wrapped long lines don't drift the alignment. The mirror reads the
  // textarea's live metrics each call, so it tracks zoom automatically.
  const EDIT_PAD = 24;
  // Number of leading frontmatter lines: preview's data-source-line is relative
  // to the BODY (frontmatter stripped) while the textarea holds the FULL file.
  const fmLineOffset = () => {
    const m = /^---\n([\s\S]*?)\n---\n?/.exec(editContent);
    return m ? m[0].split("\n").length - 1 : 0;
  };

  // Preview anchors: [{ line: full-file source line, top: px within scroller }],
  // in increasing order. Built from data-source-line tagged block elements.
  const previewAnchors = () => {
    const pv = previewRef.current;
    if (!pv) return [] as { line: number; top: number }[];
    const off = fmLineOffset();
    const cTop = pv.getBoundingClientRect().top;
    const out: { line: number; top: number }[] = [];
    pv.querySelectorAll<HTMLElement>("[data-source-line]").forEach((el) => {
      const ln = parseInt(el.dataset.sourceLine ?? "", 10);
      if (Number.isNaN(ln)) return;
      const top = el.getBoundingClientRect().top - cTop + pv.scrollTop;
      out.push({ line: ln + off, top });
    });
    return out;
  };

  // Line-aware scroll sync: align the SAME source content in both panes by
  // mapping editor scroll → source line → preview block offset (and back).
  // Falls back to ratio when there are no anchors. Approximate where the
  // textarea soft-wraps long lines.
  const syncScroll = (from: "edit" | "preview") => {
    if (!split || activePane.current !== from) return; // ignore programmatic scroll on the passive pane
    const ta = textareaRef.current;
    const pv = previewRef.current;
    if (!ta || !pv) return;
    const anchors = previewAnchors();

    if (from === "edit") {
      if (!anchors.length) return;
      const topLine = editorLineAtScrollTop(ta, ta.scrollTop); // wrap-aware top line
      let i = 0;
      while (i < anchors.length - 1 && anchors[i + 1].line <= topLine) i++;
      let top: number;
      if (i >= anchors.length - 1) {
        top = anchors[i].top;
      } else {
        const span = Math.max(1, anchors[i + 1].line - anchors[i].line);
        const f = Math.min(1, Math.max(0, (topLine - anchors[i].line) / span));
        top = anchors[i].top + f * (anchors[i + 1].top - anchors[i].top);
      }
      pv.scrollTop = top - EDIT_PAD;
    } else {
      if (!anchors.length) return;
      const y = pv.scrollTop + EDIT_PAD;
      let i = 0;
      while (i < anchors.length - 1 && anchors[i + 1].top <= y) i++;
      let line: number;
      if (i >= anchors.length - 1) {
        line = anchors[i].line;
      } else {
        const span = Math.max(1, anchors[i + 1].top - anchors[i].top);
        const f = Math.min(1, Math.max(0, (y - anchors[i].top) / span));
        line = anchors[i].line + f * (anchors[i + 1].line - anchors[i].line);
      }
      ta.scrollTop = editorScrollTopForLine(ta, line);
    }
  };

  const isDark =
    settings.theme === "dark" ||
    (settings.theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  // Live capture of the editor's scroll position as a 0–1 ratio so a view↔edit
  // switch lands at the same spot. Captured on scroll (not on unmount) to be
  // robust to React StrictMode's dev double-mount, which would otherwise write a
  // phantom 0 and break the transfer. Reset to null only on a real file switch
  // (store.openFile).
  const captureTransfer = () => {
    const el = textareaRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const ratio = max > 0 ? el.scrollTop / max : 0;
    // Body-relative source line at the viewport top: full-file line (wrap-aware
    // mirror measurement) − leading frontmatter lines.
    const line = Math.max(0, editorLineAtScrollTop(el, el.scrollTop) - fmLineOffset());
    useAppStore.getState().setTransferScroll({ line, ratio });
  };

  // Focus the textarea when entering edit mode and carry over the scroll position
  // from view mode by SOURCE LINE (line-anchor → same content, not just same %).
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    // Re-focus on the next frame: when edit mode is entered right after a native
    // dialog (e.g. 새 문서 저장) the webview may not be first-responder yet, so the
    // synchronous focus() above can be dropped. A rAF focus lands reliably and
    // puts the caret in the textarea so the user can type immediately.
    const focusRaf = requestAnimationFrame(() => ta.focus());

    const t = useAppStore.getState().transferScroll;
    if (t == null) return () => cancelAnimationFrame(focusRaf);
    const targetLine = t.line + fmLineOffset();
    // Re-apply across frames until layout settles: on a long doc the textarea's
    // scrollHeight isn't fully computed on the first frame, so `max` would be too
    // small and clamp us to the top (the "맨 끝에서 진입하면 첫 줄로" bug). Keep
    // re-applying while scrollHeight is still growing or the target is still out
    // of the scrollable range, then stop once it's reachable and stable.
    let frame = 0;
    let lastSH = -1;
    let raf = 0;
    const apply = () => {
      const sh = ta.scrollHeight;
      const max = sh - ta.clientHeight;
      const target = editorScrollTopForLine(ta, targetLine);
      ta.scrollTop = Math.max(0, Math.min(max, target));
      const grew = sh !== lastSH;
      lastSH = sh;
      if (frame++ < 12 && (grew || target > max + 1)) {
        raf = requestAnimationFrame(apply);
      }
    };
    raf = requestAnimationFrame(apply);
    return () => {
      cancelAnimationFrame(focusRaf);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Render the preview HTML while the split view is on, and always keep the outline
  // (TOC) panel in sync with what's being typed — it reads from the same store field
  // this effect writes via setHeadings, regardless of split. When split is off there's
  // no HTML consumer, so we skip Shiki (`highlight: false`) and only pay for the cheap
  // markdown-it parse that headings come from. Debounced lightly so fast typing doesn't
  // thrash the renderer; `cancelled` guards against out-of-order resolves.
  useEffect(() => {
    if (!isMd) return;
    const baseDir = currentFile ? currentFile.replace(/\/[^/]+$/, "") : null;
    let cancelled = false;
    const t = setTimeout(() => {
      renderMarkdown(editContent, baseDir, isDark, split ? undefined : { highlight: false }).then(
        ({ html, headings }) => {
          if (cancelled) return;
          if (split) setPreviewHtml(html);
          setHeadings(headings);
        }
      );
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [split, isMd, editContent, currentFile, isDark, setHeadings]);

  // Live syntax highlighting for source files: re-color with Shiki on each input (debounced)
  // and apply it to the background. If the language is unsupported ("") or coloring fails,
  // null -> the background falls back to plain text.
  useEffect(() => {
    if (isMd) return;
    if (!codeLang) {
      setHighlightedHtml(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      highlightCodeToHtml(editContent, codeLang, isDark).then((html) => {
        if (!cancelled) setHighlightedHtml(html);
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isMd, codeLang, editContent, isDark]);

  // Debounced auto-save. Every edit (re)arms a single idle timer; the timer is
  // cleared on the next keystroke, on file switch, and on unmount/mode-exit —
  // so we never write mid-typing and never leak a timer. At fire time we
  // re-read the freshest store state and gate on shouldAutoSave(), so a file
  // that went externally-changed between arming and firing is NOT clobbered.
  // Auto-save only touches disk via saveFile — it never mutates editContent,
  // so the undo/redo stacks are completely untouched.
  useEffect(() => {
    if (!settings.auto_save) return; // toggle off → manual save only
    if (!isDirty) return; // nothing pending; also skips the initial mount
    const t = setTimeout(() => {
      const s = useAppStore.getState();
      if (
        shouldAutoSave({
          autoSave: s.settings.auto_save,
          hasFile: !!s.currentFile,
          isDirty: s.isDirty,
          externalChanged: s.externalChanged,
        })
      ) {
        // silent: no success toast for auto-save (failures still toast).
        s.saveFile({ silent: true });
      }
    }, AUTO_SAVE_IDLE_MS);
    return () => clearTimeout(t);
  }, [editContent, isDirty, settings.auto_save]);

  // Line-number gutter: measure each source line's wrap-aware top via the shared
  // mirror (lib/editorScroll) and keep the gutter scrolled in lockstep with the
  // textarea. Recomputed (lightly debounced) on content/zoom/split-width change
  // and on resize; the on-scroll transform sync is wired on the textarea below.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    let raf = 0;
    const recompute = () => {
      setLineTops(editorLineTops(ta));
      setLineH(parseFloat(getComputedStyle(ta).lineHeight) || 22);
      const g = gutterInnerRef.current;
      if (g) g.style.transform = `translateY(${-ta.scrollTop}px)`;
      const h = highlightWrapperRef.current;
      if (h) h.style.transform = `translateY(${-ta.scrollTop}px)`;
    };
    const t = setTimeout(recompute, 60);
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recompute);
    });
    ro.observe(ta);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [editContent, zoom, split]);

  return (
    <div className="relative flex-1 overflow-hidden flex flex-col">
      {/* Toolbar: dirty indicator, view toggle, save. Minimal. */}
      <div
        className="no-print shrink-0 flex items-center gap-2 px-4 h-9 text-[12px]"
        style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", color: "var(--fg)" }}
      >
        <span style={{ color: "var(--muted)" }}>
          {isUntitled
            ? t("editor.untitledStatus")
            : t("editor.editModeStatus", { suffix: isDirty ? t("editor.unsavedSuffix") : "" })}
        </span>

        {/* Deleted on disk while editing: the buffer is safe; saving recreates it. */}
        {fileMissing && (
          <span className="flex items-center gap-1.5" style={{ color: "var(--accent)" }}>
            <AlertTriangle size={13} className="shrink-0" />
            {t("editor.fileDeletedExternally")}
          </span>
        )}

        {/* External-change conflict: the file changed on disk while we have unsaved
            edits. We never auto-overwrite — the user keeps editing (save clobbers
            the external change) or pulls the disk content in (discards edits). */}
        {externalChanged && !fileMissing && (
          <span className="flex items-center gap-1.5" style={{ color: "var(--accent)" }}>
            <AlertTriangle size={13} className="shrink-0" />
            {t("editor.fileChangedExternally")}
            <button
              onClick={() => void discardEditsReload()}
              className="row-hover rounded px-1.5 py-0.5"
              style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
            >
              {t("editor.loadDiskContent")}
            </button>
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="icon-btn flex items-center rounded px-1.5 py-0.5"
            style={{ border: "1px solid var(--border)", opacity: canUndo ? 1 : 0.4, cursor: canUndo ? "pointer" : "default" }}
            title={t("editor.undoTooltip", { mod: MOD_LABEL })}
          >
            <Undo2 size={13} />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="icon-btn flex items-center rounded px-1.5 py-0.5"
            style={{ border: "1px solid var(--border)", opacity: canRedo ? 1 : 0.4, cursor: canRedo ? "pointer" : "default" }}
            title={t("editor.redoTooltip", { mod: MOD_LABEL })}
          >
            <Redo2 size={13} />
          </button>
          {isMd && (
            <button
              onClick={() => setSplit((s) => !s)}
              className="flex items-center gap-1 rounded-md px-2 h-7 text-[12px]"
              style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
              title={split ? t("editor.editOnlyTooltip") : t("editor.splitViewTooltip")}
            >
              {split ? <FileText size={13} /> : <Columns2 size={13} />}
              <span>{split ? t("editor.editOnlyLabel") : t("editor.splitLabel")}</span>
            </button>
          )}
          <button
            onClick={() => saveFile()}
            disabled={!canSave}
            className="flex items-center gap-1 rounded-md px-2 h-7 text-[12px] font-medium"
            style={{
              background: canSave ? "var(--accent)" : "var(--surface)",
              color: canSave ? "#fff" : "var(--muted)",
              border: "1px solid var(--border)",
              cursor: canSave ? "pointer" : "default",
            }}
            title={
              isUntitled
                ? t("editor.saveUntitledTooltip", { mod: MOD_LABEL })
                : t("editor.saveTooltip", { mod: MOD_LABEL })
            }
          >
            <Save size={13} />
            {t("common.save")}
          </button>
          <button
            onClick={exitToView}
            className="flex items-center gap-1 rounded-md px-2 h-7 text-[12px]"
            style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
            title={t("editor.exitToViewTooltip", { mod: MOD_LABEL })}
          >
            <Eye size={13} />
            <span>{t("editor.viewLabel")}</span>
          </button>
        </div>
      </div>

      {/* Editor body: line-number gutter + textarea, optionally side-by-side
          with a live preview. */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Wrap-aware line numbers. aria-hidden + select-none: decorative gutter,
            not part of the editable text. Heights come from the same mirror the
            scroll-sync uses, so numbers stay aligned even when lines soft-wrap. */}
        <div
          aria-hidden
          className="shrink-0 overflow-hidden text-right select-none font-mono tabular-nums"
          style={{
            background: "var(--bg)",
            color: "var(--muted)",
            borderRight: "1px solid var(--border)",
            paddingTop: 24,
            paddingLeft: 10,
            paddingRight: 8,
            zoom,
            fontSize: "13px",
            lineHeight: 1.7,
            width: `calc(${String(Math.max(lineTops.length, 1)).length}ch + 18px)`,
          }}
        >
          <div ref={gutterInnerRef} style={{ willChange: "transform" }}>
            {lineTops.map((top, i) => (
              <div
                key={i}
                style={{
                  height: i < lineTops.length - 1 ? lineTops[i + 1] - top : lineH,
                  color: i === currentLine ? "var(--fg)" : undefined,
                  fontWeight: i === currentLine ? 600 : undefined,
                }}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>
        <div className="relative flex-1 min-w-0 h-full" style={{ background: "var(--bg)" }}>
          {/* Current-line highlight — standard in professional code editors. A single bar sits
              inside a wrapper synced with the gutter's translateY(-scrollTop), so line position
              math is shared with the gutter as is. */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
            <div ref={highlightWrapperRef} style={{ willChange: "transform" }}>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  // +24: both the textarea and gutter have paddingTop 24, so line 0's actual
                  // on-screen position is 24px below lineTops[0] (=0), not at it.
                  top: 24 + (lineTops[currentLine] ?? currentLine * lineH),
                  height:
                    currentLine < lineTops.length - 1
                      ? lineTops[currentLine + 1] - lineTops[currentLine]
                      : lineH,
                  background: "var(--hover)",
                }}
              />
            </div>
          </div>
          {/* Live highlight background for source files only — the textarea is made transparent
              and this layer's colored text shows through. Font, padding and line height must
              match the textarea exactly for the glyphs to overlap. */}
          {!isMd && (
            <div
              ref={backdropRef}
              aria-hidden="true"
              className="editor-code-backdrop absolute inset-0 overflow-auto pointer-events-none font-mono"
              style={{
                paddingTop: 24,
                paddingBottom: 144,
                paddingLeft: 32,
                paddingRight: 32,
                zoom,
                fontSize: "13px",
                lineHeight: 1.7,
                tabSize: 4,
                // No wrapping + horizontal scroll (paired with the textarea's wrap="off" below) —
                // pre-wrap was tried first, but the textarea's native soft wrap and this layer's
                // CSS Text wrapping algorithm break at subtly different points (the two layers'
                // effective widths differ depending on whether a scrollbar is present), so long
                // lines went out of alignment. Removing wrapping altogether guarantees one source
                // line = one screen line, so there is nothing left to misalign.
                whiteSpace: "pre",
                color: "var(--fg)",
              }}
            >
              {highlightedHtml ? (
                <div dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
              ) : (
                <code>{editContent}</code>
              )}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={editContent}
            wrap={isMd ? undefined : "off"}
            onChange={(e) => {
              onEdit(e.target.value);
              updateCurrentLine(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              updateCurrentLine(el.value, el.selectionStart);
            }}
            onKeyDown={onTextareaKeyDown}
            onContextMenu={onTextareaContextMenu}
            onScroll={() => {
              captureTransfer();
              syncScroll("edit");
              const g = gutterInnerRef.current;
              if (g) g.style.transform = `translateY(${-(textareaRef.current?.scrollTop ?? 0)}px)`;
              const h = highlightWrapperRef.current;
              if (h) h.style.transform = `translateY(${-(textareaRef.current?.scrollTop ?? 0)}px)`;
              const bd = backdropRef.current;
              const ta = textareaRef.current;
              if (bd && ta) {
                bd.scrollTop = ta.scrollTop;
                bd.scrollLeft = ta.scrollLeft;
              }
            }}
            onMouseEnter={() => (activePane.current = "edit")}
            onFocus={() => (activePane.current = "edit")}
            spellCheck={false}
            className={`${isMd ? "relative" : "absolute inset-0"} w-full h-full resize-none outline-none font-mono`}
            style={{
              background: isMd ? "var(--bg)" : "transparent",
              color: isMd ? "var(--fg)" : "transparent",
              caretColor: isMd ? undefined : "var(--fg)",
              border: "none",
              borderRight: split && isMd ? "1px solid var(--border)" : "none",
              paddingTop: 24,
              paddingBottom: 144,
              paddingLeft: 32,
              paddingRight: 32,
              // Use CSS `zoom` (same mechanism as the read view & preview pane) so
              // the shared zoom ratio looks IDENTICAL in view and edit mode — not
              // just a subtle font bump. Scroll-sync reads the textarea's live
              // metrics (lib/editorScroll), so it tracks zoom automatically.
              zoom,
              fontSize: "13px",
              lineHeight: 1.7,
              tabSize: 4,
            }}
          />
        </div>

        {split && isMd && (
          <div
            ref={previewRef}
            onScroll={() => syncScroll("preview")}
            onContextMenu={onPreviewContextMenu}
            onMouseEnter={() => (activePane.current = "preview")}
            className="flex-1 min-w-0 h-full overflow-auto flex flex-col items-center"
            style={{
              paddingTop: 24,
              paddingBottom: 144,
              paddingLeft: 32,
              paddingRight: 32,
              // Query container for `.md-table-wrap` / `.md-content:has(...)`'s
              // cqw-based sizing in markdown.css — mirrors the read view's
              // scrollRef (MarkdownViewer.tsx). Without this, cqw has no
              // container to resolve against on this (narrower) split pane.
              containerType: "inline-size",
            }}
          >
            <div
              className="md-content w-full"
              style={{
                maxWidth: "900px",
                zoom,
                ...({ "--zoom": zoom } as React.CSSProperties),
              }}
            >
              <div
                className="md-body"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Edit-mode find/replace (⌘F). Operates on the textarea; replaces go through
          onEdit so they're undoable and tracked. */}
      <EditorFindBar textareaRef={textareaRef} content={editContent} onReplaceContent={onEdit} />

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
