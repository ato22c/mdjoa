// Per-file edit history (multi-level undo/redo) kept OUTSIDE the React component
// lifecycle. AppShell renders `<Editor/>` only in edit mode, so toggling edit↔view
// unmounts and remounts the editor every time. If the undo/redo stacks lived in
// component refs (as they originally did), re-entering edit mode would wipe them —
// and you could no longer undo changes you had already saved. Keying the history
// by file path here makes it survive remounts: enter edit mode, edit, save, switch
// to view, come back, and undo still walks back through the saved edits.
//
// History is cleared when a document is (re)loaded from disk (see store.openFile)
// so a fresh load starts clean. It is intentionally NOT persisted across app
// restarts (in-memory only), matching the app's no-permanent-index stance.

export interface HistoryEntry {
  undo: string[];
  redo: string[];
  lastEditAt: number;
}

const histories = new Map<string, HistoryEntry>();

// Rapid typing within this window coalesces into a single undo step.
export const COALESCE_MS = 600;
// Cap stack depth to bound memory on very long editing sessions.
export const MAX_DEPTH = 500;

function entryFor(key: string): HistoryEntry {
  let e = histories.get(key);
  if (!e) {
    e = { undo: [], redo: [], lastEditAt: 0 };
    histories.set(key, e);
  }
  return e;
}

// Pure: should this edit open a NEW undo step (vs. coalesce into the previous)?
// First edit always snapshots; otherwise only after the coalesce window passes.
export function shouldSnapshot(
  undoLen: number,
  lastEditAt: number,
  now: number,
  coalesceMs = COALESCE_MS
): boolean {
  return undoLen === 0 || now - lastEditAt > coalesceMs;
}

// Record an edit. `prev` is the buffer value BEFORE the change is applied.
export function recordEdit(key: string, prev: string, now: number): void {
  const e = entryFor(key);
  if (shouldSnapshot(e.undo.length, e.lastEditAt, now)) {
    e.undo.push(prev);
    if (e.undo.length > MAX_DEPTH) e.undo.shift();
  }
  e.lastEditAt = now;
  e.redo = []; // a new edit invalidates the redo branch
}

// Undo: returns the content to restore (and pushes `current` onto redo), or null
// if there is nothing to undo.
export function undo(key: string, current: string): string | null {
  const e = entryFor(key);
  if (!e.undo.length) return null;
  e.redo.push(current);
  const v = e.undo.pop()!;
  e.lastEditAt = 0; // next typing starts a fresh undo step
  return v;
}

export function redo(key: string, current: string): string | null {
  const e = entryFor(key);
  if (!e.redo.length) return null;
  e.undo.push(current);
  const v = e.redo.pop()!;
  e.lastEditAt = 0;
  return v;
}

export function canUndo(key: string): boolean {
  return (histories.get(key)?.undo.length ?? 0) > 0;
}

export function canRedo(key: string): boolean {
  return (histories.get(key)?.redo.length ?? 0) > 0;
}

// Drop a file's history. Call when the document is (re)loaded from disk so the
// new content isn't undone back into a stale previous version.
export function clearHistory(key: string): void {
  histories.delete(key);
}
