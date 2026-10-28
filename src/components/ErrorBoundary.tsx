import { Component, type ErrorInfo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
// Class component → render() can't call hooks, so this uses the non-hook t()
// (same one store actions/lib code use) instead of useT(). Language changes
// while this fallback is on screen won't re-render it live, which is fine —
// getting here is rare and a reload (the very action offered here) picks up
// the current language anyway.
import { t } from "../lib/i18n";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Top-level crash guard. A render error anywhere in the tree would otherwise
 * blank the whole webview (white screen). Instead we catch it, log it to the
 * app log file, and show a recoverable fallback — the document on disk is never
 * touched, so reloading is safe. (CLAUDE.md: on exceptions the app must not die; log them.)
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    invoke("write_log", {
      level: "error",
      message: `UI crash: ${error.message}\n${error.stack ?? ""}\n${info.componentStack ?? ""}`,
    }).catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 32,
          textAlign: "center",
          background: "var(--bg, #fafaf8)",
          color: "var(--fg, #1f1f1f)",
          fontFamily: "Pretendard, system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700 }}>{t("errorBoundary.title")}</div>
        <div style={{ fontSize: 13, color: "var(--muted, #747370)", maxWidth: 420, lineHeight: 1.6 }}>
          {t("errorBoundary.message")}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: "var(--accent-strong, #3d66e0)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "8px 18px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {t("markdownViewer.reload")}
        </button>
      </div>
    );
  }
}
