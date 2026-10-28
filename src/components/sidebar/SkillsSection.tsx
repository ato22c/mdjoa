import { useState } from "react";
import {
  ChevronRight, Boxes, Wand2, Bot, SquareTerminal, FileText, FolderOpen,
  type LucideIcon,
} from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useAppStore } from "../../store/app";
import { isMac } from "../../lib/platform";
import { useT } from "../../lib/i18n";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import type { ClaudeAsset } from "../../types";

const KIND_ORDER: ClaudeAsset["kind"][] = ["skill", "agent", "command"];

/**
 * Auto-detected `.claude` assets (skills/agents/commands) for the open folder.
 * Mirrors ContextSection: AUTO, folder-scoped, read-only (click to open).
 * Minimal-chrome guard: renders NOTHING when there are no assets.
 */
export function SkillsSection({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useT();
  const { claudeAssets, currentFile, openFile, showToast, settings, setSettings, saveSettings } = useAppStore();
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const KIND_META: Record<ClaudeAsset["kind"], { label: string; Icon: LucideIcon }> = {
    skill: { label: t("skillsSection.kindSkill"), Icon: Wand2 },
    agent: { label: t("skillsSection.kindAgent"), Icon: Bot },
    command: { label: t("skillsSection.kindCommand"), Icon: SquareTerminal },
  };

  const onRowContextMenu = (path: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  // Drag the handle below the list to resize the skills panel height.
  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = settings.skills_height;
    const onMove = (ev: MouseEvent) => {
      const h = Math.max(80, Math.min(600, startH + (ev.clientY - startY)));
      setSettings({ skills_height: h });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      saveSettings();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const onPanelContextMenu = (e: React.MouseEvent) => e.preventDefault();

  // Group by kind, preserving the backend's kind→name sort.
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    items: claudeAssets.filter((a) => a.kind === kind),
  })).filter((g) => g.items.length > 0);

  // Derived count: only items that will actually be rendered.
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  // Empty group → no chrome at all.
  if (total === 0) return null;

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
          <Boxes size={11} />
          {t("skillsSection.title")}
          <span className="ml-auto font-normal tabular-nums">{total}</span>
        </button>
      )}

      {(embedded || !collapsed) && (
        <>
        {/* Resizable list: drag the handle below to set the height; scrolls when
            there are many assets. */}
        <div
          className="pb-1.5 px-2 overflow-y-auto"
          style={{ height: embedded ? settings.shelf_height : settings.skills_height, maxHeight: embedded ? "60vh" : undefined }}
        >
          {groups.map((g) => {
            const { label, Icon } = KIND_META[g.kind];
            return (
              <div key={g.kind}>
                <div
                  className="flex items-center gap-1 text-[11px] mt-1.5 mb-0.5"
                  style={{ color: "var(--muted)", paddingLeft: 7 }}
                >
                  <Icon size={11} />
                  <span className="uppercase tracking-wide">{label}</span>
                  <span className="ml-auto tabular-nums pr-1">{g.items.length}</span>
                </div>
                {g.items.map((a) => {
                  const active = a.path === currentFile;
                  return (
                    <div
                      key={a.path}
                      className="row-hover rounded-md cursor-pointer"
                      style={{
                        background: active ? "var(--active)" : undefined,
                        paddingTop: 3, paddingBottom: 3, paddingLeft: 7, paddingRight: 6,
                      }}
                      onClick={() => openFile(a.path)}
                      onContextMenu={onRowContextMenu(a.path)}
                      title={a.description ? `${a.name} — ${a.description}` : a.path}
                    >
                      <div
                        className="flex items-center gap-1 text-[14px]"
                        style={{ fontWeight: active ? 500 : 400 }}
                      >
                        <Icon size={13} className="shrink-0" style={{ color: "var(--accent)" }} />
                        <span className="truncate flex-1">{a.name}</span>
                      </div>
                      {a.description && (
                        <div
                          className="truncate text-[12px]"
                          style={{ color: "var(--muted)", paddingLeft: 18, marginTop: 1 }}
                        >
                          {a.description}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {/* Resize handle: drag to set skills panel height. embedded = the shelf
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
