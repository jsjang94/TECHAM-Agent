# CLAUDE.md

TECHAM Agent — Electron 플로팅 AI 어시스턴트. 단일 Gemini 에이전트가 Jira/Confluence/Zendesk/Hive 문서를 검색해 출처 인용된 답변을 생성. UI는 한국어.

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

## Gotchas
- `isChatLoading`/`isSubmittingNote`는 분리 유지, 합치지 말 것.
- 시크릿은 렌더러/localStorage에 절대 노출 금지.
- 하드코딩값: 위키 페이지 `285802836`, fallback space `~jsjang`, 기본 spaces `['GCPTAM']`.
