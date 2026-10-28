import { useState, useEffect, useRef } from "react";
import { X, FileText, BookOpen } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store/app";
import { useT } from "../../lib/i18n";
import { openManual } from "../../lib/manual";
import { isWindows } from "../../lib/platform";
import { LicensesModal } from "./LicensesModal";

const CONTACT_EMAIL = "sy.baek@fusionsoft.co.kr";

export function AboutModal() {
  const { aboutOpen, setAboutOpen, showToast, settings, setSettings, saveSettings } = useAppStore();
  const t = useT();
  const [licensesOpen, setLicensesOpen] = useState(false);
  // Show the build version read directly from tauri.conf.json — not hardcoded, so it
  // follows version bumps automatically (single source). On failure, an empty string
  // (only the version label is omitted).
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Open the bundled user manual (which now holds the full shortcut list, etc.)
  // — same flow as the native 도움말 menu. Close the modal proactively (same
  // pattern as the hamburger menu's handler) rather than waiting on the async
  // open to settle.
  const handleOpenManual = () => {
    setAboutOpen(false);
    void openManual();
  };

  const handleCheckNow = async () => {
    setChecking(true);
    try {
      const result = await invoke<{ version: string; notes: string } | null>("check_for_updates_now");
      showToast(result ? t("update.availableMessage", { version: result.version }) : t("update.upToDateMessage"));
    } catch {
      showToast(t("update.checkFailedMessage"));
    } finally {
      setChecking(false);
    }
  };

  const handleToggleAutoCheck = async (v: boolean) => {
    setSettings({ update_check_enabled: v });
    await saveSettings();
  };

  // Close on Escape.
  useEffect(() => {
    if (!aboutOpen) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAboutOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [aboutOpen, setAboutOpen]);

  // Move focus into the modal panel on open so keyboard interactions (Tab,
  // Escape) are scoped to the modal rather than leaving focus on whatever
  // triggered it (e.g. the hamburger menu button).
  useEffect(() => {
    if (aboutOpen) panelRef.current?.focus();
    // Reset the nested Licenses modal when About closes, so reopening About
    // always shows the About view (not a leftover-open Licenses modal).
    else setLicensesOpen(false);
  }, [aboutOpen]);

  // Load the app version once when the modal opens.
  useEffect(() => {
    if (!aboutOpen) return;
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, [aboutOpen]);

  if (!aboutOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center no-print"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setAboutOpen(false);
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
          <span className="text-sm font-semibold">{t("hamburgerMenu.about")}</span>
          <button onClick={() => setAboutOpen(false)} className="icon-btn !p-1.5" title={t("settings.closeTooltip")}>
            <X size={16} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {/* About — product identity. The header already says "정보", so no
              duplicate section title here. */}
          <section className="flex flex-col items-center text-center gap-1">
            <div className="text-3xl font-bold tracking-tight">
              MD<span style={{ color: "var(--accent)" }}>{t("common.brandSuffix")}</span>
            </div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              {t("welcome.tagline")}{version ? ` · v${version}` : ""}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>
              Copyright © 2026{" "}
              <button
                onClick={() => openUrl(`mailto:${CONTACT_EMAIL}`).catch(() => showToast(t("aboutModal.mailAppOpenFailed")))}
                className="underline underline-offset-2 hover:opacity-80"
                style={{ color: "var(--accent)" }}
                title={t("aboutModal.sendEmailTooltip")}
              >
                {CONTACT_EMAIL}
              </button>
              . All rights reserved.
            </div>
            {/* A small note to the developers who live in their docs all day. */}
            <div
              className="mt-3 w-full px-3.5 py-2.5 rounded-xl text-[12px] leading-relaxed"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--fg)" }}
            >
              {t("aboutModal.focusNote")}
            </div>
          </section>

          {/* Help & Licenses — side by side, both centered (matches the product
              section above for visual unity). */}
          <section
            className="grid grid-cols-2 gap-4 text-center"
            style={{ borderTop: "1px solid var(--border)", paddingTop: "1.25rem" }}
          >
            <div className="flex flex-col items-center">
              <div className="text-[13px] font-semibold mb-1">{t("menu.helpMenu")}</div>
              <button
                onClick={handleOpenManual}
                className="row-hover inline-flex items-center gap-1.5 px-2 h-7 rounded-md text-[12px]"
                style={{ color: "var(--muted)" }}
              >
                <BookOpen size={13} />
                {t("aboutModal.viewManual")}
              </button>
            </div>
            <div className="flex flex-col items-center">
              <div className="text-[13px] font-semibold mb-1">{t("aboutModal.licensesTitle")}</div>
              <button
                onClick={() => setLicensesOpen(true)}
                className="row-hover inline-flex items-center gap-1.5 px-2 h-7 rounded-md text-[12px]"
                style={{ color: "var(--muted)" }}
              >
                <FileText size={13} />
                {t("aboutModal.openSourceLicenses")}
              </button>
            </div>
          </section>

          {isWindows && (
            <section
              className="flex flex-col gap-2"
              style={{ borderTop: "1px solid var(--border)", paddingTop: "1.25rem" }}
            >
              <label className="flex items-center justify-between text-[13px]">
                <span>{t("update.toggleLabel")}</span>
                <input
                  type="checkbox"
                  checked={settings.update_check_enabled}
                  onChange={(e) => handleToggleAutoCheck(e.target.checked)}
                />
              </label>
              <button
                onClick={handleCheckNow}
                disabled={checking}
                className="row-hover inline-flex items-center justify-center gap-1.5 h-7 rounded-md text-[12px]"
                style={{ color: "var(--muted)" }}
              >
                {checking ? t("update.checkingLabel") : t("update.checkNowLabel")}
              </button>
            </section>
          )}
        </div>
      </div>

      <LicensesModal open={licensesOpen} onClose={() => setLicensesOpen(false)} />
    </div>
  );
}
