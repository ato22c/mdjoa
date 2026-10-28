---
name: ui-ux
description: >-
  MD좋아(mdjoa) 앱의 UI/UX 변경·요청을 처리할 때 사용. 메뉴/툴바/패널/단축키/레이아웃
  추가·이동·정리, 버튼·아이콘·라벨 변경, "더 편하게/정리해줘" 류 요청 등 화면과
  상호작용에 관한 작업이면 이 스킬의 원칙을 적용한다. 표면 지시를 넘어 사용자 편의성을
  우선해 설계한다.
---

# UI/UX 작업 원칙 (사용자 편의성 우선)

UI/UX 관련 요청은 글자 그대로만 따르지 말고, **사용자 편의성**을 우선해 설계·구현한다.
요청에 없더라도 아래 관점을 기본으로 점검하고 적용한다.

## 설계 체크리스트
1. **콘텐츠 퍼스트 미니멀** (CLAUDE.md): 본문이 주인공. UI 크롬 최소화. 자주 안 쓰는
   컨트롤은 눈에 덜 띄는 곳(하단 상태바·햄버거 메뉴 등)으로, 자주 쓰는 건 가깝게.
2. **일관성**: 같은 동작은 어디서나 같은 라벨·아이콘·순서. 예) 햄버거 메뉴와 우클릭
   컨텍스트 메뉴의 항목 순서를 통일, 편집/보기 토글 라벨을 "편집 모드/보기 모드"로 통일.
   가능하면 기존 공통 빌더(`lib/fileActionMenuItems`, `lib/contextMenuItems`)와
   컴포넌트를 재사용한다.
3. **발견성·그룹핑**: 관련 항목끼리 묶고 구분선(divider)으로 구역을 나눈다. 긴 메뉴는
   그룹화. 문서가 없을 때 의미 없는 항목/구분선은 숨긴다.
4. **테마·접근성**: 색은 항상 테마 변수(`var(--fg)`, `var(--bg)`, `var(--border)`,
   `var(--accent)`, `var(--muted)` 등)로 — 라이트/다크 모두 검증. 버튼엔 title/aria,
   토글엔 상태(`is-active`/aria-checked).
5. **단축키**: 자주 쓰는 동작엔 단축키 제공(모디파이어는 `MOD_LABEL`/`metaKey||ctrlKey`로
   macOS=⌘·Windows=Ctrl 추상화). 컨텍스트에 따라 기존 단축키 의미를 재정의할 땐 그 화면에
   한정(예: 번역 분할 보기에서 ⌘E는 분할 유지한 채 편집↔뷰 토글).
6. **안전성**: 덮어쓰기·삭제 등 파괴적 동작은 확인 다이얼로그. 되돌리기 경로 제공.
   장시간 작업은 진행 표시 + 취소 수단 + 타임아웃.
7. **플랫폼**: Windows 우선·macOS 동시. OS 분기는 `lib/platform.ts`(isMac/isWindows/
   MOD_LABEL)와 `#[cfg(target_os)]`에만. 라벨도 OS에 맞게("Finder에서 보기"/"탐색기에서 보기").

## 작업 절차
1. 바꾸기 전, 관련 컴포넌트와 **기존 패턴**(라벨·아이콘·순서·공통 빌더)을 먼저 읽는다.
2. 위 체크리스트로 편의성 영향을 점검하고, 필요한 개선을 요청 범위와 함께 적용한다.
3. 변경 후 **검증**: `npx tsc --noEmit` → `npx vitest run`(로직 변경 시) →
   `npm run tauri -- build --no-bundle`로 빌드 → 가능하면 실행/스크린샷으로 시각 확인.
4. 미사용 import/핸들러/상태를 정리한다.

## 관련 파일
- 상단바 `src/components/layout/TopBar.tsx`, 하단 상태바 `src/components/layout/BottomBar.tsx`,
  햄버거 `src/components/layout/HamburgerMenu.tsx`, 레이아웃 `src/components/layout/AppShell.tsx`.
- 공통 우클릭 항목 `src/lib/fileActionMenuItems.ts`, 본문/편집 메뉴 `src/lib/contextMenuItems.ts`.
- 디자인 토큰·원칙은 `CLAUDE.md`의 "UI 디자인 원칙" 절.
