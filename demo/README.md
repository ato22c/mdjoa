# 데모 · 마케팅 에셋

랜딩 페이지(`docs/landing-page-plan.md`)용 스크린샷·GIF와, 그걸 만드는 재현 도구.

## 랜딩 시안 (A / B)

두 가지 콘텐츠 방향. 디자인 시스템(CSS·폰트·앱 창 프레임·모노 eyebrow)은 공유, 테마/카피/구성만 다름.

- **A안** — "AI가 고친 문서, 눈으로 바로 확인". 렌더링·변경 리뷰·번역 중심.
  `landing/index.html` (dev) · `landing/standalone.html` (더블클릭) · `landing/artifact.html` (claude.ai)
- **B안** — "AI랑 일하는 사람의 책상 위 필수 앱". CLAUDE.md·SKILL.md·AGENT.md·커맨드를 한곳에서 바로 열고 확인(`.claude` 사이드바 + 빠른 열기) 중심.
  `landing/index-b.html` · `landing/standalone-b.html` · `landing/artifact-b.html`

## 파일

- `showcase.md` — A안 데모 문서(결제 서비스 릴리스 노트). 렌더링 강점(표·콜아웃·체크리스트·코드·수식·Mermaid) 시연.
- `showcase-b.md` — B안 데모 문서(deploy-web SKILL.md). AI 지침 문서가 렌더링된 모습.
- `assets/` — 캡처된 에셋
  - `showcase-rendered-light.png` / `-dark.png` — 렌더 히어로 컷(라이트/다크)
  - `showcase-rendered-mid.png` — Mermaid 플로우차트 + 코드 하이라이팅 구간
  - `feature-review-diff.png` — AI 변경 리뷰 센터(이전/현재 2-pane diff) 스틸
  - `feature-raw-vs-rendered.gif` — 원문(마크다운 소스) → 렌더링 전환 ("역시 렌더링된 걸 봐야지")
  - `feature-auto-reload.gif` — 파일이 바뀌면 뷰어가 즉시 갱신(상태·표·체크리스트 동시 반영)
- `harness/` — 캡처 재현용 임시 도구(배포 코드 아님)

## 에셋은 어떻게 만들었나 (재현)

`harness/`는 **앱의 실제 렌더링 파이프라인**(`src/lib/markdown.ts`의 markdown-it + Shiki + KaTeX + Mermaid + 실제 CSS)을 Tauri 셸 없이 그대로 써서 `showcase.md`를 렌더한다. 즉 스크린샷은 앱이 실제로 보여주는 것과 동일한 렌더 결과다.

```bash
npm run dev   # Vite 프리뷰 (localhost:1420)
```

브라우저(또는 헤드리스 캡처)로 접속:

```
http://localhost:1420/demo/harness/index.html?scene=<SCENE>&theme=<light|dark>
```

`scene` 값:
- `rendered` — showcase.md 렌더 결과 (기본)
- `raw` — 렌더링 없이 마크다운 원문(원문 vs 렌더링 비교의 "before")
- `v1` / `v2` — 자동 새로고침 데모용 문서 두 버전(v2는 상태·표·체크리스트 일부가 바뀜)
- `diff` — AI 변경 리뷰 센터(이전/현재 2-pane diff, v1↔v2)

GIF 조립은 `gifski`(`brew install gifski`)로 프레임을 이어 붙였다. 정적 스크린샷은 headless 브라우저의 viewport 캡처를 사용.

> 참고: 긴 페이지의 full-page 캡처는 헤드리스에서 하단이 비는 이슈가 있어, viewport 캡처 + 스크롤 방식으로 잡았다.
