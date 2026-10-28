// Pure helpers for Quick Open (⌘/Ctrl+O) rows. Kept dependency-free so the
// display + search logic is unit-tested in isolation (QuickOpen.tsx itself is
// DOM/Tauri glue and not unit-tested).
//
// Motivation: agentic projects hold many files whose *filename* is identical —
// every skill is `.claude/skills/<name>/SKILL.md`. Matching and listing by
// filename alone makes them indistinguishable. So for these "folder-identity"
// files we surface the folder name and let the query match the folder too.

/** A row in the Quick Open list — a markdown file or a folder. */
export interface FileItem {
  /** Raw filename ("SKILL.md") or folder name ("docs"). */
  name: string;
  /** Absolute path to open (file → viewer, folder → open as folder). */
  path: string;
  /** "file" opens in the viewer; "folder" opens as the current folder. */
  kind: "file" | "folder";
  /** Bold display label: folder name for generic files, else the name. */
  primary: string;
  /** Dimmed secondary label giving folder context. */
  secondary: string;
  /** Text the fuzzy matcher scores the query against (folder context + name). */
  searchText: string;
}

import { baseName, parentSegments } from "./pathUtil";

/** Filenames that identify a folder rather than themselves (case-insensitive). */
export const GENERIC_BASENAMES = new Set(["skill.md", "readme.md", "index.md"]);

/** Immediate parent folder name, e.g. ".../skills/ui-ux/SKILL.md" → "ui-ux". */
export function parentDirName(path: string): string {
  const segs = parentSegments(path);
  return segs[segs.length - 1] ?? "";
}

/** Last two segments of a file's parent directory, e.g. "skills/ui-ux". */
export function parentLabelOf(path: string): string {
  return parentSegments(path).slice(-2).join("/");
}

/** Whether the filename identifies its folder rather than itself. */
export function isGenericName(name: string): boolean {
  return GENERIC_BASENAMES.has(name.toLowerCase());
}

/**
 * Extra ranking score so an item whose OWN name exactly matches (or is a
 * prefix of) the query outranks items that only match because the query
 * happens to appear somewhere earlier in a longer path (e.g. typing "mdjoa"
 * should surface the "mdjoa" folder itself above "mdjoa-old" or a nested
 * "…/mdjoa/docs"). Case-insensitive.
 */
export function nameMatchBonus(name: string, query: string): number {
  if (!query) return 0;
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n === q) return 1000;
  if (n.startsWith(q)) return 200;
  return 0;
}

/**
 * Build a Quick Open row. For generic files (SKILL.md, README.md, index.md) the
 * folder name becomes the bold label and the full folder/file context is shown
 * dimmed; distinctive files keep filename-as-label with the parent dir dimmed.
 * `searchText` always includes the folder context so the query can match either
 * the folder name or the filename.
 */
export function makeFileItem(name: string, path: string): FileItem {
  const label = parentLabelOf(path);
  const searchText = label ? `${label}/${name}` : name;
  if (isGenericName(name)) {
    const folder = parentDirName(path);
    return {
      name,
      path,
      kind: "file",
      primary: folder || name,
      secondary: searchText,
      searchText,
    };
  }
  return { name, path, kind: "file", primary: name, secondary: label, searchText };
}

/**
 * Build a Quick Open row for a FOLDER. The folder's own name is the label;
 * its parent-dir context is the dim secondary; `searchText` includes both so
 * the folder is findable by its name or its location.
 */
export function makeFolderItem(path: string): FileItem {
  const name = baseName(path);
  const parent = parentLabelOf(path); // last two segments of the parent dir
  return {
    name,
    path,
    kind: "folder",
    primary: name || path,
    secondary: parent,
    searchText: parent ? `${parent}/${name}` : name,
  };
}
