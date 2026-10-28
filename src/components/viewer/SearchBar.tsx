import { useEffect, useRef, useState } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import { useAppStore } from "../../store/app";
import { useT } from "../../lib/i18n";

interface Props {
  containerRef: React.RefObject<HTMLElement | null>;
}

export function SearchBar({ containerRef }: Props) {
  const t = useT();
  const { searchOpen, searchQuery, setSearchOpen, setSearchQuery } = useAppStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [matchCount, setMatchCount] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);
  const marksRef = useRef<Element[]>([]);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
    else clearHighlights();
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    doSearch(searchQuery);
  }, [searchQuery, searchOpen]);

  const clearHighlights = () => {
    marksRef.current = [];
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll("mark.search-highlight").forEach((m) => {
      const parent = m.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(m.textContent ?? ""), m);
        parent.normalize();
      }
    });
    setMatchCount(0);
    setCurrentIdx(0);
  };

  const doSearch = (q: string) => {
    clearHighlights();
    if (!q.trim()) return;
    const container = containerRef.current;
    if (!container) return;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      nodes.push(node as Text);
    }

    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const marks: Element[] = [];

    nodes.forEach((textNode) => {
      const text = textNode.textContent ?? "";
      const matches = [...text.matchAll(regex)];
      if (!matches.length) return;

      const frag = document.createDocumentFragment();
      let last = 0;
      matches.forEach((m) => {
        const start = m.index!;
        if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
        const mark = document.createElement("mark");
        mark.className = "search-highlight";
        mark.textContent = m[0];
        frag.appendChild(mark);
        marks.push(mark);
        last = start + m[0].length;
      });
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode?.replaceChild(frag, textNode);
    });

    marksRef.current = marks;
    setMatchCount(marks.length);
    if (marks.length > 0) {
      setCurrentIdx(0);
      highlightCurrent(marks, 0);
    }
  };

  const highlightCurrent = (marks: Element[], idx: number) => {
    marks.forEach((m, i) => {
      if (i === idx) {
        m.classList.add("current");
        m.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        m.classList.remove("current");
      }
    });
  };

  const moveTo = (delta: number) => {
    if (!marksRef.current.length) return;
    const next = (currentIdx + delta + marksRef.current.length) % marksRef.current.length;
    setCurrentIdx(next);
    highlightCurrent(marksRef.current, next);
  };

  if (!searchOpen) return null;

  return (
    <div
      ref={barRef}
      onBlur={(e) => {
        // Close when focus leaves the bar entirely (clicked elsewhere / Tab out).
        // relatedTarget inside the bar (e.g. the prev/next buttons) keeps it open;
        // a null relatedTarget (clicking non-focusable page content) closes it.
        if (!barRef.current?.contains(e.relatedTarget as Node | null)) setSearchOpen(false);
      }}
      className="search-bar no-print fixed top-12 right-4 z-40 flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-[10px]"
      style={{ background: "var(--bg)", boxShadow: "var(--shadow-popover)" }}
    >
      <input
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") moveTo(e.shiftKey ? -1 : 1);
          if (e.key === "Escape") setSearchOpen(false);
        }}
        placeholder={t("searchBar.placeholder")}
        className="outline-none bg-transparent text-sm w-52"
        style={{ color: "var(--fg)" }}
      />
      <span
        className="text-[11px] tabular-nums shrink-0 min-w-8 text-right"
        style={{ color: "var(--muted)" }}
      >
        {matchCount > 0 ? `${currentIdx + 1}/${matchCount}` : searchQuery ? t("editorFindBar.noMatchesLabel") : ""}
      </span>
      <button onClick={() => moveTo(-1)} className="icon-btn !p-1" title={t("editorFindBar.prevTooltip")}>
        <ChevronUp size={14} />
      </button>
      <button onClick={() => moveTo(1)} className="icon-btn !p-1" title={t("editorFindBar.nextTooltip")}>
        <ChevronDown size={14} />
      </button>
      <button onClick={() => setSearchOpen(false)} className="icon-btn !p-1" title={t("settings.closeTooltip")}>
        <X size={14} />
      </button>
    </div>
  );
}
