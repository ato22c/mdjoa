import { ZoomIn, ZoomOut, Maximize2, Palette } from "lucide-react";
import { t } from "./i18n";
import type { ContextMenuItem } from "../components/common/ContextMenu";

type Theme = "light" | "dark" | "system";

// Shared "view" context-menu items (zoom + theme) reused by both the read view
// (MarkdownViewer) and the editor so the right-click menu is consistent in both
// modes. All reuse existing store actions — no new behavior. The theme item is a
// submenu so each option (System/Dark/Light) is picked directly instead of cycled,
// with a ✓ on the current theme.
export function buildViewMenuItems(opts: {
  zoom: number;
  setZoom: (z: number) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  // Zoom (in/out/reset) only makes sense for the document body, so sidebar menus
  // (context/token gauge/favorites) pass false to hide it. The default is true, so
  // the body view, editor, and explorer menus behave as before.
  includeZoom?: boolean;
}): ContextMenuItem[] {
  const { zoom, setZoom, theme, setTheme, includeZoom = true } = opts;
  return [
    ...(includeZoom
      ? [
          { label: t("commandPalette.zoomIn"), icon: ZoomIn, onClick: () => setZoom(zoom + 0.1) },
          { label: t("commandPalette.zoomOut"), icon: ZoomOut, onClick: () => setZoom(zoom - 0.1) },
          { label: t("contextMenuItems.resetZoom"), icon: Maximize2, onClick: () => setZoom(1.0) },
        ]
      : []),
    {
      label: t("menu.themeMenu"),
      icon: Palette,
      submenu: [
        { label: t("menu.themeSystem"), checked: theme === "system", onClick: () => setTheme("system") },
        { label: t("menu.themeDark"), checked: theme === "dark", onClick: () => setTheme("dark") },
        { label: t("menu.themeLight"), checked: theme === "light", onClick: () => setTheme("light") },
      ],
    },
  ];
}
