// Classify a tauri-plugin-fs watch event into a coarse change kind for the tree
// badges. The plugin forwards notify's event, whose `type` is either a string
// ("any" | "other" | "access") or an object keyed by the kind
// ({ create | modify | remove | access: ... }). macOS FSEvents sometimes reports
// only "any" — callers fall back to a file_exists check for those.
export type FsChangeKind = "created" | "modified" | "deleted" | null;

export function classifyFsEvent(type: unknown): FsChangeKind {
  if (type && typeof type === "object") {
    const t = type as Record<string, unknown>;
    if ("remove" in t) return "deleted";
    if ("create" in t) return "created";
    if ("modify" in t) return "modified";
  }
  return null; // "any" / "access" / "other" / unknown → caller decides via existence
}

/** What the tree should do for a (resolved, non-ambiguous) folder change kind.
 *  `reList` re-lists the folder so created files appear / deleted files vanish.
 *  A plain modify needs no re-list (the file is already in the tree). */
export interface FolderWatchPlan {
  mark: "created" | "modified" | null; // badge to set (null = none)
  clearBadge: boolean; //                clear any existing badge for this path
  reList: boolean; //                    re-list the tree (structural change)
}

export function folderWatchPlan(kind: "created" | "modified" | "deleted"): FolderWatchPlan {
  switch (kind) {
    case "created":
      return { mark: "created", clearBadge: false, reList: true };
    case "deleted":
      return { mark: null, clearBadge: true, reList: true };
    case "modified":
      return { mark: "modified", clearBadge: false, reList: false };
  }
}
