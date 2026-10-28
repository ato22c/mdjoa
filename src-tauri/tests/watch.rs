//! Integration test for OS file-watching — the backbone of MD좋아's external-
//! change detection (auto-reload + "deleted" notice + tree badges).
//!
//! The app watches via tauri-plugin-fs's `watch` feature, which uses the same
//! `notify` crate exercised here. This test guards the platform capability:
//! if `notify` ever stops delivering create/modify/remove events on this OS,
//! external-change detection is broken and this fails loudly — instead of the
//! silent breakage that hid the missing `watch` Cargo feature.

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::fs;
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Poll the event channel until `pred` matches or `timeout` elapses.
fn wait_for<F>(rx: &mpsc::Receiver<notify::Result<notify::Event>>, pred: F, timeout: Duration) -> bool
where
    F: Fn(&notify::Event) -> bool,
{
    let start = Instant::now();
    while start.elapsed() < timeout {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(Ok(ev)) if pred(&ev) => return true,
            Ok(_) => continue,           // some other event — keep waiting
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => return false,
        }
    }
    false
}

fn mentions(ev: &notify::Event, name: &str) -> bool {
    ev.paths.iter().any(|p| p.to_string_lossy().ends_with(name))
}

#[test]
fn detects_modify_and_remove_in_watched_dir() {
    let dir = tempfile::tempdir().expect("temp dir");
    let (tx, rx) = mpsc::channel();
    let mut watcher: RecommendedWatcher =
        notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        })
        .expect("create watcher");
    watcher
        .watch(dir.path(), RecursiveMode::Recursive)
        .expect("start watch");

    // Create / write → at least one event mentioning the file (Create or Modify).
    let file = dir.path().join("note.md");
    fs::write(&file, b"# hello").expect("write file");
    assert!(
        wait_for(&rx, |ev| mentions(ev, "note.md"), Duration::from_secs(10)),
        "expected a create/modify event for note.md within 10s"
    );

    // Modify again (simulates an external editor saving).
    fs::write(&file, b"# hello\n\nedited").expect("rewrite file");
    assert!(
        wait_for(&rx, |ev| mentions(ev, "note.md"), Duration::from_secs(10)),
        "expected a modify event for note.md within 10s"
    );

    // Remove (simulates deletion in Finder) → a Remove event for the file.
    fs::remove_file(&file).expect("remove file");
    assert!(
        wait_for(
            &rx,
            |ev| matches!(ev.kind, EventKind::Remove(_)) && mentions(ev, "note.md"),
            Duration::from_secs(10),
        ),
        "expected a remove event for note.md within 10s"
    );
}
