// Pure helpers for opening a remote MD document from Quick Open (URL entry).
// Kept dependency-free so the detection/normalization logic is unit-tested in
// isolation (the fetch itself lives in Rust: commands/remote.rs).

/** Whether the Quick Open query is a remote URL (http/https, no spaces). */
export function isRemoteUrl(query: string): boolean {
  const q = query.trim();
  return /^https?:\/\/\S+$/i.test(q);
}

/**
 * Normalize a URL for fetching. Currently one convenience rewrite: a GitHub
 * web UI "blob" URL (github.com/<owner>/<repo>/blob/<ref>/<path>) serves HTML,
 * so it is rewritten to the raw content host. Everything else passes through.
 */
export function normalizeRemoteUrl(url: string): string {
  const u = url.trim();
  const m = u.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  return u;
}

/**
 * Human-readable name for the URL row: the last path segment (percent-decoded),
 * falling back to the host when the path has none (e.g. "https://example.com/").
 */
export function remoteDisplayName(url: string): string {
  const noQuery = url.split(/[?#]/)[0];
  const last = noQuery.replace(/\/+$/, "").split("/").pop() ?? "";
  // A bare origin's "last segment" is the host:port chunk — treat as no name.
  if (last && !/^https?:$/i.test(last) && !last.includes(":")) {
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }
  const host = url.match(/^https?:\/\/([^/]+)/i)?.[1];
  return host ?? url;
}
