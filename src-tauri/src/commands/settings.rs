use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub theme: String,
    pub zoom: f64,
    pub sidebar_open: bool,
    pub sidebar_width: u32,
    pub outline_open: bool,
    /// Width (px) of the right-side outline(목차) panel. serde default keeps old
    /// settings.json (which lacks this field) loadable instead of resetting.
    #[serde(default = "default_outline_width")]
    pub outline_width: u32,
    pub window_x: Option<i32>,
    pub window_y: Option<i32>,
    pub window_width: u32,
    pub window_height: u32,
    pub last_folder: Option<String>,
    pub show_non_md: bool,
    /// Height (px) of the favorites panel. serde default keeps old settings.json
    /// (which lacks this field) loadable instead of resetting everything.
    #[serde(default = "default_favorites_height")]
    pub favorites_height: u32,
    /// Height (px) of the context-documents panel list. serde default keeps old
    /// settings.json (which lacks this field) loadable instead of resetting.
    #[serde(default = "default_context_height")]
    pub context_height: u32,
    /// Height (px) of the skills/agents/commands panel list. serde default keeps
    /// old settings.json (which lacks this field) loadable instead of resetting.
    #[serde(default = "default_skills_height")]
    pub skills_height: u32,
    /// Height (px) of the bottom tab shelf (favorites/context/skills). One shared
    /// value so switching tabs never changes it; only a user drag does. serde
    /// default keeps old settings.json loadable.
    #[serde(default = "default_shelf_height")]
    pub shelf_height: u32,
    /// Auto-reload the open file when it changes on disk (vs. notify-only).
    #[serde(default = "default_true")]
    pub auto_reload: bool,
    /// Auto-save edits after a short idle in edit mode (vs. manual ⌘S only).
    /// Guarded on the frontend: never auto-saves while the file has an
    /// unacknowledged external change on disk.
    #[serde(default = "default_true")]
    pub auto_save: bool,
    /// File-name glob patterns used to auto-detect "context" documents
    /// (CLAUDE.md, AGENTS.md, *.spec.md, …) when a folder is opened. serde
    /// default keeps old settings.json (which lacks this field) loadable.
    #[serde(default = "default_context_patterns")]
    pub context_patterns: Vec<String>,
    /// Context-window size (tokens) for the sum-token gauge (feature D). serde
    /// default keeps old settings.json (which lacks this field) loadable.
    #[serde(default = "default_context_window")]
    pub context_window: u32,
    /// Content body font: "pretendard" | "system". serde default keeps old
    /// settings.json loadable.
    #[serde(default = "default_content_font")]
    pub content_font: String,
    /// Hide folders that contain no markdown (recursively, bounded) in the tree.
    /// Default off (full tree). serde default keeps old settings.json loadable.
    #[serde(default)]
    pub md_only_folders: bool,
    /// UI language: "system" | "ko" | "en". serde default keeps old
    /// settings.json (which lacks this field) loadable instead of resetting.
    #[serde(default = "default_language")]
    pub language: String,
    /// Auto update check. 자동 업데이트 확인을 켤지 여부. 기본 false — 최초 동의 전까지
    /// 네트워크 조회를 하지 않는다(CLAUDE.md 네트워크 원칙, 예외 4).
    #[serde(default)]
    pub update_check_enabled: bool,
    /// 최초 동의 다이얼로그를 이미 보여줬는지(재노출 방지용). 기본 false.
    #[serde(default)]
    pub update_check_prompted: bool,
    /// 안내 띠를 마지막으로 닫은 시각(epoch ms). None = 아직 닫은 적 없음.
    #[serde(default)]
    pub default_app_prompt_at: Option<i64>,
}

fn default_outline_width() -> u32 {
    220
}

fn default_context_window() -> u32 {
    200_000
}

fn default_content_font() -> String {
    "pretendard".to_string()
}

fn default_favorites_height() -> u32 {
    192
}

fn default_context_height() -> u32 {
    180
}

fn default_skills_height() -> u32 {
    320
}

fn default_shelf_height() -> u32 {
    220
}

fn default_true() -> bool {
    true
}

fn default_language() -> String {
    "system".to_string()
}

/// Default context-document patterns shipped in settings.json. Minimal glob
/// (`*`) matched against the file name only. Users may edit these in Settings.
fn default_context_patterns() -> Vec<String> {
    vec![
        "CLAUDE.md".to_string(),
        "AGENTS.md".to_string(),
        "SKILL.md".to_string(),
        "README.md".to_string(),
        "CONTEXT.md".to_string(),
        "*.spec.md".to_string(),
        "plan*.md".to_string(),
        "*.plan.md".to_string(),
    ]
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            zoom: 1.0,
            sidebar_open: true,
            sidebar_width: 240,
            outline_open: false,
            outline_width: 220,
            window_x: None,
            window_y: None,
            window_width: 1200,
            window_height: 800,
            last_folder: None,
            show_non_md: true,
            favorites_height: 192,
            context_height: 180,
            skills_height: 320,
            shelf_height: 220,
            auto_reload: true,
            auto_save: true,
            context_patterns: default_context_patterns(),
            context_window: 200_000,
            content_font: "pretendard".to_string(),
            md_only_folders: false,
            language: "system".to_string(),
            update_check_enabled: false,
            update_check_prompted: false,
            default_app_prompt_at: None,
        }
    }
}

fn settings_path() -> PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.fusionsoft.mdjoa");
    fs::create_dir_all(&data_dir).ok();
    data_dir.join("settings.json")
}

#[command]
pub fn load_settings() -> AppSettings {
    let path = settings_path();
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        AppSettings::default()
    }
}

#[command]
pub fn save_settings(settings: AppSettings) -> Result<(), String> {
    let path = settings_path();
    let tmp = path.with_extension("tmp");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_settings_json_without_update_fields_loads_with_safe_defaults() {
        // 구버전 settings.json에는 update_check_enabled/update_check_prompted가 없다.
        let old_json = r#"{
            "theme": "system", "zoom": 1.0, "sidebar_open": true, "sidebar_width": 240,
            "outline_open": false, "window_x": null, "window_y": null,
            "window_width": 1200, "window_height": 800, "last_folder": null,
            "show_non_md": false, "language": "system"
        }"#;
        let settings: AppSettings = serde_json::from_str(old_json).unwrap();
        assert_eq!(settings.update_check_enabled, false, "미동의 상태가 기본값이어야 함(네트워크 원칙)");
        assert_eq!(settings.update_check_prompted, false, "동의 다이얼로그를 아직 안 봤어야 함");
        assert_eq!(settings.default_app_prompt_at, None, "기본 앱 안내 띠를 닫은 적 없어야 함");
    }

    #[test]
    fn default_settings_have_update_check_disabled() {
        let s = AppSettings::default();
        assert_eq!(s.update_check_enabled, false);
        assert_eq!(s.update_check_prompted, false);
    }
}
