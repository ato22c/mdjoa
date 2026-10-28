// A viewer that lets the webview render local files directly — PDF, HTML, etc.
// PDF: convertFileSrc -> asset:// -> the webview's native PDF renderer.
// HTML: read_file (chardetng auto-detects encoding, converts to UTF-8) -> Blob URL.
//   asset:// doesn't add a charset to Content-Type, so non-UTF-8 files such as EUC-KR
//   get garbled. The Blob URL approach sets charset=utf-8 explicitly and, via <base href>,
//   also loads relative resources (images, CSS) from their original location.
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useAppStore } from "../../store/app";
import { isHtmlPath } from "../../lib/fileType";
import { useT } from "../../lib/i18n";

export function FrameViewer() {
  const currentFile = useAppStore((s) => s.currentFile);
  const t = useT();
  const [htmlSrc, setHtmlSrc] = useState<string | null>(null);
  // Track the Blob URL in a ref so memory is released when the component switches.
  const blobUrlRef = useRef<string | null>(null);

  // Release the last Blob URL on unmount.
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!currentFile || !isHtmlPath(currentFile)) {
      setHtmlSrc(null);
      return;
    }

    let alive = true;

    invoke<{ content: string }>("read_file", { path: currentFile })
      .then(({ content }) => {
        if (!alive) return;

        // Extract only the directory part of the asset:// URL and use it as <base href>.
        // That way relative resources in the HTML (images, CSS, etc.) load from their
        // original location through the Tauri asset protocol.
        const fileAssetUrl = convertFileSrc(currentFile);
        const baseUrl = fileAssetUrl.substring(0, fileAssetUrl.lastIndexOf("/") + 1);

        // Remove existing charset/base declarations, then re-declare as UTF-8.
        let html = content
          .replace(/<meta[^>]+charset[^>]*>/gi, "")
          .replace(/<base\b[^>]*>/gi, "");

        const inject = `<meta charset="utf-8"><base href="${baseUrl}">`;
        if (/<head\b[^>]*>/i.test(html)) {
          html = html.replace(/<head\b[^>]*>/i, (m) => m + inject);
        } else {
          html = inject + html;
        }

        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const newUrl = URL.createObjectURL(blob);

        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = newUrl;
        setHtmlSrc(newUrl);
      })
      .catch(() => {
        // If read_file fails, fall back to serving asset:// directly (encoding may be garbled).
        if (alive) setHtmlSrc(convertFileSrc(currentFile));
      });

    return () => {
      alive = false;
    };
  }, [currentFile]);

  if (!currentFile) return null;

  const isHtml = isHtmlPath(currentFile);
  const src = isHtml ? htmlSrc : convertFileSrc(currentFile);
  if (!src) return null; // HTML is loading

  return (
    <iframe
      key={src}
      src={src}
      title={t("frameViewer.previewTitle")}
      // Sandbox HTML only: allow-same-origin lets relative CSS/images load while
      //   script execution stays blocked (allow-scripts would bypass the whole sandbox -> never).
      // PDF gets no sandbox — macOS WKWebView can't show its native PDF viewer inside a
      //   sandboxed iframe and renders a blank screen (BL-003). A PDF is static data, not
      //   executable code, so there is no script risk even without a sandbox.
      {...(isHtml ? { sandbox: "allow-same-origin" } : {})}
      className="flex-1 w-full h-full border-0"
      style={{ background: "var(--bg)" }}
    />
  );
}
