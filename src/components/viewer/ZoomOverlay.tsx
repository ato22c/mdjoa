import { useEffect } from "react";
import { X } from "lucide-react";
import { useT } from "../../lib/i18n";

export type ZoomTarget =
  | { kind: "img"; src: string; alt: string }
  | { kind: "svg"; html: string };

/**
 * Full-window view of one image or diagram at its natural size, scrollable when
 * larger than the window. Opened by clicking either in the document body, so a
 * wide diagram that was shrunk to fit the column can still be read.
 */
export function ZoomOverlay({ target, onClose }: { target: ZoomTarget; onClose: () => void }) {
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="no-print fixed inset-0 z-50 overflow-auto"
      style={{ background: "var(--bg)", cursor: "zoom-out" }}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        title={t("common.close")}
        className="icon-btn fixed right-4 top-4 z-10"
      >
        <X size={18} />
      </button>
      {/* margin:auto centers it when smaller than the window and, unlike
          justify/align-center, keeps the top-left reachable when it overflows. */}
      <div className="flex min-h-full min-w-full p-6">
        {target.kind === "img" ? (
          <img
            src={target.src}
            alt={target.alt}
            className="m-auto"
            style={{ maxWidth: "none", flexShrink: 0, background: "#fff" }}
          />
        ) : (
          <div
            className="m-auto"
            style={{ flexShrink: 0 }}
            dangerouslySetInnerHTML={{ __html: target.html }}
          />
        )}
      </div>
    </div>
  );
}
