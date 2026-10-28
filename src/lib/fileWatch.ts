// Pure helper for the open-file watcher (useFileWatcher). Extracted so the
// "does this fs event concern my file?" decision can be unit-tested without a
// running watcher. The watcher observes the file's PARENT directory, so events
// carry sibling paths too — we match the exact path or the basename.
export function eventMentionsFile(paths: string[], filePath: string): boolean {
  if (!filePath) return false;
  const sep = filePath.includes("\\") ? "\\" : "/";
  const fileName = filePath.slice(filePath.lastIndexOf(sep) + 1);
  return paths.some((p) => p === filePath || p.endsWith(sep + fileName));
}
