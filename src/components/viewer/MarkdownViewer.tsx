import { useEffect, useRef, useState, useCallback } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RefreshCw, AlertTriangle, X, Copy, ExternalLink, Link2, Pencil, Focus, GitCompare, ArrowUp } from "lucide-react";
import { useAppStore } from "../../store/app";
import { useT } from "../../lib/i18n";
import { buildViewMenuItems } from "../../lib/contextMenuItems";
import { buildFileMenuItems } from "../../lib/fileActionMenuItems";
import { renderMarkdown, initHighlighter, highlightPendingCode } from "../../lib/markdown";
import { AI_TASK_GROUPS, runDocumentTask, tasksInGroup } from "../../lib/aiTasks";
import { collectAnchors, lineAtScrollTop, scrollTopForLine } from "../../lib/scrollSync";
import { renderMermaid } from "../../lib/mermaid";
import { changedBlockIndices } from "../../lib/textDiff";
import { resolveRelativePath } from "../../lib/pathUtil";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import { SearchBar } from "./SearchBar";
import { ZoomOverlay, type ZoomTarget } from "./ZoomOverlay";
import { loadScrollMemory, saveScrollMemory } from "../../lib/scrollMemory";
import "../../styles/markdown.css";

// Strip leading YAML frontmatter so block diffing operates on the body only.
// Mirrors extractFrontmatter() in lib/markdown.ts: only a block that STARTS the
// document (`---` … `---`) is removed. Keeps diff indices body-relative so they
// line up with `.md-body` children once the frontmatter-offset is applied.
function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

export function MarkdownViewer() {
  const {
    currentFile,
    currentContent,
    openFile,
    openWikiLink,
    toggleTask,
    settings,
    zoom,
    setZoom,
    setSettings,
    saveSettings,
    setEditMode,
    setHeadings,
    setActiveHeading,
    showToast,
    externalChanged,
    fileMissing,
    setExternalChanged,
    setFileMissing,
    recreateOpenFile,
    focusMode,
    setFocusMode,
    setQuickOpenMode,
  } = useAppStore();
  const t = useT();
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState("");
  const [zoomTarget, setZoomTarget] = useState<ZoomTarget | null>(null);
  // App-owned right-click menu for the document body. null = closed.
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  // Remembered scroll position per file path: a newly opened doc starts at the
  // top, but reopening a previously viewed doc restores where you left off.
  // Restore the initial value from localStorage, so the reading position survives app restarts.
  // On every set, persist again via saveScrollMemory (debounced) — see handleScroll.
  const scrollPositions = useRef<Map<string, number>>(loadScrollMemory());
  const rafRef = useRef(0);
  // Whether to show the "맨 위로" (back to top) button: appears once scrollTop passes the threshold.
  const [showTopBtn, setShowTopBtn] = useState(false);
  // Previous *source* content of the currently-open file, keyed by path. Used
  // to detect a same-file external change (reload underneath us) and diff it.
  // We only highlight when the path is unchanged but the content differs — NOT
  // on first open and NOT when switching to a different file.
  const prevSource = useRef<{ path: string; content: string } | null>(null);
  // Block indices (in the new source) to highlight once the new HTML renders.
  // Populated by the source-tracking effect, consumed by the render effect.
  const pendingHighlight = useRef<number[]>([]);

  const isDark =
    settings.theme === "dark" ||
    (settings.theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    initHighlighter();
  }, []);

  // On opening a document, focus the body so keyboard scrolling (↑↓/PageDn/Space) works
  // right away. Runs only when `currentFile` changes (= a fresh open) — an external-change
  // reloadView keeps the same path and doesn't re-run, so focus isn't stolen while reading.
  // preventScroll avoids conflicting with scroll restoration (the [html] effect below).
  useEffect(() => {
    if (!currentFile) return;
    scrollRef.current?.focus({ preventScroll: true });
  }, [currentFile]);

  // (Scroll position for the view→edit transfer is captured LIVE in handleScroll,
  // not on unmount — see the note there. An unmount-time capture breaks under
  // React StrictMode's dev double-mount.)

  useEffect(() => {
    if (!currentContent) return;
    const content = currentContent;
    const baseDir = currentFile ? currentFile.replace(/\/[^/]+$/, "") : null;
    // Make heavy documents (e.g. render-test.md with lots of code) appear instantly: render
    // once without coloring and show it right away (avoiding Shiki's synchronous cost); code
    // coloring is applied directly in the DOM by highlightPendingCode in the [html] effect
    // after the page is on screen. Markdown/math/diagrams aren't redrawn (no full re-render),
    // so work isn't done twice. setHtml swaps everything at once, so there is no flicker on
    // external-change reloads either. `cancelled` prevents out-of-order results when the
    // content changes.
    let cancelled = false;
    renderMarkdown(content, baseDir, isDark, { highlight: false }).then(({ html: rendered, headings }) => {
      if (cancelled) return;
      setHtml(rendered);
      setHeadings(headings);
    });
    return () => {
      cancelled = true;
    };
  }, [currentContent, isDark, currentFile]);

  // Detect a *same-file* external change and stage which blocks to highlight.
  // Runs on every content/file change but only computes a diff when the path
  // is unchanged and the content actually differs (i.e. the file was reloaded
  // underneath us). First open of a file (no prior, or a different prior path)
  // records the baseline silently with no highlight.
  //
  // We diff on the *body* (frontmatter stripped) so the reported indices are
  // body-block-relative. At highlight time we add +1 when the rendered DOM has
  // a leading `.md-frontmatter` card (see the [html] effect), keeping source
  // block indices aligned with `.md-body` children.
  useEffect(() => {
    const prev = prevSource.current;
    if (currentFile && currentContent) {
      if (prev && prev.path === currentFile && prev.content !== currentContent) {
        pendingHighlight.current = changedBlockIndices(
          stripFrontmatter(prev.content),
          stripFrontmatter(currentContent)
        );
      } else {
        // First open, or switched to a different file → no highlight.
        pendingHighlight.current = [];
      }
      prevSource.current = { path: currentFile, content: currentContent };
    } else {
      pendingHighlight.current = [];
      prevSource.current = null;
    }
  }, [currentContent, currentFile]);

  // Track which heading is currently at the top of the viewport (outline scroll spy)
  const updateActiveHeading = useCallback(() => {
    const sc = scrollRef.current;
    const ct = contentRef.current;
    if (!sc || !ct) return;
    const els = ct.querySelectorAll<HTMLElement>(
      "h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]"
    );
    if (!els.length) {
      setActiveHeading(null);
      return;
    }
    const topEdge = sc.getBoundingClientRect().top + 90;
    let current = els[0].id;
    for (const el of els) {
      if (el.getBoundingClientRect().top <= topEdge) current = el.id;
      else break;
    }
    setActiveHeading(current);
  }, [setActiveHeading]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (currentFile && el) {
      scrollPositions.current.set(currentFile, el.scrollTop);
      // Persist the reading position to localStorage (debounced — avoids excessive writes while scrolling).
      saveScrollMemory(scrollPositions.current);
      // Capture the reading position LIVE (not on unmount; robust to StrictMode's
      // dev double-mount). We store the SOURCE LINE at the viewport top (line
      // anchor → view↔edit lands on the same content) plus a ratio fallback.
      const max = el.scrollHeight - el.clientHeight;
      const ratio = max > 0 ? el.scrollTop / max : 0;
      const content = contentRef.current;
      const line = content ? lineAtScrollTop(collectAnchors(el, content), el.scrollTop) : null;
      useAppStore.getState().setTransferScroll({ line: line ?? 0, ratio });
    }
    // "맨 위로" (back to top) button: shown once scrolled past the threshold (400px), hidden otherwise.
    if (el) setShowTopBtn(el.scrollTop > 400);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(updateActiveHeading);
  }, [currentFile, updateActiveHeading]);

  // Smoothly scroll the container to the top. handleScroll then persists the position
  // and hides the button.
  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    // Restore scroll: a pending mode-switch ratio (view↔edit) wins; otherwise
    // this file's remembered absolute position (0 = top for new docs).
    // `reapplyScroll` recomputes the target from the live scrollHeight so it can
    // be applied AGAIN after async content (mermaid) lays out — otherwise a
    // re-render (e.g. toggling a checkbox at the bottom) restores against the
    // pre-mermaid (shorter) height and ends up scrolled up once mermaid grows.
    let reapplyScroll: (() => void) | null = null;
    if (scrollRef.current) {
      const el = scrollRef.current;
      const t = useAppStore.getState().transferScroll;
      const savedPx = currentFile ? scrollPositions.current.get(currentFile) ?? 0 : 0;
      reapplyScroll = () => {
        const max = el.scrollHeight - el.clientHeight;
        if (max <= 0) return; // not laid out yet (html=""), wait for the rerun
        // Mode-switch transfer → line anchor (same content); else this file's
        // remembered px. Falls back to the ratio if no anchor resolves.
        let top: number | null;
        if (t != null && contentRef.current) {
          top = scrollTopForLine(collectAnchors(el, contentRef.current), t.line);
          if (top == null) top = t.ratio * max;
        } else {
          top = savedPx;
        }
        el.scrollTop = Math.min(max, Math.max(0, top ?? 0));
        // Programmatic scrollTop changes bypass onScroll, so sync the button's visibility manually.
        setShowTopBtn(el.scrollTop > 400);
      };
      reapplyScroll();
    }
    // Wikilink heading jump (#9): when a `[[file#heading]]` opened this file,
    // scroll to the matching heading after it renders, then clear the flag. Best
    // effort — match a heading element whose visible text equals the target
    // (case-insensitive, trimmed); if none matches we just leave the file at the
    // top (per spec: open the file and report). Overrides the restore above.
    const pendingHeading = useAppStore.getState().pendingWikiHeading;
    if (pendingHeading && contentRef.current) {
      const want = pendingHeading.trim().toLowerCase();
      const hEls = contentRef.current.querySelectorAll<HTMLElement>(
        "h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]"
      );
      const match = Array.from(hEls).find(
        (el) => (el.textContent ?? "").trim().toLowerCase() === want
      );
      if (match) {
        match.scrollIntoView({ behavior: "auto", block: "start" });
        reapplyScroll = null; // heading jump wins — don't re-apply the saved scroll
      }
      useAppStore.getState().clearPendingWikiHeading();
    }
    updateActiveHeading();
    // Render any mermaid diagrams in the freshly-set HTML. Async + isolated so
    // a malformed diagram falls back to a code block without blocking the view.
    // Re-apply the scroll after mermaid lays out so its height change doesn't
    // leave us scrolled away from the intended position.
    if (contentRef.current) {
      const el = contentRef.current;
      renderMermaid(el, isDark).then(() => {
        updateActiveHeading();
        reapplyScroll?.();
      });
      // Apply code coloring in the DOM (no full re-render). Height may change after coloring,
      // so re-align the scroll position. On coloring failure or unsupported language, leave plain text.
      highlightPendingCode(el, isDark).then(() => reapplyScroll?.());
      // Images load async and change height above the fold — re-apply the scroll
      // target once each finishes so the line anchor stays accurate.
      el.querySelectorAll("img").forEach((img) => {
        if (!img.complete) img.addEventListener("load", () => reapplyScroll?.(), { once: true });
      });
    }
    // "변경 하이라이트": after the new HTML is in the DOM, transiently tint the
    // top-level elements that correspond to the changed *body* blocks. The
    // rendered `.md-body` direct children map ~1:1 with source body blocks
    // (fences/lists may collapse to one child — approximate by design).
    //
    // Frontmatter offset: when the doc has YAML frontmatter, renderMarkdown
    // PREPENDS a `div.md-frontmatter` card as the first child, shifting every
    // body element by +1 vs the (frontmatter-stripped) body block indices. We
    // detect that leading card and add the offset so a body edit highlights the
    // right element. Defensive: skip out-of-range indices (never crash).
    const toHighlight = pendingHighlight.current;
    pendingHighlight.current = []; // consume once, regardless of outcome
    if (toHighlight.length && contentRef.current) {
      const children = contentRef.current.children;
      const fmOffset =
        (children[0] as HTMLElement | undefined)?.classList.contains("md-frontmatter")
          ? 1
          : 0;
      const tinted: HTMLElement[] = [];
      for (const idx of toHighlight) {
        const el = children[idx + fmOffset] as HTMLElement | undefined;
        if (!el) continue; // index out of range → skip
        el.style.transition = "background-color 1.2s ease";
        el.style.backgroundColor = "color-mix(in srgb, var(--accent) 28%, transparent)";
        tinted.push(el);
      }
      if (tinted.length) {
        const clear = setTimeout(() => {
          for (const el of tinted) el.style.backgroundColor = "";
        }, 3500);
        return () => clearTimeout(clear);
      }
    }
    // Keyed on `html` (which changes on every file switch); `currentFile` is
    // read fresh from the closure to avoid an extra run that would briefly
    // scroll the outgoing document before its replacement renders.
  }, [html, isDark, updateActiveHeading]);

  // Reload helper for the manual "새로고침" button and the notify-only banner.
  // The open-file watcher itself lives in AppShell (so it also runs in edit
  // mode) and routes through store.refreshOpenFileFromDisk.
  const reloadCurrent = useCallback(() => {
    if (!currentFile) return;
    if (scrollRef.current) scrollPositions.current.set(currentFile, scrollRef.current.scrollTop);
    openFile(currentFile);
  }, [currentFile, openFile]);

  // Delegated click handler for code-copy buttons and links.
  const handleContentClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;

      // Interactive task-list checkboxes. markdown-it-task-lists is configured
      // with `{ enabled: true }`, so the rendered `<input>`s are NOT disabled —
      // a real click fires here. The Nth `.task-list-item-checkbox` in document
      // order maps to the Nth `- [ ]`/`* [ ]`/`+ [ ]` source line, so we derive
      // the index by position among all checkboxes in `.md-body`.
      const checkbox = target.closest("input.task-list-item-checkbox");
      if (checkbox && contentRef.current) {
        const all = Array.from(
          contentRef.current.querySelectorAll<HTMLInputElement>(
            "input.task-list-item-checkbox"
          )
        );
        const idx = all.indexOf(checkbox as HTMLInputElement);
        if (idx >= 0) {
          // The DOM already flipped `checked` on click; read it as the target
          // state. We don't mutate the DOM further — the re-render from the new
          // file content is the source of truth (and corrects any race).
          toggleTask(idx, (checkbox as HTMLInputElement).checked);
        }
        return;
      }

      // Click an image or rendered diagram → full-size view. An image that is
      // itself a link keeps the link behavior (handled below).
      const img = target.closest("img");
      if (img && !img.closest("a[href]")) {
        setZoomTarget({ kind: "img", src: img.currentSrc || img.src, alt: img.alt });
        return;
      }
      const diagram = target.closest<HTMLElement>(".mermaid-rendered");
      const svg = diagram?.querySelector("svg");
      if (svg) {
        const clone = svg.cloneNode(true) as SVGSVGElement;
        const natural = svg.viewBox.baseVal?.width;
        clone.style.maxWidth = "none";
        clone.style.minWidth = "";
        if (natural) clone.style.width = `${Math.round(natural)}px`;
        setZoomTarget({ kind: "svg", html: clone.outerHTML });
        return;
      }

      const btn = target.closest("button.code-copy");
      if (btn) {
        const code = btn.closest(".code-block")?.querySelector("pre code")?.textContent ?? "";
        navigator.clipboard
          .writeText(code)
          .then(() => showToast(t("editor.copiedToClipboard")))
          .catch(() => showToast(t("editor.copyFailed")));
        return;
      }

      // Wikilinks (#9): hrefless <a data-wikilink="…"> emitted by the
      // markdown-it rule. Resolve in the current folder and open the target
      // (heading, if any, scrolls after render via pendingWikiHeading). Checked
      // BEFORE the generic `a[href]` branch since wikilinks carry no href.
      const wiki = target.closest<HTMLElement>("a[data-wikilink]");
      if (wiki) {
        e.preventDefault();
        const wlTarget = wiki.getAttribute("data-wikilink") ?? "";
        const wlHeading = wiki.getAttribute("data-wikilink-heading");
        if (wlTarget) openWikiLink(wlTarget, wlHeading);
        return;
      }

      // Links: never let the webview navigate away from the app. Web/mailto
      // links open in the OS default browser; in-document anchors scroll.
      const anchor = target.closest("a[href]");
      if (anchor) {
        const href = anchor.getAttribute("href") ?? "";
        e.preventDefault();
        if (/^(https?:|mailto:)/i.test(href)) {
          openUrl(href).catch(() => showToast(t("editor.linkOpenFailed")));
        } else if (href.startsWith("#")) {
          const id = decodeURIComponent(href.slice(1));
          const root = contentRef.current;
          let el = root?.querySelector<HTMLElement>(`#${CSS.escape(id)}`) ?? null;
          if (!el && root) {
            // Our heading ids are `h-N-<slug>`, but markdown `[..](#slug)` links
            // use the GitHub-style slug. Resolve by matching a heading whose
            // visible-text slug starts with the requested slug (falls back to a
            // substring match on the id).
            const want = id.toLowerCase();
            const slugify = (s: string) =>
              s.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/gi, "-").replace(/^-+|-+$/g, "");
            const heads = Array.from(
              root.querySelectorAll<HTMLElement>("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]")
            );
            el =
              heads.find((h) => slugify(h.textContent ?? "").startsWith(want)) ??
              heads.find((h) => h.id.toLowerCase().includes(want)) ??
              null;
          }
          el?.scrollIntoView({ behavior: "smooth", block: "start" });
        } else if (/\.(md|markdown)(#[^#]*)?$/i.test(href) && currentFile) {
          // Relative .md link -> open the file inside the app
          const hashIdx = href.lastIndexOf("#");
          const filePart = hashIdx > 0 ? href.slice(0, hashIdx) : href;
          const fragment = hashIdx > 0 ? href.slice(hashIdx + 1) : null;
          const resolved = resolveRelativePath(currentFile, filePart);
          if (resolved) {
            if (fragment) {
              useAppStore.setState({ pendingWikiHeading: fragment });
            }
            openFile(resolved).catch(() => showToast(t("markdownViewer.fileOpenFailed")));
          }
        }
      }
    },
    [showToast, toggleTask, openWikiLink, t]
  );

  // App-owned right-click menu for the body. All items reuse existing actions:
  // Hovering a link shows its actual destination (target) as a native tooltip (title) —
  // the desktop webview has no browser status bar, so you can't otherwise see where it goes.
  // The title is filled once per anchor (skipped if already set). Web/mail links use href,
  // wikilinks use [[target]], and everything else (relative paths etc.) uses href as is.
  const handleContentMouseOver = useCallback((e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a || a.title) return;
    const wiki = a.getAttribute("data-wikilink");
    if (wiki) {
      const h = a.getAttribute("data-wikilink-heading");
      a.title = h ? `[[${wiki}#${h}]]` : `[[${wiki}]]`;
      return;
    }
    const href = a.getAttribute("href");
    if (href) a.title = href;
  }, []);

  // copy (clipboard), open-external (openUrl, same as left-click), copy-link,
  // and reveal-in-Finder/Explorer (revealItemInDir, same as the hamburger menu).
  // We build the item list from context (link under the cursor vs plain body)
  // and only include an item when its backing action is actually available.
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      // Resolve a real web/mailto link under the cursor (skip wikilinks and
      // in-document anchors — there's no "open externally" for those).
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      const href = anchor?.getAttribute("href") ?? "";
      const isWebLink = !!anchor && /^(https?:|mailto:)/i.test(href);

      const selection = window.getSelection()?.toString() ?? "";
      const items: ContextMenuItem[] = [];

      if (isWebLink) {
        items.push({
          label: t("editor.openLinkExternal"),
          icon: ExternalLink,
          onClick: () => {
            openUrl(href).catch(() => showToast(t("editor.linkOpenFailed")));
          },
        });
        items.push({
          label: t("editor.copyLinkAddress"),
          icon: Link2,
          onClick: () => {
            navigator.clipboard
              .writeText(href)
              .then(() => showToast(t("editor.linkAddressCopied")))
              .catch(() => showToast(t("editor.copyFailed")));
          },
        });
      }

      // Copy selected text — only shown when there is a selection (no dead item).
      if (selection.trim()) {
        if (items.length) items.push({ separator: true });
        items.push({
          label: t("markdownViewer.copySelectedText"),
          icon: Copy,
          onClick: () => {
            navigator.clipboard
              .writeText(selection)
              .then(() => showToast(t("editor.copiedToClipboard")))
              .catch(() => showToast(t("editor.copyFailed")));
          },
        });
      }

      // Edit: jump into edit mode for the current document (reuses setEditMode).
      if (currentFile) {
        if (items.length) items.push({ separator: true });
        items.push({
          label: t("commandPalette.switchToEditMode"),
          icon: Pencil,
          onClick: () => setEditMode(true),
        });
        // AI task submenu — one submenu per group (translate/summarize), same layout as the top bar and hamburger.
        // Items are picked by group from the registry. New tasks show up automatically.
        for (const g of AI_TASK_GROUPS) {
          items.push({
            label: t(g.labelKey),
            icon: g.icon,
            submenu: tasksInGroup(g.id).map((task) => ({
              label: t(task.labelKey),
              onClick: () => void runDocumentTask(task.id),
            })),
          });
        }
        // Compare with another document — it acts on the current document, so it sits in the same
        // group as edit/translate. The target is chosen via QuickOpen (compare mode). (The duplicate
        // entry in the file-actions group is removed with skipCompare.)
        items.push({
          label: t("hamburgerMenu.compareDocument"),
          icon: GitCompare,
          onClick: () => setQuickOpenMode("compare"),
        });
      }

      // Focus mode toggle (hide chrome / body only). Shows ✓ when currently on. Esc also exits.
      items.push({
        label: t("markdownViewer.focusMode"),
        icon: Focus,
        checked: focusMode,
        onClick: () => setFocusMode(!focusMode),
      });

      // File actions (open in new window / favorite / compare with another document / reveal in
      // explorer) use the same shared builder as the explorer right-click — based on the current document.
      if (currentFile) {
        items.push({ separator: true });
        items.push(...buildFileMenuItems({ path: currentFile, skipCompare: true }));
      }

      // View: zoom + theme — rarely used view controls, so they go in the bottom section (consistent with the status bar).
      if (items.length) items.push({ separator: true });
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

      // Nothing actionable here → fall through to the global handler (default
      // menu blocked in release, native inspector kept in dev).
      if (!items.length) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [currentFile, showToast, setEditMode, zoom, setZoom, settings.theme, setSettings, saveSettings, focusMode, setFocusMode, setQuickOpenMode, t]
  );

  if (!currentContent) return null;

  return (
    <div className="relative flex-1 overflow-hidden flex flex-col">
      {/* File deleted/moved on disk. */}
      {fileMissing && (
        <div
          className="no-print shrink-0 flex items-center gap-2 px-4 py-1.5 text-[12px]"
          style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", color: "var(--fg)" }}
        >
          <AlertTriangle size={14} style={{ color: "var(--accent)" }} className="shrink-0" />
          <span>{t("markdownViewer.fileMissingBanner")}</span>
          <button
            onClick={() => void recreateOpenFile()}
            className="rounded px-2 py-0.5 ml-1 font-medium"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            {t("markdownViewer.resaveButton")}
          </button>
          <button onClick={() => setFileMissing(false)} className="icon-btn !p-1 ml-auto" title={t("common.close")}>
            <X size={13} />
          </button>
        </div>
      )}
      {/* Notify-only mode: file changed on disk, awaiting manual reload. */}
      {externalChanged && !fileMissing && (
        <div
          className="no-print shrink-0 flex items-center gap-2 px-4 py-1.5 text-[12px]"
          style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", color: "var(--fg)" }}
        >
          <RefreshCw size={13} style={{ color: "var(--accent)" }} className="shrink-0" />
          <span>{t("markdownViewer.externalChangeBanner")}</span>
          <button
            onClick={reloadCurrent}
            className="rounded px-2 py-0.5 ml-1 font-medium"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            {t("markdownViewer.reload")}
          </button>
          <button onClick={() => setExternalChanged(false)} className="icon-btn !p-1 ml-auto" title={t("common.close")}>
            <X size={13} />
          </button>
        </div>
      )}
      {/* Padding lives on the scroll container itself (inline, since the global
          `* { padding: 0 }` reset overrides Tailwind's layered padding utils).
          This keeps the scrollbar full-height and flush against the right edge,
          while the padding provides the content margins (top/bottom scroll with
          the document; left/right are constant, with the right gap sitting
          between the text and the flush scrollbar). */}
      <div
        ref={scrollRef}
        tabIndex={-1}
        className="flex-1 min-h-0 overflow-auto flex flex-col items-center outline-none"
        style={{
          paddingTop: 44,
          paddingBottom: 144,
          paddingLeft: 32,
          paddingRight: 32,
          // Query container for `.md-table-wrap`'s cqw-based breakout below —
          // lets a wide table size itself off this box's real width instead
          // of md-content's 900px cap, without a JS width measurement.
          containerType: "inline-size",
        }}
        onScroll={handleScroll}
        onContextMenu={handleContextMenu}
      >
        <div
          className="md-content w-full"
          style={{
            // Grows with the content area up to a readable cap; margins (the
            // scroller's L/R padding) are preserved. 900 uses wide screens better
            // than 760 without letting lines get too long.
            maxWidth: "900px",
            zoom: zoom,
            // cqw units resolve in the (unzoomed) query container's coordinate
            // space, but `zoom` then scales the painted result — so a table
            // wrap sized in cqw must divide by zoom to land on the right pixel
            // width. See `.md-table-wrap` and `.md-content:has(.md-table-wrap)`
            // in markdown.css.
            ...({ "--zoom": zoom } as React.CSSProperties),
          }}
        >
          <div
            ref={contentRef}
            className="md-body md-zoomable"
            onClick={handleContentClick}
            onMouseOver={handleContentMouseOver}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
      {zoomTarget && <ZoomOverlay target={zoomTarget} onClose={() => setZoomTarget(null)} />}
      {/* "맨 위로" (back to top): fixed at bottom right. Right and bottom margins keep it clear of the
          body/scrollbar. Below the threshold it fades out (150ms transition) and is non-clickable. */}
      <button
        type="button"
        onClick={scrollToTop}
        aria-label={t("markdownViewer.scrollToTop")}
        title={t("markdownViewer.scrollToTop")}
        className="no-print absolute right-5 bottom-6 z-10 flex items-center justify-center rounded-full"
        style={{
          width: 40,
          height: 40,
          background: "var(--surface)",
          color: "var(--fg-secondary)",
          border: "1px solid var(--border)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          opacity: showTopBtn ? 1 : 0,
          pointerEvents: showTopBtn ? "auto" : "none",
          transition: "opacity 150ms ease, color 150ms ease, border-color 150ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--accent)";
          e.currentTarget.style.borderColor = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--fg-secondary)";
          e.currentTarget.style.borderColor = "var(--border)";
        }}
      >
        <ArrowUp size={18} />
      </button>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
      <SearchBar containerRef={contentRef} />
    </div>
  );
}
