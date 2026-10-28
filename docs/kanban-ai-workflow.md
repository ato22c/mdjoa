# Kanban-Driven AI Coding Workflow

> **개념 문서** — mdjoa 파일럿(v1.4)을 기반으로 작성.  
> 다른 프로젝트에서 이 패턴을 재현하려면 이 문서를 출발점으로 삼을 것.

---

## 1. 왜 이 접근이 필요한가

### 기존 AI 코딩의 한계

```
사용자: "이 버그 고쳐줘"
AI: 코드 수정
사용자: "아 그리고 이것도..."
AI: 또 수정
... (맥락이 흘러 사라짐)
```

- **상태가 없다**: 무엇이 됐는지, 무엇이 남았는지 대화에만 존재
- **워크플로가 없다**: todo → in-progress → done 흐름이 없어 우선순위 관리 불가
- **인수인계가 없다**: 세션이 끊기면 맥락 소실

### 이 패턴이 해결하는 것

칸반 카드가 **태스크의 진실 공급원(source of truth)**이 된다.

```
카드 (BL-001) ─── 클릭 ──→ AI가 카드 내용 읽음
                             ↓
                         코드 변경
                             ↓
                         카드 상태 업데이트 → BACKLOG.md 저장
```

- 카드는 변하지 않는다 — 대화가 사라져도 카드는 남는다
- AI는 카드에서 컨텍스트를 읽고, 카드에 결과를 쓴다
- 워크플로는 눈에 보인다 (할 일 / 진행 중 / 완료)

---

## 2. 카드가 갖춰야 할 구조

AI가 카드 하나만으로 작업할 수 있으려면 카드에 충분한 맥락이 있어야 한다.

```markdown
### [BL-001] 변경 내용 확인 창에서 이전/현재 문서가 좌우로 안 보임

- **Status**: 진행 중
- **Priority**: Should Have
- **Effort**: 2h
- **Category**: Bug
- **Assignee**: —
- **Dependencies**: none
- **Created**: 2026-06-23
- **Updated**: 2026-06-26

**Description**:
문서 변경 내용을 확인하는 창(변경 비교/diff 뷰)에서 이전 문서와 지금 문서가
나란히(좌우) 보여야 하는데, 실제로는 그렇게 표시되지 않는 것으로 보임.

**결과**:
변경 리뷰(ReviewCenter)·비교(CompareView)가 git식 단일 컬럼(통합) diff였음.
`toSideBySideRows` 등 추가해 좌우 2-pane으로 교체.
```

핵심 필드:
| 필드 | 목적 |
|------|------|
| `Description` | 현재 문제 / 기대 동작 / 재현 경로 |
| `결과` | 완료 기준 — AI가 "언제 멈춰야 하는지" 판단 기준 |
| `Category` | bug / feature / validation / improvement → AI 접근 방식 결정 |
| `Priority` | must / should / could → 자원 배분 |

---

## 3. 워크플로 단계

```
┌──────────┐     등록     ┌─────────────┐    AI 구현    ┌──────────────┐    검증    ┌──────┐
│  대충 아이디어 │ ──────→ │  BL 카드 (할 일) │ ──────────→ │ 진행 중 (코드변경) │ ────→ │ 완료 │
└──────────┘             └─────────────┘               └──────────────┘            └──────┘
     ↑                          ↑
     │                          │
  자연어 입력               AI가 필드 채움
  (대충 설명)               (제목/설명/결과 등)
```

### 단계 1: 등록 (자연어 → 구조화된 카드)

사용자가 대충 설명하면 AI가 BACKLOG.md 형식의 카드 필드를 채운다.

```
입력: "PDF 열면 맥에서 빈 화면"
  ↓
AI: {
  title: "macOS WKWebView에서 PDF 빈 화면 수정",
  category: "bug",
  priority: "should",
  effort: "1h",
  description: "PDF 파일을 앱에서 열면 macOS WKWebView가...",
  result: "PDF가 정상 렌더링됨..."
}
```

### 단계 2: 구현 계획 (카드 → 단계별 계획)

카드 클릭 → "구현 계획 생성" → AI가 어떤 파일을 어떻게 바꿀지 알려준다.

```
1. src-tauri/src/commands/file.rs — iframe sandbox 속성 제거
2. src/components/viewer/FrameViewer.tsx — PDF MIME 타입 감지 추가
3. public/index.html — CSP 헤더 수정
...
```

### 단계 3: 구현 실행 (계획 → 실제 코드 변경)

v1(현재 파일럿): 계획을 클립보드에 복사 → Claude Code 세션에 붙여넣기  
v2(목표): "구현 시작" 버튼 → 앱 내에서 Claude가 직접 파일 수정  
v3(장기): 변경 완료 → 자동 테스트 → 결과에 따라 카드 자동 이동

### 단계 4: 검증 및 완료

- 완료 기준은 카드의 `결과` 필드에 이미 명세됨
- 검증 후 카드 상태를 `done`으로 변경 → BACKLOG.md에 반영

---

## 4. mdjoa 파일럿 구현

### 현재 구현된 것

**등록 단계**: 대시보드 add-task 입력창에서 Enter → Tauri가 `backlog_generate_task` 호출

```rust
// src-tauri/src/commands/backlog.rs
#[command]
pub async fn backlog_generate_task(rough: String) -> Result<String, String> {
    // claude --model haiku -p <prompt> → JSON 반환
}
```

**계획 단계**: 카드 클릭 → 모달 → "구현 계획 생성" 버튼

```rust
#[command]
pub async fn backlog_plan_task(
    bl_id: String, title: String, desc: String, result: String,
) -> Result<String, String> {
    // claude --model haiku -p <계획 프롬프트> → 단계별 계획 텍스트 반환
}
```

**대시보드 진입**: 햄버거 메뉴 → "백로그 대시보드" → 별도 창으로 `dashboard.html` 열림

```rust
#[command]
pub fn open_dashboard_window(app: AppHandle) -> Result<(), String> {
    WebviewWindowBuilder::new(&app, "backlog-dashboard",
        WebviewUrl::App("dashboard.html".into()))...build()
}
```

### 파일 구조

```
mdjoa/
├── public/dashboard.html          # Tauri 서빙용 대시보드 (AI 통합 포함)
├── dashboard.html                 # 브라우저 독립 실행용 (테스트/참조)
├── BACKLOG.md                     # 태스크 데이터 (git 추적, 사람도 편집 가능)
└── src-tauri/src/commands/
    └── backlog.rs                 # 3개 Tauri 커맨드
```

### 프론트엔드 흐름

```javascript
// 카드 클릭 → 모달 열기
card.addEventListener('click', () => openTaskModal(task));

// 모달 내 "구현 계획 생성" 버튼
planBtn.addEventListener('click', async () => {
  const plan = await window.__TAURI__.core.invoke('backlog_plan_task', {
    blId, title, desc, result
  });
  // 결과를 모달 내 확장 영역에 표시
});
```

---

## 5. 다른 프로젝트에 적용하는 법

### 최소 요구 사항

1. **태스크 데이터 포맷**: `### [ID] 제목` + `- **Status**: ...` + Description + 결과 블록
2. **AI 접점**: claude CLI (로컬), OpenAI API, 또는 다른 LLM — 공통 인터페이스로 추상화
3. **대시보드**: `dashboard.html` 복사 후 `parseTaskMarkdown` / `toMarkdown` 함수 교체

### 이식 체크리스트

- [ ] `BACKLOG.md` (또는 동등한 태스크 파일) 생성
- [ ] `backlog_generate_task` — 자연어 → 카드 필드 JSON
- [ ] `backlog_plan_task` — 카드 내용 → 구현 단계 텍스트
- [ ] `open_dashboard_window` — 대시보드 창 열기
- [ ] `dashboard.html` — 칸반 UI, 파일 열기/저장
- [ ] 앱 메뉴/버튼에 대시보드 진입점 연결

### 스택 독립적인 부분

`dashboard.html` 자체는 순수 HTML/CSS/JS로 Tauri 없이도 동작한다.  
`window.__TAURI__` 체크로 Tauri 기능을 조건부 활성화하므로,  
브라우저에서 직접 열어도 파일 선택 → 칸반 표시 → 저장은 작동한다.

---

## 6. 로드맵 (개념)

| 단계 | 기능 | 상태 |
|------|------|------|
| v1 | 자연어 등록 → AI가 카드 필드 채움 | ✅ 구현됨 |
| v1 | AI 구현 계획 생성 (카드 컨텍스트 → 단계 목록) | ✅ 구현됨 |
| v2 | "구현 시작" → Claude Code가 직접 파일 수정 | 💡 아이디어 |
| v2 | 진행 상황 스트리밍 (카드에 실시간 로그) | 💡 아이디어 |
| v3 | 수정 후 자동 테스트 → 결과로 카드 자동 이동 | 💡 아이디어 |
| v3 | 멀티 에이전트 (설계 AI + 구현 AI + 검증 AI 분리) | 💡 아이디어 |

### v2 핵심 설계 포인트

"구현 시작" 버튼이 실제로 Claude Code를 실행하려면:

```rust
// 개념 코드 — 미구현
#[command]
pub async fn backlog_execute_task(bl_id: String, plan: String) -> Result<(), String> {
    // 1. 현재 디렉토리(프로젝트 루트) 확인
    // 2. claude -p "<계획>" --no-confirm 실행 (비대화형 모드)
    // 3. 실행 중 stdout을 채널로 프론트에 스트리밍
    // 4. 완료 후 카드 status → "done" 업데이트 이벤트 emit
}
```

주의: Claude Code는 아직 완전한 비대화형 실행 API가 없음.  
현실적인 v2는 "Claude Code 세션을 신규 터미널 탭으로 열고, 프롬프트를 자동 입력"하는 방식.

---

## 7. 이 패턴의 핵심 인사이트

> **카드가 AI의 스펙이다.**  
> Description이 충분히 구체적이면, AI는 누구의 도움 없이 혼자 구현할 수 있다.  
> 좋은 카드를 쓰는 것이 좋은 개발의 절반이다.

자연어 채팅의 맥락 손실 문제는 "대화를 더 잘하는" 방식으로는 해결되지 않는다.  
**상태를 외부화**하면 된다 — BACKLOG.md가 그 저장소다.
