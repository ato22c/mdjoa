---
name: version-bump
description: >-
  "버전 올려줘", "버전 패치/마이너/메이저 올려줘", "version bump" 요청 시 호출되는 스킬.
  MD좋아(mdjoa)의 버전 표기 3곳(package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json)을
  항상 동일하게 맞추는 것이 목적 — CLAUDE.md "버전 일원화" 원칙을 실행한다. 저장소 전체를
  검색해 버전 문자열을 찾아다니지 않고, 이 3곳(+ 자동 동기화되는 package-lock.json/Cargo.lock)만
  건드린다. CHANGELOG 새 헤딩 작성이나 git 커밋/태그는 하지 않는다(명시 요청 시에만 별도로).
---

# Version Bump (MD좋아 버전 올리기)

MD좋아는 버전 문자열을 **3곳에 중복 보관**한다(CLAUDE.md "버전 일원화" 원칙):

| 파일 | 필드 |
|---|---|
| `package.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version = "..."` (`[package]` 섹션) |
| `src-tauri/tauri.conf.json` | `"version"` (최상위) |

세 곳이 어긋나면 빌드 산출물의 버전 표시가 서로 달라지거나(예: About 화면은 `tauri.conf.json`,
배포 스크립트의 업로드 경로는 `package.json` 기준) 자동 업데이트 매니페스트
(`latest.json`)의 버전 비교가 꼬일 수 있다. 이 스킬은 세 곳을 **한 번에, 정확히 같은 값으로** 올린다.

## 0. 시작 전 확인

```bash
git status --short
```

**이 스킬이 건드릴 파일(`package.json`, `package-lock.json`, `src-tauri/Cargo.toml`,
`src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`) 외에 이미 변경된 파일이 있으면 건드리지
말고 사용자에게 알린다.** (이 저장소는 때때로 다른 세션과 같은 작업폴더를 공유할 수 있다 —
남의 미완성 작업을 실수로 커밋 대상에 섞지 않는다.)

세 파일의 현재 버전이 이미 서로 다르면(비정상 상태), 먼저 어느 값이 맞는지 사용자에게 확인한다
— 임의로 하나를 고르지 않는다.

## 1. 레벨 결정

사용자가 patch/minor/major를 명시하지 않으면 **patch가 기본값**이다. MD좋아의 실제 운용 기준
(CLAUDE.md §버전 관리는 아니지만 `docs/deploy-update-strategy.md` §4.1의 SemVer 정책 참고):

- **PATCH**: 버그 수정, 설정 스키마 호환 유지 (기본값)
- **MINOR**: 기능 추가, 하위 호환 유지
- **MAJOR**: 설정/저장 스키마 비호환 변경 등 마이그레이션 필요

애매하면 기본값(patch)으로 진행하되, 이번 세션에 추가된 변경이 명백히 새 기능이면 minor를
제안하고 확인만 받는다(단정하지 않음).

## 2. 매니페스트 올리기 — `package.json` (npm이 계산)

```bash
npm version <patch|minor|major> --no-git-tag-version
```

- `package.json`과 `package-lock.json`을 동시에 정확히 갱신한다(git 태그·커밋은 만들지 않음 —
  `--no-git-tag-version`).
- 명령 출력(또는 `package.json` 재확인)으로 **새 버전 문자열**을 얻는다. 이후 단계는 전부 이
  값을 그대로 쓴다(직접 semver 계산을 다시 하지 않는다 — npm이 계산한 값이 유일한 근거).

## 3. 나머지 두 파일 동기화 — 직접 수정

`src-tauri/Cargo.toml`의 `[package]` 섹션에서:
```toml
version = "1.6.0"
```
을 새 버전으로 교체.

`src-tauri/tauri.conf.json`의 최상위:
```json
"version": "1.6.0",
```
을 새 버전으로 교체.

(둘 다 값이 하나뿐인 단순 필드라 CLI 도구 없이 직접 편집이 가장 확실하다. `cargo set-version`
같은 도구는 mdjoa에 설치돼 있다는 보장이 없으므로 의존하지 않는다.)

## 4. Cargo.lock 동기화

```bash
cd src-tauri && cargo check
```

`Cargo.toml`의 버전이 바뀌면 `Cargo.lock`의 mdjoa 자체 패키지 항목(로컬 path 패키지라
checksum 없음)이 어긋난다. `cargo check`를 한 번 돌리면 Cargo가 자동으로 `Cargo.lock`을
새 버전에 맞게 갱신한다(재빌드 아님 — 기존 빌드 캐시를 그대로 쓰므로 빠르다).

## 5. 최종 확인

세 파일의 버전이 정확히 일치하는지 확인:

```bash
grep -m1 '"version"' package.json
grep -m1 '^version' src-tauri/Cargo.toml
grep -m1 '"version"' src-tauri/tauri.conf.json
```

세 값이 다르면 그대로 넘어가지 말고 원인을 찾아 고친다.

## 6. 이 스킬이 하지 않는 것 (범위 밖)

- **CHANGELOG.md에 새 버전 헤딩 작성** — 별도 요청 시에만. 릴리스 노트 작성은 이 스킬의 일이 아니다.
- **git 커밋/태그/푸시** — 명시 요청 시에만. (버전 파일 변경 후 커밋할지는 항상 사용자에게
  물어본다 — 세션 규칙상 커밋은 명시 요청이 있을 때만.)
- **저장소 전체 grep으로 다른 곳의 버전 문자열 찾아 고치기** — 하지 않는다. `About` 화면처럼
  `getVersion()`으로 런타임에 `tauri.conf.json`을 읽어 표시하는 곳은 코드 수정이 필요 없다.
  `CHANGELOG.md`의 과거 버전 헤딩, `docs/*` 안의 예시로 인용된 옛 버전 번호, worklog의 날짜별
  기록 등 **히스토리 기록**은 절대 건드리지 않는다 — 실수로 발견해도 보고만 하고 고치지 않는다.

## 7. 결과 보고

짧게: 이전 버전 → 새 버전, 갱신한 파일 3개(+ Cargo.lock) 목록만. 커밋 여부는 별도로 물어본다.

예:
> 버전을 1.6.0 → 1.6.1로 올렸습니다 (patch).
> 갱신: `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
> `src-tauri/tauri.conf.json`.
> 커밋할까요?
