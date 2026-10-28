use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::command;

const MAX_RECENT: usize = 20;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentFile {
    pub path: String,
    pub name: String,
    pub accessed_at: String,
    /// Recents now include folders too; defaults to false for older entries.
    #[serde(default)]
    pub is_dir: bool,
}

fn recent_path() -> PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.fusionsoft.mdjoa");
    fs::create_dir_all(&data_dir).ok();
    data_dir.join("recent.json")
}

fn load_raw() -> Vec<RecentFile> {
    let path = recent_path();
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        vec![]
    }
}

fn save_raw(list: &[RecentFile]) -> Result<(), String> {
    let path = recent_path();
    let tmp = path.with_extension("tmp");
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub fn get_recent_files() -> Vec<RecentFile> {
    let list = load_raw();
    list.into_iter()
        .filter(|f| std::path::Path::new(&f.path).exists())
        .collect()
}

#[command]
pub fn add_recent_file(path: String, is_dir: bool) -> Result<Vec<RecentFile>, String> {
    let name = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let now = chrono::Local::now().to_rfc3339();

    let mut list = load_raw();
    list.retain(|f| f.path != path);
    list.insert(
        0,
        RecentFile {
            path,
            name,
            accessed_at: now,
            is_dir,
        },
    );
    list.truncate(MAX_RECENT);
    save_raw(&list)?;

    Ok(list
        .into_iter()
        .filter(|f| std::path::Path::new(&f.path).exists())
        .collect())
}

#[command]
pub fn clear_recent_files() -> Result<(), String> {
    save_raw(&[])
}
