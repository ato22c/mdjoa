import { useCallback } from "react";
import { FolderOpen, Folder, FileText, Clock } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../../store/app";
import { MOD_LABEL } from "../../lib/platform";
import { buildOpenDialogFilters } from "../../lib/fileType";
import { useT } from "../../lib/i18n";

const MOD = MOD_LABEL;

export function WelcomeScreen() {
  const { recentFiles, openFile, setFolder, showToast, openRecent } = useAppStore();
  const t = useT();

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: buildOpenDialogFilters(),
      });
      if (typeof selected === "string") await openFile(selected);
    } catch (e) {
      showToast(t("toast.openFailed", { err: String(e) }));
    }
  }, [openFile, showToast, t]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") setFolder(selected);
    } catch (e) {
      showToast(t("toast.folderOpenFailed", { err: String(e) }));
    }
  }, [setFolder, showToast, t]);

  return (
    <div className="flex flex-col items-center justify-center h-full w-full gap-9 select-none px-8">
      <div className="text-center">
        <h1
          className="text-4xl font-bold tracking-tight mb-2.5"
          style={{ color: "var(--fg)" }}
        >
          MD<span style={{ color: "var(--accent)" }}>{t("common.brandSuffix")}</span>
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {t("welcome.tagline")}
        </p>
      </div>

      <div className="flex gap-2.5">
        <button
          onClick={handleOpenFile}
          className="flex items-center gap-2.5 px-6 py-3 rounded-lg text-sm font-medium transition-all active:scale-[0.98]"
          style={{
            // --accent-strong (not muted when window inactive) so the white
            // label stays readable regardless of focus.
            background: "var(--accent-strong)",
            color: "#fff",
            boxShadow: "0 1px 2px rgba(31,31,31,0.12)",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--accent-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "var(--accent-strong)")
          }
        >
          <FileText size={16} />
          {t("welcome.openFile")}
        </button>
        <button
          onClick={handleOpenFolder}
          className="row-hover flex items-center gap-2.5 px-6 py-3 rounded-lg text-sm font-medium transition-all active:scale-[0.98]"
          style={{
            color: "var(--fg)",
            border: "1px solid var(--border)",
          }}
        >
          <FolderOpen size={16} style={{ color: "var(--muted)" }} />
          {t("welcome.openFolder")}
        </button>
      </div>

      {recentFiles.length > 0 && (
        <div className="w-full max-w-md">
          <div
            className="flex items-center gap-1.5 text-[11px] font-medium mb-1.5 px-2"
            style={{ color: "var(--muted)" }}
          >
            <Clock size={11} />
            {t("welcome.recent")}
          </div>
          <div>
            {recentFiles.slice(0, 8).map((f) => (
              <button
                key={f.path}
                onClick={() => void openRecent(f.path, f.is_dir)}
                className="row-hover w-full flex items-center gap-2.5 px-2 h-9 rounded-md text-left text-[13px]"
              >
                {f.is_dir ? (
                  <Folder size={14} className="shrink-0" style={{ color: "var(--muted)" }} />
                ) : (
                  <FileText size={14} className="shrink-0" style={{ color: "var(--muted)" }} />
                )}
                <span className="font-medium truncate shrink-0 max-w-[55%]">{f.name}</span>
                <span className="text-xs truncate flex-1" style={{ color: "var(--muted)" }}>
                  {f.path}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 text-xs" style={{ color: "var(--muted)" }}>
        <span className="flex items-center gap-1.5">
          <kbd className="kbd-hint">{MOD}B</kbd> {t("welcome.hintSidebar")}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="kbd-hint">{MOD}F</kbd> {t("welcome.hintSearch")}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="kbd-hint">{MOD}P</kbd> {t("welcome.hintPrint")}
        </span>
        <span>{t("welcome.dropHint")}</span>
      </div>
    </div>
  );
}
