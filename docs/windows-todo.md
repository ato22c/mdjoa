# Windows 작업 체크리스트 (v1.3.0)

> 브랜치: `feat/windows-support` · 갱신: 2026-06-14
> 이 문서는 **macOS에서 끝낼 수 없고 Windows 실기(또는 CI/온라인)가 필요한 작업**만 모은다.
> macOS에서 안전하게 끝낸 작업은 아래 "이미 완료" 참고. 전략 배경: `docs/windows-strategy.md`.

## 다른 PC에서 이어서 작업하는 법
```bash
git clone <repo> && cd mdjoa
git checkout feat/windows-support
npm ci
# 개발 실행:  npm run tauri dev
# 설치본 빌드: npm run tauri build   # → src-tauri/target/release/bundle/{nsis,msi}/
```
Windows 빌드 선행 요건: Rust(MSVC toolchain) + Visual Studio Build Tools(C++) + WebView2(Win11 기본 탑재, Win10은 설치 필요할 수 있음).

---

## A. 반드시 Windows 실기에서 검증 (코드는 작성됨, 검증 불가 상태)
- [x] **빌드/실행**: `npm run tauri dev`, `npm run tauri build` 성공 + 앱 정상 기동.
- [ ] **.md/.markdown 더블클릭** → 앱 실행되고 해당 파일 열림. 이미 실행 중이면 **기존 창**에서 열림(single-instance, `argv[1]` 경로 수신).
- [ ] **한글 경로 / CP949·EUC-KR 문서** 열기·저장·인코딩 자동 감지 정상.
- [ ] **atomic write 교체**(`settings.rs`, `pandoc.rs`의 `fs::rename`): 대상 파일이 다른 프로세스에 열려 있을 때 교체 실패/재시도 동작 확인. 실패 시 토스트+로그 노출되는지. (windows-strategy §3.4)
- [x] **단축키**: Ctrl 매핑 전반 + 집중 모드 `Ctrl+Shift+Enter`, 확대 `Ctrl+=`/`Ctrl++`, 뒤로/앞으로, 비교 `Ctrl+\` 등.
- [ ] **폰트 렌더링(DirectWrite)**: Pretendard/JetBrains Mono 본문·코드 시각 검수(굵기·자간이 macOS와 다를 수 있음).
- [ ] **타이틀바**: Windows 네이티브 최소화/최대화/닫기 정상(커스텀 크롬 없음 → 분기 불필요).
- [ ] **창 상태 복원**(window-state 플러그인) 위치·크기 저장.
- [ ] **파일명/폴더명 표시**: 백슬래시 경로에서 상단바 파일명·폴더명·내보내기 기본 파일명 정상(=`baseName`/`parentSegments` 적용분 검증).

## B. 릴리스 전 필수 설정 (값 채우기)
- [x] **pandoc Windows 체크섬 핀**: `SHA256_WIN_X86_64` = `bb808d00fd58762299d64582a9b4c3e4b106cd929e62c5f19bcdcb496f1e54ae` (pandoc-3.10-windows-x86_64.zip). 채운 뒤 Windows에서 DOCX 변환 다운로드·변환 검증.
- [x] **버전 bump → 1.3.0**: `package.json` / `src-tauri/Cargo.toml` / `tauri.conf.json` 일괄. (릴리스 태그 `v1.3.0`)
- [x] **WebView2 설치 모드 결정**: `offlineInstaller`로 설정 (오프라인 사내 PC — WebView2 런타임 설치파일 내장).
- [x] **설치 타깃 결정**: `targets: ["app","dmg","nsis"]` 로 고정 — Windows는 **NSIS(.exe, perUser) 단일**(WiX/MSI 제외). CI에서 WiX `light.exe` 번들 실패 + 전략 §1 권장(관리자 권한 없는 사내 PC). 추후 MDM(Intune/SCCM) 일괄배포 요구 시 `"msi"` 추가(코드 무변경, 한글 productName WiX 호환 확인 필요).

## C. 코드 서명 / 배포 (인프라 협조 필요)
- [ ] **코드 서명**: 사내 PKI 코드서명 인증서 + GPO로 루트/중간 CA 신뢰 배포(SmartScreen "알 수 없는 게시자" 경고 제거). macOS에서 서명 불가 → **Windows 서명 잡으로 분리**(`signtool` 또는 Tauri `windows.signCommand`).
- [ ] **설치/제거 UX 검증**: NSIS 한국어 마법사, ARP(프로그램 추가/제거) 표시명 "MD좋아", 실행 파일명 ASCII(`mdjoa.exe`) 확인. 사일런트 설치(`/S`) 동작.

## D. CI (GitHub Actions — 푸시하면 자동)
- [ ] `.github/workflows/build.yml`의 **windows-latest 잡 통과** 확인(이번 브랜치 첫 푸시 후). `#[cfg(target_os="windows")]` 분기가 여기서 처음 실제 컴파일된다.
- [ ] 아티팩트(.exe/.msi/.dmg) 업로드 확인.

## E. 선택(폴리시)
- [ ] pandoc 탐지(`where`)·버전 조회 `Command`에도 `CREATE_NO_WINDOW` 적용(콘솔창 깜빡임 추가 제거). 현재 `convert_docx`만 적용됨.

---

## 이미 완료 (macOS에서 안전하게, 이 브랜치에 반영됨)
- **경로 구분자 크로스플랫폼화**: `src/lib/pathUtil.ts`(`baseName`/`pathSegments`/`parentSegments`) 신설 + 단위테스트. `TopBar`/`AppShell`/`convert.ts`/`FavoritesSection`/`ContextSection`의 `split("/")`·`lastIndexOf("/")` 교체.
- **Windows 번들 설정**: `tauri.conf.json`에 `bundle.windows`(NSIS perUser, 한국어/영어), `webviewInstallMode`, `fileAssociations`(md/markdown), `mainBinaryName: "mdjoa"`(실행파일 ASCII) 추가. `targets`를 `["app","dmg","nsis"]`로 고정(WiX/MSI 제외). macOS 문서타입은 기존 `Info.plist` 유지.
- **CI Windows 빌드 통과 확인**: 첫 푸시에서 Rust는 Windows에서 정상 컴파일(경고만), WiX 번들 실패 → NSIS 단일로 전환해 해결.
- **pandoc Windows 분기**: `release_asset()`에 `#[cfg(target_os="windows")]` x86_64 분기(체크섬 핀 대기), `convert_docx`에 `CREATE_NO_WINDOW`.
- **CI**: windows+macos 빌드 매트릭스.
- (이전 작업) 데이터 폴더 크로스플랫폼(`%LOCALAPPDATA%`), 로그 경로 분기, 단축키 입력 추상화(`metaKey||ctrlKey`), `MOD_LABEL`, single-instance 경로 수신은 이미 갖춰짐.
