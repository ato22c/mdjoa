import { useEffect, useRef, useState, useCallback } from "react";
import { useAppStore } from "../../store/app";
import { renderCodeFileHtml, initHighlighter, highlightPendingCode } from "../../lib/markdown";
import { langFromPath } from "../../lib/fileType";
import { useT } from "../../lib/i18n";
import { SearchBar } from "./SearchBar";
import "../../styles/markdown.css";

// Viewer for non-Markdown text/code files. Wraps the whole file in one code block and
// colors it with Shiki (extension -> language). It bypasses markdown-it, so `#`/`*` etc.
// inside the code are never misread as Markdown. Markup, CSS and highlighter reuse the
// same path as MarkdownViewer.
export function CodeFileViewer() {
  const { currentFile, currentContent, settings, zoom, showToast } = useAppStore();
  const t = useT();
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState("");
  // Remember scroll position per file (reopening returns to where you were).
  const scrollPositions = useRef<Map<string, number>>(new Map());

  const isDark =
    settings.theme === "dark" ||
    (settings.theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    initHighlighter();
  }, []);

  // Focus the body when a new file opens so keyboard scrolling works right away.
  useEffect(() => {
    if (!currentFile) return;
    scrollRef.current?.focus({ preventScroll: true });
  }, [currentFile]);

  // On content/file change, build the code block markup (shown immediately, uncolored).
  useEffect(() => {
    if (currentContent == null || !currentFile) return;
    setHtml(renderCodeFileHtml(currentContent, langFromPath(currentFile)));
  }, [currentContent, currentFile]);

  // After html is replaced, color it in the DOM (progressive) and restore scroll position.
  useEffect(() => {
    if (contentRef.current) void highlightPendingCode(contentRef.current, isDark);
    const sc = scrollRef.current;
    if (sc && currentFile) sc.scrollTop = scrollPositions.current.get(currentFile) ?? 0;
  }, [html, isDark, currentFile]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (currentFile && el) scrollPositions.current.set(currentFile, el.scrollTop);
  }, [currentFile]);

  // The code block's "copy" button (same behavior as MarkdownViewer).
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const btn = (e.target as HTMLElement).closest("button.code-copy");
      if (!btn) return;
      const code = btn.closest(".code-block")?.querySelector("pre code")?.textContent ?? "";
      navigator.clipboard
        .writeText(code)
        .then(() => showToast(t("editor.copiedToClipboard")))
        .catch(() => showToast(t("editor.copyFailed")));
    },
    [showToast, t]
  );

  if (currentContent == null) return null;

  return (
    <div className="relative flex-1 overflow-hidden flex flex-col">
      <div
        ref={scrollRef}
        tabIndex={-1}
        className="flex-1 min-h-0 overflow-auto flex flex-col items-center outline-none"
        style={{ paddingTop: 44, paddingBottom: 144, paddingLeft: 32, paddingRight: 32 }}
        onScroll={handleScroll}
      >
        <div className="md-content w-full" style={{ maxWidth: "900px", zoom }}>
          <div
            ref={contentRef}
            className="md-body"
            onClick={handleClick}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
      <SearchBar containerRef={contentRef} />
    </div>
  );
}
