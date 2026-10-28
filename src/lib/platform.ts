// Platform flags. Detection is best-effort via the webview userAgent.
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

export const isMac = /Mac/i.test(ua);
export const isWindows = /Win/i.test(ua);

/** Modifier label for shortcut hints. */
export const MOD_LABEL = isMac ? "⌘" : "Ctrl+";

/**
 * True only inside the real Tauri webview. False in the plain-browser web
 * preview (`npm run dev`, or this design review's headless browser) — code
 * that calls Tauri-only APIs (invoke, getCurrentWebviewWindow, …) must check
 * this first, since those calls throw synchronously outside Tauri.
 */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
