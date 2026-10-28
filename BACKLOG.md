# 📋 Project Backlog
<!-- Last updated: 2026-10-28 -->

| Total | 📋 Todo | 🔄 In Progress | ✅ Done | ❌ Cancelled |
|-------|---------|----------------|---------|-------------|
| 14    | 5       | 0              | 9       | 0           |

## 🏃 Sprint Backlog
*활성 스프린트 없음*

---

## 📝 Backlog Items


### [BL-016] 한국어 코드 주석 영어 번역 (공개 전)
- **Status**: 📋 Todo  |  **Priority**: Should Have  |  **Effort**: ~4h
- **Category**: Chore  |  **Assignee**: TBD  |  **Dependencies**: 없음
- **Created**: 2026-10-28  |  **Updated**: 2026-10-28

**Description**: 오픈소스 공개 시 외부 기여자가 읽을 수 있도록 한국어 주석을 영어로 바꾼다.
2026-10-28 측정: 한국어 주석 줄 약 870개(TS/TSX 717줄·67파일, Rust 150줄·11파일), 전체
코드 약 21,800줄 중 약 4%. i18n 문자열(ko.ts 등)은 UI 텍스트라 번역 대상 아님.
핵심 모듈(`src/lib/`, `src-tauri/src/commands/`)부터 진행. 동작 변경 없이 주석만 수정.

### [BL-015] README 영어 메인 + 한국어 분리 (README.ko.md)
- **Status**: 📋 Todo  |  **Priority**: Should Have  |  **Effort**: ~2h
- **Category**: Chore  |  **Assignee**: TBD  |  **Dependencies**: 없음
- **Created**: 2026-10-28  |  **Updated**: 2026-10-28

**Description**: 공개 레포 첫 화면인 `README.md`를 영어로 작성하고, 한국어판은 `README.ko.md`로
분리해 상호 링크한다. 내용: 소개, 스크린샷, 설치(GitHub Releases/winget), 기능, 라이선스(MIT),
이슈 제보 방법(진단 로그 첨부). 사내·유료 표현은 넣지 않는다.

### [BL-014] 오픈소스 공개용 간단 랜딩 페이지 (GitHub Pages)
- **Status**: 📋 Todo  |  **Priority**: Should Have  |  **Effort**: ~3h
- **Category**: Feature  |  **Assignee**: TBD  |  **Dependencies**: 없음 (공개 릴리스 전 완료 권장)
- **Created**: 2026-10-28  |  **Updated**: 2026-10-28

**Description**: MIT 오픈소스 공개(GitHub Releases 배포)에 맞춰 제품 소개·다운로드 안내용
단일 페이지를 만든다. GitHub Pages로 무료 호스팅. 기존 `docs/landing-page-plan.md`와
`demo/landing/` 시안을 재활용한다.

**Sub-tasks**:
- [ ] BL-014-1: 기존 시안(`demo/landing/`) 중 사용할 안 선택, 사내·유료 표현 제거
- [ ] BL-014-2: 핵심 소개(기능 3~4개, 스크린샷/GIF), 다운로드 버튼(GitHub Releases 최신 링크)
- [ ] BL-014-3: 한국어/영어 문구, 라이선스(MIT)·개인정보 방침 링크
- [ ] BL-014-4: GitHub Pages 배포 설정 및 공개 URL 확인

### [BL-012] 편집 모드에서 편집 중에도 목차(TOC)가 실시간 갱신되게 하기
- **Status**: ✅ Done  |  **Priority**: Should Have  |  **Effort**: ~1h
- **Category**: Enhancement  |  **Assignee**: —  |  **Dependencies**: none
- **Created**: 2026-07-09 (사용자 추가항목, 미분류 상태였음)  |  **Updated**: 2026-08-10

**Description**: 편집 모드 진입 시 `MarkdownViewer`(목차 추출 담당)가 렌더링 트리에서 빠지기 때문에,
`store.headings`가 편집모드 진입 시점 값으로 멈춰 있었음. 저장하거나 편집모드를 나가야만 목차가
갱신됨(`src/store/app.ts`의 `setEditContent`은 `headings`를 건드리지 않고, `Editor.tsx`의 자체
미리보기 렌더는 `headings`를 버렸음).

**결과**: `Editor.tsx`의 분할 미리보기 렌더 이펙트를 `isMd`이면 항상 실행하도록 바꾸고(기존엔
`split && isMd`일 때만), `renderMarkdown()`이 계산해서 버리던 `headings`를 `setHeadings()`로
스토어에 반영. 분할이 꺼져있을 땐 `{ highlight: false }`로 Shiki 색칠 없이 가벼운 파싱만 수행.
`tsc`/`eslint`/`vitest`(316개) 통과, 실기 확인 완료(편집 중 헤딩 타이핑 → 목차 즉시 갱신).

### [BL-001] 변경 내용 확인 창에서 이전/현재 문서가 좌우로 안 보임
- **Status**: ✅ Done  |  **Priority**: Should Have  |  **Effort**: 2h
- **Category**: Bug  |  **Assignee**: —  |  **Dependencies**: none
- **Created**: 2026-06-23  |  **Updated**: 2026-06-26

**Description**: 문서 변경 내용을 확인하는 창(변경 비교/diff 뷰)에서 **이전 문서와 지금 문서가 나란히(좌우)** 보여야 하는데, 실제로는 그렇게 표시되지 않는 것으로 보임. 재현 경로·현재 표시 형태 확인 후, 좌우 2-pane(side-by-side) 비교가 의도대로 나오도록 수정. 관련 추정 위치: `src/components/screens/ReviewCenter.tsx`, `src/components/viewer/CompareView.tsx`, `src/lib/lineDiff.ts`/`textDiff.ts`.

**결과**: 원인은 버그가 아니라 설계 불일치 — 변경 리뷰(ReviewCenter)·비교(CompareView)가 git식 단일 컬럼(통합) diff였음. `lineDiff` 결과를 좌우 행으로 짝짓는 순수 헬퍼 `toSideBySideRows`를 추가하고(테스트 5개), **변경 리뷰**의 우측을 좌우 2-pane(왼쪽=이전 / 오른쪽=현재)으로 교체. context 줄 구분 위해 "이전 | 현재" 컬럼 헤더 추가. CompareView는 범위 외(이번엔 변경 리뷰만). 실기 검증 완료.

### [BL-002] PDF · HTML 파일 열어보기
- **Status**: ✅ Done  |  **Priority**: Should Have  |  **Effort**: ~3h
- **Category**: Feature  |  **Assignee**: —  |  **Dependencies**: none
- **Created**: 2026-06-25  |  **Updated**: 2026-06-26

**Description**: `.pdf`·`.html`/`.htm` 파일을 앱에서 **렌더된 화면**으로 열어보는 기능.
새 `FrameViewer`(iframe + `convertFileSrc`)로 PDF(웹뷰 네이티브)·HTML(브라우저처럼) 렌더.
v1.4.0에 릴리즈: iframe sandbox 보안, HTML 인코딩 자동 감지(chardetng·Blob URL), 파일 열기 HTML 필터.

### [BL-004] 파일 열기 다이얼로그 기본 필터 MD·HTML 통합
- **Status**: ✅ Done  |  **Priority**: Nice to Have  |  **Effort**: 0.5h
- **Category**: Enhancement  |  **Assignee**: —  |  **Dependencies**: BL-002
- **Created**: 2026-06-30  |  **Updated**: 2026-06-30

**Description**: 파일 열기 다이얼로그의 첫 번째(기본) 필터를 "마크다운 · HTML"로 통합해
`.md`/`.markdown`/`.html`/`.htm`을 한 번에 선택할 수 있게 합니다.
기존엔 MD 전용 필터가 기본이고 HTML은 별도 필터로 분리되어 있었습니다.

**결과**: `OPEN_DIALOG_FILTERS` 상수의 첫 번째 항목을 "마크다운 · HTML"로 변경.
`WelcomeScreen`, `CommandPalette` 등 하드코딩된 필터를 모두 이 상수로 통일. 테스트 갱신 완료.

### [BL-005] 편집 모드 첫 진입 시 분할 보기 기본값
- **Status**: ✅ Done  |  **Priority**: Nice to Have  |  **Effort**: 0.5h
- **Category**: Enhancement  |  **Assignee**: —  |  **Dependencies**: none
- **Created**: 2026-06-30  |  **Updated**: 2026-06-30

**Description**: `Ctrl+E`로 편집 모드에 처음 진입할 때 분할 화면(편집+미리보기)이 기본으로
열리도록 합니다. 기존엔 단독 편집 화면이 기본이었고 사용자가 수동으로 분할 버튼을 눌러야 했습니다.

**결과**: `Editor.tsx`의 `split` 초기값을 `false` → `true`로 변경.
분할 구현(스크롤 동기화·150ms 디바운스 미리보기·줄 번호 거터)은 이미 완성 상태였으므로
한 줄 변경으로 완료. "편집만" 버튼으로 언제든 단독 편집 화면으로 토글 가능.

### [BL-006] Windows 탐색기 더블클릭 — 앱 첫 실행 시 잘못된 파일 열리는 버그
- **Status**: ✅ Done  |  **Priority**: Must Have  |  **Effort**: 2h
- **Category**: Bug  |  **Assignee**: —  |  **Dependencies**: none
- **Created**: 2026-06-30  |  **Updated**: 2026-06-30

**Description**: MD좋아가 닫혀 있을 때 Windows 탐색기에서 `.md` 파일을 더블클릭하면,
해당 파일이 아닌 **마지막으로 열었던 파일**이 열리는 버그. Windows 11에서 100% 재현.

**원인**: `single-instance` 플러그인의 `init` 콜백은 앱이 이미 실행 중일 때 두 번째 인스턴스에서만
실행됨 — 첫 실행(앱 종료 상태에서 열기)에는 동작하지 않음. `setup` 훅에서 `argv[1]`을 읽지 않아
전달된 파일 경로가 유실되고, 세션 복원 로직이 마지막 파일을 열었음.

**결과**: `src-tauri/src/lib.rs`의 `setup` 훅에 `#[cfg(target_os = "windows")]` 블록 추가.
`std::env::args()`로 `argv[1]`을 읽어 플래그(`-`로 시작)가 아닌 경우 `PendingOpen`에 저장.
`App.tsx`의 `get_pending_open` 로직이 이 값을 읽어 세션 복원보다 우선 처리.

### [BL-003] macOS WKWebView PDF 렌더 확인
- **Status**: ✅ Done  |  **Priority**: Should Have  |  **Effort**: 1h
- **Category**: Validation  |  **Assignee**: —  |  **Dependencies**: BL-002
- **Created**: 2026-06-26  |  **Updated**: 2026-06-26

**Description**: macOS에서 WKWebView가 PDF를 올바르게 렌더하는지 실기기 확인 필요.
빈 화면이 나오면 PDF.js 도입을 협의(새 의존성 추가).

**결과**: 실기 확인 결과 빈 화면의 원인은 iframe의 `sandbox="allow-same-origin"`이었음
— WKWebView는 sandbox iframe 안에서 네이티브 PDF 뷰어를 띄우지 못함. PDF는 정적
데이터(스크립트 위험 없음)라 PDF일 때만 sandbox를 제거(HTML은 유지)해 해결.
한글은 폰트가 임베드된 PDF면 정상 렌더(`??`는 라틴 전용 폰트로 한글을 그린 테스트
픽스처 결함이었음). PDF.js 도입 불필요. 픽스처 `test-fixtures/korean-sample.pdf` 추가.

### [BL-007] AI 문서 작업(검토·개선·요점정리) 후속 확장
- **Status**: 📋 Todo  |  **Priority**: Nice to Have  |  **Effort**: TBD
- **Category**: Feature  |  **Assignee**: —  |  **Dependencies**: AI 문서 작업 v1 (검토·개선·요점정리)
- **Created**: 2026-07-03  |  **Updated**: 2026-07-04

**Description**: "AI 문서 작업 v1"(검토·개선·요점정리를 로컬 claude CLI로 수행, 분할창 표시 —
설계: `docs/superpowers/specs/2026-07-03-ai-document-tasks-design.md`)에서 **범위 밖으로 미룬 확장**을
모아 둔다. v1이 안정화된 뒤 필요에 따라 착수.

- **검토 지적사항 자동 적용**: 검토(읽기 전용 지적)에서 나온 개선점을 사용자가 골라 문서에 바로 반영.
  (v1은 읽기 전용 코멘트만 — 고치는 건 '개선'이 담당.)
- **커스텀 프롬프트**: 정해진 3작업 외에, 사용자가 문서에 대해 임의 지시를 직접 입력해 실행.
- **긴 문서 분할 요약(map-reduce)**: v1은 약 28,000자 초과 시 명확히 막음(한 번에 호출 제약).
  긴 스펙/기획서를 청크로 나눠 부분 요약 → 통합 요약하는 map-reduce 파이프라인.
- ~~**UI 문자열 i18n화**~~ — ✅ 완료(2026-07-04, `feat/i18n`). `main`을 `feat/i18n`으로 병합하며
  스윕 범위를 확장: `AiTask.label` → `labelKey`(i18n 키)로 전환, `aiTasks.ts`/`TaskView.tsx`/
  `HamburgerMenu.tsx`의 "AI 작업" 서브메뉴/`TranslationIndicator.tsx`/`TopBar.tsx`·
  `MarkdownViewer.tsx`의 번역 항목 모두 `t()`/`useT()` 기반으로 전환. Rust `run_claude` 에러도
  코드(wire-format)화해 프런트에서 언어별로 표시.

### [BL-008] Claude CLI 기반 AI 작업 속도 개선
- **Status**: 📋 Todo  |  **Priority**: Should Have  |  **Effort**: TBD
- **Category**: Enhancement  |  **Assignee**: —  |  **Dependencies**: AI 문서 작업 v1(BL-007과 동일 기반)
- **Created**: 2026-07-03  |  **Updated**: 2026-07-03

**Description**: 검토·개선·요점정리·번역(한/영) 5개 작업 전부가 이제 `src-tauri/src/commands/translate.rs`의
`run_claude`(로컬 `claude` CLI 서브프로세스 호출) 한 경로를 공유한다(`src/lib/aiTasks.ts`). 원래
번역 전용으로 파악됐던 속도 이슈(`docs/ai-dev-features-v2.md` §6 항목 K)가 이제 **5개 작업 전부에 적용되는
공통 병목**이 됐다 — 호출마다(청크 포함) 수 초의 CLI 프로세스 기동 비용이 그대로 든다.

**추가 고려사항(단일 실행기 통합 이후 새로 드러남)**:
- **단일 호출 작업(검토·개선·요점정리)은 진행 표시가 전혀 없다.** 번역(청크 작업)은 청크별 부분 결과를
  `updateTaskContent`로 점진 표시하지만, 단일 호출 작업은 응답이 통째로 올 때까지 스피너만 보인다 —
  체감 대기가 더 크다.
- **모델 선택도 속도에 영향**: 번역=`haiku`(빠름), 검토·개선·요점정리=`sonnet`(느리지만 품질 우선).
  속도 개선 시 이 모델 선택 트레이드오프도 같이 고려.
- **캐시는 이미 있음**(Rust `run_claude`가 `hash(prompt+model)`로 동일 요청 즉시 반환) — 후보에서 제외.

**후보(원 K 항목에서 이관·갱신)**:
(a) Anthropic HTTP API 직접 호출(기동 비용 0·스트리밍 가능·모든 5작업에 적용 가능, 단 API 키·소액 과금 필요 —
  CLAUDE.md의 "기존 로그인 사용, 별도 과금 없음" 원칙과 충돌하므로 **정책 결정 선행 필수**)
(b) claude 1회 기동으로 여러 청크 처리(번역 전용, chunked 작업에만 해당)
(c) 단일 호출 작업(검토·개선·요점정리)에도 부분 진행 표시 추가 — CLI 스트리밍 출력을 파싱해 점진 표시
(d) 동시성·청크 크기 튜닝(번역 전용, 현재 `CONCURRENCY=4`)
(e) DeepL 등 전용 번역 API(번역에만 적용 가능, 가장 빠르지만 외부 전송 — 검토/개선/요점정리는 대상 아님)

### [BL-009] 소스 파일 편집 경험 개선(신택스 하이라이팅·현재 줄 강조·버튼 통일)
- **Status**: ✅ Done  |  **Priority**: Should Have  |  **Effort**: ~4h
- **Category**: Enhancement  |  **Assignee**: —  |  **Dependencies**: none
- **Created**: 2026-07-04  |  **Updated**: 2026-07-04

**Description**: 마크다운이 아닌 소스/코드 파일의 편집 경험을 마크다운 수준으로 끌어올림.
사용자 요청("분할창 불필요 + 신택스 컬러링 가능?", "라인 수 표시 + VS Code 느낌", "버튼 크기 통일")
3건을 이어서 처리.

**결과**:
- 소스 파일은 편집 모드에서 분할 미리보기를 띄우지 않음(렌더링 대상 없어 의미 없었음).
- 실시간 신택스 하이라이팅 추가 — 투명 `textarea` + Shiki 색칠 배경 겹치기 방식
  (`highlightCodeToHtml()` 신설, `src/lib/markdown.ts`).
- **발견·수정한 버그 2건**: (1) 하이라이트 배경을 줄바꿈(`pre-wrap`)으로 만들었더니 긴 줄에서
  텍스트 정렬이 깨짐 → 원인은 textarea 네이티브 줄바꿈과 CSS Text 줄바꿈 알고리즘이 스크롤바
  유무에 따라 다른 지점에서 끊기는 것 → 줄바꿈 자체를 없애고(가로 스크롤) 근본 해결.
  (2) 그 과정에서 줄 번호 거터가 코드 파일에서 위치를 잘못 계산하던 기존 버그(줄바꿈 하드코딩)도
  발견해 같이 수정.
- 현재 줄 강조(거터 숫자 굵게 + 본문 옅은 배경) 추가.
- `Editor.tsx`/`TaskView.tsx`의 편집·저장·보기 버튼 크기 불일치 수정(CSS 레이어 우선순위로
  Tailwind 클래스가 죽어있던 문제 포함).
- (부수 발견) 목차 패널이 소스 파일 전환 시 이전 파일 목차를 그대로 보여주던 버그도 같이 수정.

검증: 매 커밋 tsc/eslint/vitest(305개) 통과. 정렬 버그는 실제 Shiki HTML로 정적 페이지를 만들어
playwright 스크린샷으로 재현·수정·재검증.

**비용/외부 전송 허용 범위 결정 후 방향 확정.** 관련: `src/lib/aiTasks.ts`(`runClaude`/`runDocumentTask`/
`runChunkedTask`), `src-tauri/src/commands/translate.rs`(`run_claude`).

**제외(백로그 아님)**: **비용($) 표시** — 가격 변동·텔레메트리 인상으로 제품 정체성과 충돌
(`docs/ai-dev-features-v2.md` §D에 "비용 추정 넣지 않음" 명시). 후속 대상이 아니라 의도적 비목표.

### [BL-010] 브랜드명 언어별 분리(한국어 "MD좋아" / 그 외 "MDjoa")
- **Status**: ✅ Done  |  **Priority**: Nice to Have  |  **Effort**: ~3h
- **Category**: Enhancement  |  **Assignee**: —  |  **Dependencies**: i18n 인프라(`src/lib/i18n/`)
- **Created**: 2026-07-04  |  **Updated**: 2026-07-04

**Description**: 사용자 요청 — 한국어 이외 환경에서는 앱명이 "MDjoa"로 보이게(설치되는 앱명·
사용자 매뉴얼·UI 내부). 이어서 설치 앱명도 macOS·Windows 둘 다 반영, 그리고 작업표시줄/Alt-Tab에
쓰이는 네이티브 창 타이틀도 반영 요청.

**결과**:
- **UI**: `src/lib/i18n/en.ts`의 `brandSuffix`("좋아"→"joa")와 About·메뉴·툴팁 문자열을 "MDjoa"로
  교체. 기존 i18n 파이프라인(`t()`/`rebuild_menu`)을 그대로 타서 별도 배선 불필요.
- **영문 사용자 매뉴얼**(`docs/user-manual.en.md`): "MD좋아" → "MDjoa" 전체 치환.
- **macOS 설치 앱명**: `Info.plist`에 `CFBundleDisplayName` 추가 + `en.lproj`/`ko.lproj`의
  `InfoPlist.strings`로 지역화(Finder·Spotlight 표시명). Apple 표준 메커니즘이라 코드 없이
  리소스 파일만으로 해결. 실제 `tauri build`로 번들 내 배치 확인.
- **Windows 설치 앱명**: `src-tauri/windows/installer-hooks.nsh`(NSIS `installerHooks`)로 설치
  언어가 한국어가 아니면 프로그램 추가/제거 표시명 + 기본 시작 메뉴 바로가기를 "MDjoa"로 재작성.
  바탕화면 바로가기 체크박스(설치 마법사 마지막 페이지)는 `.onGUIEnd`로 별도 처리 — Tauri 기본
  템플릿의 `${PRODUCTNAME}` 등 정의가 훅 파일의 이른 `!include` 시점엔 아직 존재하지 않아 그대로
  참조하면 조용히 깨지는 문제를 발견해, `POSTINSTALL` 단계에서 변수에 미리 담아두는 방식으로
  우회. **Homebrew로 `makensis`를 설치해 Tauri 실제 업스트림 템플릿과 조합한 컴파일 테스트로
  검증**(경고/에러 0) — 실제 Windows 설치는 아직 미검증.
- **네이티브 창 타이틀**(Windows 작업표시줄 툴팁·Alt-Tab): `getCurrentWindow().setTitle()`을
  언어 변경 이펙트에 연결(`src/lib/menuLabels.ts`의 `syncWindowTitle`, `App.tsx`). `core:window:
  allow-set-title` 권한 추가. 개발 빌드로 실행해 macOS에서 실제 창 타이틀이 "MDjoa"로 바뀌는 것
  System Events로 라이브 확인.
- **제외**: 업그레이드 설치 시 바로가기 재생성(템플릿이 업데이트 모드에서 건너뜀), 바탕화면
  바로가기의 AppUserModelId(같은 이른-참조 문제, `${BUNDLEID}` 필요) — 둘 다 커스텀 `.nsi`
  템플릿 전체를 새로 짜야 해서 범위 밖으로 남김.

검증: vitest 305개·tsc·eslint(신규 경고 0) 통과. 커밋: `c37ceb6`.
