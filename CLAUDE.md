# MD좋아 프로젝트 규칙

## 프로젝트 개요
경량 Markdown 뷰어. 사내 배포용. agentic AI 개발자가 다수의 MD 문서를
읽고·빠르게 열고·AI가 수정한 문서를 즉시 갱신해 보는 용도.
- **메인 타깃: Windows 10/11** (사용자 다수가 Windows)
- **동시 지원: macOS** (Apple Silicon 우선, Intel 호환). 현재 개발·빌드 환경.
- **단일 코드베이스로 두 OS를 함께 지원**한다. 한쪽만을 위한 코드 분리·중복 금지.
- 현재 개발/빌드는 macOS에서 하되, **Windows 동작을 1급으로** 보장(아래 플랫폼·소스 관리 참조).
핵심 가치: 간편함, 빠른 실행, 신뢰성. 기능 과잉 금지.

## 제품 정보
- 제품 표시명: 한국어 UI에서는 MD좋아, 그 외 언어(영어)에서는 MDjoa.
  UI 내 문자열은 i18n(src/lib/i18n/ko.ts·en.ts의 brandSuffix·about·appMenu 등)로 언어별 전환.
  설치된 앱 이름도 macOS(Info.plist CFBundleDisplayName, ko.lproj/en.lproj 지역화)·
  Windows(NSIS installerHooks, src-tauri/windows/installer-hooks.nsh)에서 설치 언어 기준으로 전환.
  네이티브 창 타이틀(Windows 작업표시줄 툴팁·Alt-Tab에 노출)도 언어 변경 시
  getCurrentWindow().setTitle()로 갱신(src/lib/menuLabels.ts의 syncWindowTitle,
  App.tsx의 settings.language 이펙트에서 호출). tauri.conf.json의 app.windows[].title은
  그 값이 나타나기 전(창 생성 시점) 초기값일 뿐.
- 내부 식별자: mdjoa / 번들 ID: com.fusionsoft.mdjoa
  (패키지명, 실행 파일명, 설정 폴더명 등 코드/경로 레벨은 ASCII만 사용
  — 한글 경로 호환성 문제 방지. 표시명만 한글 "MD좋아")
- 저작권·라이선스: Copyright © 2026 sy.baek@fusionsoft.co.kr. Licensed under the MIT License.
  → About 화면과 인스톨러 메타데이터에 표기

## 기술 스택 (변경 시 사전 협의 — 유지가 원칙)
- Tauri 2.x + React 18 + TypeScript + Vite  ← 크로스플랫폼 단일 코드베이스의 근거
- Markdown: markdown-it (GFM 테이블/체크박스/각주 플러그인)
- 코드 하이라이팅: Shiki
- 상태 관리: Zustand / 스타일: Tailwind CSS
- 아이콘: Lucide 단일 세트
- 토큰 카운트: gpt-tokenizer(o200k/cl100k) lazy-load — 로컬 BPE
- 위 스택은 **Windows·macOS 모두에서 동일하게 동작**하는 것만 채택. 한 OS 전용 의존성 추가 금지.

## 명령어
```bash
npm run dev        # 웹 프리뷰(Vite) — UI 빠른 확인
npm run dev:win    # Tauri 데스크톱 앱 실행(네이티브 검증)
npm test           # vitest run (단위 테스트)
npm run build      # 라이선스 생성 + tsc + vite build
npm run lint       # eslint
npm run release    # 버전 일괄 bump + 릴리스
```

## UI 디자인 원칙: "콘텐츠 퍼스트 미니멀" (Typora 계열)
- 본문이 주인공. UI 크롬 최소화. 상단 메뉴바 없음
  → 좌측 상단 햄버거 메뉴 + 우측 상단 아이콘 3~4개만
- 본문 폭 720~760px 중앙 정렬, 줄간격 1.7, 기본 16px
- 폰트: Pretendard(본문, 동봉) / JetBrains Mono(코드, 동봉)
- 라이트: 배경 #FAFAF8, 텍스트 #1F1F1F
- 다크: 배경 #1E1E20, 텍스트 #E8E8E6
- 포인트 컬러 1개만. 그림자/애니메이션 최소(트랜지션 150ms 이하)
- 잘 만든 문서처럼 보이는 것이 목표. 장식 금지

## 코드 품질 원칙
- 모든 파일 I/O는 atomic write(임시 파일 → 교체)
- 예외 발생 시 앱이 죽지 않고 에러 토스트 + 로그 파일 기록
- 핵심 로직(파일 감지, 변환, 설정 저장)은 단위 테스트 작성
- 설정은 appdata 로컬 JSON. 외부 접속은 아래 기능에서만 허용
  (예외 1: v1.1의 pandoc 다운로드, 사용자 동의 시에만.
   예외 2: AI 문서 작업(번역·검토·개선·요점정리 등) — 사용자가 메뉴에서 직접 트리거할 때만
   로컬 `claude` CLI를 통해 Anthropic과 통신. 백그라운드 호출 없음, 별도 과금 없음(기존 로그인 사용).
   작업 정의는 src/lib/aiTasks.ts 레지스트리에 있으며, 새 작업 추가 시 이 예외 범위에 포함된다.
   예외 3: 원격 MD 열기 — 사용자가 빠르게 열기(⌘/Ctrl+O)에 URL을 직접 입력할 때만
   해당 URL을 1회 GET. 받은 문서는 appdata 캐시에 저장 후 로컬 파일처럼 열림.
   예외 4: 자동 업데이트 확인(Windows) — 사용자가 최초 동의(또는 설정에서 언제든 켬/끔)
   했을 때만 업데이트 서버에서 버전 정보를 조회·다운로드. 기본 서버는 공개 채널
   (GitHub Releases)이며 인증 토큰을 넣지 않는다. 사내 배포판은 빌드 시 환경변수
   (MDJOA_UPDATE_ENDPOINT / MDJOA_UPDATE_TOKEN)로 서버를 바꾼다(주소·스크립트는
   공개 레포에는 두지 않음). 사용자 데이터는 전송하지 않으며,
   위 업데이트 서버 외 접속 없음.)
- 한국어 UI 기본
- 오픈소스 공개 대비 언어 규칙: 신규·수정하는 코드 주석과 커밋 메시지는 영어로 쓴다.
  README는 영어(README.md) + 한국어(README.ko.md), 사용자 매뉴얼은 한/영 병행.
  기존 한국어 주석은 건드릴 때 영어로 바꾸고, 일괄 번역은 BACKLOG 항목으로 따로 진행.
- 단축키 모디파이어는 추상화할 것: macOS=Cmd, Windows=Ctrl
  (아래 명세의 Cmd는 Windows 빌드 시 Ctrl로 자동 매핑)

## 플랫폼 · 소스 · 버전 관리 (Windows 우선, mac 동시)
상세: docs/source-repo-strategy.md · docs/windows-strategy.md
- **단일 리포(`mdjoa`) · 단일 코드베이스.** 플랫폼별 리포 분리·코드 중복 금지(안티패턴).
- **OS 분기는 한 곳에만 격리**: 프론트는 `src/lib/platform.ts`(isMac/isWindows/MOD_LABEL/
  showHwpxExport), Rust는 `#[cfg(target_os)]`, 번들은 `tauri.conf.json` + `Info.plist`(mac).
  컴포넌트에서 `navigator.platform` 직접 검사 금지. 새 기능은 "OS 의존?" 확인 후 분기점에만 추가.
- **빌드는 각 OS 네이티브로**(크로스 컴파일 비권장). Windows=메인이라 CI 매트릭스
  (windows-latest + macos-latest)에서 둘 다 빌드, **Windows를 릴리스 게이트 1급**으로.
  Windows 실동작(타이틀바·파일연결·single-instance·경로/인코딩·atomic write)은 Windows에서 검증.
- 경로는 `std::path`/`PathBuf`, 구분자 하드코딩 금지. atomic write의 Windows 차이 주의(windows-strategy 3.4).
- **버전 일원화**: package.json / src-tauri/Cargo.toml / tauri.conf.json 의 version을 항상 동일하게.
  (bump 스크립트로 일괄 갱신 권장.) SemVer, `main` + feat/fix 브랜치, 릴리스는 태그 `vX.Y.Z`.
  Windows 첫 정식 배포 = v1.3.0 목표.

## 라이선스 고지
- Pretendard, JetBrains Mono = SIL OFL 1.1
  → 라이선스 전문을 About 화면 + THIRD-PARTY-LICENSES.txt에 포함
- 빌드 시 오픈소스 라이선스 목록 자동 생성하여 동봉

## 진행 방식
- 각 단계 시작 시 구현 계획을 먼저 제시하고 확인받을 것
- 단계 완료 시 항상 실행 가능한 상태 유지
- 불확실한 설계 결정은 옵션 비교 후 질문할 것
