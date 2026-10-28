import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../store/app";
import { isWindows, isTauri } from "../lib/platform";

interface UpdateInfoPayload {
  version: string;
  notes: string;
}

/**
 * Subscribes to the "update-available"/"update-installed" events emitted by
 * Rust updater.rs and reflects them in the store. Subscribes only on Windows
 * with a real Tauri runtime (web preview and macOS never get the events, so
 * this is a silent no-op there).
 */
export function useUpdateEvents(): void {
  const setUpdateInfo = useAppStore((s) => s.setUpdateInfo);
  const setUpdateInstalled = useAppStore((s) => s.setUpdateInstalled);

  useEffect(() => {
    if (!isTauri || !isWindows) return;
    const unAvailable = listen<UpdateInfoPayload>("update-available", (e) => {
      setUpdateInfo(e.payload);
    });
    const unInstalled = listen("update-installed", () => {
      setUpdateInstalled(true);
    });
    return () => {
      unAvailable.then((u) => u());
      unInstalled.then((u) => u());
    };
  }, [setUpdateInfo, setUpdateInstalled]);
}
