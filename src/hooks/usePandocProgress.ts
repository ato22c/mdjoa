import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { DownloadProgress } from "../types";

/**
 * Subscribe to the backend "pandoc-progress" event and return a 0–100
 * percentage (null until a sized download reports). Pass `active` = whether a
 * download is currently expected; when it goes false the accumulated progress
 * resets so a later download doesn't briefly flash a stale percentage.
 *
 * Shared by SettingsModal (inline bar) and ConversionIndicator (global pill).
 */
export function usePandocProgress(active: boolean): number | null {
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  useEffect(() => {
    const un = listen<DownloadProgress>("pandoc-progress", (e) => setProgress(e.payload));
    return () => {
      un.then((u) => u());
    };
  }, []);

  useEffect(() => {
    if (!active) setProgress(null);
  }, [active]);

  return progress && progress.total > 0
    ? Math.round((progress.received / progress.total) * 100)
    : null;
}
