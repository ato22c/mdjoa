export interface RecentFile {
  path: string;
  name: string;
  accessed_at: string;
  is_dir: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_md: boolean;
}

export interface AppSettings {
  theme: "light" | "dark" | "system";
  /** UI language. "system" = auto-detect from the OS locale. Default "system". */
  language: "system" | "ko" | "en";
  zoom: number;
  sidebar_open: boolean;
  sidebar_width: number;
  outline_open: boolean;
  /** Width (px) of the right-side outline (table of contents) panel (resizable handle). */
  outline_width: number;
  window_x: number | null;
  window_y: number | null;
  window_width: number;
  window_height: number;
  last_folder: string | null;
  show_non_md: boolean;
  favorites_height: number;
  /** Height (px) of the context-documents panel list (resizable handle). */
  context_height: number;
  /** Height (px) of the skills/agents/commands panel list (resizable handle). */
  skills_height: number;
  /** Height (px) of the bottom tab shelf; shared by all tabs (resize handle on its top edge). */
  shelf_height: number;
  auto_reload: boolean;
  auto_save: boolean;
  /** File-name glob patterns used to auto-detect context documents per folder. */
  context_patterns: string[];
  /** Context-window size (tokens) for the sum-token gauge (feature D). Default 200000. */
  context_window: number;
  /** Body font for markdown content: "pretendard" | "system". Default "pretendard". */
  content_font: "pretendard" | "system";
  /** Hide folders with no markdown (recursive) in the tree. Default false. */
  md_only_folders: boolean;
  /** Optional override path to the `claude` CLI used for translation. null = auto-detect. */
  claude_cli_path: string | null;
  /** Whether to check for updates automatically (Windows). Default false. */
  update_check_enabled: boolean;
  /** Whether the first-run consent dialog was already shown (prevents re-showing). Default false. */
  update_check_prompted: boolean;
  /** When the notice banner was last dismissed (epoch ms). null = never dismissed. */
  default_app_prompt_at: number | null;
}

/** A context document auto-detected under the open folder (sidebar item). */
export interface ContextFile {
  name: string;
  path: string;
}

/** A skill/agent/command discovered under the open project's `.claude/` dir. */
export interface ClaudeAsset {
  kind: "skill" | "agent" | "command";
  name: string;
  description: string;
  path: string;
}

export interface HeadingItem {
  id: string;
  text: string;
  level: number;
}

// A file that references the current document via `[[…]]` (feature F / #10).
export interface Backlink {
  name: string;
  path: string;
}

export interface FavoriteItem {
  path: string;
  name: string;
  added_at: string;
  is_dir: boolean;
}

export interface Bookmark {
  heading_id: string;
  text: string;
  level: number;
  created_at: string;
}

export type PandocState = "none" | "system" | "bundled";

export interface PandocStatus {
  state: PandocState;
  version: string | null;
  path: string | null;
}

export interface DownloadProgress {
  received: number;
  total: number;
}

/** Detection state of the local `claude` CLI used for translation. */
export type ClaudeState = "none" | "system" | "override";

export interface ClaudeStatus {
  state: ClaudeState;
  version: string | null;
  path: string | null;
}

export interface FileMeta {
  created_ms: number | null;
  modified_ms: number | null;
  size: number;
}

/** Kind of on-disk change for a folder file, shown as a colored tree badge.
 *  (Deleted files leave the tree entirely, so they carry no badge.) */
export type ChangeKind = "created" | "modified";
