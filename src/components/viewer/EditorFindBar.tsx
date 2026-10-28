import { useEffect, useRef, useState } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import { useAppStore } from "../../store/app";
import { useT } from "../../lib/i18n";
import { editorScrollTopForLine } from "../../lib/editorScroll";
import {
  findMatches,
  replaceAllMatches,
  lineOfIndex,
  firstMatchFrom,
  type FindMatch,
} from "../../lib/editorFind";

interface Props {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  content: string;
  // Apply replaced text through the editor's edit path so the change is undoable
  // (records history) and dirty/auto-save tracking stays correct.
  onReplaceContent: (next: string) => void;
}

// Edit-mode find/replace. Reuses the global `searchOpen`/`searchQuery` so ⌘F opens
// the right surface per mode (this bar in edit mode, the SearchBar in view mode)
// and the query carries across. Operates directly on the textarea + raw markdown.
export function EditorFindBar({ textareaRef, content, onReplaceContent }: Props) {
  const t = useT();
  const { searchOpen, searchQuery, setSearchOpen, setSearchQuery, showToast } = useAppStore();
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);

  const findInputRef = useRef<HTMLInputElement>(null);
  // Where query-driven searches start from (the caret when the bar opened) so
  // typing in the find box jumps to the nearest forward match, not always line 1.
  const anchorRef = useRef(0);

  const matches = findMatches(content, searchQuery, caseSensitive);
  const count = matches.length;
  // currentIdx can lag behind edits done in the textarea while the bar is open.
  const safeIdx = count ? Math.min(currentIdx, count - 1) : 0;

  // Select a match in `text`/`ms` and scroll the textarea so it's visible. Takes
  // its text + match list explicitly so callers can act on freshly-edited content
  // (the `content` prop only updates on the next render).
  const selectAt = (text: string, ms: FindMatch[], idx: number) => {
    const ta = textareaRef.current;
    const m = ms[idx];
    if (!ta || !m) return;
    ta.setSelectionRange(m.start, m.end);
    const top = editorScrollTopForLine(ta, lineOfIndex(text, m.start));
    const max = ta.scrollHeight - ta.clientHeight;
    // Keep the match a little below the top edge rather than flush against it.
    ta.scrollTop = Math.max(0, Math.min(max, top - 60));
  };

  // On open: anchor query-searches at the caret, seed the query from a single-line
  // textarea selection, and focus the find box.
  useEffect(() => {
    if (!searchOpen) return;
    const ta = textareaRef.current;
    anchorRef.current = ta ? ta.selectionStart : 0;
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      const sel = content.slice(ta.selectionStart, ta.selectionEnd);
      if (sel && !sel.includes("\n")) setSearchQuery(sel);
    }
    const id = requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen]);

  // Jump to the nearest match whenever the query / case option / open state
  // changes — but NOT on plain textarea edits (content is intentionally absent
  // from the deps), so typing in the document doesn't yank the scroll around.
  useEffect(() => {
    if (!searchOpen) return;
    if (!matches.length) {
      setCurrentIdx(0);
      return;
    }
    const idx = Math.max(0, firstMatchFrom(matches, anchorRef.current));
    setCurrentIdx(idx);
    selectAt(content, matches, idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, caseSensitive, searchOpen]);

  if (!searchOpen) return null;

  const go = (delta: number) => {
    if (!count) return;
    const idx = (safeIdx + delta + count) % count;
    setCurrentIdx(idx);
    selectAt(content, matches, idx);
  };

  const replaceCurrent = () => {
    const m = matches[safeIdx];
    if (!m) return;
    const next = content.slice(0, m.start) + replaceText + content.slice(m.end);
    onReplaceContent(next);
    // Land on the next match in the NEW text once React has committed it.
    const after = findMatches(next, searchQuery, caseSensitive);
    const idx = Math.max(0, firstMatchFrom(after, m.start + replaceText.length));
    requestAnimationFrame(() => {
      setCurrentIdx(after.length ? idx : 0);
      if (after.length) selectAt(next, after, idx);
    });
  };

  const replaceAll = () => {
    const { text, count: n } = replaceAllMatches(content, searchQuery, replaceText, caseSensitive);
    if (!n) {
      showToast(t("editorFindBar.replaceNoneToast"));
      return;
    }
    onReplaceContent(text);
    setCurrentIdx(0);
    showToast(t("editorFindBar.replacedAllToast", { n }));
  };

  const close = () => {
    setSearchOpen(false);
    textareaRef.current?.focus();
  };

  const onFindKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      go(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      // Close only the find bar; stop Esc from leaking to the global handler (view-mode switch, etc.).
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const onReplaceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey || e.metaKey || e.ctrlKey) replaceAll();
      else replaceCurrent();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const countLabel = count > 0 ? `${safeIdx + 1}/${count}` : searchQuery ? t("editorFindBar.noMatchesLabel") : "";

  return (
    <div
      className="editor-find-bar no-print fixed top-12 right-4 z-40 flex flex-col gap-1.5 p-1.5 rounded-[10px]"
      style={{ background: "var(--bg)", boxShadow: "var(--shadow-popover)" }}
    >
      {/* Find row */}
      <div className="flex items-center gap-1.5 pl-1.5">
        <input
          ref={findInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={onFindKeyDown}
          placeholder={t("editorFindBar.findPlaceholder")}
          className="outline-none bg-transparent text-sm w-48"
          style={{ color: "var(--fg)" }}
        />
        <span
          className="text-[11px] tabular-nums shrink-0 min-w-10 text-right"
          style={{ color: "var(--muted)" }}
        >
          {countLabel}
        </span>
        <button
          onClick={() => setCaseSensitive((v) => !v)}
          className="icon-btn !p-0 rounded text-[12px] font-mono leading-none flex items-center justify-center"
          style={{
            border: "1px solid var(--border)",
            background: caseSensitive ? "var(--accent)" : "transparent",
            color: caseSensitive ? "#fff" : "var(--muted)",
            width: 24,
            height: 22,
          }}
          title={t("editorFindBar.caseSensitiveTooltip")}
        >
          Aa
        </button>
        <button onClick={() => go(-1)} className="icon-btn !p-1" title={t("editorFindBar.prevTooltip")}>
          <ChevronUp size={14} />
        </button>
        <button onClick={() => go(1)} className="icon-btn !p-1" title={t("editorFindBar.nextTooltip")}>
          <ChevronDown size={14} />
        </button>
        <button onClick={close} className="icon-btn !p-1" title={t("settings.closeTooltip")}>
          <X size={14} />
        </button>
      </div>

      {/* Replace row */}
      <div className="flex items-center gap-1.5 pl-1.5">
        <input
          type="text"
          value={replaceText}
          onChange={(e) => setReplaceText(e.target.value)}
          onKeyDown={onReplaceKeyDown}
          placeholder={t("editorFindBar.replacePlaceholder")}
          className="outline-none bg-transparent text-sm w-48"
          style={{ color: "var(--fg)" }}
        />
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={replaceCurrent}
            disabled={count === 0}
            className="rounded px-2 py-0.5 text-[12px]"
            style={{
              border: "1px solid var(--border)",
              color: "var(--fg)",
              opacity: count === 0 ? 0.4 : 1,
              cursor: count === 0 ? "default" : "pointer",
            }}
            title={t("editorFindBar.replaceCurrentTooltip")}
          >
            {t("editorFindBar.replaceButton")}
          </button>
          <button
            onClick={replaceAll}
            disabled={count === 0}
            className="rounded px-2 py-0.5 text-[12px]"
            style={{
              border: "1px solid var(--border)",
              color: "var(--fg)",
              opacity: count === 0 ? 0.4 : 1,
              cursor: count === 0 ? "default" : "pointer",
            }}
            title={t("editorFindBar.replaceAllTooltip")}
          >
            {t("editorFindBar.replaceAllButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
