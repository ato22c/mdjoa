// Auto update (Windows) — check/download/install.
//
// Network calls happen only when the user turns on update_check_enabled in settings
// (CLAUDE.md network policy, exception 4). The optional token is embedded at build
// time and is never exposed to the frontend (JS/webview).
use serde::Serialize;
use tauri::{command, AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

/// Optional read-only token embedded at build time via `MDJOA_UPDATE_TOKEN`.
/// Only private update servers need it; the public build (GitHub Releases) leaves
/// it empty and sends no auth header.
fn update_token() -> &'static str {
    option_env!("MDJOA_UPDATE_TOKEN").unwrap_or("")
}

/// Optional endpoint override embedded at build time via `MDJOA_UPDATE_ENDPOINT`.
/// Empty = use the endpoint in tauri.conf.json (public GitHub Releases).
fn update_endpoint() -> &'static str {
    option_env!("MDJOA_UPDATE_ENDPOINT").unwrap_or("")
}

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
}

/// Builds the updater. A token header and an endpoint override are applied only
/// when embedded at build time. Builder/header failures (config errors) propagate
/// as Err so the manual "check now" shows the real error instead of swallowing it.
fn build_updater(app: &AppHandle) -> Result<Option<tauri_plugin_updater::Updater>, String> {
    let mut builder = app.updater_builder();
    let token = update_token();
    if !token.is_empty() {
        builder = builder
            .header("PRIVATE-TOKEN", token)
            .map_err(|e| format!("update_header_failed|{e}"))?;
    }
    let endpoint = update_endpoint();
    if !endpoint.is_empty() {
        let url: tauri::Url = endpoint
            .parse()
            .map_err(|e| format!("update_builder_failed|{e}"))?;
        builder = builder
            .endpoints(vec![url])
            .map_err(|e| format!("update_builder_failed|{e}"))?;
    }
    let updater = builder.build().map_err(|e| format!("update_builder_failed|{e}"))?;
    Ok(Some(updater))
}

/// "1.6.0" 같은 SemVer 문자열을 (major, minor, patch) 튜플로 파싱한다.
/// 파싱 실패 시 (0,0,0) — 비교가 항상 "새 버전 아님"으로 안전하게 폴백.
fn parse_semver(v: &str) -> (u32, u32, u32) {
    let mut parts = v.trim().split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

/// candidate가 current보다 SemVer상 더 높은 버전인지.
pub fn is_newer_version(current: &str, candidate: &str) -> bool {
    parse_semver(candidate) > parse_semver(current)
}

/// 새 버전을 체크하고, 있으면 즉시 백그라운드로 다운로드+설치까지 진행한다
/// (VT와 동등한 자동화 수준). 설치가 끝나면 "update-installed"를 emit — 실제
/// 파일 반영은 이 시점에 이미 끝나 있고, 다음 재시작부터 새 버전이 뜬다.
/// 재시작을 강제하지 않는 이유: 사용자가 작업 중일 수 있으므로 quit 시점에
/// 자연스럽게 적용되게 한다(VT의 "조용히 설치" 개념과 동등).
async fn check_and_auto_install(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let Some(updater) = build_updater(app)? else {
        return Ok(None);
    };
    let update = updater
        .check()
        .await
        .map_err(|e| format!("update_check_failed|{e}"))?;

    let Some(update) = update else {
        return Ok(None);
    };

    // 방어적 이중 확인: 사내 GitLab의 latest.json이 잘못 갱신되어(수동 편집 실수,
    // 캐시 지연 등) 현재 버전과 같거나 더 낮은 버전을 "새 버전"이라고 응답하는
    // 경우를 걸러낸다. tauri-plugin-updater도 자체 비교를 하지만, 우리가 직접
    // 배포 스크립트로 latest.json을 만드는 구조라 이 가드를 별도로 둔다.
    if !is_newer_version(env!("CARGO_PKG_VERSION"), &update.version) {
        return Ok(None);
    }

    let info = UpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
    };
    app.emit("update-available", info.clone()).ok();

    let app_for_install = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = update
            .download_and_install(|_chunk, _total| {}, || {})
            .await;
        if result.is_ok() {
            app_for_install.emit("update-installed", ()).ok();
        } else if let Err(e) = result {
            commands_log_error(&format!("update_install_failed|{e}"));
        }
    });

    Ok(Some(info))
}

/// updater.rs는 log.rs를 직접 의존하지 않는 것이 기존 커맨드 모듈들의 관례이므로,
/// 여기서만 쓰는 아주 얇은 래퍼로 로그를 남긴다(자동 체크 실패는 토스트 없이 로그만).
fn commands_log_error(message: &str) {
    super::log::append_line("error", message);
}

/// 수동 "지금 업데이트 확인" — 설정의 update_check_enabled와 무관하게 항상 동작
/// (토큰이 없는 개발 빌드에서는 여전히 None을 반환해 안전).
#[command]
pub async fn check_for_updates_now(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    check_and_auto_install(&app).await
}

/// 설정 켜짐 상태에서 앱 시작 시 1회 + 이후 4시간 간격으로 자동 체크한다.
/// lib.rs의 setup 훅에서 spawn되며, update_check_enabled가 꺼져 있으면 즉시 반환.
pub async fn start_background_checks(app: AppHandle, enabled: bool) {
    if !enabled {
        return;
    }
    const INTERVAL: std::time::Duration = std::time::Duration::from_secs(4 * 60 * 60);
    loop {
        if let Err(e) = check_and_auto_install(&app).await {
            commands_log_error(&e);
        }
        tokio::time::sleep(INTERVAL).await;
    }
}

/// "지금 재시작" 버튼 — 이미 백그라운드에서 설치까지 끝난 상태이므로 단순 재시작.
#[command]
pub fn install_pending_update(app: AppHandle) -> Result<(), String> {
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_patch_bump() {
        assert!(is_newer_version("1.6.0", "1.6.1"));
    }

    #[test]
    fn detects_minor_and_major_bump() {
        assert!(is_newer_version("1.6.0", "1.7.0"));
        assert!(is_newer_version("1.6.0", "2.0.0"));
    }

    #[test]
    fn same_or_older_is_not_newer() {
        assert!(!is_newer_version("1.6.0", "1.6.0"));
        assert!(!is_newer_version("1.6.1", "1.6.0"));
        assert!(!is_newer_version("2.0.0", "1.9.9"));
    }

    #[test]
    fn malformed_candidate_never_wins() {
        assert!(!is_newer_version("1.6.0", "not-a-version"));
    }
}
