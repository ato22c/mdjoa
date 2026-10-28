import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "./store/app";
import { resolveLang, setActiveLang, useT } from "./lib/i18n";
import { AppShell } from "./components/layout/AppShell";
import { isWindows, isTauri } from "./lib/platform";
import { useUpdateEvents } from "./hooks/useUpdateEvents";
import { shouldPromptDefaultApp } from "./lib/defaultApp";
import "./styles/global.css";
import "./styles/print.css";

export default function App() {
  const {
    settings,
    loadSettings,
    loadRecent,
    loadFavorites,
    openFile,
    setFolder,
    setSettings,
    saveSettings,
    updateInfo,
    updateInstalled,
    showToast,
  } = useAppStore();
  const t = useT();
  useUpdateEvents();

  useEffect(() => {
    (async () => {
      await loadSettings();
      await loadRecent();
      await loadFavorites();

      // Secondary document windows ("doc-*") are runtime-created via
      // open_in_new_window. They reuse this same frontend but must NOT run
      // session restore (get_pending_open / last_folder / lastFile) — they open
      // only the one file they were spawned for. They are not persisted to the
      // config `windows` list, so they never auto-reopen on restart by design.
      const label = getCurrentWebviewWindow().label;
      if (label !== "main") {
        const target = await invoke<string | null>("get_window_file", { label }).catch(() => null);
        if (target) {
          // Open the file; set its parent folder so the sidebar tree is usable.
          // Split on either separator (cross-platform) and avoid creating an
          // empty/root folder when the path has no parent segment.
          const parent = target.replace(/[\\/][^\\/]+$/, "");
          if (parent && parent !== target) setFolder(parent);
          await openFile(target);
        }
        return;
      }

      // Ask for consent once, only on Windows and only if we haven't asked yet.
      // Save update_check_prompted=true regardless of the answer to avoid re-prompting.
      if (isWindows && !useAppStore.getState().settings.update_check_prompted) {
        const enable = await ask(t("update.consentMessage"), {
          title: t("update.consentTitle"),
          kind: "info",
          okLabel: t("update.consentEnable"),
          cancelLabel: t("update.consentLater"),
        });
        setSettings({ update_check_prompted: true, update_check_enabled: enable });
        await saveSettings();
      }

      // Show the top notice banner if we are not the default .md app (honors the
      // 30-day snooze after dismissal and the permanent opt-out).
      // The OS lookup can be slow, so don't await it and block the startup flow.
      if (shouldPromptDefaultApp(useAppStore.getState().settings, Date.now())) {
        invoke<boolean>("is_default_markdown_app")
          .then((isDefault) => {
            if (!isDefault) useAppStore.getState().setDefaultAppBannerOpen(true);
          })
          .catch(() => {});
      }

      // Pick up any file path that was stored before the webview was ready
      // (e.g. Finder double-click when app was not yet running)
      const pending = await invoke<string | null>("get_pending_open");
      if (pending) {
        await openFile(pending);
        return;
      }

      // No file from the CLI/Finder: restore the previous session — reopen the
      // last folder (so the sidebar tree is ready) and the most recently viewed
      // file. Guard each path with file_exists so a moved/deleted target is
      // silently skipped instead of erroring.
      const { last_folder } = useAppStore.getState().settings;
      const recent = useAppStore.getState().recentFiles;
      if (last_folder && (await invoke<boolean>("file_exists", { path: last_folder }).catch(() => false))) {
        setFolder(last_folder);
      }
      const lastFile = recent[0]?.path;
      if (lastFile && (await invoke<boolean>("file_exists", { path: lastFile }).catch(() => false))) {
        await openFile(lastFile);
      }
    })();
  }, []);

  // Logging / post-deployment diagnostics (offline — writes to the local log file
  // only, no network). ErrorBoundary catches render errors; this adds the ones it
  // misses: async errors, event-handler errors, unhandled promise rejections.
  useEffect(() => {
    // Startup stamp so the log identifies the build + platform.
    getVersion()
      .then((v) =>
        invoke("write_log", {
          level: "info",
          message: t("app.startupLog", { version: v, ua: navigator.userAgent }),
        })
      )
      .catch(() =>
        invoke("write_log", {
          level: "info",
          message: t("app.startupLogFallback", { ua: navigator.userAgent }),
        }).catch(() => {})
      );

    // Dedup identical messages within 2s so an error loop can't spam the log.
    let last = "";
    let lastAt = 0;
    const logErr = (msg: string) => {
      const now = Date.now();
      if (msg === last && now - lastAt < 2000) return;
      last = msg;
      lastAt = now;
      invoke("write_log", { level: "error", message: msg }).catch(() => {});
    };
    const onError = (e: ErrorEvent) =>
      logErr(`window.error: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string } | undefined;
      logErr(`unhandledrejection: ${r?.message ?? String(e.reason)}`);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
    // Startup-only: must attach these listeners exactly once at mount. `t` is
    // intentionally excluded — a language switch shouldn't re-fire the startup
    // log or re-attach listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dim the chrome when the window loses focus (OS convention). Toggles a
  // `window-inactive` class on the root; the actual dimming is done in CSS so
  // it fades smoothly and respects the active theme.
  useEffect(() => {
    const root = document.documentElement;
    const setInactive = (inactive: boolean) =>
      root.classList.toggle("window-inactive", inactive);

    // Initialize from the current focus state on mount.
    setInactive(!document.hasFocus());

    const onFocus = () => setInactive(false);
    const onBlur = () => setInactive(true);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "dark") {
      root.classList.add("dark");
    } else if (settings.theme === "light") {
      root.classList.remove("dark");
    } else {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      root.classList.toggle("dark", mq.matches);
      const handler = (e: MediaQueryListEvent) => root.classList.toggle("dark", e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [settings.theme]);

  // Apply UI language: cache it for non-React t() and rebuild the native menu
  // so its labels follow the language (same structure as the theme pattern).
  useEffect(() => {
    const lang = resolveLang(settings.language);
    setActiveLang(lang);
    // Refresh native menu labels and window title (fails harmlessly in the web preview).
    import("./lib/menuLabels").then(({ rebuildNativeMenu, syncWindowTitle }) => {
      rebuildNativeMenu();
      syncWindowTitle();
    });
  }, [settings.language]);

  useEffect(() => {
    if (!isTauri || !isWindows || !updateInfo) return;
    showToast(t("update.availableMessage", { version: updateInfo.version }));
  }, [updateInfo, showToast, t]);

  useEffect(() => {
    if (!isTauri || !isWindows || !updateInstalled) return;
    (async () => {
      const restart = await ask(t("update.installedMessage"), {
        title: t("update.consentTitle"),
        kind: "info",
        okLabel: t("update.restartNow"),
        cancelLabel: t("update.restartLater"),
      });
      if (restart) {
        // `invoke` is already imported from "@tauri-apps/api/core" at the top of App.tsx (reuse it).
        await invoke("install_pending_update").catch(() => {});
      }
    })();
  }, [updateInstalled, t]);

  return <AppShell />;
}
