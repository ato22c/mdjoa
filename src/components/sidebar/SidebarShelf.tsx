import { useState } from "react";
import { Sparkles, Boxes, Star, type LucideIcon } from "lucide-react";
import { useAppStore } from "../../store/app";
import { useT } from "../../lib/i18n";
import { ContextSection } from "./ContextSection";
import { SkillsSection } from "./SkillsSection";
import { FavoritesSection } from "./FavoritesSection";

type TabId = "context" | "skills" | "favorites";

/**
 * Bottom shelf that groups Context, Skills and Favorites into a single row of tabs.
 *
 * The explorer is the sidebar's main feature, so these three lists start collapsed
 * (no active tab) and only one expands at a time. Clicking the active tab again
 * collapses it. Empty groups get no tab at all (minimal chrome), and if all three
 * are empty nothing is rendered.
 */
export function SidebarShelf() {
  const t = useT();
  const contextCount = useAppStore((s) => s.contextFiles.length);
  const favoritesCount = useAppStore((s) => s.favorites.length);
  const skillsCount = useAppStore((s) => s.claudeAssets.length);
  // null = collapsed. If the selected tab becomes empty (e.g. all favorites removed), it is treated as collapsed below.
  const [active, setActive] = useState<TabId | null>(null);
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const saveSettings = useAppStore((s) => s.saveSettings);

  // Tab order: Favorites -> Context -> Skills.
  const tabs: { id: TabId; label: string; Icon: LucideIcon; count: number }[] = [
    { id: "favorites" as const, label: t("favoritesSection.title"), Icon: Star, count: favoritesCount },
    { id: "context" as const, label: t("contextSection.title"), Icon: Sparkles, count: contextCount },
    { id: "skills" as const, label: t("skillsSection.title"), Icon: Boxes, count: skillsCount },
  ].filter((tab) => tab.count > 0);

  if (tabs.length === 0) return null;

  const current = tabs.find((tab) => tab.id === active)?.id ?? null;

  // Dragging the top edge up enlarges the expanded list. Each tab has its own saved-height key.
  const onResizeMouseDown = (e: React.MouseEvent) => {
    if (!current) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = settings.shelf_height;
    const onMove = (ev: MouseEvent) => {
      const max = Math.min(600, Math.round(window.innerHeight * 0.6));
      setSettings({ shelf_height: Math.max(80, Math.min(max, startH + (startY - ev.clientY))) });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      saveSettings();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div className="shrink-0 relative" style={{ borderTop: "1px solid var(--border)" }}>
      {/* Only when expanded: height-resize handle straddling the top edge. */}
      {current && (
        <div
          onMouseDown={onResizeMouseDown}
          title={t("favoritesSection.resizeTooltip")}
          className="absolute left-0 right-0 -top-1 h-2 z-10 cursor-row-resize hover:bg-[var(--accent)] opacity-0 hover:opacity-30 transition-opacity"
        />
      )}
      <div className="flex items-center h-8 px-1" role="tablist">
        {tabs.map(({ id, label, Icon, count }) => {
          const on = id === current;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={on}
              onClick={() => setActive(on ? null : id)}
              className="row-hover flex items-center justify-center gap-1 flex-1 min-w-0 h-7 rounded-md text-[12px]"
              style={{
                color: on ? "var(--fg)" : "var(--muted)",
                background: on ? "var(--active)" : undefined,
                fontWeight: on ? 600 : 400,
              }}
              title={label}
            >
              <Icon
                size={11}
                className="shrink-0"
                style={{ color: on ? "var(--accent)" : undefined }}
              />
              <span className="truncate">{label}</span>
              <span className="shrink-0 font-normal tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>
      {current === "context" && <ContextSection embedded />}
      {current === "skills" && <SkillsSection embedded />}
      {current === "favorites" && <FavoritesSection embedded />}
    </div>
  );
}
