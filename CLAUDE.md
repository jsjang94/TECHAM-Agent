# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TECHAM Agent — an Electron desktop app that acts as a floating AI assistant. A single Gemini agent answers sabin (in-house) questions by searching Jira, Confluence, Zendesk, and the Hive developer docs, then synthesizes a cited answer. UI is Korean.

## Commands

```bash
npm run dev          # run app in dev (electron-vite, hot reload)
npm run build        # typecheck (node + web) THEN electron-vite build — use this to verify changes
npm run typecheck    # tsc for both node (main/preload) and web (renderer) projects
npm run typecheck:node   # main + preload only
npm run typecheck:web    # renderer only
npm run lint         # eslint (see caveat below)
npm run format       # prettier --write .
npm run build:mac    # package a macOS build
```

- **There is no test suite** (`npm test` intentionally errors). Verify changes with `npm run build` (typecheck) plus manually running the app, or by extracting pure logic into a throwaway node script and running it. Renderer-only React logic can't be observed headlessly here.
- **Lint is noisy**: the repo has ~800 pre-existing prettier/`explicit-function-return-type`/`no-explicit-any` violations. When you touch a file, only care about warnings your change introduced (especially `react-hooks/*`), not the pre-existing flood.

## Architecture — the parts that span files

### Three processes; credentials are fully local (no server)
- `src/main/` — Node side. Runs the agent, executes all tool searches, owns every IPC handler, manages the window, **and is the sole owner of API keys**.
- `src/preload/` — context-bridge. Exposes a tiny typed `window.api` (`quitApp`, `minimizeApp`, `openExternal`); everything else goes through `window.electron.ipcRenderer`.
- `src/renderer/src/` — React 19 UI. `App.tsx` holds essentially all state; `ChatWindow.tsx` is the chat/settings/wiki panel.
- **`src/main/credentials.ts` is the single owner of all 7 secrets** (Gemini key + Atlassian base URL/email/token + Zendesk subdomain/email/token). They're provisioned once via a base64 "setup code" pasted on the setup screen (`LoginPopup.tsx`), encrypted with Electron `safeStorage`, and cached at `userData/credentials.enc`. **The renderer never reads keys back** — it only calls `save-credentials` (send setup code) and `has-credentials` (boolean gate). All three services are called **directly** (Gemini→Google, Atlassian/Zendesk→their APIs); there is no proxy server. `credentials.ts` builds the Atlassian/Zendesk `Basic` auth headers locally, matching the exact format the old proxy used.
- Generate a setup code with `node scripts/make-setup-code.mjs <keys.json | .env path>`. (History: this app used to route everything through a Vercel proxy `techam-proxy` to hide keys; that was removed to eliminate cold-start warmup — keys are now local. `~/techam-proxy` may still exist as a dormant repo.)

### The transparent click-through overlay (non-obvious)
The window is fullscreen, frameless, transparent, always-on-top (`main/index.ts` `createWindow`). By default mouse events pass through to the desktop (`setIgnoreMouseEvents(true, {forward:true})`). `App.tsx` hit-tests `document.elementFromPoint` on every mousemove and toggles ignore on/off via the `set-ignore-mouse` IPC depending on whether the cursor is over an element with class `.interactable`. **Any clickable UI must carry `className="interactable"` or clicks fall through to the desktop.** The chat window is not an OS window — it's a `position:fixed` div dragged via CSS (`chatPosRef`, `handleTitlebarMouseDown`).

### Agentic RAG flow (single agent, multi-tool)
`renderer handleSend` → IPC `chat-with-agent` → `main/agents/managerAgent.ts::processUserMessage`. That runs ONE Gemini `gemini-2.5-flash` model (`new GoogleGenerativeAI(getGeminiApiKey())`, direct to Google) with function-calling tools declared in `main/mcp/tools.ts`. The tool-call loop (`while functionCalls`) executes tools with `Promise.all` (so multiple sources run in parallel) and feeds results back until the model produces final text. The whole agent loop runs locally in main. Tools (`search_jira`, `search_confluence`, `search_zendesk`, `search_hive_docs`, `scrape_hive_docs`) hit Jira/Confluence/Zendesk **directly** from main using auth from `credentials.ts` (`getAtlassianAuth()` / `getZendeskAuth()`, no args) — via `nodeHttpsFetch` (raw Node `https`), NOT `net.fetch`, specifically to avoid Chromium attaching session cookies/Origin that trigger Jira XSRF.

### Search retrieval design (in `tools.ts`)
Each Atlassian/Zendesk search does **AND first, then OR fallback** when AND returns zero, and prepends a `[안내: ...]` note so the model knows results are loosely-matched. Jira sorts by `updated DESC`; Confluence omits `order by` to use relevance ranking. Zendesk has no OR operator, so its fallback re-searches with just the first (most important) keyword — hence tool schemas instruct the model to list keywords most-important-first.

### System prompt is the product logic
`managerAgent.ts::SYSTEM_INSTRUCTION` encodes most behavior: per-source formatting, multi-source cross-referencing, mandatory clickable markdown source links, a **re-grounding rule** (never reuse URLs/facts from prior turns without re-searching), and the answer structure (conclusion → per-source evidence → links). Behavior changes usually belong here, not in code.

### Conversation history is deliberately trimmed
`App.tsx` sends the last `HISTORY_LIMIT` (6) messages, truncating bot messages to `HISTORY_BOT_MAX_CHARS` (600) with an explicit "…생략" marker. This is intentional: replaying full past answers (with scraped URLs/code) caused the model to skip re-searching and hallucinate. Don't "simplify" this back to raw full history.

### Answer rendering
Bot (non-system) messages render through `react-markdown` + `remark-gfm` + `remark-breaks` in `ChatWindow.tsx`. Links are intercepted and opened in the external browser via the `open-external` IPC (`shell.openExternal`, http/https only) — never let a link navigate the app window. `normalizeBotMarkdown` escapes leading `[label]:` lines so tool-result formatting isn't silently eaten as markdown link-reference-definitions.

### Wiki "error note" (팀 위키) — optimistic-locking write
IPC `write-error-note` appends a row to a fixed Confluence page (id hardcoded `285802836`). It's a read-modify-write: GET current version → append row → PUT `version+1`. Confluence returns 409 on concurrent edits, so it retries up to 3× (re-GET latest, re-append) before surfacing `isConflict`. All user input is HTML-escaped (`escapeHtml`) before insertion because Confluence storage is XHTML. IPC `search-error-note` reads the same page and injects matching rows as top-priority context into the agent prompt (a lightweight curated-answer override layer).

### Startup / setup gate
`app.whenReady` calls `loadCredentials()` (best-effort decrypt of `credentials.enc`). On mount, `App.tsx` asks main `has-credentials`; the agent click opens chat instantly if credentials exist, else shows the setup screen. There is **no warmup/keepalive/network machinery** — it was all proxy cold-start mitigation and was removed. `config.userEmail` is now just a non-secret identity label (set at setup, stored in `localStorage`, used e.g. as wiki-author hint); the real readiness gate is `hasCredentials`.

## Conventions / gotchas
- Loading state is split by action: `isChatLoading` (chat) vs `isSubmittingNote` (wiki). Config save is synchronous. Keep them separate; don't reintroduce a shared `isLoading`.
- `main/index.ts` sets `global.fetch = net.fetch` so the Gemini SDK uses Chromium networking to reach Google — but tool searches deliberately use `nodeHttpsFetch` instead (see above).
- Secrets live only in `main` (`credentials.ts` in-memory + `safeStorage` at rest). Never route a key through the renderer or `localStorage`. `has-credentials` returns a boolean only.
- Hardcoded values worth knowing: wiki page id `285802836` and fallback space `~jsjang` (`main/index.ts`), default spaces `['GCPTAM']` (`App.tsx`).
- Renderer talks to main almost entirely via untyped `(window as any).electron.ipcRenderer.invoke(...)`. `config` (`{userEmail, confSpaces, jiraSpaces}`) is passed on each call and is the source of truth for search scope (no secrets).
