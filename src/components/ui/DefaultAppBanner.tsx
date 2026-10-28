import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { useAppStore } from "../../store/app";
import { useT } from "../../lib/i18n";
import { errorMessage } from "../../lib/i18n/errorMessage";
import { isWindows } from "../../lib/platform";
import { openWindowsDefaultAppSettings } from "../../lib/defaultApp";

/**
 * Banner prompting to make this the default .md app. It doesn't disappear on its own;
 * it stays until the user dismisses it. On dismiss (✕ / settings) the time is saved and
 * the user is asked once more 30 days later.
 */
export function DefaultAppBanner() {
  const t = useT();
  const open = useAppStore((s) => s.defaultAppBannerOpen);
  if (!open) return null;

  const close = () => {
    const st = useAppStore.getState();
    st.setDefaultAppBannerOpen(false);
    st.setSettings({ default_app_prompt_at: Date.now() });
    void st.saveSettings();
  };

  // Windows can't change it silently, so only the OS picker is opened (same as SettingsModal).
  // On macOS it applies immediately.
  const onSet = async () => {
    const st = useAppStore.getState();
    try {
      if (isWindows) {
        await openWindowsDefaultAppSettings();
        st.showToast(t("settings.setDefaultAppWindowsOpened"));
      } else {
        await invoke("set_default_markdown_app");
        st.showToast(t("settings.setDefaultAppSuccess"));
      }
      close();
    } catch (e) {
      st.showToast(t("settings.setDefaultAppFailed", { err: errorMessage(String(e)) }));
    }
  };

  return (
    <div
      className="no-print relative shrink-0 flex items-center justify-center gap-3 pl-3 pr-10 h-9 text-[13px]"
      style={{ background: "var(--hover)", borderBottom: "1px solid var(--border)", color: "var(--fg)" }}
      role="status"
    >
      {/* In a narrow window, truncate only the text with … and keep the button and ✕ always visible. */}
      <span className="min-w-0 truncate" title={t("settings.defaultAppBannerMessage")}>
        {t("settings.defaultAppBannerMessage")}
      </span>
      <button
        onClick={onSet}
        className="shrink-0 whitespace-nowrap font-medium underline underline-offset-2 hover:opacity-80"
        style={{ color: "var(--accent)" }}
      >
        {t("settings.defaultAppBannerSet")}
      </button>
      <button
        onClick={() => close()}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[var(--border)]"
        style={{ color: "var(--muted)" }}
        aria-label={t("common.close")}
        title={t("common.close")}
      >
        <X size={14} />
      </button>
    </div>
  );
}
