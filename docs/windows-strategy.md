# MD좋아 Windows 이식 전략 (v1.3 대상)

> 작성일: 2026-06-13 / 대상: Windows 10·11 (x64 우선, ARM64는 후순위)
> 원칙: 코드는 이미 크로스플랫폼을 염두에 두고 작성됨. 빌드·테스트는 macOS에서만 수행하므로
> Windows 분기 코드는 "작성하되 검증은 불가" 상태임을 전제로 위험을 관리한다.

---

## 0. 현황 조사 결과 — 이미 잘 된 부분 / 고쳐야 할 부분

### 0.1 이미 크로스플랫폼으로 처리된 지점 (그대로 두면 됨)

| 항목 | 근거 | 비고 |
|---|---|---|
| 데이터 디렉터리 | `pandoc.rs:40-46`, `settings.rs:56-62` | `dirs::data_local_dir()` 사용 → Windows에서 `%LOCALAPPDATA%`로 자동 매핑. ASCII 식별자 `com.fusionsoft.mdjoa`만 경로에 사용. |
| atomic write | `settings.rs:77-80`, `pandoc.rs:214-222` | 임시파일 → `fs::rename` 패턴. Windows에서도 동작(주의점은 §3 참고). |
| 단축키 입력 처리 | `AppShell.tsx:51` `const mod = e.metaKey \|\| e.ctrlKey;` | 입력단은 추상화됨. Cmd/Ctrl 모두 수용. |
| pandoc 바이너리 이름 | `pandoc.rs:48-54` `if cfg!(windows) { "pandoc.exe" }` | 확장자 분기 OK. |
| 시스템 pandoc 탐색 | `pandoc.rs:57-59` `if cfg!(windows) { "where" } else { "which" }` | OK. |
| zip 추출 | `pandoc.rs:200` `name.ends_with("/bin/pandoc.exe")` | Windows 엔트리도 매칭하도록 작성됨. |
| 실행권한 부여 | `pandoc.rs:216-221` `#[cfg(unix)]`로 가드 | Windows에서는 chmod 생략(불필요). |
| 단축키 표시 라벨(핵심) | `platform.ts:6-10` `isMac`/`isWindows`, `MOD_LABEL` | 중앙 추상화 존재. 단 일부 화면이 이걸 안 씀(§4). |
| 파일 연결 placeholder | `lib.rs:34-47` single-instance가 `argv[1]`로 경로 수신 | Windows 더블클릭/Open with 경로 진입점 이미 준비됨. |
| 타이틀바 | `tauri.conf.json:20` `"decorations": true` | **커스텀 타이틀바 없음**. 네이티브 크롬 사용 → 신호등/캡션 분기 코드 자체가 없음(§6). |
| 클립보드/인쇄 폰트 폴백 | `export.ts:15,23` `'Malgun Gothic'`, `'Consolas'` | Windows 시스템 폰트 폴백 이미 명시됨. |

### 0.2 반드시 고쳐야 할 분기/가정 (Windows에서 깨짐)

| 심각도 | 위치 | 문제 | 수정 방향 |
|---|---|---|---|
| **높음** | `pandoc.rs:125-141` `release_asset()` | `#[cfg(not(target_os="macos"))]`에서 무조건 `Err("아직 지원되지 않습니다")` 반환. Windows에서 DOCX 변환 다운로드 불가. | Windows arch별 에셋명 + SHA-256 추가(§7). |
| **높음** | `TopBar.tsx:38` `currentFile.split("/").pop()` | 경로 구분자 `/` 하드코딩. Windows 경로 `C:\Users\..\a.md`에서 파일명 추출 실패(전체 경로가 그대로 표시됨). | `/[\\/]/`로 분리하거나 공용 `baseName()` 유틸. |
| **높음** | `AppShell.tsx:121` `currentFolder.split("/").filter(Boolean).pop()` | 동일. 폴더명 표시 깨짐. | 위와 동일. |
| **높음** | `convert.ts:13` `path.split("/").pop()` | DOCX/HWPX 저장 시 기본 파일명 산출 실패 → 기본 파일명이 `C:\...\문서` 통째로. | 위와 동일. |
| **중간** | `SettingsModal.tsx:9-10`, `WelcomeScreen.tsx:6-7` | `navigator.platform`(deprecated) 기반 자체 `isMac/MOD` 재정의. `platform.ts`를 안 씀 → 일관성·표시 라벨 불일치 위험. | `platform.ts`의 `MOD_LABEL` import로 통일. |
| **낮음** | `pandoc.rs:240-249` `convert_docx` | `Command::new(pandoc)` 자체는 OK이나, Windows에서 콘솔창(검은 창) 깜빡임 발생 가능. | `CREATE_NO_WINDOW` 플래그(`std::os::windows::process::CommandExt`) 부여. |

> 참고: `useFolderWatch.ts:7`의 `IGNORE_RE = /(^|[\\/])(\.[^\\/]+|node_modules)([\\/]|$)/`는
> 이미 `\\`와 `/`를 모두 처리하므로 Windows 안전. `useFileWatcher.ts`도 경로 가정 없음.

---

## 1. 패키징: MSI vs NSIS

`tauri.conf.json:30` `"targets": "all"` → Windows에서는 WiX(MSI)와 NSIS 양쪽을 모두 생성한다.
사내 배포 맥락에서 둘을 비교한다.

| 기준 | MSI (WiX v3) | NSIS |
|---|---|---|
| 설치 UX | Windows Installer 표준. 사일런트 설치(`msiexec /i /qn`) 용이 | 마법사형. `/S` 사일런트 지원 |
| 그룹 정책/SCCM·Intune 배포 | **MSI가 사실상 표준**. 사내 자산관리·일괄배포에 유리 | 가능하나 MSI보다 취급 까다로움 |
| 한글 표시명 처리 | productName "MD좋아"가 ARP(프로그램 추가/제거)에 한글로 표기 — 양쪽 모두 가능 | 동일 |
| 사용자 단위 설치(관리자 권한 불필요) | WiX는 perMachine 기본, perUser 설정 필요 | `installMode: "currentUser"` 간단 — **관리자 권한 없는 사내 PC에 유리** |
| 빌드 의존성 | WiX 툴체인 필요 | 경량 |
| 코드 서명 적용 | 양쪽 동일하게 가능 |  |

**권장**: 사내 배포 채널이 **Intune/SCCM 등 MDM 일괄배포면 MSI**,
**사용자가 직접 받아 설치(관리자 권한 없음)면 NSIS(currentUser 모드)**.
초기 v1.3에서는 **NSIS(perUser) 단일 타깃**을 권장한다. 이유:
- 사내 표준 PC에서 관리자 권한 없이 설치 가능 → 배포 마찰 최소.
- macOS에서만 빌드/테스트하므로 WiX 툴체인 추가 검증 부담을 줄임.
- 추후 MDM 요구가 생기면 MSI 타깃을 병행 추가(설정만 추가, 코드 무변경).

설정 예시(작성만, 적용은 구현 단계에서):
```jsonc
// tauri.conf.json > bundle 에 추가
"windows": {
  "nsis": { "installMode": "currentUser", "languages": ["Korean"] }
}
```
또한 현재 `"targets": "all"`은 macOS 빌드에서 불필요한 타깃을 만들 수 있으므로
플랫폼별 타깃 명시(`tauri build --target` 또는 CI 분리)를 권장.

---

## 2. 코드 서명(Authenticode) / SmartScreen — 사내 배포 현실론

미서명 EXE/인스톨러는 Windows SmartScreen이 "Windows에서 PC를 보호했습니다" 경고를 띄우고,
사용자가 "추가 정보 → 실행"을 눌러야 한다. 사내 배포라도 마찰·문의가 발생한다.

현실적 옵션(권장 순):

1. **사내 PKI 코드서명 인증서 + 그룹 정책 신뢰 배포 (가장 권장)**
   사내 CA가 발급한 코드서명 인증서로 서명하고, 해당 루트/중간 CA를 GPO로 도메인 PC의
   신뢰된 루트에 배포. SmartScreen 평판과 별개로 "알 수 없는 게시자" 경고 제거. 비용 0.
2. **상용 OV 코드서명 인증서**
   외부 CA(예: 일반 OV 인증서)로 서명. 게시자명은 표시되나 SmartScreen 평판(reputation)은
   초기에 낮아 다운로드 경고가 한동안 남을 수 있음. 사내 한정이면 1번이 더 합리적.
3. **EV 코드서명 인증서**
   SmartScreen 평판 즉시 부여. 비용 높고 HSM/USB 토큰 필요. 사내 전용 배포엔 과함.
4. **미서명 + 안내문 배포 (비권장, 임시)**
   설치 가이드에 SmartScreen 우회 절차 명시. 신뢰성 가치(CLAUDE.md)에 반하므로 정식 배포엔 부적합.

**권장 결론**: 사내 배포이므로 **1번(사내 PKI + GPO 신뢰)**을 1순위.
서명 자체는 `signtool`로 수행하는데, **빌드를 macOS에서 하므로 서명은 Windows CI/서명 서버에서
별도 단계로 분리**해야 한다(macOS에서 Authenticode 서명 불가). Tauri의 `windows.signCommand`로
빌드 파이프라인에 끼울 수 있으나, 본 프로젝트는 macOS 빌드 전제이므로 **별도 Windows 서명 잡**으로 두는 것이 현실적.

---

## 3. 경로 / 인코딩 / atomic write

### 3.1 한글 경로 호환
- 내부 식별자·번들 ID는 ASCII(`mdjoa`, `com.fusionsoft.mdjoa`)로 고정되어 데이터 폴더 경로 안전.
- 사용자 문서 경로에 한글이 있어도 Rust는 `PathBuf`/`OsString`으로 UTF-8 처리(`file.rs` 전반),
  프런트는 Tauri가 UTF-8 문자열로 전달하므로 한글 경로 자체는 안전.
- 파일 **내용** 인코딩은 `chardetng`로 자동 감지(`file.rs:16-20`) → CP949/EUC-KR 문서도 처리. Windows 사내 문서(CP949)와 궁합 좋음.

### 3.2 경로 구분자
- 백엔드: `std::path` 사용으로 안전.
- 프런트: **§0.2의 `split("/")` 3곳이 Windows 백슬래시 경로에서 깨짐**. 공용 유틸로 정리 권장:
  ```ts
  export const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
  ```
  (`TopBar.tsx:38`, `AppShell.tsx:121`, `convert.ts:13` 일괄 교체)

### 3.3 데이터 폴더 위치
- macOS: `~/Library/Application Support/com.fusionsoft.mdjoa/`
- Windows: `dirs::data_local_dir()` → **`%LOCALAPPDATA%\com.fusionsoft.mdjoa\`**
  (질문에 언급된 `%APPDATA%`(Roaming)가 **아니라** `%LOCALAPPDATA%`(Local)임에 유의 —
  `data_local_dir`은 Local을 반환. 설정/캐시/pandoc 바이너리 보관처로 Local이 적절: 로밍 동기화 대상에서 제외).

### 3.4 atomic write의 Windows 동작 (주의)
`settings.rs:77-80`, `pandoc.rs:214-222`의 `fs::rename(tmp, dest)` 패턴:
- POSIX `rename`은 대상이 있어도 원자적 교체. **Windows의 `MoveFileEx`/Rust `fs::rename`은
  대상 파일이 이미 존재하면 실패**할 수 있음(특히 동시에 다른 프로세스가 열고 있을 때 `AccessDenied`).
- Rust 표준 `fs::rename`은 내부적으로 덮어쓰기를 시도하나, **대상이 다른 핸들에 열려 있으면 실패** 가능.
- 위험: settings.json은 짧게 쓰고 닫으므로 대체로 안전. pandoc.exe 설치 시 직전 실행 핸들이 남아 있으면 교체 실패 가능.
- 권장: 교체 실패 시 (a) 기존 파일 삭제 후 rename 재시도, 또는 (b) `tauri-plugin-fs`/OS 콜로 교체.
  최소한 **rename 실패를 토스트로 노출**(CLAUDE.md "에러 토스트 + 로그")하고, 현재는 `?`로 에러 문자열만 전파됨 — 동작 확인은 Windows 실기 필요.

---

## 4. 단축키 Cmd → Ctrl 매핑

### 4.1 입력 처리 — 이미 추상화됨 (OK)
- `AppShell.tsx:51` `const mod = e.metaKey || e.ctrlKey;` → 단축키 동작은 Cmd/Ctrl 양쪽 수용.
- `FolderSearch.tsx:45`, `QuickOpen.tsx:91`도 `(e.metaKey || e.ctrlKey)` 패턴 사용 — OK.
- 즉, **기능 동작 레벨은 추가 작업 불필요.**

### 4.2 표시 라벨 — 부분적으로만 추상화됨 (수정 필요)
- 중앙 추상화는 `platform.ts:10` `MOD_LABEL = isMac ? "⌘" : "Ctrl+"` 존재.
- 그러나 **`SettingsModal.tsx:9-10`과 `WelcomeScreen.tsx:6-7`이 각자
  `navigator.platform`으로 `isMac`/`MOD`를 재정의**:
  ```ts
  const isMac = navigator.platform.toUpperCase().includes("MAC"); // deprecated API
  const MOD = isMac ? "⌘" : "Ctrl+";
  ```
  - `navigator.platform`은 deprecated이며 webview에 따라 신뢰도 낮음.
  - 라벨 로직이 3곳에 분산되어 불일치 위험.
- **수정**: 두 화면이 `platform.ts`의 `MOD_LABEL`을 import하도록 통일. (동작이 아닌 표시 일관성 문제이므로 심각도 중간.)

---

## 5. 폰트 / 파일 연결 / single-instance (Windows)

### 5.1 폰트 렌더링 (Pretendard / JetBrains Mono)
- `global.css:3-16`에서 두 폰트를 woff2 가변폰트로 `@font-face` 번들(`public/fonts/`에 동봉) → **앱 본문 렌더링은 OS 설치 폰트와 무관하게 동일**(Windows 안전).
- 주의점:
  - 가변폰트(`PretendardVariable.woff2` 2MB)는 구형 WebView2에서도 woff2 지원하므로 OK.
  - **DirectWrite 렌더링 차이**: Windows의 글자 힌팅/렌더링은 macOS(CoreText)와 미묘하게 다름(굵기·자간 체감). 디자인 검수는 Windows 실기에서 한 번 필요.
  - `export.ts`의 클립보드/인쇄 폴백 폰트(`Malgun Gothic`, `Consolas`)는 Windows 기본 탑재 폰트라 적절.
- 작업: **추가 코드 불필요**, 시각 검수만.

### 5.2 파일 연결 (.md / .markdown 등록)
- 현재 `Info.plist`(macOS)에만 문서 타입 선언. **Windows 파일 연결 등록 설정이 없음**.
- Tauri는 `bundle.fileAssociations`로 크로스플랫폼 등록을 지원. 추가 필요:
  ```jsonc
  "bundle": {
    "fileAssociations": [
      { "ext": ["md", "markdown"], "name": "Markdown Document",
        "description": "Markdown 문서", "role": "Viewer" }
    ]
  }
  ```
  NSIS/MSI가 이를 레지스트리(`HKCU\Software\Classes\.md`)에 등록.
- 진입점 처리: 더블클릭 시 OS가 `mdjoa.exe <파일경로>`로 실행 → `lib.rs:38` single-instance의
  `argv.get(1)`이 경로를 받아 `open-file` emit. **백엔드 수신 로직은 이미 준비됨**(별도 코드 불필요).
  단, macOS의 `RunEvent::Opened`(`lib.rs:81-97`)는 `#[cfg(target_os="macos")]`로 가드되어 Windows에선 single-instance 경로만 사용됨 — 의도대로 동작.

### 5.3 single-instance 플러그인 Windows 동작
- `tauri-plugin-single-instance`는 Windows 지원(Cargo.toml:20). 두 번째 실행 인스턴스의 `argv`를
  첫 인스턴스로 전달 → `lib.rs:34-47` 콜백이 창 포커스 + 경로 emit. **Windows에서 기대대로 동작**.
- 검증 포인트: 이미 실행 중일 때 .md 더블클릭 → 기존 창에서 열리는지(실기 확인 필요).

---

## 6. 타이틀바 차이 (Windows)

- 현재 `tauri.conf.json:20` `"decorations": true`, `"transparent": false` → **네이티브 타이틀바 사용**.
- 코드베이스에 커스텀 타이틀바/신호등(traffic light)/캡션 영역/`data-tauri-drag-region` 사용 **없음**(검색 결과 0건, 매칭은 모두 빌드 산출물).
- 결론: **Windows에서 최소화·최대화·닫기 버튼이 OS 기본으로 정상 표시됨**. 신호등 가정 코드가 없으므로 **분기·수정 불필요**.
- 유일한 디자인 영향: macOS와 Windows의 타이틀바 외형이 다름(미니멀 원칙엔 영향 미미). 커스텀 크롬을 도입할 계획이라면 그때 Windows 캡션 버튼을 별도 구현해야 하나, **현 설계에선 불필요**.
- 창 상태 저장: `tauri-plugin-window-state`(Cargo.toml:21, lib.rs:32)가 위치/크기 저장 — 크로스플랫폼 동작.

---

## 7. pandoc 다운로드: Windows arch별 바이너리 / 체크섬

### 7.1 현재 막혀 있는 지점
- `pandoc.rs:23-24`: 체크섬 상수가 **macOS arm64/x86_64 두 개뿐**.
- `pandoc.rs:125-141` `release_asset()`: `#[cfg(not(target_os="macos"))]` 분기가 무조건 에러 반환.
  → Windows 빌드에서 **DOCX 변환 엔진 자동 다운로드 불가**.

### 7.2 추가해야 할 것
pandoc 3.10(`PANDOC_VERSION`, pandoc.rs:19) 공식 릴리스(jgm/pandoc)의 Windows 에셋:
- x86_64: `pandoc-3.10-windows-x86_64.zip` (zip 내부 `pandoc-3.10/pandoc.exe`)
- (ARM64 Windows는 공식 zip 부재 가능 → x64 바이너리를 에뮬레이션으로 사용하거나 미지원 처리)

수정 지점:
1. Windows용 SHA-256 상수 추가(릴리스 zip의 공식 체크섬을 받아 **빌드 시점에 검증하여 핀**).
   현재 macOS 체크섬처럼 하드코딩(`pandoc.rs:22-24` 주석대로 버전업 시 재생성).
2. `release_asset()`에 `#[cfg(target_os = "windows")]` 분기 추가:
   ```rust
   #[cfg(target_os = "windows")]
   { match arch {
       "x86_64" => Ok((format!("pandoc-{PANDOC_VERSION}-windows-x86_64.zip"), SHA256_WIN_X86_64)),
       other => Err(format!("지원하지 않는 아키텍처입니다: {other}")),
   }}
   ```
3. zip 추출(`pandoc.rs:200`)은 이미 `pandoc.exe` 엔트리를 매칭하므로 변경 불필요.
4. 설치 경로(`bundled_pandoc_path`, pandoc.rs:48-54)도 `.exe` 분기 이미 있음 — 변경 불필요.
5. (선택) `convert_docx`에 Windows 콘솔창 숨김 플래그(`CREATE_NO_WINDOW`) 추가.

> 주의: macOS에서 빌드/테스트하므로 **Windows 다운로드·변환 경로는 실기 검증 불가**.
> 체크섬은 공식 릴리스 페이지에서 받아 핀하고, 실제 다운로드 검증은 Windows QA 단계에서 수행.

---

## 8. 결론: 단계별 구현 로드맵 + 위험요소

### 8.1 로드맵 (우선순위순)

**1단계 — 크로스플랫폼 안전화 (코드, macOS에서도 안전하게 적용 가능)**
- 경로 구분자 수정: `baseName` 공용 유틸 도입, `TopBar.tsx:38`·`AppShell.tsx:121`·`convert.ts:13` 교체.
- 단축키 라벨 통일: `SettingsModal.tsx`·`WelcomeScreen.tsx`가 `platform.ts`의 `MOD_LABEL` 사용.
- → 이 단계는 macOS 동작에 영향 없이 회귀 검증 가능(가장 먼저, 안전).

**2단계 — Windows 번들 설정 (설정 위주)**
- `tauri.conf.json`에 `bundle.windows.nsis`(currentUser, Korean) + `fileAssociations` 추가.
- 아이콘 `icon.ico` 이미 존재(`tauri.conf.json:36`) — 확인만.
- 빌드 타깃을 플랫폼별로 분리(`"all"` 재검토).

**3단계 — pandoc Windows 지원**
- `release_asset()` Windows 분기 + Windows SHA-256 핀.
- `convert_docx` 콘솔창 숨김 플래그(선택).

**4단계 — Windows 실기 검증 (별도 환경 필요)**
- 한글 경로/CP949 문서 열기, atomic write 교체 동작(§3.4), .md 더블클릭→single-instance,
  폰트 렌더링 시각 검수, 단축키, DOCX 변환 다운로드.

**5단계 — 코드 서명 / 배포**
- 사내 PKI 코드서명 + GPO 신뢰 배포(§2). Windows 서명 잡을 빌드와 분리 구성.

### 8.2 주요 위험요소

1. **macOS 단독 빌드/테스트 → Windows 경로 전부 미검증(최대 위험)**: pandoc 다운로드/변환,
   atomic rename 교체 실패(§3.4), single-instance 파일 연결, 폰트 렌더링은 **Windows 실기 없이는
   확신 불가**. 4단계 QA 환경 확보가 전제.
2. **atomic write의 Windows rename 시맨틱 차이(§3.4)**: 대상 파일이 열려 있을 때 `fs::rename` 실패
   가능 → 설정/엔진 설치 무음 실패 위험. 실패 노출·재시도 로직 필요.
3. **코드 서명 부재 시 SmartScreen 마찰**: 사내라도 미서명 배포는 경고·문의 유발. PKI+GPO 신뢰가
   해결책이나 인프라(사내 CA, GPO 권한) 협조 필요.
4. (경미) **경로 `split("/")` 3곳**: 1단계에서 처리하면 해소되는 저비용 버그지만, 누락 시 Windows에서
   파일명/폴더명/내보내기 기본 파일명이 전부 깨져 체감 품질 저하.

### 8.3 한 줄 요약
입력단(단축키)·데이터 폴더·atomic write 골격·single-instance·바이너리 확장자 분기는 이미
크로스플랫폼으로 작성되어 있고, **타이틀바 신호등 가정도 없다(커스텀 크롬 미사용)**. 실제로 손대야 할 곳은
(1) 프런트 경로 `split("/")` 3곳, (2) pandoc Windows 에셋/체크섬, (3) Windows 번들·파일연결 설정,
(4) 단축키 라벨 통일이며, 가장 큰 위험은 **macOS 단독 빌드로 인한 Windows 경로 전반의 검증 불가**다.
