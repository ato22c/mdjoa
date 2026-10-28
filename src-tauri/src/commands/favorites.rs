use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FavoriteItem {
    pub path: String,
    pub name: String,
    pub added_at: String,
    // `#[serde(default)]` so favorites.json written before this field existed
    // still loads (missing -> false, i.e. treated as a file).
    #[serde(default)]
    pub is_dir: bool,
}

fn favorites_path() -> PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.fusionsoft.mdjoa");
    fs::create_dir_all(&data_dir).ok();
    data_dir.join("favorites.json")
}

fn load_raw() -> Vec<FavoriteItem> {
    let path = favorites_path();
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        vec![]
    }
}

// Atomic write (tmp -> rename), matching settings.rs / recent.rs.
fn save_raw(list: &[FavoriteItem]) -> Result<(), String> {
    let path = favorites_path();
    let tmp = path.with_extension("tmp");
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Returns favorites, filtering out entries whose file no longer exists.
#[command]
pub fn get_favorites() -> Vec<FavoriteItem> {
    load_raw()
        .into_iter()
        .filter(|f| Path::new(&f.path).exists())
        .collect()
}

/// Toggle a path's favorite status. Returns the updated (existence-filtered) list.
#[command]
pub fn toggle_favorite(path: String, is_dir: bool) -> Result<Vec<FavoriteItem>, String> {
    let mut list = load_raw();
    if let Some(pos) = list.iter().position(|f| f.path == path) {
        list.remove(pos);
    } else {
        let name = Path::new(&path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
        list.insert(
            0,
            FavoriteItem {
                path,
                name,
                added_at: chrono::Local::now().to_rfc3339(),
                is_dir,
            },
        );
    }
    save_raw(&list)?;
    Ok(list
        .into_iter()
        .filter(|f| Path::new(&f.path).exists())
        .collect())
}

/// Remove every favorite. Returns the now-empty list. The frontend keeps a
/// snapshot for one-tap undo (restored via `set_favorites`), so this runs
/// without a confirm dialog.
#[command]
pub fn clear_favorites() -> Result<Vec<FavoriteItem>, String> {
    save_raw(&[])?;
    Ok(vec![])
}

/// Replace the entire favorites list with `items`, verbatim (order, name,
/// added_at, is_dir preserved). Used to restore a snapshot after
/// `clear_favorites` (undo). Returns the (existence-filtered) saved list.
#[command]
pub fn set_favorites(items: Vec<FavoriteItem>) -> Result<Vec<FavoriteItem>, String> {
    save_raw(&items)?;
    Ok(items
        .into_iter()
        .filter(|f| Path::new(&f.path).exists())
        .collect())
}

/// Persist a new ordering for favorites. `paths` lists every favorite in the
/// desired order; any stored favorite missing from it is appended (defensive).
#[command]
pub fn reorder_favorites(paths: Vec<String>) -> Result<Vec<FavoriteItem>, String> {
    let mut list = load_raw();
    let mut reordered: Vec<FavoriteItem> = Vec::with_capacity(list.len());
    for p in &paths {
        if let Some(pos) = list.iter().position(|f| &f.path == p) {
            reordered.push(list.remove(pos));
        }
    }
    reordered.append(&mut list); // keep any not mentioned
    save_raw(&reordered)?;
    Ok(reordered
        .into_iter()
        .filter(|f| Path::new(&f.path).exists())
        .collect())
}
