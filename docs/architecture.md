# MD좋아 — 기술 스택 & 아키텍처

> 대상: 이 앱을 개발·유지보수하는 개발자. 최신화: 2026-06-15 (v1.3.0 기준).
> 관련 문서: `windows-strategy.md`, `windows-todo.md`, `source-repo-strategy.md`, `release-guide.md`, `security-audit.md`.

---

## 1. 개요
MD좋아는 **경량 Markdown 뷰어**다. agentic AI 개발자가 다수의 `.md`를 빠르게 열어 읽고,
AI가 고친 문서를 즉시 다시 보는 용도. 메인 타깃은 **Windows 10/11**, **macOS 동시 지원**,
**단일 코드베이스**로 양 OS를 함께 지원한다. 핵심 가치: 간편함·빠른 실행·신뢰성. 기능 과잉 금지.

설계 원칙:
- **콘텐츠 퍼스트 미니멀 UI** (상단 메뉴바 없음, 햄버거 + 우측 아이콘 몇 개).
- **오프라인·무텔레메트리** (유일한 네트워크 예외: 사용자 동의 시 pandoc 다운로드).
- **OS 분기는 한 곳에 격리** (프론트 `lib/platform.ts`, Rust `#[cfg(target_os)]`, 번들 설정).

---

## 2. 기술 스택
| 영역 | 채택 | 비고 |
|---|---|---|
| 앱 셸 | **Tauri 2.x** (Rust) | 크로스플랫폼 단일 코드베이스. WebView2(Win)/WKWebView(mac) |
| UI | **React 18 + TypeScript + Vite** | 함수형 컴포넌트, lazy/Suspense 코드 분할 |
| 상태관리 | **Zustand** | 단일 스토어 `src/store/app.ts` |
| 스타일 | **Tailwind CSS** + CSS 변수 테마 | 라이트/다크/시스템 |
| 아이콘 | **Lucide** (단일 세트) | |
| 폰트 | **Pretendard**(본문) / **JetBrains Mono**(코드) | woff2 동봉(`public/fonts`), OS 설치 무관 |
| Markdown | **markdown-it** (+footnote, +task-lists) | GFM 테이블/체크박스/각주 |
| 코드 하이라이팅 | **Shiki** (`bundle/full`, JS regex 엔진) | github-light/dark 테마 |
| 수식 | **KaTeX** | |
| 다이어그램 | **Mermaid** (`securityLevel: strict`) | 라이트 테마 `neutral` |
| 새니타이즈 | **DOMPurify** | `html:false` + 출력 새니타이즈 이중 방어 |
| 토큰 카운트 | **gpt-tokenizer** (o200k/cl100k) | lazy-load, 로컬 BPE, 네트워크 없음 |
| 문서 변환 | **pandoc** (DOCX) | 동의 시 다운로드, SHA-256 핀 검증 |

스택 변경은 사전 협의 대상(유지가 원칙). 한 OS 전용 의존성 추가 금지.

---

## 3. 아키텍처 한눈에
```
┌─────────────────────────── WebView (React/TS) ───────────────────────────┐
│  App.tsx  → AppShell (레이아웃/단축키/메뉴이벤트/드래그드롭/파일감시)      │
│   ├─ TopBar (창컨트롤·파일명·통계·테마)   ├─ Sidebar(FileTree/즐겨찾기/    │
│   ├─ MarkdownViewer / Editor / CompareView│      컨텍스트/게이지/목차/백링크)│
│   ├─ HamburgerMenu · CommandPalette(⌘K) · QuickOpen · FolderSearch        │
│   └─ Settings/About/ReviewCenter 모달                                     │
│  store/app.ts (Zustand) ── lib/* (순수 로직) ── hooks/*                    │
└───────────────────────────────┬───────────────────────────────────────────┘
                                 │  Tauri IPC (invoke / event)
┌───────────────────────────────┴─────────── Rust (src-tauri) ──────────────┐
│  lib.rs: 플러그인 등록 · 네이티브 메뉴 · single-instance · 파일연결 진입점 │
│  commands/*: file, settings, recent, favorites, bookmarks, context,        │
│              search, wikilink, window, pandoc, log                         │
│  플러그인: dialog, fs(watch), opener, window-state, single-instance        │
└────────────────────────────────────────────────────────────────────────────┘
```
**경계 원칙**: 파일 I/O·경로·OS 연동은 Rust(`std::path`/`PathBuf`), UI/렌더/상태는 프론트.
프론트는 경로 문자열만 다루며 분해는 `lib/pathUtil.ts`(양 구분자)로만 한다.

---

## 4. 디렉터리 구조 (요점)
```
src/
  App.tsx                  세션 복원 · 로깅 · 테마 · 멀티윈도우 진입
  store/app.ts             Zustand 단일 스토어(파일/폴더/설정/히스토리/비교/외부변경/리뷰…)
  components/
    layout/    AppShell, TopBar, HamburgerMenu
    viewer/    MarkdownViewer, Editor, CompareView
    sidebar/   FileTree, FavoritesSection, ContextSection, ContextGaugePanel,
               OutlinePanel, BacklinksPanel
    screens/   WelcomeScreen, SettingsModal, AboutModal, LicensesModal,
               QuickOpen, CommandPalette, ReviewCenter, FolderSearch
    ui/        Toast, ConversionIndicator        common/ ContextMenu
    ErrorBoundary.tsx
  lib/         markdown, mermaid, scrollSync, textDiff, lineDiff, editHistory,
               navHistory, externalChange, fsEventKind, fileWatch, newFile,
               editorScroll, tokenizer, contextTokens, contextPrompt, fuzzy,
               reviewDiff, pathUtil, platform, contextMenuItems, export, convert,
               textStats
  hooks/       useFileWatcher, useDragDrop, usePandocProgress
src-tauri/
  src/lib.rs, src/commands/*.rs
  tauri.conf.json + tauri.macos.conf.json(플랫폼 오버라이드)
  capabilities/default.json(권한), icons/, Info.plist(mac 문서타입)
```

---

## 5. 백엔드 커맨드 (Rust → invoke)
| 모듈 | 커맨드 | 책임 |
|---|---|---|
| file | read_file, write_file, file_exists, file_meta, list_dir, path_is_dir, toggle_task | 파일 읽기(인코딩 자동감지 chardetng)·**atomic write**·디렉터리 나열·체크박스 토글 |
| settings | load_settings, save_settings | appdata 로컬 JSON 설정 |
| recent | get/add/clear_recent_files | 최근 항목(없는 항목 자동 필터) |
| favorites | get/toggle/reorder/clear/set_favorites | 즐겨찾기 |
| bookmarks | get/toggle_bookmark | 문서 내 북마크 |
| context | scan_context_files | 폴더 내 컨텍스트 문서(글롭) 수집 |
| search | search_in_folder | 폴더 전체 내용 검색(상한 있음) |
| wikilink | resolve_wikilink, scan_backlinks | `[[..]]` 해석 · 백링크 스캔 |
| window | open_in_new_window, get_window_file | 얇은 멀티윈도우 |
| pandoc | pandoc_status/download/delete, convert_docx | DOCX 변환 엔진(다운로드 SHA-256 검증) |
| log | write_log, get_log_path | 오프라인 진단 로그(1MB 로테이션) |
| (lib.rs) | get_pending_open, rebuild_menu | 지연 오픈 경로 · 네이티브 메뉴 갱신 |

---

## 6. 핵심 흐름
- **파일 열기**: `openFile` → `read_file` → `currentContent` 세팅 → `MarkdownViewer`가 `renderMarkdown`(markdown-it+Shiki+KaTeX) → `renderMermaid`. 최근/북마크/백링크(지연)도 트리거.
- **렌더 파이프라인**(`lib/markdown.ts`): frontmatter 분리 → markdown-it → 헤딩 ID·목차 수집 → **DOMPurify 새니타이즈** → 코드펜스는 Shiki, 수식은 KaTeX. `buildMd`는 (baseDir,theme,hl)별 메모이즈.
- **외부 변경 감지**: `useFileWatcher`(tauri-plugin-fs watch) → `decideExternalChange`(보기/편집·dirty·자동리로드 조합) → 자동 리로드/배너/충돌/삭제 처리. 폴더 변경은 `fsEventKind`로 트리 배지(생성/수정/삭제).
- **토큰 카운트**: 먼저 문자/4 근사 → `tokenizer`(lazy BPE)로 정확값 교체. 1.5MB 초과 시 근사로 가드.
- **백링크 지연로딩**: 파일 전환 시 디바운스(600ms)+취소, 경로별 세션 캐시(이미 본 문서는 즉시).
- **멀티윈도우**: `open_in_new_window` → 보조 창은 세션 복원 없이 지정 파일만(`get_window_file`).
- **명령 팔레트(⌘K)** / **빠른 열기(⌘O)**: `lib/fuzzy` 공용 퍼지 검색.
- **AI 변경 리뷰**: 세션 기준선(`reviewBaseline`) ↔ 현재 디스크를 `lineDiff`로 비교.

---

## 7. 보안 / 신뢰성
- **CSP** 적용(`tauri.conf.json` security.csp): `default-src 'self'`, 스크립트 self만.
- **XSS 방어 이중화**: markdown-it `html:false` + 출력 **DOMPurify** 새니타이즈. Mermaid `securityLevel:strict`.
- **링크**: 웹/메일은 OS 기본 브라우저(opener), 그 외 내비게이션 차단.
- **무텔레메트리**: 네트워크 사용 없음(예외: 동의된 pandoc 다운로드, SHA-256 핀 검증).
- **atomic write**: 임시파일 → `rename` 교체(설정/즐겨찾기/체크박스). Windows rename 시맨틱 주의(windows-strategy §3.4).
- **크래시/메모리 가드**: 파일 25MB 상한, 토큰/렌더 상한, `ErrorBoundary`, 전역 에러·패닉 로깅.

---

## 8. 플랫폼 전략 (단일 코드베이스)
- **프론트 분기**: `lib/platform.ts`의 `isMac`/`isWindows`/`MOD_LABEL`/`showHwpxExport`만 사용. 컴포넌트에서 `navigator.platform` 직접 검사 금지.
- **Rust 분기**: `#[cfg(target_os="...")]` (예: pandoc 에셋·`CREATE_NO_WINDOW`, 메뉴 구성, 로그 경로).
- **번들 설정**: 공통 `tauri.conf.json` + `tauri.macos.conf.json`(mac 오버라이드: 타이틀바 등). Windows는 `bundle.windows`(NSIS perUser), 실행파일명 ASCII(`mainBinaryName: "mdjoa"`).
- **데이터 폴더**: `dirs::data_local_dir()` → mac `~/Library/Application Support/com.fusionsoft.mdjoa`, Windows `%LOCALAPPDATA%\com.fusionsoft.mdjoa`. 식별자는 ASCII만.

---

## 9. 빌드 / 배포
- **로컬**: `npm run release`(= 현재 OS 설치본). mac → `.dmg`/`.app`, Windows → `.exe`(NSIS). 자세히 `release-guide.md`.
- **CI**(`.github/workflows/build.yml`): push(main, feat/**)·PR·태그(v*)·수동 시 **windows-latest + macos-latest** 매트릭스에서 type-check+테스트+Tauri 빌드+아티팩트 업로드. `fail-fast:false`(양쪽 모두 확인), Windows를 릴리스 게이트 1급으로.
- **버전 일원화**: `package.json` / `Cargo.toml` / `tauri.conf.json` 동일 유지. SemVer, 릴리스 태그 `vX.Y.Z`.
- **PDF 내보내기**: 별도 변환 엔진 없이 `window.print()` → OS 인쇄 대화상자 → "PDF로 저장"(전용 print.css). 자체 PDF 렌더러는 용량/품질 손해라 미채택.

---

## 10. 성능 전략
- **시작 경량화**: 문서 렌더러(markdown-it/Shiki/KaTeX/DOMPurify)를 `lazy`로 분리 → 시작은 Welcome/사이드바만.
- **렌더 캐시**: `buildMd` 메모이즈, 토큰/백링크 결과 세션 캐시.
- **부하 분산**: 백링크 디바운스+취소, 폴더 검색/diff 줄 수 상한.
- (검토중) 무거운 문서 첫 표시 지연 — Shiki 동기 색칠을 first-paint 이후로 미루는 2단계 렌더.
