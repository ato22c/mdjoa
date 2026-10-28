import { useState } from "react";
import { ChevronRight, Sparkles, FileText, FolderOpen, ListPlus, ListX } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useAppStore } from "../../store/app";
import { isMac } from "../../lib/platform";
import { parentSegments } from "../../lib/pathUtil";
import { useT } from "../../lib/i18n";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";

/**
 * Auto-detected "context" documents for the open folder (feature C):
 * CLAUDE.md, AGENTS.md, *.spec.md, plan*.md, … matched by file-name globs.
 *
 * This is an AUTOMATIC, folder-scoped group, distinct from the manual, global
 * 즐겨찾기 (FavoritesSection). It is read-only: items open on click, there is no
 * add/remove here — patterns are edited only in the Settings modal.
 *
 * Minimal-chrome guard: when there are no matches the section renders NOTHING
 * (returns null) so an empty folder shows zero UI.
 */
export function ContextSection({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useT();
  const {
    contextFiles,
    currentFile,
    openFile,
    selectedContextPaths,
    toggleContextSelection,
    settings,
    setSettings,
    saveSettings,
    showToast,
  } = useAppStore();
  const [collapsed, setCollapsed] = useState(false);
  // App-owned right-click menu. null = closed.
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  // Right-click a context file row → app-owned menu (replaces the browser's
  // default menu so it doesn't read as an "error"). All items reuse existing
  // store actions / the same revealItemInDir used by the document view.
  const onRowContextMenu = (path: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const selected = selectedContextPaths.includes(path);
    const items: ContextMenuItem[] = [
      { label: t("common.open"), icon: FileText, onClick: () => openFile(path) },
      {
        label: isMac ? t("common.revealInFinder") : t("common.revealInExplorer"),
        icon: FolderOpen,
        onClick: () => {
          revealItemInDir(path).catch(() =>
            showToast(isMac ? t("common.revealInFinderFailed") : t("common.revealInExplorerFailed"))
          );
        },
      },
      {
        label: selected ? t("contextSection.excludeFromSum") : t("contextSection.addToSum"),
        icon: selected ? ListX : ListPlus,
        onClick: () => toggleContextSelection(path),
      },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  // Drag the handle below the list to resize the context panel height.
  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = settings.context_height;
    const onMove = (ev: MouseEvent) => {
      const h = Math.max(80, Math.min(600, startH + (ev.clientY - startY)));
      setSettings({ context_height: h });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      saveSettings();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Right-click on the header/empty area: just suppress the browser's default
  // menu — there's no panel-level action (theme/zoom were removed from sidebar).
  const onPanelContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  // Empty group → no chrome at all (spec: 매칭 0건이면 크롬 0).
  if (contextFiles.length === 0) return null;

  return (
    <div
      className="shrink-0"
      style={embedded ? undefined : { borderBottom: "1px solid var(--border)" }}
      onContextMenu={onPanelContextMenu}
    >
      {/* embedded = shown inside SidebarShelf, which owns the tab header. */}
      {!embedded && (
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1 w-full h-9 pr-4 text-[12px] font-semibold uppercase tracking-wide"
          style={{ color: "var(--muted)", letterSpacing: "0.04em", paddingLeft: 7 }}
        >
          <ChevronRight
            size={12}
            style={{
              transform: collapsed ? undefined : "rotate(90deg)",
              transition: "transform 120ms ease",
            }}
          />
          <Sparkles size={11} />
          {t("contextSection.title")}
          <span className="ml-auto font-normal tabular-nums">{contextFiles.length}</span>
        </button>
      )}

      {(embedded || !collapsed) && (
        <>
        {/* Resizable list: drag the handle below to set the height; scrolls when
            there are many context files. */}
        <div
          className="pb-1.5 px-2 overflow-y-auto"
          style={{ height: embedded ? settings.shelf_height : settings.context_height, maxHeight: embedded ? "60vh" : undefined }}
        >
          {contextFiles.map((f) => {
            const active = f.path === currentFile;
            const checked = selectedContextPaths.includes(f.path);
            // Parent path hint (last 2 segments) so same-named files (e.g. nested
            // SKILL.md) are distinguishable; full path stays on the hover title.
            // Cross-platform: parentSegments handles `\` and `/`.
            const shortDir = parentSegments(f.path).slice(-2).join("/");
            return (
              <div
                key={f.path}
                className="row-hover rounded-md cursor-pointer"
                style={{
                  background: active ? "var(--active)" : undefined,
                  paddingTop: 3,
                  paddingBottom: 3,
                  paddingLeft: 7,
                  paddingRight: 6,
                }}
                onClick={() => openFile(f.path)}
                onContextMenu={onRowContextMenu(f.path)}
                title={f.path}
              >
                <div
                  className="flex items-center gap-1 text-[14px]"
                  style={{ fontWeight: active ? 500 : 400 }}
                >
                  {/* Multi-select checkbox (feature D). Stops propagation so a
                      tick toggles selection WITHOUT opening the file — the row
                      click (open) keeps working everywhere else. */}
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleContextSelection(f.path)}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 cursor-pointer"
                    style={{ accentColor: "var(--accent)", width: 12, height: 12 }}
                    title={t("contextSection.includeInTotalTooltip")}
                    aria-label={t("contextSection.includeInTotalAriaLabel", { name: f.name })}
                  />
                  <FileText size={13} className="shrink-0" style={{ color: "var(--accent)" }} />
                  <span className="truncate flex-1">{f.name}</span>
                </div>
                {shortDir && (
                  <div
                    className="truncate text-[12px]"
                    style={{ color: "var(--muted)", paddingLeft: 18, marginTop: 1 }}
                  >
                    {shortDir}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* Resize handle: drag to set context panel height. embedded = the shelf
            owns a top-edge handle instead. */}
        <div
          style={embedded ? { display: "none" } : undefined}
          onMouseDown={onResizeMouseDown}
          title={t("favoritesSection.resizeTooltip")}
          className="group/resize shrink-0 h-2 cursor-row-resize flex items-center justify-center"
        >
          <div
            className="h-[2px] w-8 rounded-full opacity-0 group-hover/resize:opacity-100 transition-opacity"
            style={{ background: "var(--border)" }}
          />
        </div>
        </>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
