import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { isMarkdownPath, isTextLikePath, isPdfPath } from "../lib/fileType";

// Window-level drag & drop. A dropped `.md`/`.markdown` file opens in the
// viewer; a dropped folder is opened as the working folder (sidebar tree). When
// both are dropped, the markdown file wins. Tauri's drag-drop is a single
// window event (no per-region target), so this applies anywhere in the window —
// dropping a folder onto the explorer area opens it, as expected.
export function useDragDrop(
  onFile: (path: string) => void,
  onFolder?: (path: string) => void
) {
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
      const paths = event.payload.paths ?? [];
      // Prefer a markdown file; otherwise a viewable text/code file, then a PDF.
      const file =
        paths.find(isMarkdownPath) ?? paths.find(isTextLikePath) ?? paths.find(isPdfPath);
      if (file) {
        onFile(file);
        return;
      }
      // Otherwise open the first dropped directory as the folder.
      if (onFolder) {
        for (const p of paths) {
          const isDir = await invoke<boolean>("path_is_dir", { path: p }).catch(() => false);
          if (isDir) {
            onFolder(p);
            return;
          }
        }
      }
    }).then((u) => {
      unlisten = u;
    });

    return () => {
      unlisten?.();
    };
  }, [onFile, onFolder]);
}
