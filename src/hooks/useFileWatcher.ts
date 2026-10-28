import { useEffect, useRef } from "react";
import { watchImmediate } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { eventMentionsFile } from "../lib/fileWatch";

/**
 * Watch the open file for on-disk changes and fire `onChanged` (debounced).
 *
 * We watch the file's PARENT DIRECTORY (not the file itself) and filter events
 * by filename. On macOS, FSEvents is directory-based and a watch on a single
 * file is unreliable — and editors/agents that save atomically (write temp →
 * rename) swap the inode, which a file-level watch misses entirely. Watching
 * the directory catches both in-place writes and atomic replaces.
 */
export function useFileWatcher(path: string | null, onChanged: () => void) {
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const lastReloadRef = useRef(0);
  // Keep the latest callback without re-subscribing the watcher each render.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    if (!path) return;

    let active = true;
    const sep = path.includes("\\") ? "\\" : "/";
    const dir = path.slice(0, path.lastIndexOf(sep)) || sep;

    (async () => {
      try {
        const unlisten = await watchImmediate(
          dir,
          (event) => {
            if (!active) return;
            // Only react to events that mention our file.
            const paths = (event as { paths?: string[] }).paths ?? [];
            if (!eventMentionsFile(paths, path)) return;
            const now = Date.now();
            if (now - lastReloadRef.current < 400) return; // debounce
            lastReloadRef.current = now;
            onChangedRef.current();
          },
          { recursive: false }
        );
        if (!active) {
          unlisten(); // effect was torn down before watch resolved
          return;
        }
        unlistenRef.current = unlisten;
      } catch (e) {
        // Log instead of swallowing — a failed watch silently disables external
        // change detection (the exact bug that hid the missing `watch` feature).
        invoke("write_log", {
          level: "error",
          message: `useFileWatcher: watch failed for ${dir}: ${e}`,
        }).catch(() => {});
        // Parent directory missing (deleted while file was open) — trigger an
        // existence check so the viewer surfaces the "파일 없음" banner.
        if (active) onChangedRef.current();
      }
    })();

    return () => {
      active = false;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [path]);
}
