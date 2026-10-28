// Pure logic for the AI change review center (killer #1). Helpers for reviewing
// "what changed" on one screen after an AI agent has edited several MD files on disk.
//
// Holds just two pure functions (no side effects or I/O → easy to unit test):
//   1) sortReviewItems  — stable-sort the change list by kind, then name
//   2) resolveBeforeAfter — decide the before/after text used for one item's diff
//
// The actual disk read (read_file) happens in the modal, which passes the result in here.

import type { ChangeKind } from "../types";

// One item in the review list. Besides the changedFiles values (created/modified),
// kind can also be "deleted" for a file that has disappeared by review time (defensive).
export type ReviewKind = ChangeKind | "deleted";

export interface ReviewItem {
  path: string;
  name: string;
  kind: ReviewKind;
}

/** Extract only the file name from an absolute path (no hardcoded separator — handles both / and \). */
export function baseName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

// List sort priority: kind (created → modified → deleted), then file name (locale compare).
// This makes the screen read as "new → changed → gone".
const KIND_ORDER: Record<ReviewKind, number> = {
  created: 0,
  modified: 1,
  deleted: 2,
};

/**
 * Convert the changedFiles map into a review list (sorted array). Sorted by kind
 * first, then by file name (case-insensitive locale compare) within the same kind.
 * Does not mutate the input.
 */
export function sortReviewItems(changed: Record<string, ChangeKind>): ReviewItem[] {
  const items: ReviewItem[] = Object.entries(changed).map(([path, kind]) => ({
    path,
    name: baseName(path),
    kind,
  }));
  return items.sort((a, b) => {
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (byKind !== 0) return byKind;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export interface BeforeAfter {
  before: string;
  after: string;
}

/**
 * Decide the before/after used for one review item's diff.
 *   - before = baseline (the version the user last knew). "" if absent (everything is an addition, like a create).
 *   - after  = current disk content (diskContent). "" if the file is gone (deleted).
 * If there is no baseline and no disk content, both are "" → no diff (handled as an empty state).
 *
 * diskContent === null means "could not read from disk / file missing".
 */
export function resolveBeforeAfter(
  kind: ReviewKind,
  baseline: string | undefined,
  diskContent: string | null
): BeforeAfter {
  const before = baseline ?? "";
  // If deleted or the disk can't be read, after is an empty string (shown as all removed).
  const after = kind === "deleted" || diskContent === null ? "" : diskContent;
  return { before, after };
}
