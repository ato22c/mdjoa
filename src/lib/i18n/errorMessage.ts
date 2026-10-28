// Rust 커맨드가 던지는 사용자 노출 에러를 로컬라이즈된 메시지로 변환한다.
//
// src-tauri/src/commands/*.rs의 사용자 노출 실패는 한글 문장이 아니라 안정적
// wire-format 코드를 반환한다: 파라미터가 없으면 "file_not_found", 있으면
// "code|arg1|arg2" 처럼 파이프로 구분한다(예: "file_too_large|12.3|10"). 이 코드
// 자체는 절대 화면에 그대로 노출되지 않아야 하며, 여기서 error.* 사전 키로 매핑해
// t()로 번역한 뒤 반환한다.
//
// 미지 코드(향후 추가된 Rust 에러, 또는 e.to_string()이 감싼 일반 std::io::Error 등
// 애초에 코드화되지 않은 것들)는 원문을 그대로 반환한다 — 크래시나 "undefined" 노출을
// 막는 안전한 폴백. 즉, 12개(+추가분) 확인된 에러만 변환 대상이고 나머지는 그대로 둔다.
import { t } from "./index";

// 코드 → error.* 사전 키.
const CODE_TO_KEY: Record<string, string> = {
  file_too_large: "error.fileTooLarge",
  source_not_found: "error.sourceNotFound",
  name_exists: "error.nameExists",
  item_not_found: "error.itemNotFound",
  untitled_dir_mismatch: "error.untitledDirMismatch",
  pandoc_unsupported_arch: "error.pandocUnsupportedArch",
  pandoc_unsupported_platform: "error.pandocUnsupportedPlatform",
  pandoc_checksum_not_pinned: "error.pandocChecksumNotPinned",
  pandoc_download_connect_failed: "error.pandocDownloadConnectFailed",
  pandoc_download_http_error: "error.pandocDownloadHttpError",
  pandoc_download_stream_error: "error.pandocDownloadStreamError",
  pandoc_checksum_mismatch: "error.pandocChecksumMismatch",
  pandoc_zip_extract_failed: "error.pandocZipExtractFailed",
  pandoc_binary_not_in_zip: "error.pandocBinaryNotInZip",
  pandoc_install_failed: "error.pandocInstallFailed",
  pandoc_engine_not_found: "error.pandocEngineNotFound",
  pandoc_exec_failed: "error.pandocExecFailed",
  pandoc_convert_failed: "error.pandocConvertFailed",
  translate_claude_not_found: "error.translateClaudeNotFound",
  translate_doc_too_long: "error.translateDocTooLong",
  translate_claude_spawn_failed: "error.translateClaudeSpawnFailed",
  translate_claude_wait_failed: "error.translateClaudeWaitFailed",
  translate_empty_result: "error.translateEmptyResult",
  translate_failed: "error.translateFailed",
  update_check_failed: "error.updateCheckFailed",
  update_header_failed: "error.updateHeaderFailed",
  update_builder_failed: "error.updateBuilderFailed",
};

// 코드별 위치 파라미터 이름(순서 = Rust 쪽 format!() 인자 순서와 반드시 일치).
// 코드가 없는 항목은 파라미터 없음(고정 문구).
const PARAM_NAMES: Record<string, string[]> = {
  file_too_large: ["size", "max"],
  pandoc_unsupported_arch: ["arch"],
  pandoc_download_connect_failed: ["err"],
  pandoc_download_http_error: ["status"],
  pandoc_download_stream_error: ["err"],
  pandoc_zip_extract_failed: ["err"],
  pandoc_install_failed: ["err"],
  pandoc_exec_failed: ["err"],
  pandoc_convert_failed: ["err"],
  translate_claude_spawn_failed: ["err"],
  translate_claude_wait_failed: ["err"],
  translate_failed: ["err"],
  update_check_failed: ["err"],
  update_header_failed: ["err"],
  update_builder_failed: ["err"],
};

/**
 * "code" 또는 "code|arg1|arg2" 형태의 Rust 에러 문자열을 현재 언어의 사용자 메시지로
 * 변환한다. 코드를 모르면 원문을 그대로 반환한다(그래스풀 폴백).
 */
export function errorMessage(raw: string): string {
  const s = String(raw);
  const sep = s.indexOf("|");
  const code = sep === -1 ? s : s.slice(0, sep);
  const key = CODE_TO_KEY[code];
  if (!key) return s;

  const names = PARAM_NAMES[code] ?? [];
  const params: Record<string, string> = {};
  if (names.length > 0 && sep !== -1) {
    let rest = s.slice(sep + 1);
    names.forEach((name, i) => {
      if (i === names.length - 1) {
        // 마지막 파라미터는 남은 문자열 전체를 그대로 받는다 — claude stderr 등
        // 자유 텍스트에 "|"가 섞여 있어도 잘리지 않는다.
        params[name] = rest;
        return;
      }
      const next = rest.indexOf("|");
      if (next === -1) {
        params[name] = rest;
        rest = "";
      } else {
        params[name] = rest.slice(0, next);
        rest = rest.slice(next + 1);
      }
    });
  }
  return t(key, params);
}
