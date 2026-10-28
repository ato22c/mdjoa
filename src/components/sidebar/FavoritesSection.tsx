import { useRef, useState } from "react";
import { Star, ChevronRight, X, GripVertical, Folder, FolderOpen, StarOff } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useAppStore } from "../../store/app";
import { isMac } from "../../lib/platform";
import { parentSegments } from "../../lib/pathUtil";
import { useT } from "../../lib/i18n";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";

/**
 * Pinned favorites at the top of the sidebar. Collapsible, hidden when empty.
 * Items can be reordered by dragging the grip handle: a grip handle fades in on
 * hover, the dragged row dims, and a thin accent line marks where it will drop.
 *
 * Reordering uses POINTER events (not HTML5 drag-and-drop) because the Tauri
 * webview's native file-drop handler intercepts HTML5 drag events, so they
 * never fire inside the webview.
 */
export function FavoritesSection({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useT();
  const { favorites, currentFile, openFile, setFolder, toggleFavorite, reorderFavorites, clearFavorites, settings, setSettings, saveSettings, showToast } =
    useAppStore();
  const [collapsed, setCollapsed] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overSlot, setOverSlot] = useState<number | null>(null);
  // App-owned right-click menu. null = closed.
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  // Open a favorite the same way a left-click row does: folders open in the
  // tree, files open in the viewer.
  const openFavorite = (f: { path: string; is_dir: boolean }) => {
    if (f.is_dir) setFolder(f.path);
    else openFile(f.path);
  };

  // Right-click a favorite row → app-owned menu (replaces the browser default so
  // it doesn't read as an "error"). All items reuse existing store actions.
  const onRowContextMenu = (f: { path: string; name: string; is_dir: boolean }) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const items: ContextMenuItem[] = [
      { label: t("common.open"), icon: f.is_dir ? Folder : Star, onClick: () => openFavorite(f) },
      {
        label: isMac ? t("common.revealInFinder") : t("common.revealInExplorer"),
        icon: FolderOpen,
        onClick: () => {
          revealItemInDir(f.path).catch(() =>
            showToast(isMac ? t("common.revealInFinderFailed") : t("common.revealInExplorerFailed"))
          );
        },
      },
      { label: t("favoritesSection.removeFavorite"), icon: StarOff, onClick: () => toggleFavorite(f.path, f.is_dir) },
      { label: t("favoritesSection.clearAll"), icon: StarOff, onClick: () => clearFavorites() },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  // Bounding rects of each row, kept in a ref so a pointer move can compute the
  // hovered insertion slot without re-rendering. Index aligns with favorites.
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Pointer-drag bookkeeping (refs so handlers see fresh values, no re-render).
  const startYRef = useRef(0);
  const startIndexRef = useRef<number | null>(null);
  // Whether the pointer moved past the drag threshold. Used in row onClick to
  // suppress the click-to-open that the browser fires after a drag gesture.
  const movedRef = useRef(false);
  const DRAG_THRESHOLD = 4; // px before a press becomes a drag

  // Map a pointer Y position to an insertion slot (0..favorites.length) by
  // comparing against each row's vertical midpoint.
  const slotForY = (y: number) => {
    for (let i = 0; i < favorites.length; i++) {
      const el = rowRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return favorites.length;
  };

  const onHandlePointerDown = (i: number) => (e: React.PointerEvent) => {
    // Left button / primary pointer only.
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    startIndexRef.current = i;
    startYRef.current = e.clientY;
    movedRef.current = false;
  };

  const onHandlePointerMove = (e: React.PointerEvent) => {
    if (startIndexRef.current === null) return;
    if (!movedRef.current && Math.abs(e.clientY - startYRef.current) < DRAG_THRESHOLD) return;
    if (!movedRef.current) {
      movedRef.current = true;
      setDragIndex(startIndexRef.current);
    }
    setOverSlot(slotForY(e.clientY));
  };

  const onHandlePointerUp = (e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    if (movedRef.current) onDrop();
    else reset();
    startIndexRef.current = null;
  };

  // Drag the handle below the list to resize the favorites panel height.
  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = settings.favorites_height;
    const onMove = (ev: MouseEvent) => {
      const h = Math.max(80, Math.min(480, startH + (ev.clientY - startY)));
      setSettings({ favorites_height: h });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      saveSettings();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  if (favorites.length === 0) return null;

  const dragging = dragIndex !== null;

  const reset = () => {
    setDragIndex(null);
    setOverSlot(null);
    movedRef.current = false;
  };

  const onDrop = () => {
    if (dragIndex === null || overSlot === null) return reset();
    const paths = favorites.map((f) => f.path);
    const [moved] = paths.splice(dragIndex, 1);
    const target = overSlot > dragIndex ? overSlot - 1 : overSlot;
    paths.splice(target, 0, moved);
    // Only persist if the order actually changed.
    if (paths.some((p, i) => p !== favorites[i].path)) reorderFavorites(paths);
    reset();
  };

  const InsertionLine = () => (
    <div
      style={{ height: 2, borderRadius: 2, margin: "1px 6px", background: "var(--accent)" }}
    />
  );

  // Right-click on the header/empty area (rows stopPropagation + show their own
  // menu) → app menu instead of the browser default.
  const onPanelContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      { label: t("favoritesSection.clearAll"), icon: StarOff, onClick: () => clearFavorites() },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  return (
    <div
      className="shrink-0"
      style={embedded ? undefined : { borderBottom: "1px solid var(--border)" }}
      onContextMenu={onPanelContextMenu}
    >
      {/* embedded = shown inside SidebarShelf, which owns the tab header
          (clear-all stays reachable from the right-click menu). */}
      {!embedded && (
      <div className="group/hdr flex items-center w-full h-9 pr-2" style={{ paddingLeft: 7 }}>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1 flex-1 min-w-0 text-[12px] font-semibold uppercase tracking-wide"
          style={{ color: "var(--muted)", letterSpacing: "0.04em" }}
        >
          <ChevronRight
            size={12}
            style={{
              transform: collapsed ? undefined : "rotate(90deg)",
              transition: "transform 120ms ease",
            }}
          />
          <Star size={11} fill="currentColor" />
          {t("favoritesSection.title")}
          <span className="font-normal tabular-nums">{favorites.length}</span>
        </button>
        {/* Clear-all: removes every favorite, with a 되돌리기 toast as the safety
            net (no confirm dialog). Shown on header hover; section is hidden when
            the list is empty, so there's always something to clear here. */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            clearFavorites();
          }}
          className="shrink-0 opacity-0 group-hover/hdr:opacity-100 rounded hover:bg-[var(--hover)] transition-opacity"
          style={{ padding: 3 }}
          title={t("favoritesSection.clearAll")}
        >
          <StarOff size={13} style={{ color: "var(--muted)" }} />
        </button>
      </div>
      )}

      {(embedded || !collapsed) && (
        <>
        <div
          className="pb-1.5 px-2 overflow-y-auto"
          style={{ height: embedded ? settings.shelf_height : settings.favorites_height, maxHeight: embedded ? "60vh" : undefined }}
        >
          {favorites.map((f, i) => {
            const active = f.path === currentFile;
            const isDragged = dragIndex === i;
            // Parent path hint (last 2 segments) so same-named favorites are
            // distinguishable; full path stays on the native hover title.
            // Cross-platform: parentSegments handles `\` and `/`.
            const shortDir = parentSegments(f.path).slice(-2).join("/");
            return (
              <div key={f.path}>
                {dragging && overSlot === i && <InsertionLine />}
                <div
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  className="row-hover group rounded-md cursor-pointer"
                  style={{
                    background: active ? "var(--active)" : undefined,
                    paddingTop: 3,
                    paddingBottom: 3,
                    paddingLeft: 7,
                    paddingRight: 6,
                    opacity: isDragged ? 0.4 : 1,
                    transition: "opacity 120ms ease",
                  }}
                  onClick={() => {
                    // Suppress the click that follows a drag gesture; only open
                    // on a genuine click (no movement past the threshold).
                    if (movedRef.current) return;
                    // Folders open the folder in the tree; files open the file.
                    openFavorite(f);
                  }}
                  onContextMenu={onRowContextMenu(f)}
                  title={f.path}
                >
                  <div
                    className="flex items-center gap-1 text-[14px]"
                    style={{ fontWeight: active ? 500 : 400 }}
                  >
                    <GripVertical
                      size={13}
                      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{
                        color: "var(--muted)",
                        touchAction: "none",
                        cursor: isDragged ? "grabbing" : "grab",
                      }}
                      onPointerDown={onHandlePointerDown(i)}
                      onPointerMove={onHandlePointerMove}
                      onPointerUp={onHandlePointerUp}
                    />
                    {f.is_dir ? (
                      <Folder size={13} className="shrink-0" style={{ color: "var(--accent)" }} />
                    ) : (
                      <Star size={13} fill="currentColor" className="shrink-0" style={{ color: "var(--accent)" }} />
                    )}
                    <span className="truncate flex-1">{f.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(f.path, f.is_dir);
                      }}
                      className="shrink-0 opacity-0 group-hover:opacity-100 rounded hover:bg-[var(--hover)] transition-opacity"
                      style={{ padding: 2 }}
                      title={t("topbar.unfavorite")}
                    >
                      <X size={12} style={{ color: "var(--muted)" }} />
                    </button>
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
                {dragging && overSlot === favorites.length && i === favorites.length - 1 && (
                  <InsertionLine />
                )}
              </div>
            );
          })}
        </div>
        {/* Resize handle: drag to set favorites panel height. embedded = the shelf
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
