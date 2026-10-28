// Cross-platform path helpers for the frontend. Paths arriving from the backend
// use the OS-native separator — `/` on macOS/Linux, `\` on Windows (e.g.
// `C:\Users\me\notes\a.md`). Splitting on a hardcoded `/` drops the filename on
// Windows, so every path-segment operation goes through these, which split on
// BOTH separators. Backend path logic stays in Rust's `std::path`.

/** Matches either path separator. */
export const SEP_RE = /[\\/]/;

/** Non-empty path segments (handles `\`, `/`, and trailing separators). */
export function pathSegments(p: string): string[] {
  return p.split(SEP_RE).filter(Boolean);
}

/** Last path segment (file or folder name). Falls back to the input when it has
 *  no separators/segments (e.g. a bare name or empty string). */
export function baseName(p: string): string {
  const segs = pathSegments(p);
  return segs.length ? segs[segs.length - 1] : p;
}

/** Segments of the parent directory (everything except the basename). */
export function parentSegments(p: string): string[] {
  return pathSegments(p).slice(0, -1);
}

/** The OS-native separator a given path uses (`\` if it has any backslash and
 *  no forward slash — i.e. a Windows path — else `/`). Mirrors the heuristic
 *  used elsewhere in the store so synthesized paths match the source path. */
export function pathSep(p: string): "\\" | "/" {
  return p.includes("\\") && !p.includes("/") ? "\\" : "/";
}

/** Parent directory of `p` (everything before the basename), keeping `p`'s
 *  separator and any POSIX leading slash. Returns "" when there is no parent. */
export function parentDir(p: string): string {
  const segs = parentSegments(p);
  if (!segs.length) return "";
  const sep = pathSep(p);
  return sep === "\\" ? segs.join("\\") : (p.startsWith("/") ? "/" : "") + segs.join("/");
}

/** Join a directory and a child name with the directory's native separator,
 *  not duplicating a trailing separator. */
export function joinPath(dir: string, name: string): string {
  const sep = pathSep(dir);
  if (!dir) return name;
  return dir.endsWith("\\") || dir.endsWith("/") ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/** True when `path` is `base` itself or a descendant of `base` (separator-aware
 *  on the boundary). Used to decide which open/favorite/recent paths a folder
 *  rename or delete touches. */
export function isPathAtOrUnder(path: string, base: string): boolean {
  if (path === base) return true;
  const next = path.charAt(base.length);
  return path.startsWith(base) && (next === "/" || next === "\\");
}

/** Rewrite `path` when its ancestor directory `oldBase` was renamed to `newBase`.
 *  Returns the path unchanged when it isn't `oldBase` or a descendant of it.
 *  Used to keep open/favorite/recent paths valid after a folder rename. Matching
 *  is separator-insensitive on the boundary (handles `\` vs `/`). */
export function remapUnderRename(path: string, oldBase: string, newBase: string): string {
  if (path === oldBase) return newBase;
  if (isPathAtOrUnder(path, oldBase)) return newBase + path.slice(oldBase.length);
  return path;
}

/**
 * Resolve a URL-style relative href against an absolute OS file path.
 * Returns the resolved absolute path, or null if href is not a relative path.
 *
 * Example (Windows):
 *   resolveRelativePath("C:\\docs\\readme.md", "../src/foo.md")
 *   → "C:\\src\\foo.md"
 */
export function resolveRelativePath(basePath: string, href: string): string | null {
  if (!href) return null;
  // Skip absolute URLs, mailto, anchors
  if (/^[a-z][a-z0-9+\-.]*:/i.test(href) || href.startsWith("#")) return null;

  const sep = basePath.includes("\\") ? "\\" : "/";
  const isPosixAbsolute = basePath.startsWith("/");
  const dirSegs = parentSegments(basePath);

  const result = [...dirSegs];
  for (const part of href.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { result.pop(); }
    else { result.push(part); }
  }

  return sep === "\\"
    ? result.join("\\")
    : (isPosixAbsolute ? "/" : "") + result.join("/");
}
