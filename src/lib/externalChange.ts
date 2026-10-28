// Decision logic for "the open document changed on disk" — extracted as a pure
// function so every scenario (added/modified/deleted/recreated × view / edit-
// clean / edit-dirty) is unit-testable without a running watcher or webview.
//
// The watcher observes the file's PARENT directory, so it keeps firing even
// after the file is deleted — a later re-create (same name) is just an event
// where `exists` is true again, which this function routes to reload/reflect.

export type ExternalChangeAction =
  | "missing" //   file no longer on disk → show "deleted" notice, keep the buffer
  | "none" //      file present but content identical (our own save, touch) → no-op
  | "reloadView" //  view mode + auto-reload → silently reload the rendered doc
  | "notifyView" //  view mode + auto-reload OFF → show "외부 변경됨 · 새로고침" banner
  | "reflectEdit" //  edit mode, no unsaved edits → safely reload buffer from disk
  | "conflictEdit"; // edit mode WITH unsaved edits → conflict; never auto-overwrite

export interface ExternalChangeInput {
  exists: boolean; //        does the file still exist on disk?
  contentChanged: boolean; // does disk content differ from what we have loaded?
  editMode: boolean; //      are we in the editor (vs the read view)?
  isDirty: boolean; //       does the editor buffer have unsaved edits?
  autoReload: boolean; //    settings.auto_reload (view-mode behavior)
}

export function decideExternalChange(i: ExternalChangeInput): ExternalChangeAction {
  if (!i.exists) return "missing";
  if (!i.contentChanged) return "none";
  if (i.editMode) return i.isDirty ? "conflictEdit" : "reflectEdit";
  return i.autoReload ? "reloadView" : "notifyView";
}
