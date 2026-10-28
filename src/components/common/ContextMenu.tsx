import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// A single context-menu entry. A `separator` row is a thin divider and ignores
// every other field. A normal row shows an optional icon + label and runs
// `onClick` when activated (unless `disabled`). An item with `submenu` opens a
// fly-out on hover instead of running onClick. `checked` shows a ✓ (used for
// radio-style choices like the theme picker).
export interface ContextMenuItem {
  label?: string;
  icon?: LucideIcon;
  onClick?: () => void;
  disabled?: boolean;
  separator?: boolean;
  submenu?: ContextMenuItem[];
  checked?: boolean;
}

export interface ContextMenuProps {
  // Anchor position (viewport coords, e.g. event.clientX/Y).
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * Clamp a menu's top-left so the whole box stays on screen. Pure + exported so
 * the boundary logic can be unit-tested without a DOM. Prefers the requested
 * position; only nudges left/up when the menu would overflow, and never goes
 * negative (8px viewport margin).
 */
export function clampMenuPosition(
  x: number,
  y: number,
  menuW: number,
  menuH: number,
  viewportW: number,
  viewportH: number,
  margin = 8
): { left: number; top: number } {
  let left = x;
  let top = y;
  if (left + menuW > viewportW - margin) left = viewportW - menuW - margin;
  if (top + menuH > viewportH - margin) top = viewportH - menuH - margin;
  if (left < margin) left = margin;
  if (top < margin) top = margin;
  return { left, top };
}

// Shared row style for both the main menu and submenus.
const MENU_CLASS = "fixed z-[100] no-print py-1 rounded-lg text-[13px] select-none";
const MENU_STYLE: React.CSSProperties = {
  minWidth: 180,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
  color: "var(--fg)",
};

const SUB_MENU_STYLE: React.CSSProperties = { ...MENU_STYLE, minWidth: 140 };

function MenuRow({
  item,
  hasSubmenu,
  onActivate,
  onHover,
}: {
  item: ContextMenuItem;
  hasSubmenu: boolean;
  onActivate: () => void;
  onHover: (e: React.MouseEvent) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      role="menuitem"
      disabled={item.disabled}
      onClick={() => {
        if (item.disabled || hasSubmenu) return;
        onActivate();
      }}
      onMouseEnter={onHover}
      className="row-hover flex items-center gap-2.5 w-full px-3 h-8 text-left rounded-none"
      style={{
        color: item.disabled ? "var(--muted)" : "var(--fg)",
        opacity: item.disabled ? 0.5 : 1,
        cursor: item.disabled ? "default" : "pointer",
        transition: "background-color 120ms ease",
      }}
    >
      {Icon ? (
        <Icon size={14} className="shrink-0" style={{ color: "var(--muted)" }} />
      ) : (
        // Reserve the icon slot so labels align whether or not there's an icon
        // (e.g. checkable theme rows).
        <span className="shrink-0" style={{ width: 14 }} />
      )}
      <span className="truncate flex-1">{item.label}</span>
      {item.checked && <Check size={14} className="shrink-0" style={{ color: "var(--accent)" }} />}
      {hasSubmenu && (
        <ChevronRight size={14} className="shrink-0" style={{ color: "var(--muted)" }} />
      )}
    </button>
  );
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  // Start at the requested point; correct once we can measure the rendered box.
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  // Open submenu (fly-out): index into `items` + raw anchor at the row's right.
  const [sub, setSub] = useState<{ i: number; x: number; y: number } | null>(null);
  const [subPos, setSubPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  // Measure after mount and clamp into the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos(clampMenuPosition(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight));
  }, [x, y]);

  // Clamp the submenu once it renders (so it doesn't run off the right edge).
  useEffect(() => {
    if (!sub) return;
    const el = subRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSubPos(
      clampMenuPosition(sub.x, sub.y, rect.width, rect.height, window.innerWidth, window.innerHeight)
    );
  }, [sub]);

  // Close on outside click, Esc, scroll, resize, or losing focus. Capture phase
  // so an outside mousedown closes before it can do anything else. A click inside
  // EITHER the main menu or the open submenu counts as "inside".
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (subRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const subItems = sub != null ? items[sub.i]?.submenu ?? [] : [];

  return createPortal(
    <>
      <div
        ref={ref}
        role="menu"
        className={MENU_CLASS}
        style={{ ...MENU_STYLE, left: pos.left, top: pos.top }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item, i) => {
          if (item.separator) {
            return <div key={`sep-${i}`} className="my-1 h-px" style={{ background: "var(--border)" }} />;
          }
          const hasSubmenu = !!item.submenu?.length;
          return (
            <MenuRow
              key={i}
              item={item}
              hasSubmenu={hasSubmenu}
              onActivate={() => {
                onClose();
                item.onClick?.();
              }}
              onHover={(e) => {
                if (hasSubmenu) {
                  const r = e.currentTarget.getBoundingClientRect();
                  setSub({ i, x: r.right - 4, y: r.top - 4 });
                } else {
                  setSub(null);
                }
              }}
            />
          );
        })}
      </div>

      {sub != null && subItems.length > 0 && (
        <div
          ref={subRef}
          role="menu"
          className={MENU_CLASS}
          style={{ ...SUB_MENU_STYLE, left: subPos.left, top: subPos.top }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {subItems.map((item, j) =>
            item.separator ? (
              <div key={`ssep-${j}`} className="my-1 h-px" style={{ background: "var(--border)" }} />
            ) : (
              <MenuRow
                key={j}
                item={item}
                hasSubmenu={false}
                onActivate={() => {
                  onClose();
                  item.onClick?.();
                }}
                onHover={() => {}}
              />
            )
          )}
        </div>
      )}
    </>,
    document.body
  );
}
