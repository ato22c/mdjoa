import { describe, it, expect } from "vitest";
import { isRemoteUrl, normalizeRemoteUrl, remoteDisplayName } from "./remoteUrl";

describe("isRemoteUrl", () => {
  it("accepts http/https URLs (case-insensitive scheme)", () => {
    expect(isRemoteUrl("https://example.com/doc.md")).toBe(true);
    expect(isRemoteUrl("http://example.com/doc.md")).toBe(true);
    expect(isRemoteUrl("HTTPS://example.com/doc.md")).toBe(true);
    expect(isRemoteUrl("  https://example.com/doc.md  ")).toBe(true);
  });

  it("rejects non-URL queries", () => {
    expect(isRemoteUrl("readme")).toBe(false);
    expect(isRemoteUrl("file:///a.md")).toBe(false);
    expect(isRemoteUrl("ftp://example.com/a.md")).toBe(false);
    expect(isRemoteUrl("https://")).toBe(false);
    expect(isRemoteUrl("https:// example.com")).toBe(false);
    expect(isRemoteUrl("")).toBe(false);
  });
});

describe("normalizeRemoteUrl", () => {
  it("rewrites GitHub blob URLs to raw.githubusercontent.com", () => {
    expect(
      normalizeRemoteUrl("https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md")
    ).toBe("https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md");
    expect(normalizeRemoteUrl("https://www.github.com/o/r/blob/dev/docs/a.md")).toBe(
      "https://raw.githubusercontent.com/o/r/dev/docs/a.md"
    );
  });

  it("passes through non-blob URLs unchanged", () => {
    const raw = "https://raw.githubusercontent.com/o/r/main/a.md";
    expect(normalizeRemoteUrl(raw)).toBe(raw);
    const plain = "https://example.com/notes/today.md";
    expect(normalizeRemoteUrl(plain)).toBe(plain);
    // Not a blob path (e.g. releases page) stays as-is.
    const rel = "https://github.com/o/r/releases";
    expect(normalizeRemoteUrl(rel)).toBe(rel);
  });
});

describe("remoteDisplayName", () => {
  it("uses the last path segment, percent-decoded", () => {
    expect(remoteDisplayName("https://example.com/docs/guide.md")).toBe("guide.md");
    expect(remoteDisplayName("https://example.com/docs/%ED%95%9C%EA%B8%80.md")).toBe("한글.md");
    expect(remoteDisplayName("https://example.com/docs/guide.md?x=1#top")).toBe("guide.md");
    expect(remoteDisplayName("https://example.com/docs/")).toBe("docs");
  });

  it("falls back to the host for a bare origin", () => {
    expect(remoteDisplayName("https://example.com/")).toBe("example.com");
    expect(remoteDisplayName("https://example.com")).toBe("example.com");
  });
});
