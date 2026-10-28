import { useEffect, useRef } from "react";
import { watchImmediate, type UnwatchFn } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/app";
import { isWatchablePrimaryPath, isClaudeAssetPath, IGNORED_PATH_RE } from "../lib/mdPath";
import { isPathAtOrUnder } from "../lib/pathUtil";
import { classifyFsEvent, folderWatchPlan } from "../lib/fsEventKind";

const DEBOUNCE_MS = 300;

/**
 * Watches the open folder (recursively) so the tree stays in sync with disk:
 *  - created `.md` → re-list (file appears) + "created" badge (green)
 *  - modified `.md` → "modified" badge (amber)
 *  - deleted `.md` → re-list (file disappears) + clear its badge
 *
 * macOS FSEvents sometimes reports only an ambiguous "any" kind; for those we
 * fall back to a file_exists check (exists → modified, gone → deleted). Debounced
 * per-path so a burst of writes coalesces.
 */
export function useFolderWatch(folder: string | null) {
  const unwatchRef = useRef<UnwatchFn | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!folder) return;

    let active = true;
    const timers = timersRef.current;

    // Coalesce re-lists: a burst of file events (e.g. an agent rewriting 100
    // files) must trigger ONE tree re-list, not 100. Each event that needs a
    // re-list just (re)arms this trailing timer.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (active) useAppStore.getState().bumpTreeRefresh();
      }, DEBOUNCE_MS);
    };

    // `.claude/{skills,agents,commands}` changes → re-scan the 스킬 section.
    // Separate from the tree-badge path: these live under a dot-dir which
    // isWatchableMarkdownPath ignores, so they never badge the tree.
    let claudeRescanTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleClaudeRescan = () => {
      if (claudeRescanTimer) clearTimeout(claudeRescanTimer);
      claudeRescanTimer = setTimeout(() => {
        claudeRescanTimer = null;
        if (active) useAppStore.getState().scanClaudeAssets();
      }, DEBOUNCE_MS);
    };

    const apply = async (path: string, kind: ReturnType<typeof classifyFsEvent>) => {
      if (!active) return;
      const s = useAppStore.getState();
      if (kind === null) {
        // Ambiguous (macOS FSEvents often reports only "any"): we can't tell
        // create from modify, so resolve by existence and ALWAYS re-list — a new
        // file still appears; a modify just gets an amber badge + harmless re-list.
        const exists = await invoke<boolean>("file_exists", { path }).catch(() => true);
        if (!active) return;
        if (exists) s.markChanged(path, "modified");
        else s.clearChanged(path);
        scheduleRefresh();
        return;
      }
      const plan = folderWatchPlan(kind);
      if (plan.clearBadge) s.clearChanged(path);
      if (plan.mark) s.markChanged(path, plan.mark);
      if (plan.reList) scheduleRefresh();
    };

    // Handle directory events (create/delete/rename of folders). Badges the folder
    // in the tree and triggers a re-list so the tree stays in sync.
    const applyDir = async (path: string, kind: ReturnType<typeof classifyFsEvent>) => {
      if (!active) return;
      const s = useAppStore.getState();
      const isDir = await invoke<boolean>("path_is_dir", { path }).catch(() => false);
      if (!active) return;
      if (!isDir) {
        // Path is gone (deleted dir or non-primary file). If the open file lived
        // inside this deleted directory, surface the "파일 없음" banner immediately.
        const cur = useAppStore.getState().currentFile;
        if (cur && isPathAtOrUnder(cur, path)) {
          useAppStore.getState().setFileMissing(true);
        }
        s.clearChanged(path);
        scheduleRefresh();
        return;
      }
      // Existing directory: badge on create (green) or ambiguous (amber), then refresh.
      if (kind === "created" || kind === null) {
        s.markChanged(path, kind === "created" ? "created" : "modified");
        scheduleRefresh();
      }
      // kind === "modified": file inside dir changed, already handled by the file's own event.
    };

    (async () => {
      try {
        const unwatch = await watchImmediate(
          folder,
          (event) => {
            if (!active) return;
            const kind = classifyFsEvent((event as { type?: unknown }).type);
            for (const path of event.paths) {
              if (isClaudeAssetPath(path)) { scheduleClaudeRescan(); continue; }
              const handler = isWatchablePrimaryPath(path)
                ? apply
                : IGNORED_PATH_RE.test(path) ? null : applyDir;
              if (!handler) continue;
              const existing = timers.get(path);
              if (existing) clearTimeout(existing);
              timers.set(
                path,
                setTimeout(() => {
                  timers.delete(path);
                  void handler(path, kind);
                }, DEBOUNCE_MS)
              );
            }
          },
          { recursive: true }
        );
        if (active) {
          unwatchRef.current = unwatch;
        } else {
          unwatch(); // folder changed/unmounted before the watcher resolved
        }
      } catch (e) {
        // Log instead of swallowing — a silently failed watch is how the missing
        // `watch` Cargo feature went unnoticed (tree badges just never appeared).
        invoke("write_log", {
          level: "error",
          message: `useFolderWatch: watch failed for ${folder}: ${e}`,
        }).catch(() => {});
      }
    })();

    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (claudeRescanTimer) clearTimeout(claudeRescanTimer);
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      unwatchRef.current?.();
      unwatchRef.current = null;
    };
  }, [folder]);
}
