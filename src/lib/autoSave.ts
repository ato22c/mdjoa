// Auto-save tuning + the pure guard decision, split out of Editor.tsx so that
// file exports only the <Editor> component. Mixing a component and non-component
// exports in one module breaks React Fast Refresh (Vite falls back to a full
// invalidate on every edit), so these live here.

// Idle delay before an auto-save fires. Long enough that it never interrupts
// active typing, short enough to feel "I didn't have to press save". Safe to keep
// short: the file watcher is inactive in edit mode (MarkdownViewer is unmounted),
// so our own saves never trigger a false external-change.
export const AUTO_SAVE_IDLE_MS = 1000;

// Pure decision: should the debounced timer actually write to disk right now?
// Kept side-effect-free so it can be unit-tested without the store or a DOM.
//  - autoSave off  → manual save only
//  - no open file  → nothing to write
//  - not dirty     → buffer matches disk, skip
//  - externalChanged → the file changed on disk under us; auto-saving would
//    silently clobber that external edit (the app's core use case is "AI rewrote
//    the MD"), so we refuse and leave the conflict warning up. Only an explicit
//    ⌘S overwrites.
export function shouldAutoSave(p: {
  autoSave: boolean;
  hasFile: boolean;
  isDirty: boolean;
  externalChanged: boolean;
}): boolean {
  if (!p.autoSave) return false;
  if (!p.hasFile) return false;
  if (!p.isDirty) return false;
  if (p.externalChanged) return false;
  return true;
}
