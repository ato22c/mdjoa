// AI auto-completion for backlog tasks. When the user enters a rough description in the
// dashboard, this calls the local claude CLI and returns title/priority/effort/category/
// description etc. filled in as JSON. Uses the same claude detection/invocation pattern
// as translate.rs.

use std::process::{Command, Stdio};
use tauri::{command, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

fn find_claude() -> Option<String> {
    let probe = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = Command::new(probe);
    cmd.arg("claude");
    let out = quiet(&mut cmd).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if path.is_empty() { return None; }
    Some(path)
}

fn resolve_claude() -> Option<String> {
    if let Some(p) = find_claude() { return Some(p); }
    let exe = if cfg!(windows) { "claude.exe" } else { "claude" };
    if let Some(home) = dirs::home_dir() {
        for candidate in [
            home.join(".local").join("bin").join(exe),
            home.join(".claude").join("local").join(exe),
        ] {
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// Takes the user's rough task description and returns JSON with the BACKLOG.md fields filled in.
/// Returned JSON schema:
/// { "title": str, "priority": "must|should|could", "effort": str,
///   "category": "bug|feature|validation|improvement",
///   "assignee": str, "dependencies": str,
///   "description": str, "result": "" }
#[command]
pub async fn backlog_generate_task(rough: String) -> Result<String, String> {
    let claude = resolve_claude()
        .ok_or("Claude CLI를 찾을 수 없습니다. PATH에 claude가 있는지 확인하세요.")?;

    let prompt = format!(
        r#"You are a product backlog manager. Given the rough task idea below, output a \
JSON object that fills in all required BACKLOG.md fields. Use Korean for title and description.

Rough idea: {rough}

Output ONLY valid JSON (no markdown fence, no explanation):
{{
  "title": "간결한 한국어 제목",
  "priority": "must|should|could",
  "effort": "예: 1h, ~2h, ~0.5d",
  "category": "bug|feature|validation|improvement",
  "assignee": "—",
  "dependencies": "none",
  "description": "구체적인 한국어 설명 (재현 경로, 기대 동작, 범위 등)",
  "result": ""
}}"#,
        rough = rough
    );

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&claude);
        cmd.arg("--model")
            .arg("haiku")
            .arg("-p")
            .arg(&prompt)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        quiet(&mut cmd);

        let child = cmd.spawn().map_err(|e| format!("claude 실행 실패: {e}"))?;
        let out = child.wait_with_output().map_err(|e| format!("대기 실패: {e}"))?;

        if out.status.success() {
            let raw = String::from_utf8_lossy(&out.stdout);
            // Strip a wrapping ``` fence if present
            let text = raw.trim();
            let json = if text.starts_with("```") {
                text.lines()
                    .skip(1)
                    .collect::<Vec<_>>()
                    .join("\n")
                    .trim_end_matches("```")
                    .trim()
                    .to_string()
            } else {
                text.to_string()
            };
            if json.is_empty() {
                Err("claude 응답이 비어 있습니다".into())
            } else {
                Ok(json)
            }
        } else {
            let err = String::from_utf8_lossy(&out.stderr);
            Err(format!("claude 오류: {}", err.trim()))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Generates an AI implementation plan for a backlog task.
/// Based on the task's title/description/expected result, returns a step-by-step plan
/// (including files and changes).
#[command]
pub async fn backlog_plan_task(
    bl_id: String,
    title: String,
    desc: String,
    result: String,
) -> Result<String, String> {
    let claude = resolve_claude()
        .ok_or("Claude CLI를 찾을 수 없습니다. PATH에 claude가 있는지 확인하세요.")?;

    let prompt = format!(
        r#"You are a senior developer reviewing a backlog task. Provide a concise, actionable implementation plan in Korean.

Task ID: {bl_id}
Title: {title}
Description: {desc}
Expected Result: {result}

Output ONLY a numbered list (5-8 steps). Each step must name the specific file to change and what to do. No intro, no outro, no markdown headers."#,
        bl_id = bl_id,
        title = title,
        desc = desc,
        result = result,
    );

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&claude);
        cmd.arg("--model")
            .arg("haiku")
            .arg("-p")
            .arg(&prompt)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        quiet(&mut cmd);

        let child = cmd.spawn().map_err(|e| format!("claude 실행 실패: {e}"))?;
        let out = child.wait_with_output().map_err(|e| format!("대기 실패: {e}"))?;

        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if text.is_empty() { Err("claude 응답이 비어 있습니다".into()) } else { Ok(text) }
        } else {
            Err(format!("claude 오류: {}", String::from_utf8_lossy(&out.stderr).trim()))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens the backlog dashboard (dashboard.html) in a separate window.
/// If backlog_path is given, it is passed as a URL query parameter so the dashboard auto-loads it.
#[command]
pub fn open_dashboard_window(app: AppHandle, backlog_path: Option<String>) -> Result<(), String> {
    const LABEL: &str = "backlog-dashboard";
    // If already open, just focus it
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    let url_str = if let Some(ref path) = backlog_path {
        // Minimally encode only URL-special characters in the path (for macOS/Windows paths)
        let encoded: String = path.chars().map(|c| match c {
            ' ' => "%20".to_string(),
            '#' => "%23".to_string(),
            '?' => "%3F".to_string(),
            '&' => "%26".to_string(),
            '%' => "%25".to_string(),
            c   => c.to_string(),
        }).collect();
        format!("dashboard.html?backlog={encoded}")
    } else {
        "dashboard.html".to_string()
    };
    let mut builder = WebviewWindowBuilder::new(
        &app,
        LABEL,
        WebviewUrl::App(url_str.into()),
    )
    .title("MD좋아 — 백로그")
    .inner_size(1280.0, 820.0)
    .min_inner_size(800.0, 500.0);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    builder.build().map(|_| ()).map_err(|e| e.to_string())
}
