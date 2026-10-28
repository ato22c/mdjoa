import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { X, Download, Trash2, CheckCircle2, CircleSlash, HardDrive, Loader2, FolderOpen, Link2 } from "lucide-react";
import { useAppStore } from "../../store/app";
import { usePandocProgress } from "../../hooks/usePandocProgress";
import { useT } from "../../lib/i18n";
import { isMac, isWindows } from "../../lib/platform";
import { openWindowsDefaultAppSettings } from "../../lib/defaultApp";
import { errorMessage } from "../../lib/i18n/errorMessage";
import type { PandocStatus, ClaudeStatus } from "../../types";

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen, showToast, pandocDownloading, settings, setSettings, saveSettings } =
    useAppStore();
  const t = useT();
  const [status, setStatus] = useState<PandocStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // A download may have been started here (local `downloading`) or by the
  // export flow (store `pandocDownloading`). Either way, treat the engine as
  // busy: suppress the download/delete actions and show progress, so the user
  // can't kick off a second concurrent download.
  const busy = downloading || pandocDownloading;
  const pct = usePandocProgress(busy);

  const refresh = useCallback(async () => {
    try {
      setStatus(await invoke<PandocStatus>("pandoc_status"));
    } catch {
      setStatus({ state: "none", version: null, path: null });
    }
  }, []);

  // Detection state of the claude CLI used for translation + draft of the path override.
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [claudePathDraft, setClaudePathDraft] = useState("");
  const refreshClaude = useCallback(async (overridePath: string | null) => {
    try {
      setClaudeStatus(await invoke<ClaudeStatus>("claude_status", { overridePath }));
    } catch {
      setClaudeStatus({ state: "none", version: null, path: null });
    }
  }, []);
  useEffect(() => {
    if (settingsOpen) {
      setClaudePathDraft(settings.claude_cli_path ?? "");
      void refreshClaude(settings.claude_cli_path);
    }
  }, [settingsOpen, settings.claude_cli_path, refreshClaude]);
  const commitClaudePath = useCallback(() => {
    const v = claudePathDraft.trim() || null;
    setSettings({ claude_cli_path: v });
    saveSettings();
    void refreshClaude(v);
  }, [claudePathDraft, setSettings, saveSettings, refreshClaude]);

  // Local draft of the context-document patterns, edited as one-per-line text.
  // Synced from settings whenever the modal opens; committed (parsed → array,
  // saved) on blur so we don't persist on every keystroke.
  const [patternsDraft, setPatternsDraft] = useState("");
  useEffect(() => {
    if (settingsOpen) setPatternsDraft(settings.context_patterns.join("\n"));
  }, [settingsOpen, settings.context_patterns]);

  const commitPatterns = useCallback(() => {
    const next = patternsDraft
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    // Skip the save if nothing actually changed.
    const cur = settings.context_patterns;
    if (next.length === cur.length && next.every((p, i) => p === cur[i])) return;
    setSettings({ context_patterns: next });
    saveSettings();
  }, [patternsDraft, settings.context_patterns, setSettings, saveSettings]);

  // Refresh on open, and also when a download started elsewhere (the export
  // flow, which sets the store flag) finishes — so the modal reflects the
  // newly-installed engine instead of going stale.
  useEffect(() => {
    if (settingsOpen && !pandocDownloading) refresh();
  }, [settingsOpen, pandocDownloading, refresh]);

  // Close on Escape.
  useEffect(() => {
    if (!settingsOpen) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [settingsOpen, setSettingsOpen]);

  // Move focus into the modal panel on open so keyboard interactions (Tab,
  // Escape) are scoped to the modal rather than leaving focus on whatever
  // triggered it (e.g. the hamburger menu button).
  useEffect(() => {
    if (settingsOpen) panelRef.current?.focus();
  }, [settingsOpen]);

  const onDownload = useCallback(async () => {
    setDownloading(true);
    try {
      await invoke("pandoc_download");
      showToast(t("settings.pandocInstallSuccess"));
      await refresh();
    } catch (e) {
      showToast(t("settings.installFailed", { err: errorMessage(String(e)) }));
    } finally {
      setDownloading(false);
    }
  }, [refresh, showToast, t]);

  const onDelete = useCallback(async () => {
    try {
      await invoke("pandoc_delete");
      showToast(t("settings.pandocDeleteSuccess"));
      await refresh();
    } catch (e) {
      showToast(t("settings.deleteFailed", { err: errorMessage(String(e)) }));
    }
  }, [refresh, showToast, t]);

  // Windows can't be forced silently (UserChoice is hash-protected since
  // Win10) — just deep-link into the OS picker. macOS calls straight into
  // LaunchServices and takes effect immediately, no picker needed.
  const [settingDefaultApp, setSettingDefaultApp] = useState(false);
  const onSetDefaultApp = useCallback(async () => {
    setSettingDefaultApp(true);
    try {
      if (isWindows) {
        await openWindowsDefaultAppSettings();
        showToast(t("settings.setDefaultAppWindowsOpened"));
      } else {
        await invoke("set_default_markdown_app");
        showToast(t("settings.setDefaultAppSuccess"));
      }
    } catch (e) {
      showToast(t("settings.setDefaultAppFailed", { err: errorMessage(String(e)) }));
    } finally {
      setSettingDefaultApp(false);
    }
  }, [showToast, t]);

  if (!settingsOpen) return null;

  const statusMeta = (() => {
    switch (status?.state) {
      case "system":
        return { icon: CheckCircle2, color: "var(--accent)", label: t("settings.pandocStatusSystem"), desc: status.path };
      case "bundled":
        return { icon: HardDrive, color: "var(--accent)", label: t("settings.pandocStatusBundled"), desc: status.path };
      default:
        return { icon: CircleSlash, color: "var(--muted)", label: t("settings.pandocStatusNone"), desc: t("settings.pandocDownloadNeeded") };
    }
  })();
  const StatusIcon = statusMeta.icon;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center no-print"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setSettingsOpen(false);
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-[480px] max-w-[92vw] rounded-2xl overflow-hidden animate-fade-in outline-none"
        style={{ background: "var(--bg)", boxShadow: "var(--shadow-popover)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-12 shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <span className="text-sm font-semibold">{t("settings.title")}</span>
          <button onClick={() => setSettingsOpen(false)} className="icon-btn !p-1.5" title={t("settings.closeTooltip")}>
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3 overflow-y-auto" style={{ maxHeight: "calc(100vh - 120px)" }}>

          {/* Files — compact, one row each */}
          <section>
            <div className="text-[12px] font-semibold mb-2" style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("settings.files")}</div>
            <div className="flex flex-col" style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              {[
                { key: "auto_reload" as const, label: t("settings.autoReload") },
                { key: "auto_save" as const, label: t("settings.autoSave") },
                { key: "md_only_folders" as const, label: t("settings.mdOnlyFolders") },
                { key: "show_non_md" as const, label: t("settings.showNonMd") },
              ].map(({ key, label }, i) => (
                <div
                  key={key}
                  className="flex items-center justify-between px-3.5 h-10 gap-3"
                  style={{
                    background: "var(--surface)",
                    borderTop: i > 0 ? "1px solid var(--border)" : undefined,
                  }}
                >
                  <span className="text-[13px]">{label}</span>
                  <button
                    role="switch"
                    aria-checked={settings[key]}
                    onClick={() => { setSettings({ [key]: !settings[key] }); saveSettings(); }}
                    className="relative w-9 h-5 rounded-full shrink-0 transition-colors"
                    style={{ background: settings[key] ? "var(--accent)" : "var(--border)" }}
                  >
                    <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: settings[key] ? "18px" : "2px" }} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Language */}
          <section>
            <div className="text-[12px] font-semibold mb-2" style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("settings.language")}</div>
            <div
              className="flex items-center justify-between px-3.5 h-10"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}
            >
              <span className="text-[13px]">{t("settings.languageLabel")}</span>
              <div className="flex gap-1">
                {([
                  ["system", t("common.system")],
                  ["ko", t("settings.languageKo")],
                  ["en", t("settings.languageEn")],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => { setSettings({ language: value }); saveSettings(); }}
                    className="px-3 h-7 rounded-lg text-[12px] font-medium transition-colors"
                    style={{
                      background: settings.language === value ? "var(--accent)" : "var(--hover)",
                      color: settings.language === value ? "#fff" : "var(--fg)",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Body font — single row */}
          <section>
            <div className="text-[12px] font-semibold mb-2" style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("settings.font")}</div>
            <div
              className="flex items-center justify-between px-3.5 h-10"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}
            >
              <span className="text-[13px]">{t("settings.fontLabel")}</span>
              <div className="flex gap-1">
                {(["pretendard", "system"] as const).map((font) => (
                  <button
                    key={font}
                    onClick={() => { setSettings({ content_font: font }); saveSettings(); }}
                    className="px-3 h-7 rounded-lg text-[12px] font-medium transition-colors"
                    style={{
                      background: settings.content_font === font ? "var(--accent)" : "var(--hover)",
                      color: settings.content_font === font ? "#fff" : "var(--fg)",
                    }}
                  >
                    {font === "pretendard" ? "Pretendard" : t("common.system")}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Context document patterns */}
          <section>
            <div className="text-[12px] font-semibold mb-2" style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("settings.contextPatterns")}</div>
            <p className="text-[11px] mb-2" style={{ color: "var(--muted)" }}>
              {t("settings.contextPatternsDesc")} <code>*</code> {t("settings.wildcardSupported")}
            </p>
            <textarea
              value={patternsDraft}
              onChange={(e) => setPatternsDraft(e.target.value)}
              onBlur={commitPatterns}
              spellCheck={false}
              rows={5}
              className="w-full rounded-xl px-3 py-2 text-[12px] font-mono resize-y outline-none"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--fg)", lineHeight: 1.6 }}
              placeholder="CLAUDE.md&#10;AGENTS.md&#10;*.spec.md&#10;plan*.md"
            />
          </section>

          {/* Translation (Claude CLI) */}
          <section>
            <div className="text-[12px] font-semibold mb-2" style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("settings.translation")}</div>
            <p className="text-[11px] mb-2" style={{ color: "var(--muted)" }}>
              {t("settings.translationDescPre")} <code>claude</code> {t("settings.translationDescPost")}
            </p>
            <div
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl mb-2"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              {claudeStatus && claudeStatus.state !== "none" ? (
                <>
                  <CheckCircle2 size={16} style={{ color: "#2ea043" }} className="shrink-0" />
                  <span className="text-[12px] min-w-0 truncate">
                    {t("settings.claudeDetected")}{claudeStatus.version ? ` · ${claudeStatus.version}` : ""}
                    <span style={{ color: "var(--muted)" }}> · {claudeStatus.path}</span>
                  </span>
                </>
              ) : (
                <>
                  <CircleSlash size={16} style={{ color: "var(--muted)" }} className="shrink-0" />
                  <span className="text-[12px]" style={{ color: "var(--muted)" }}>
                    {t("settings.claudeNotFound")}
                  </span>
                </>
              )}
            </div>
            <input
              type="text"
              value={claudePathDraft}
              onChange={(e) => setClaudePathDraft(e.target.value)}
              onBlur={commitClaudePath}
              spellCheck={false}
              placeholder={t("settings.claudePathPlaceholder")}
              className="w-full rounded-xl px-3 py-2 text-[12px] font-mono outline-none"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--fg)" }}
            />
          </section>

          {/* Conversion engine (pandoc) */}
          <section>
            <div className="text-[12px] font-semibold mb-2" style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("settings.conversionEngine")}</div>
            <div
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <StatusIcon size={18} style={{ color: statusMeta.color }} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium flex items-center gap-2">
                  {statusMeta.label}
                  {status?.version && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--hover)", color: "var(--muted)" }}>
                      v{status.version}
                    </span>
                  )}
                </div>
                {statusMeta.desc && (
                  <div className="text-[11px] truncate" style={{ color: "var(--muted)" }}>{statusMeta.desc}</div>
                )}
              </div>
              {status?.state === "none" && !busy && (
                <button
                  onClick={onDownload}
                  className="flex items-center gap-1.5 px-3 h-7 rounded-lg text-[12px] font-medium shrink-0 transition-colors"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  <Download size={13} />
                  {t("settings.download")}
                </button>
              )}
              {status?.state === "bundled" && !busy && (
                <button onClick={onDelete} className="icon-btn shrink-0" title={t("settings.deleteEngineTooltip")}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            {busy && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-[11px] mb-1" style={{ color: "var(--muted)" }}>
                  <span className="flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" />{t("settings.downloading")}</span>
                  <span className="tabular-nums">{pct !== null ? `${pct}%` : ""}</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--hover)" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct ?? 8}%`, background: "var(--accent)" }} />
                </div>
              </div>
            )}
          </section>

          {/* Default program setting */}
          <section>
            <div className="text-[12px] font-semibold mb-2" style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("settings.defaultApp")}</div>
            <div
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <Link2 size={18} style={{ color: "var(--muted)" }} className="shrink-0" />
              <div className="min-w-0 flex-1 text-[13px]">{t("settings.defaultAppDesc")}</div>
              <button
                onClick={onSetDefaultApp}
                disabled={settingDefaultApp}
                className="flex items-center gap-1.5 px-3 h-7 rounded-lg text-[12px] font-medium shrink-0 transition-colors"
                style={{ background: "var(--accent)", color: "#fff", opacity: settingDefaultApp ? 0.7 : 1 }}
              >
                {settingDefaultApp && <Loader2 size={13} className="animate-spin" />}
                {isMac ? t("settings.setDefaultAppMac") : t("settings.setDefaultAppWindows")}
              </button>
            </div>
          </section>

          {/* Diagnostic log */}
          <section style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
            <button
              onClick={async () => {
                try {
                  const p = await invoke<string>("get_log_path");
                  await revealItemInDir(p);
                } catch (e) {
                  showToast(t("settings.logFolderOpenFailed", { err: String(e) }));
                }
              }}
              className="row-hover flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] w-full"
              style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
            >
              <FolderOpen size={13} style={{ color: "var(--muted)" }} />
              {t("settings.openLogFolder")}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
