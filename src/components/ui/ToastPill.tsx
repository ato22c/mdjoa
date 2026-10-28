import type { ReactNode } from "react";

/**
 * Shared bottom-toast pill chrome. Used by both Toast (messages) and
 * ConversionIndicator (download/convert progress). Positioning and stacking are
 * owned by the ToastRegion container in AppShell; this is just the bubble.
 */
export function ToastPill({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 max-w-sm px-4 py-2.5 rounded-lg text-[13px]
        bg-[#1f1f1f] text-white dark:bg-[#e8e8e6] dark:text-[#1f1f1f]
        shadow-[0_4px_14px_rgba(0,0,0,0.25)] animate-toast-in"
    >
      {children}
    </div>
  );
}
