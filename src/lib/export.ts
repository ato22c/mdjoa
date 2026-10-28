// Export helpers. All exports are user-gesture driven and offline-first.
// - PDF: opens the OS print panel (print.css restyles for paper). Routed through
//   the Rust `print_document` command (webview.print()) because macOS WKWebView
//   ignores JS window.print() — nothing happens. Works on Windows WebView2 too.
// - HTML clipboard: copies the rendered body with self-contained styles so it
//   pastes into 한글/Word with formatting intact.
import { invoke } from "@tauri-apps/api/core";

/** Open the OS print panel (user picks "PDF로 저장"). Falls back to the web
 *  `window.print()` if the native command is somehow unavailable. */
export function exportPdf(): void {
  invoke("print_document").catch(() => {
    try {
      window.print();
    } catch {
      /* nothing else to try */
    }
  });
}

// Standalone styles for clipboard HTML. Uses fixed colors (not CSS vars) so
// the markup renders correctly once pasted outside the app.
const CLIPBOARD_STYLES = `
body{font-family:'Pretendard','Malgun Gothic',sans-serif;font-size:11pt;line-height:1.7;color:#1f1f1f;}
h1,h2,h3,h4,h5,h6{font-weight:700;line-height:1.3;margin:1.2em 0 .5em;}
h1{font-size:1.8em;}h2{font-size:1.5em;}h3{font-size:1.25em;}
p{margin:0 0 1em;}
a{color:#2b6cb0;}
ul,ol{padding-left:1.6em;margin:0 0 1em;}
li{margin:.25em 0;}
blockquote{border-left:3px solid #888;margin:1em 0;padding:.2em 1em;color:#444;}
code{font-family:'D2Coding','Consolas',monospace;font-size:.9em;background:#f0f0f0;border-radius:3px;padding:.1em .35em;}
pre{background:#f6f6f3;border:1px solid #ddd;border-radius:6px;padding:1em;overflow:auto;}
pre code{background:none;border:none;padding:0;}
table{border-collapse:collapse;width:100%;margin:1em 0;}
th,td{border:1px solid #ccc;padding:.4em .8em;text-align:left;}
th{background:#f0f0f0;}
img{max-width:100%;}
hr{border:none;border-top:1px solid #ccc;margin:2em 0;}
`;

/**
 * Copy the rendered markdown body to the clipboard as rich HTML (+ plain text
 * fallback), so it can be pasted into 한글, Word, etc. with formatting.
 */
export async function copyAsHtml(
  contentEl: HTMLElement,
  plainText: string
): Promise<void> {
  // Clone and strip app-only affordances (copy buttons) from the fragment.
  const clone = contentEl.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".code-copy, .code-lang").forEach((n) => n.remove());

  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CLIPBOARD_STYLES}</style></head>` +
    `<body>${clone.innerHTML}</body></html>`;

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    const item = new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plainText], { type: "text/plain" }),
    });
    await navigator.clipboard.write([item]);
  } else {
    // Fallback: plain text only.
    await navigator.clipboard.writeText(plainText);
  }
}
