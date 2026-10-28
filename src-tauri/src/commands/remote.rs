// Remote markdown open — only runs when a URL is typed directly into Quick Open.
//
// Network use here is a sanctioned exception to the no-network rule
// (CLAUDE.md 예외 3): the fetch happens ONLY on an explicit user-entered URL,
// never in the background. The document is saved into an appdata cache file
// (atomic write) and then flows through the normal local-file pipeline
// (viewer/TOC/recents all work unchanged). Re-opening the same URL overwrites
// the same cache file, so recents keep pointing at the fresh copy.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::command;

/// Refuse bodies larger than this — a "markdown document" cap, not a download
/// manager. Also guards a missing/lying Content-Length via streamed counting.
const MAX_BYTES: usize = 10 * 1024 * 1024;
const TIMEOUT_SECS: u64 = 15;

#[derive(Serialize)]
pub struct RemoteDoc {
    /// Absolute path of the cached copy (open this like any local file).
    pub path: String,
    /// Display file name of the cached copy.
    pub name: String,
}

/// Cache directory for fetched remote documents, inside our appdata. OS
/// branching isolated here (CLAUDE.md), mirroring file.rs::untitled_dir.
fn remote_cache_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    let dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Library")
        .join("Application Support")
        .join("com.fusionsoft.mdjoa")
        .join("remote-cache");
    #[cfg(not(target_os = "macos"))]
    let dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.fusionsoft.mdjoa")
        .join("remote-cache");
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// Stable cache file name for a URL: `<sanitized-stem>-<8-hex-of-sha256>.md`.
/// The hash makes the name unique per URL (so different URLs never collide)
/// and stable across opens (so re-fetching overwrites the same file).
fn cache_file_name(url: &str) -> String {
    // Last path segment, without query/fragment.
    let no_query = url.split(['?', '#']).next().unwrap_or(url);
    let last = no_query.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    // Strip a trailing .md/.markdown (re-appended below) and sanitize for
    // Windows-illegal characters; anything else non-ASCII-safe becomes '-'.
    let stem_raw = last
        .trim_end_matches(".md")
        .trim_end_matches(".markdown")
        .trim_end_matches(".MD");
    let mut stem: String = stem_raw
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '-' })
        .collect();
    stem.truncate(60); // keep paths short (Windows MAX_PATH headroom)
    if stem.is_empty() {
        stem = "remote".to_string();
    }
    let digest = Sha256::digest(url.as_bytes());
    let short: String = digest[..4].iter().map(|b| format!("{:02x}", b)).collect();
    format!("{stem}-{short}.md")
}

/// Download a markdown document from `url` into the remote cache and return
/// the cached file's path+name. http(s) only, 15s timeout, 10MB cap. The body
/// is decoded as UTF-8 (lossy) — markdown on the web is UTF-8 in practice.
#[command]
pub async fn open_remote_md(url: String) -> Result<RemoteDoc, String> {
    let url = url.trim().to_string();
    let lower = url.to_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("http:// 또는 https:// URL만 열 수 있습니다".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("mdjoa")
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("연결 실패: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("가져오기 실패 (HTTP {})", resp.status()));
    }
    if let Some(len) = resp.content_length() {
        if len as usize > MAX_BYTES {
            return Err("문서가 너무 큽니다 (10MB 초과)".to_string());
        }
    }

    // Stream with a hard byte cap — Content-Length may be absent or wrong.
    use futures_util::StreamExt;
    let mut buf: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("받는 중 오류: {e}"))?;
        if buf.len() + chunk.len() > MAX_BYTES {
            return Err("문서가 너무 큽니다 (10MB 초과)".to_string());
        }
        buf.extend_from_slice(&chunk);
    }
    let content = String::from_utf8_lossy(&buf);

    // Atomic write into the cache (tmp in the same dir → rename, like file.rs).
    let name = cache_file_name(&url);
    let dest = remote_cache_dir().join(&name);
    let tmp = dest.with_extension("md.tmp");
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| format!("저장 실패: {e}"))?;
    std::fs::rename(&tmp, &dest).map_err(|e| format!("저장 실패: {e}"))?;

    Ok(RemoteDoc {
        path: dest.to_string_lossy().into_owned(),
        name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_name_uses_last_segment_and_stable_hash() {
        let url = "https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md";
        let a = cache_file_name(url);
        let b = cache_file_name(url);
        assert_eq!(a, b, "same URL → same cache file");
        assert!(a.starts_with("command-"), "stem comes from the last segment: {a}");
        assert!(a.ends_with(".md"));
    }

    #[test]
    fn cache_name_differs_per_url() {
        let a = cache_file_name("https://example.com/a/README.md");
        let b = cache_file_name("https://example.com/b/README.md");
        assert_ne!(a, b, "same file name in different locations must not collide");
    }

    #[test]
    fn cache_name_handles_query_fragment_and_empty_segment() {
        let a = cache_file_name("https://example.com/docs/guide.md?token=x#top");
        assert!(a.starts_with("guide-"), "{a}");
        let b = cache_file_name("https://example.com/");
        assert!(b.starts_with("remote-") || b.starts_with("example"), "{b}");
        assert!(b.ends_with(".md"));
    }

    // Needs network, so excluded from default runs — run manually with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn fetches_real_url_into_cache() {
        let url = "https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md";
        let doc = tauri::async_runtime::block_on(open_remote_md(url.to_string())).unwrap();
        let content = std::fs::read_to_string(&doc.path).unwrap();
        assert!(!content.is_empty(), "downloaded content is non-empty");
        assert!(doc.name.starts_with("command-") && doc.name.ends_with(".md"), "{}", doc.name);
        // Re-fetch → same cache path (stable per-URL name).
        let doc2 = tauri::async_runtime::block_on(open_remote_md(url.to_string())).unwrap();
        assert_eq!(doc.path, doc2.path);
    }

    #[test]
    fn cache_name_sanitizes_illegal_chars() {
        let a = cache_file_name("https://example.com/we%20ird:na*me.md");
        // Windows-illegal characters must be gone.
        for c in ['<', '>', ':', '"', '/', '\\', '|', '?', '*'] {
            assert!(!a.contains(c), "illegal char {c:?} in {a}");
        }
    }
}
