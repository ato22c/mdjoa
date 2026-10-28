// Document navigation history (browser/IDE-style back/forward). Pure stack logic,
// kept separate from the store so it can be unit-tested in isolation. The store
// holds a single `NavState` and drives openFile from goBack/goForward.
//
// Model: `entries` is the ordered list of visited file paths; `index` points at
// the currently-shown entry. Navigating to a new file truncates any forward
// history (the classic "new branch" behaviour) and appends. Re-opening the file
// already at `index` (refresh / reloadCurrent) is a no-op so it never pollutes
// the stack or breaks forward.

export interface NavState {
  entries: string[];
  index: number; // -1 when empty; otherwise the position of the current entry
}

// Cap stack depth to bound memory on very long sessions. When exceeded we drop
// the oldest entries (FIFO) and keep `index` pointing at the same logical entry.
export const MAX_NAV = 100;

/** Empty starting state (no document opened yet). */
export function emptyNav(): NavState {
  return { entries: [], index: -1 };
}

/**
 * Record a normal navigation to `path`. Truncates any forward history past the
 * current index, appends `path`, and points index at it. No change when `path`
 * already equals the current entry (refresh / reopening the same doc).
 */
export function pushEntry(state: NavState, path: string): NavState {
  if (state.index >= 0 && state.entries[state.index] === path) {
    return state; // same doc — don't duplicate or reset forward history
  }
  // Drop forward history, then append.
  let entries = state.entries.slice(0, state.index + 1);
  entries.push(path);
  let index = entries.length - 1;
  // Enforce the depth cap by dropping the oldest entries.
  if (entries.length > MAX_NAV) {
    const overflow = entries.length - MAX_NAV;
    entries = entries.slice(overflow);
    index -= overflow;
  }
  return { entries, index };
}

export function canGoBack(state: NavState): boolean {
  return state.index > 0;
}

export function canGoForward(state: NavState): boolean {
  return state.index >= 0 && state.index < state.entries.length - 1;
}

/**
 * Move one step back. Returns the new state plus the target path to open, or
 * null target when already at the start (state unchanged).
 */
export function goBack(state: NavState): { state: NavState; path: string | null } {
  if (!canGoBack(state)) return { state, path: null };
  const index = state.index - 1;
  return { state: { ...state, index }, path: state.entries[index] };
}

/**
 * Move one step forward. Returns the new state plus the target path to open, or
 * null target when already at the end (state unchanged).
 */
export function goForward(state: NavState): { state: NavState; path: string | null } {
  if (!canGoForward(state)) return { state, path: null };
  const index = state.index + 1;
  return { state: { ...state, index }, path: state.entries[index] };
}
