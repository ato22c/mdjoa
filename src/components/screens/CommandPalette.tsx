import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Search } from "lucide-react";
import { useAppStore } from "../../store/app";
import { createNewFileViaDialog, saveCurrentFileAs } from "../../lib/newFile";
import { fuzzyFilter } from "../../lib/fuzzy";
import { MOD_LABEL } from "../../lib/platform";
import { buildOpenDialogFilters } from "../../lib/fileType";
import { useT } from "../../lib/i18n";

/**
 * Command palette (⌘/Ctrl+K) — a global overlay to fuzzy-search and run every action.
 *
 * Follows QuickOpen's modal/input/list look and keyboard navigation (↑↓ to move,
 * Enter to run, Esc to close). Each command reuses existing store actions, dialogs and
 * invoke calls as-is, so behavior matches the hamburger/native menus. Commands that
 * don't apply (e.g. compare/new window with no document) are left out of the list.
 *
 * Visibility is owned solely by store.paletteOpen (AppShell's ⌘K opens it).
 */

interface Command {
  label: string;
  run: () => void;
  /** Shortcut hint (already formatted with MOD_LABEL). */
  hint?: string;
}

export function CommandPalette() {
  const t = useT();
  const paletteOpen = useAppStore((s) => s.paletteOpen);
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen);
  // Subscribe because the command list must be recomputed when currentFile/currentFolder change.
  const currentFile = useAppStore((s) => s.currentFile);
  const currentFolder = useAppStore((s) => s.currentFolder);
  const editMode = useAppStore((s) => s.editMode);
  // Review command is shown only when there is at least one change.
  const changedCount = useAppStore((s) => Object.keys(s.changedFiles).length);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setPaletteOpen(false), [setPaletteOpen]);

  // Command definitions. All behavior reuses existing actions/patterns — latest state is
  // read via getState() and evaluated at run time. Context conditions (current
  // document/folder) are filtered out when building the list.
  const commands = useMemo<Command[]>(() => {
    const s = () => useAppStore.getState();
    const setTheme = (theme: "light" | "dark" | "system") => {
      s().setSettings({ theme });
      s().saveSettings();
    };
    const list: Command[] = [];

    list.push({ label: t("commandPalette.newFile"), run: () => void createNewFileViaDialog() });
    if (currentFile) {
      list.push({
        label: t("commandPalette.saveAs"),
        hint: `${MOD_LABEL}Shift+S`,
        run: () => void saveCurrentFileAs(),
      });
    }
    list.push({
      label: t("welcome.openFile"),
      hint: `${MOD_LABEL}O`,
      run: async () => {
        try {
          const sel = await open({ multiple: false, filters: buildOpenDialogFilters() });
          if (typeof sel === "string") await s().openFile(sel);
        } catch (e) {
          s().showToast(t("toast.openFailed", { err: String(e) }));
        }
      },
    });
    list.push({
      label: t("welcome.openFolder"),
      hint: `${MOD_LABEL}Shift+O`,
      run: async () => {
        try {
          const sel = await open({ directory: true, multiple: false });
          if (typeof sel === "string") s().setFolder(sel);
        } catch (e) {
          s().showToast(t("toast.folderOpenFailed", { err: String(e) }));
        }
      },
    });
    list.push({
      label: t("commandPalette.quickOpenFile"),
      hint: `${MOD_LABEL}O`,
      run: () => {
        s().setQuickOpenMode("open");
        // QuickOpen toggles on its own ⌘O, so synthesize the same key event here to open it.
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "o", metaKey: true, ctrlKey: true })
        );
      },
    });
    if (currentFile) {
      list.push({
        label: t("commandPalette.compareDocument"),
        hint: `${MOD_LABEL}\\`,
        run: () => s().setQuickOpenMode("compare"),
      });
    }
    list.push({
      label: t("commandPalette.goBack"),
      hint: `${MOD_LABEL}←`,
      run: () => void s().goBack(),
    });
    list.push({
      label: t("commandPalette.goForward"),
      hint: `${MOD_LABEL}→`,
      run: () => void s().goForward(),
    });
    list.push({
      label: t("commandPalette.toggleSidebar"),
      hint: `${MOD_LABEL}B`,
      run: () => {
        const st = s();
        st.setSettings({ sidebar_open: !st.settings.sidebar_open });
        st.saveSettings();
      },
    });
    list.push({
      label: t("commandPalette.toggleOutline"),
      run: () => {
        const st = s();
        st.setSettings({ outline_open: !st.settings.outline_open });
        st.saveSettings();
      },
    });
    list.push({
      label: t("commandPalette.findInDocument"),
      hint: `${MOD_LABEL}F`,
      run: () => s().setSearchOpen(true),
    });
    if (currentFolder) {
      list.push({ label: t("commandPalette.refreshExplorer"), run: () => s().bumpTreeRefresh() });
    }
    // Change review (killer #1): shown only when at least one document changed on disk.
    if (changedCount > 0) {
      list.push({
        label: t("commandPalette.reviewChanges", { count: changedCount }),
        run: () => s().setReviewOpen(true),
      });
    }
    if (currentFile) {
      list.push({
        label: t("commandPalette.openInNewWindow"),
        run: () =>
          void invoke("open_in_new_window", { path: currentFile }).catch((e) =>
            s().showToast(t("commandPalette.openInNewWindowFailed", { err: String(e) }))
          ),
      });
      list.push({
        label: editMode ? t("editor.exitToView") : t("commandPalette.switchToEditMode"),
        hint: `${MOD_LABEL}E`,
        run: async () => {
          const st = s();
          if (!st.currentFile) return;
          if (!(await st.maybeSaveBeforeLeave())) return;
          st.setEditMode(!st.editMode);
        },
      });
    }
    list.push({
      label: t("commandPalette.toggleFocusMode"),
      run: () => s().setFocusMode(!s().focusMode),
    });
    list.push({
      label: t("commandPalette.zoomIn"),
      hint: `${MOD_LABEL}+`,
      run: () => s().setZoom(s().zoom + 0.1),
    });
    list.push({
      label: t("commandPalette.zoomOut"),
      hint: `${MOD_LABEL}-`,
      run: () => s().setZoom(s().zoom - 0.1),
    });
    list.push({
      label: t("commandPalette.zoomReset"),
      hint: `${MOD_LABEL}0`,
      run: () => s().setZoom(1.0),
    });
    list.push({ label: t("commandPalette.themeSystem"), run: () => setTheme("system") });
    list.push({ label: t("commandPalette.themeDark"), run: () => setTheme("dark") });
    list.push({ label: t("commandPalette.themeLight"), run: () => setTheme("light") });
    list.push({ label: t("commandPalette.openSettings"), run: () => s().setSettingsOpen(true) });
    list.push({ label: t("commandPalette.about"), run: () => s().setAboutOpen(true) });
    list.push({
      label: t("commandPalette.openLogFolder"),
      run: async () => {
        try {
          const p = await invoke<string>("get_log_path");
          await revealItemInDir(p);
        } catch (e) {
          s().showToast(t("settings.logFolderOpenFailed", { err: String(e) }));
        }
      },
    });
    return list;
  }, [t, currentFile, currentFolder, editMode, changedCount]);

  const results = useMemo(
    () => fuzzyFilter(commands, query, (c) => c.label),
    [commands, query]
  );

  // On open, reset query/selection and focus the input.
  useEffect(() => {
    if (!paletteOpen) return;
    setQuery("");
    setSelected(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [paletteOpen]);

  // If results shrink, clamp the selected index into range.
  useEffect(() => {
    setSelected((s) => (results.length === 0 ? 0 : Math.min(s, results.length - 1)));
  }, [results]);

  // Scroll the selected row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const choose = useCallback(
    (cmd: Command) => {
      // Close first, then run — safe even if the command opens another modal/palette.
      close();
      cmd.run();
    },
    [close]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => (results.length ? (s + 1) % results.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => (results.length ? (s - 1 + results.length) % results.length : 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const cmd = results[selected];
        if (cmd) choose(cmd);
      }
    },
    [results, selected, close, choose]
  );

  if (!paletteOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center no-print"
      style={{ background: "rgba(0,0,0,0.35)", paddingTop: "12vh" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="w-[600px] max-w-[92vw] max-h-[70vh] rounded-2xl overflow-hidden flex flex-col animate-fade-in"
        style={{ background: "var(--bg)", boxShadow: "var(--shadow-popover)" }}
        onKeyDown={onKeyDown}
      >
        <div
          className="flex items-center gap-2.5 px-4 h-12 shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <Search size={16} style={{ color: "var(--muted)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder={t("commandPalette.placeholder")}
            className="flex-1 bg-transparent outline-none border-none text-[15px]"
            style={{ color: "var(--text)" }}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-[13px] text-center" style={{ color: "var(--muted)" }}>
              {t("commandPalette.noResults")}
            </div>
          ) : (
            results.map((cmd, i) => (
              <button
                key={cmd.label}
                data-idx={i}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(cmd);
                }}
                onMouseMove={() => setSelected(i)}
                className="w-full flex items-center gap-2.5 px-4 py-1.5 text-left"
                style={{
                  background: i === selected ? "var(--hover, rgba(127,127,127,0.12))" : "transparent",
                }}
              >
                <span className="text-[13px] truncate" style={{ color: "var(--text)" }}>
                  {cmd.label}
                </span>
                {cmd.hint && (
                  <span
                    className="text-[12px] tabular-nums truncate ml-auto pl-3"
                    style={{ color: "var(--muted)" }}
                  >
                    {cmd.hint}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
