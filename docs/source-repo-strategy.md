# MD좋아 소스 · 리포지토리 관리 전략

> 작성: 2026-06-13 · 범위: 소스 구조 / 리포지토리 / 버전관리 / 빌드·릴리스 절차
> 연계 문서: [windows-strategy.md](./windows-strategy.md)(이식 디테일), [deploy-update-strategy.md](./deploy-update-strategy.md)(배포·업데이트)

## 0. 전제

- **Windows 사용자가 메인**, macOS는 부차(현재 개발·빌드 환경).
- 기술 스택은 **Tauri 2 + React + Rust** — 본질적으로 **단일 코드베이스 크로스플랫폼**.
- 현재 코드의 99%는 플랫폼 공통이고, OS 의존은 이미 소수 지점에 격리돼 있음
  (프론트 `src/lib/platform.ts`, Rust `#[cfg(target_os)]`, `tauri.conf.json` 번들 설정).

---

## 1. 핵심 결정: **단일 리포지토리 · 단일 코드베이스 (모노 코드베이스)**

**결론: 하나의 리포(`mdjoa`)에서 mac·Windows를 모두 빌드한다. 플랫폼별 리포 분리는 하지 않는다.**

| 선택지 | 평가 |
| --- | --- |
| **A. 단일 리포 + 단일 코드베이스** ✅ 채택 | Tauri의 표준. 공통 99% + 분기 1%를 조건부로 격리. 한 번 고치면 양 OS 반영. |
| B. 단일 리포 + 플랫폼별 디렉토리 분리 | 불필요한 중복·동기화 비용. 분기가 1%뿐이라 과함. |
| C. 플랫폼별 리포 분리(mdjoa-mac / mdjoa-win) | ❌ 안티패턴. UI·로직이 거의 동일한데 두 벌 유지 → 기능·버그가 항상 갈라짐. 절대 피한다. |

**이유**
- React UI·Rust 커맨드 로직은 OS와 무관 → 분리할 이유가 없다.
- OS 차이(단축키 라벨, 경로, 번들러, 타이틀바, pandoc arch)는 **이미 분기점이 한정적**이고
  조건부 컴파일/런타임 감지로 한 파일에 모을 수 있다.
- 분리 리포는 "Windows 메인 + mac 부차"를 **두 제품**으로 갈라 유지보수를 2배로 만든다.

---

## 2. 코드 구성 — 공통 / 분기 격리 규칙

### 2.1 계층별 분류

| 영역 | 공통 여부 | 비고 |
| --- | --- | --- |
| React 컴포넌트·스토어·렌더링·기능 | **100% 공통** | OS 무관 |
| Rust 커맨드(파일·검색·북마크·즐겨찾기 등) | **대부분 공통** | std 기반 |
| 단축키 **입력 처리** | 공통 | `e.metaKey \|\| e.ctrlKey`로 이미 양쪽 수용 |
| 단축키 **표시 라벨** | 분기 | `platform.ts`의 `MOD_LABEL`(⌘/Ctrl) 사용 — 하드코딩 금지 |
| 타이틀바/신호등 | 분기 | macOS Overlay + 좌패딩 vs Windows 기본 — `isMac` 가드 |
| pandoc 다운로드 | 분기 | OS·arch별 바이너리/체크섬 (`pandoc.rs`) |
| 번들/아이콘/파일연결 | 분기 | `tauri.conf.json` 플랫폼 섹션 + `Info.plist`(mac) |
| HWPX 등 한국형 연동 | 분기 | `showHwpxExport`(Windows에서 노출) |

### 2.2 분기 격리 원칙 (지킬 것)

1. **프론트 OS 분기는 `src/lib/platform.ts`에만.** 컴포넌트에서 `navigator.platform`을
   직접 보지 말고 `isMac` / `isWindows` / `MOD_LABEL` / `showHwpxExport`를 import.
2. **Rust OS 분기는 `#[cfg(target_os = "...")]`로** 함수 단위 격리. 런타임 `if cfg!()`는 표시 문자열 정도만.
3. **플랫폼별 "파일 분리"는 최후의 수단.** 가능하면 같은 파일 안에서 조건부로. 정말 큰 분기만
   `foo.macos.rs` / `foo.windows.rs` 식으로 나눈다(현재는 불필요).
4. **새 기능 추가 시 체크**: "이게 OS에 의존하나?" → 아니면 공통, 맞으면 위 격리 지점에만 분기 추가.
5. 경로는 항상 `PathBuf`/`std::path`; 구분자 하드코딩(`/`, `\`) 금지. (프론트도 분리 시 OS 구분자 고려)

---

## 3. 빌드 타깃 & 환경

| OS | 역할 | 빌드 방법 |
| --- | --- | --- |
| **Windows 10/11** | **메인 배포 대상** | Windows 러너(CI) 또는 Windows 머신에서 `tauri build` → MSI/NSIS |
| macOS (arm64) | 개발·부차 배포 | 현재 환경에서 `tauri build` → dmg/app |

- **크로스 컴파일 금지/비권장**: Tauri는 webview·번들러가 OS 네이티브라 mac에서 Windows 바이너리를
  만드는 것은 비권장. **각 OS는 그 OS에서 빌드**한다 → CI 매트릭스로 해결(§5).
- 개발은 어느 OS에서나 `tauri dev` 가능. 단 **Windows 동작 검증은 Windows에서** 해야 정확
  (타이틀바·파일연결·single-instance·폰트·atomic write 차이).

---

## 4. 버전 관리 절차

### 4.1 단일 버전 소스 동기화

버전이 **세 곳**에 흩어져 있음 → 항상 동일하게 유지:
- `package.json` `version`
- `src-tauri/Cargo.toml` `package.version`
- `src-tauri/tauri.conf.json` `version`

**실행 계획**: 버전 bump 스크립트(`scripts/bump-version.mjs <semver>`)를 추가해 세 파일을 한 번에 갱신.
수동 편집 시 누락 위험 제거. (현재 모두 `1.1.0`.)

### 4.2 브랜치 전략

- `main`: 항상 빌드 가능한 안정 브랜치. **플랫폼별 브랜치 만들지 않음**(코드가 공통이므로).
- `feat/*`, `fix/*`: 기능/수정 브랜치 → PR → `main`.
- 릴리스는 `main`에서 **태그**로 자른다: `v1.2.0` 등 (SemVer).

### 4.3 SemVer 기준 (이 앱 맥락)

- **MAJOR**: 비호환 변경(설정 파일 포맷 변경 등 마이그레이션 필요).
- **MINOR**: 기능 추가(편집 모드, 검색 등) — 대부분 여기.
- **PATCH**: 버그 수정·문구·소규모 개선.
- Windows 첫 정식 배포를 **v1.3.0**(windows-strategy 로드맵과 일치)으로 잡는다.

### 4.4 릴리스 절차 (태그 → 자동 빌드)

1. `main`에서 버전 bump 커밋(`scripts/bump-version.mjs 1.3.0`) + `CHANGELOG.md` 갱신.
2. 태그 푸시: `git tag v1.3.0 && git push --tags`.
3. CI가 태그를 받아 **mac + Windows 동시 빌드**(§5) → 서명 → GitHub Releases에 산출물 첨부.
4. **Windows 빌드를 1급으로 검증**(메인 사용자) 후 릴리스 노트 공개.
5. 배포·업데이트 채널은 [deploy-update-strategy.md](./deploy-update-strategy.md) 참조.

---

## 5. CI/CD — GitHub Actions 매트릭스 (실행 계획)

```yaml
# .github/workflows/release.yml (요지)
on:
  push:
    tags: ["v*"]
jobs:
  build:
    strategy:
      matrix:
        include:
          - os: windows-latest   # 메인
            target: msi/nsis
          - os: macos-latest     # 부차
            target: dmg
    runs-on: ${{ matrix.os }}
    steps:
      - checkout
      - setup node + rust
      - npm ci
      - npm run tauri build        # gen-licenses → tsc → vite → cargo → 번들
      - (서명: win=Authenticode, mac=codesign/notarize)
      - upload-artifact → GitHub Release
```

- **각 OS는 자기 러너에서 빌드** → 크로스 컴파일 회피.
- 태그 없이 `main` push 시엔 **빌드 검증만**(아티팩트 미발행)으로 두 OS 컴파일 깨짐을 조기 발견.
- 서명 키·인증서는 GitHub Secrets로 주입(평문 커밋 금지).

---

## 6. Windows 메인을 반영한 운영 원칙

1. **Windows를 1급 시민으로 취급**: CI 매트릭스에서 Windows를 첫 잡으로, 릴리스 게이트에 Windows 통과 필수.
2. **테스트 우선순위 Windows ≥ mac**: 기능 추가 시 Windows 경로/단축키/파일연결을 우선 검증.
3. macOS는 개발 편의 환경으로 유지(현재 코드·문서가 mac 기준이므로 격차를 CI로 메움).
4. 분기 코드 리뷰 시 "**Windows에서 이 줄이 어떻게 동작하나**"를 기본 질문으로.

---

## 7. 하지 말 것 (안티패턴)

- ❌ **플랫폼별 리포 분리** — 유지보수 2배, 기능 분기.
- ❌ **플랫폼별 코드 중복**(같은 컴포넌트를 mac용/win용 따로) — 조건부로 격리.
- ❌ **크로스 컴파일에 의존** — CI 매트릭스로 네이티브 빌드.
- ❌ **버전 수동 3중 편집** — bump 스크립트로 일원화.
- ❌ **OS 분기를 컴포넌트 곳곳에 흩뿌리기** — `platform.ts` / `#[cfg]`로 모은다.

---

## 8. 실행 계획 (단계별)

| 단계 | 작업 | 산출물 |
| --- | --- | --- |
| **P0 (기반)** | 버전 bump 스크립트, GitHub Actions 빌드 검증(매트릭스, 아티팩트 X) | `scripts/bump-version.mjs`, `.github/workflows/ci.yml` |
| **P1 (Windows 동작)** | windows-strategy.md의 분기 수정(단축키 라벨·타이틀바·경로·파일연결·pandoc arch) | Windows에서 정상 구동 |
| **P2 (배포)** | 서명(Authenticode/notarize), Release 워크플로(태그 트리거) | `release.yml`, 서명된 MSI/NSIS·dmg |
| **P3 (업데이트)** | 자동 업데이트(tauri-updater 또는 수동 알림) — deploy-update-strategy 참조 | 업데이트 채널 |

---

## 9. 한 줄 요약

> **하나의 리포 · 하나의 코드베이스로 mac·Windows를 함께 관리**하고, OS 차이는 `platform.ts`와
> `#[cfg(target_os)]`에만 격리한다. 빌드는 **CI 매트릭스(각 OS 네이티브)**, 버전은 **bump 스크립트로 일원화**,
> 릴리스는 **태그 → 자동 빌드·서명 → GitHub Releases**. **Windows를 1급 시민**으로 검증·배포한다.
