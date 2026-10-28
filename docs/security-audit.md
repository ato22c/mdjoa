# 보안 점검 (Security Audit)

> 최종 점검: 2026-10-28 · 결과: 프론트 **low 2건(수용)**, 백엔드 **취약점 0건**(경고 3건 수용, 아래 §2)

이 문서는 MD좋아의 보안 점검 범위·결과·재현 방법을 정리한다. 시큐어 코딩 기반과
공급망(의존성) 취약점 양쪽을 다룬다.

## 1. 시큐어 코딩 (코드 레벨)

| 영역 | 상태 | 근거 |
|---|---|---|
| XSS (Markdown→HTML) | ✅ | markdown-it `html:false` + **DOMPurify 정화**(script/iframe/object/embed/form 금지, `on*` 금지, `ALLOW_DATA_ATTR:false`+명시 허용, 스킴 화이트리스트). frontmatter는 `escapeHtml`. KaTeX 출력도 정화 통과. (`lib/markdown.ts`) |
| HTML 주입 sink | ✅ | `dangerouslySetInnerHTML` 2곳 모두 정화된 renderMarkdown 출력. 엔티티 디코딩은 분리된 `<textarea>`(스크립트 미실행). Mermaid는 `securityLevel:"strict"`. |
| 링크/외부 열기 | ✅ | `http(s)`/`mailto`만 `openUrl` 전달 — `javascript:`/`file:` 차단. (`MarkdownViewer`) |
| CSP | ✅ | `script-src 'self'`(인라인·eval 금지), img `self/asset:/data:`만. (`tauri.conf.json`) |
| 공급망(pandoc 다운로드) | ✅ | 하드코딩 HTTPS GitHub URL + **SHA-256 핀 검증 후 설치**, 셸 미사용, 동의 게이트. (`commands/pandoc.rs`) |
| 명령 주입 | ✅ | `std::process` 인자 방식(셸 없음), 경로는 `PathBuf`/`std::path`. |
| 경로 탈출 | ✅ | 위키링크/검색은 **폴더 내 파일명 검색**(경로 조인 아님) + 깊이·파일수 상한. |
| 네트워크/텔레메트리 | ✅ | 웹뷰 `default-src 'self'`로 외부 통신 차단. 텔레메트리 없음. 네트워크는 사용자 동작·동의 기반만: pandoc 다운로드, 원격 MD URL 1회 GET, 자동 업데이트 확인(기본 GitHub Releases), AI 작업(로컬 `claude` CLI). 전부 Rust 쪽에서만 수행. |
| 비밀정보 | ✅ | 커밋 이력 382개 전수 검사: `glpat-` 토큰·비밀번호·API 키 패턴 0건. `MDJOA_UPDATE_TOKEN`은 빌드 시 환경변수 이름만 이력에 있음(값 없음). 서명 개인키는 레포 밖. |
| 사내 주소 | ✅ | 소스에서 제거. 업데이트 엔드포인트 기본값은 공개 GitHub Releases, 사내 빌드는 `MDJOA_UPDATE_ENDPOINT` 환경변수로 주입. 배포 스크립트는 비공개 레포로 이동. (과거 커밋 17개에는 주소 잔존 → 공개 시 새 레포로 이력 정리) |
| 크래시/무결성 | ✅ | atomic write, Rust 커맨드 `Result`(무패닉), ErrorBoundary, 파일 25MB·토큰·렌더 상한(DoS/OOM 가드). |

## 2. 공급망 (의존성 CVE)

### 프론트엔드 — `npm audit`
```
npm audit --omit=dev   →  2 low (katex → mermaid 전이)
```
- 2026-10-28: `npm audit fix`로 DOMPurify(critical)·linkify-it·markdown-it 등 해소.
- 잔여 low 2건: katex 프로토타입 오염의 trust 우회. 해결책이 breaking(katex 0.19)이라 **수용** — 신뢰 불가 입력은 DOMPurify 정화를 거치고 `trust` 옵션을 쓰지 않음. mermaid 갱신 시 재검토.

### 백엔드 — `cargo audit`
```
cargo install cargo-audit --locked
cd src-tauri && cargo audit   →  취약점 0건 (2026-10-28)
```
- 2026-10-28 재실행: 취약점 0건, `unmaintained` 경고 3건(zbus_names·zvariant·zvariant_derive, RUSTSEC-2026-0370~0372)은 Linux D-Bus 전이 의존이라 Windows·macOS 빌드에는 영향이 없어 수용.
- 과거 출력의 17건은 모두 **`unmaintained`/`unsound` 정보성 경고**이며 취약점이 아니다.
- 거의 전부 **Tauri 2의 Linux/GTK3 백엔드 전이 의존**(atk/gdk/gtk/glib 등) + 빌드 매크로(`proc-macro-error`) + 유니코드 테이블(`unic-*`). 본 앱 주 타깃(Windows·macOS)에선 GTK 크레이트가 런타임에 쓰이지 않으며, 업스트림(Tauri/gtk-rs gtk4 이전)이 갱신되면 해소된다.
- 이 17건은 검토 후 **수용(accepted)** 으로 `src-tauri/.cargo/audit.toml`의 `ignore`에 등록 → 이후 `cargo audit`은 **새로운 실제 취약점이 생길 때만 실패**(CI 게이트로 사용 가능).

## 3. 재현 / 정기 점검

```bash
# 프론트
npm audit --omit=dev

# 백엔드 (cargo-audit 미설치 시 1회 설치)
cargo install cargo-audit --locked
cd src-tauri && cargo audit
```

권장 주기: **분기마다 + Tauri/주요 의존성 메이저 업데이트 시**. 수용 권고 목록은
`src-tauri/.cargo/audit.toml`에서 재검토하고, GTK 경고가 사라지면 항목을 제거한다.
