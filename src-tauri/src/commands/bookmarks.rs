use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Bookmark {
    pub heading_id: String,
    pub text: String,
    pub level: u8,
    pub created_at: String,
}

/// Bookmarks are keyed by absolute file path -> list of heading bookmarks.
type BookmarkMap = HashMap<String, Vec<Bookmark>>;

fn bookmarks_path() -> PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.fusionsoft.mdjoa");
    fs::create_dir_all(&data_dir).ok();
    data_dir.join("bookmarks.json")
}

fn load_map() -> BookmarkMap {
    let path = bookmarks_path();
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        HashMap::new()
    }
}

fn save_map(map: &BookmarkMap) -> Result<(), String> {
    let path = bookmarks_path();
    let tmp = path.with_extension("tmp");
    let json = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Bookmarks for a single file (empty if none).
#[command]
pub fn get_bookmarks(path: String) -> Vec<Bookmark> {
    load_map().remove(&path).unwrap_or_default()
}

/// Toggle a heading bookmark for a file. Returns that file's updated list.
#[command]
pub fn toggle_bookmark(
    path: String,
    heading_id: String,
    text: String,
    level: u8,
) -> Result<Vec<Bookmark>, String> {
    let mut map = load_map();
    let entry = map.entry(path.clone()).or_default();

    if let Some(pos) = entry.iter().position(|b| b.heading_id == heading_id) {
        entry.remove(pos);
    } else {
        entry.push(Bookmark {
            heading_id,
            text,
            level,
            created_at: chrono::Local::now().to_rfc3339(),
        });
    }

    // Drop empty entries so the file doesn't accumulate stale keys.
    let result = entry.clone();
    if entry.is_empty() {
        map.remove(&path);
    }
    save_map(&map)?;
    Ok(result)
}
