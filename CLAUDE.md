# CLAUDE.md

TECHAM Agent — Electron 플로팅 AI 어시스턴트. 단일 Gemini 에이전트가 Jira/Confluence/Zendesk/Hive 문서를 검색해 출처 인용된 답변을 생성. UI는 한국어.

## Workflow (에이전트 행동 지침)
사소한 수정(오타, 타입 수정, 린트 경고, 문서/상수값 변경 등)은 아래 규칙에서 제외. 새 기능 추가·기존 동작 변경에는 전부 적용.

### 1. 계획 수립 강제
- 새 기능, 기존 동작 변경, 아키텍처에 영향 주는 변경은 반드시 `superpowers:brainstorming` → `superpowers:writing-plans` 순서를 거칠 것. 코드부터 작성 금지.
- 브레인스토밍으로 요구사항·제약에 합의하고, 계획을 세운 뒤에 구현 착수.

### 2. TDD 사이클
- 이 프로젝트엔 테스트 프레임워크가 없음(`npm test`는 의도적 에러). 여기서 "테스트"는 (a) 순수 로직용 임시 node 검증 스크립트, (b) 스크립트로 검증 불가능한 부분(IPC/UI/창 동작)을 위한 `npm run build`+수동 실행 두 가지를 뜻함.
- 순수 로직(검색 랭킹, 파서, 포매터 등) 변경 시: 구현 전에 실패하는 임시 검증 스크립트 작성(레드) → 실행해 실패 확인 → 최소 구현(그린) → 정리(리팩터). 스크립트는 스크래치패드성 위치에 두고 커밋 대상 아님.
- 스크립트로 검증 불가능한 변경(IPC 핸들러, React 컴포넌트 등)은 기존처럼 build+수동 실행으로 검증하되, 구현 전에 "무엇이 성공/실패 기준인지" 먼저 적어둘 것.

### 3. 근본원인 추적 (추측 기반 수정 금지)
- 버그·에러·예상치 못한 동작을 만나면 바로 고치지 말고 `superpowers:systematic-debugging` 스킬을 먼저 호출.
- 순서: 재현 → 로그/코드 추적으로 가설 수립 → 가설별 검증 → 근본원인 확인 후에만 수정 착수. 여러 곳을 동시에 고치는 산탄총식 수정 금지.

## Commands
- `npm run dev` / `npm run build`(typecheck+build, 변경 검증용) / `npm run typecheck[:node|:web]` / `npm run lint` / `npm run format` / `npm run build:mac`
- 테스트 없음(`npm test`는 의도적 에러). `npm run build` + 수동 실행으로 검증, 순수 로직은 임시 node 스크립트로.
- lint에 기존 위반 ~800건 있음 — 내 변경으로 생긴 경고만 신경 쓸 것.

## Architecture
- 3 프로세스: `main/`(에이전트·모든 IPC·API 키 소유), `preload/`(작은 `window.api` 브릿지, 나머지는 `ipcRenderer`), `renderer/src/`(React 19, `App.tsx`가 상태 보유, `ChatWindow.tsx`가 UI).
- **자격증명은 완전 로컬, 서버 없음**: `main/credentials.ts`가 7개 시크릿(Gemini+Atlassian+Zendesk) 소유. base64 설정 코드로 1회 주입, `safeStorage`로 암호화. 렌더러는 키를 절대 다시 못 읽음. 코드 생성: `node scripts/make-setup-code.mjs <keys.json>`.
- 창은 기본적으로 풀스크린/투명/클릭통과. `App.tsx`가 `elementFromPoint`로 히트테스트해 `set-ignore-mouse` 토글. **클릭 가능한 UI는 반드시 `className="interactable"` 필요** — 없으면 클릭이 데스크톱으로 통과.
- 에이전트 루프: `chat-with-agent` IPC → `managerAgent.ts::processUserMessage`, `gemini-2.5-flash` 함수콜링 툴(`mcp/tools.ts`) 루프. 툴은 Jira/Confluence/Zendesk를 `nodeHttpsFetch`(raw Node https, `net.fetch` 아님)로 직접 호출 — Jira XSRF(Chromium 쿠키) 회피 목적.
- 검색은 AND 우선, 0건이면 OR 폴백 + `[안내:...]` 표기. 동작 대부분은 `SYSTEM_INSTRUCTION`에 있음 — 동작 변경은 코드보다 여기서.
- 모델에 보내는 히스토리는 의도적으로 잘림(최근 6개, 봇 메시지 600자 제한) — 전체 히스토리로 되돌리지 말 것.
- 위키 에러노트 작성(`write-error-note`)은 낙관적 락: GET→append→PUT version+1, Confluence 페이지 `285802836`, 409 시 3회 재시도.

## Frontend/UI
- 기존 UI를 손보거나 새 컴포넌트를 추가할 때는 `frontend-design` 스킬을 호출해 뻔한 제네릭 AI 스타일 대신 의도적인 선택을 할 것.
- 마이크로카피: 버튼 라벨과 결과 토스트/메시지의 동사를 일치시킬 것(예: "재시도" 버튼 → "재시도했습니다"). 시스템 용어 대신 사용자가 이해하는 말을 쓰고, 에러 메시지는 사과 대신 무엇이 잘못됐고 어떻게 고치는지 명시.
- 모션은 절제: 클릭통과/히트테스트 오버레이 특성상 산만한 애니메이션 금지. 새 인터랙티브 요소는 `className="interactable"`뿐 아니라 시각적으로도 차분하게 유지.

## Gotchas
- `isChatLoading`/`isSubmittingNote`는 분리 유지, 합치지 말 것.
- 시크릿은 렌더러/localStorage에 절대 노출 금지.
- 하드코딩값: 위키 페이지 `285802836`, fallback space `~jsjang`, 기본 spaces `['GCPTAM']`.
