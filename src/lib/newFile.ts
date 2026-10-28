// New-document creation (frontend orchestration). No new Rust command: reuses
// write_file (atomic, src-tauri/src/commands/file.rs) + file_exists + list_dir,
// then openFile + setEditMode so the blank doc is ready to type into.
//
// Two entry flows (see docs plan #23):
//   - createNewFileViaDialog(): save() dialog → user picks location/name.
//   - createNewFileInFolder(dir): instant create with an auto unique name.
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store/app";
import { t } from "./i18n";
import type { DirEntry } from "../types";

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/** Append `.md` unless the name already ends with .md/.markdown (case-insensitive). */
export function withMdExtension(name: string): string {
  return /\.(md|markdown)$/i.test(name) ? name : `${name}.md`;
}

/** Parent directory of a path (separator-agnostic). "" when there is no parent. */
export function parentDir(path: string): string {
  const m = path.match(/^(.*)[\\/][^\\/]+$/);
  return m ? m[1] : "";
}

/** Join a directory and a file name, reusing the directory's separator. */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith("\\") || dir.endsWith("/") ? dir + name : dir + sep + name;
}

/**
 * First free file name of the form `base.ext`, `base 2.ext`, `base 3.ext`, …
 * `taken(name)` reports whether a name already exists. Bounded so a pathological
 * directory can't loop forever; falls back to the last attempt at the cap.
 */
export function uniqueFileName(
  base: string,
  ext: string,
  taken: (name: string) => boolean
): string {
  const first = `${base}${ext}`;
  if (!taken(first)) return first;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base} ${i}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base} 99${ext}`;
}

// ── Orchestration ───────────────────────────────────────────────────────────

/** Open `path` and drop straight into edit mode, refresh the tree, switch folder. */
async function openForEditing(path: string, switchFolderIfNeeded: boolean) {
  const s = useAppStore.getState();
  if (switchFolderIfNeeded) {
    const parent = parentDir(path);
    if (parent && parent !== s.currentFolder) s.setFolder(parent);
  }
  await s.openFile(path); // openFile resets editMode→false; re-enter below
  // Re-read the store after the async open so we call the live actions and
  // setEditMode wins over openFile's reset → the new doc opens ready to type.
  const st = useAppStore.getState();
  st.setEditMode(true);
  st.bumpTreeRefresh();
}

/**
 * Instantly create a blank .md inside `dir` with an auto unique name
 * (`base.md`, `base 2.md`, …), open it for editing, and mark it pending so an
 * untouched blank gets cleaned up on leave. No save dialog. The caller owns the
 * maybeSaveBeforeLeave guard (so it runs exactly once per user action).
 */
async function createBlankInFolder(dir: string, base: string): Promise<void> {
  const s = useAppStore.getState();
  const entries = await invoke<DirEntry[]>("list_dir", { path: dir }).catch(() => [] as DirEntry[]);
  const taken = new Set(entries.map((e) => e.name));
  const name = uniqueFileName(base, ".md", (n) => taken.has(n));
  const path = joinPath(dir, name);

  await invoke("write_file", { path, content: "" });
  await openForEditing(path, true);
  // Track the blank doc so a create that's never typed into is cleaned off disk
  // when the user moves to another file.
  s.markPendingNewFile(path);
  s.showToast(t("newFile.createdToast", { name }));
}

/**
 * New document for the menu / ⌘N / palette. Creates an UNNAMED scratch doc backed by
 * a temp file (no dialog, no file in the user's folder yet) and drops straight into
 * edit mode. It auto-saves into the temp file as you type; the file name + location
 * are only chosen later, on Save or when leaving with content (see store.commitUntitled).
 */
export async function createNewFileViaDialog(): Promise<void> {
  const s = useAppStore.getState();
  // Guard unsaved edits / pending scratch doc before we navigate away.
  // (This also covers cancelling a running AI task — handled by maybeSaveBeforeLeave.)
  if (!(await s.maybeSaveBeforeLeave())) return;
  try {
    const tempPath = await invoke<string>("create_untitled_file");
    s.enterUntitled(tempPath);
  } catch (e) {
    s.showToast(t("newFile.createFailedToast", { err: String(e) }));
  }
}

/**
 * Instantly create a new .md inside `dir` (새 문서.md, 새 문서 2.md, …) and open
 * it for editing. Used by the file tree's folder right-click.
 */
export async function createNewFileInFolder(dir: string): Promise<void> {
  const s = useAppStore.getState();
  if (!(await s.maybeSaveBeforeLeave())) return;
  try {
    await createBlankInFolder(dir, t("commandPalette.newFile"));
  } catch (e) {
    s.showToast(t("newFile.createFailedToast", { err: String(e) }));
  }
}

/**
 * Save As. Writes what the user currently sees — the live
 * edit buffer when editing, else the rendered content — to a new path picked via
 * the OS dialog, then switches the active document to it (preserving view/edit
 * mode). The original file on disk is left untouched.
 */
export async function saveCurrentFileAs(): Promise<void> {
  const s = useAppStore.getState();
  const src = s.currentFile;
  if (!src) {
    s.showToast(t("newFile.noDocumentToSave"));
    return;
  }
  // An unnamed scratch doc has no original to keep — Save As is just its first
  // commit (same name+location dialog).
  if (s.untitledPath && src === s.untitledPath) {
    await s.commitUntitled();
    return;
  }
  const content = s.editMode ? s.editContent : s.currentContent ?? "";
  const wasEditing = s.editMode;
  const dir = parentDir(src);
  const baseName = src.replace(/^.*[\\/]/, "");
  try {
    const picked = await save({
      defaultPath: dir ? joinPath(dir, baseName) : baseName,
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    if (!picked) return; // cancelled
    const path = withMdExtension(picked);

    await invoke("write_file", { path, content });

    // We've persisted the buffer to `path`, so there are no unsaved edits left to
    // lose — clear the dirty flag before switching so openFile's leave-guard does
    // NOT also rewrite the ORIGINAL file (Save As must leave it untouched).
    useAppStore.setState({ isDirty: false });

    const parent = parentDir(path);
    if (parent && parent !== s.currentFolder) s.setFolder(parent);
    await s.openFile(path);
    // openFile lands in view mode for non-empty content; restore edit mode if the
    // user was editing so Save As keeps them in the same mode on the new file.
    if (wasEditing) useAppStore.getState().setEditMode(true);
    s.bumpTreeRefresh();
    s.showToast(t("newFile.savedAsToast", { name: path.replace(/^.*[\\/]/, "") }));
  } catch (e) {
    s.showToast(t("newFile.saveAsFailedToast", { err: String(e) }));
  }
}
