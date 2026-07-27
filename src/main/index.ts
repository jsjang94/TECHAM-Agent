// src/main/index.ts
import { app, BrowserWindow, screen, ipcMain, net, shell } from 'electron'
import { join } from 'path'
import { optimizer, is } from '@electron-toolkit/utils'
import { processUserMessage } from './agents/managerAgent'
import { nodeHttpsFetch } from './mcp/tools'
import { loadCredentials, saveCredentials, hasCredentials, getAtlassianAuth, getZendeskAuth, getGeminiApiKey } from './credentials'

// Gemini SDK 등 서드파티 라이브러리의 fetch도 Chromium 네트워킹 사용하도록 전역 교체
(global as any).fetch = net.fetch.bind(net)

// Confluence storage 포맷은 XHTML이라 사용자 입력을 그대로 넣으면 <, &, " 등이
// 페이지 구조를 깨거나 의도치 않은 마크업으로 주입된다. HTML 엔티티로 이스케이프한다.
// (&를 가장 먼저 치환해야 뒤에 생기는 &lt; 등이 이중 이스케이프되지 않는다.)
const escapeHtml = (s: string): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function createWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize

  // 창을 항상 풀스크린으로 고정 → 채팅창은 CSS로 드래그, 에이전트는 화면에 고정
  const mainWindow = new BrowserWindow({
    width, height,
    x: 0, y: 0,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })

  mainWindow.on('ready-to-show', () => { mainWindow.show() })

  // 기본적으로 투명 영역 클릭을 바탕화면으로 통과시킴
  mainWindow.setIgnoreMouseEvents(true, { forward: true })

  // 다른 앱 사용 시 뒤로 숨김, 포커스 시 다시 최상단
  mainWindow.on('blur', () => { mainWindow.setAlwaysOnTop(false) })
  mainWindow.on('focus', () => { mainWindow.setAlwaysOnTop(true) })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

}


app.whenReady().then(() => {
  app.on('browser-window-created', (_, window) => { optimizer.watchWindowShortcuts(window) })
  // 저장된 로컬 자격증명을 메모리로 로드 (없으면 미설정 상태 → 렌더러가 설정 화면 표시)
  loadCredentials()
  createWindow()

  ipcMain.on('quit-app', () => {
    app.exit(0)
  })

  // 최소화 버튼 → 앱 전체(에이전트 포함)를 mac Dock으로 최소화
  ipcMain.on('minimize-app', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  // Dock 아이콘 클릭 시 최소화된 창 복원
  app.on('activate', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win?.isMinimized()) win.restore()
  })

  // 마우스가 interactable 위: 클릭 캡처 / 투명 영역: 클릭 통과
  ipcMain.on('set-ignore-mouse', (event, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.setIgnoreMouseEvents(ignore, { forward: true })
  })

  // 채팅 답변의 마크다운 링크 클릭 → 앱 창 대신 기본 브라우저로 열기 (http/https만 허용)
  ipcMain.on('open-external', (_, url: string) => {
    try {
      const { protocol } = new URL(url)
      if (protocol === 'http:' || protocol === 'https:') shell.openExternal(url)
    } catch {
      /* 잘못된 URL은 무시 */
    }
  })

  // 설정 코드(base64 JSON) 저장 — 렌더러가 붙여넣은 설정 코드를 받아 safeStorage로 암호화 저장.
  // 키 값은 main에만 머물고 렌더러로 돌려주지 않는다.
  ipcMain.handle('save-credentials', async (_, setupCode: string) => saveCredentials(setupCode));

  // 자격증명 설정 여부만 반환 (렌더러 게이트용) — 실제 키 값은 절대 노출하지 않음
  ipcMain.handle('has-credentials', async () => hasCredentials());

  // 🌟 멀티 에이전트 통신 파이프라인. 멀티홉은 오래 걸려(15~30초+) 단계 진행 상황을
  // 'agent-progress' 이벤트로 렌더러에 스트리밍한다(반환값 계약은 그대로 유지).
  ipcMain.handle('chat-with-agent', async (event, config, userMessage, chatHistory) => {
    try {
      const reply = await processUserMessage(userMessage, chatHistory, config, (p) => {
        try {
          event.sender.send('agent-progress', p);
        } catch {
          /* 렌더러가 사라졌거나 전송 실패 → 무시 */
        }
      });
      return { success: true, text: reply };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Gemini / Atlassian / Zendesk 연결 상태 확인 (채팅창 상단 상태 표시용) — 로컬 자격증명으로 직결
  ipcMain.handle('check-integrations-health', async () => {
    const checkGemini = async (): Promise<boolean> => {
      try {
        // 모델 목록 조회 — 토큰을 소모하지 않는 가장 가벼운 엔드포인트로 연결만 확인 (키는 헤더로)
        const res = await net.fetch('https://generativelanguage.googleapis.com/v1beta/models', {
          method: 'GET',
          headers: { 'x-goog-api-key': getGeminiApiKey() }
        });
        console.log(`[Health/Gemini] 응답 상태: ${res.status}`);
        if (!res.ok) console.error(`[Health/Gemini] 실패 응답 바디: ${(await res.text()).substring(0, 500)}`);
        return res.ok;
      } catch (err: any) {
        console.error(`[Health/Gemini] 예외 발생: ${err.message}`);
        return false;
      }
    };

    const checkAtlassian = async (): Promise<boolean> => {
      try {
        const { authHeader, baseUrl } = getAtlassianAuth();
        const res = await nodeHttpsFetch(`${baseUrl}/rest/api/3/myself`, {
          method: 'GET', headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
        });
        console.log(`[Health/Atlassian] 응답 상태: ${res.status}`);
        if (!res.ok) console.error(`[Health/Atlassian] 실패 응답 바디: ${(await res.text()).substring(0, 500)}`);
        return res.ok;
      } catch (err: any) {
        console.error(`[Health/Atlassian] 예외 발생: ${err.message}`);
        return false;
      }
    };

    const checkZendesk = async (): Promise<boolean> => {
      try {
        const { authHeader, baseUrl } = getZendeskAuth();
        const res = await nodeHttpsFetch(`${baseUrl}/api/v2/users/me.json`, {
          method: 'GET', headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
        });
        console.log(`[Health/Zendesk] 응답 상태: ${res.status}`);
        if (!res.ok) console.error(`[Health/Zendesk] 실패 응답 바디: ${(await res.text()).substring(0, 500)}`);
        return res.ok;
      } catch (err: any) {
        console.error(`[Health/Zendesk] 예외 발생: ${err.message}`);
        return false;
      }
    };

    const [gemini, atlassian, zendesk] = await Promise.all([checkGemini(), checkAtlassian(), checkZendesk()]);
    return { gemini, atlassian, zendesk };
  });

  // 🌟 [기존 코드 유지] 오답노트 검색
  ipcMain.handle('search-error-note', async (_, _config, userQuestion) => {
    try {
      const { authHeader, baseUrl } = getAtlassianAuth();
      const res = await net.fetch(`${baseUrl}/wiki/rest/api/content/285802836?expand=body.storage`, {
        method: 'GET', headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
      });
      const data = await res.json();
      const html = data.body?.storage?.value || '';

      const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let match;
      const notes: any[] = [];

      while ((match = trRegex.exec(html)) !== null) {
        const rowHtml = match[1];
        const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        const cells: string[] = [];
        let tdMatch;
        while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
          cells.push(tdMatch[1].replace(/<[^>]*>?/gm, ' ').replace(/&nbsp;/g, ' ').trim());
        }
        if (cells.length >= 3 && cells[1] !== '질문') { 
          notes.push({ author: cells[0], question: cells[1], answer: cells[2], link: cells[3] || '' });
        }
      }

      const userText = userQuestion.toLowerCase();
      const userWords = userText.replace(/[^\w\s가-힣]/g, '').split(' ').filter(w => w.length > 0);

      const candidateNotes = notes.filter(note => {
        const qTarget = note.question.toLowerCase();
        const qWords = qTarget.replace(/[^\w\s가-힣]/g, '').split(' ').filter(w => w.length > 0);
        if (qWords.length === 0) return false;
        return userWords.some(uw => qTarget.includes(uw)) || qWords.some(qw => userText.includes(qw));
      });

      if (candidateNotes.length > 0) {
         const ruleTexts = candidateNotes.map(n => 
           `[사내 규칙 후보]\n- 등록조건: ${n.question}\n- 준수할 답변: ${n.answer}\n- 참고링크: ${n.link}`
         ).join('\n\n');
         return `[시스템 힌트: 사용자의 질문 문맥을 파악하여 아래 사내 규칙 중 일치하는 것이 있다면 그 답변 가이드를 무조건 최우선으로 적용하세요.]\n\n${ruleTexts}`;
      }
      return null;
    } catch (e: any) { return null; }
  });

  // 🌟 [기존 코드 유지] 오답노트 등록
  ipcMain.handle('write-error-note', async (_, _config, noteData) => {
    try {
      const pageId = '285802836';
      const { authHeader, baseUrl } = getAtlassianAuth();
      const confluenceHeaders = { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' };

      // 추가할 행은 노트 내용에만 의존하므로 재시도해도 동일하다 → 루프 밖에서 한 번만 만든다.
      // 모든 사용자 입력을 이스케이프한 뒤에 개행을 <br/>로 바꾼다 (br 태그가 이스케이프되지 않도록 순서 유지).
      const safeLink = String(noteData.link || '').trim();
      const isHttpLink = /^https?:\/\//i.test(safeLink);
      const linkHtml = safeLink
        ? (isHttpLink ? `<a href="${escapeHtml(safeLink)}">${escapeHtml(safeLink)}</a>` : escapeHtml(safeLink))
        : '';
      const formattedQ = escapeHtml(noteData.question).replace(/\n/g, '<br/>');
      const formattedA = escapeHtml(noteData.answer).replace(/\n/g, '<br/>');
      const newRow = `<tr><td>${escapeHtml(noteData.author)}</td><td>${formattedQ}</td><td>${formattedA}</td><td>${linkHtml}</td></tr>`;

      // 409(동시 편집 충돌) 시 최신 버전을 다시 GET → 행 이어붙여 → PUT 을 최대 3회 재시도한다.
      // 409는 내 변경이 아직 반영되지 않았다는 뜻이라, 재-GET한 최신 본문(타인이 추가한 행 포함)에
      // 내 행을 덧붙이면 데이터 유실·중복 없이 안전하게 병합된다.
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // 1. 최신 본문 + 버전 GET
        const getRes = await net.fetch(`${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.storage,version,space`, {
          method: 'GET', headers: confluenceHeaders
        });
        if (!getRes.ok) throw new Error('페이지를 읽어오지 못했습니다.');
        const pageData = await getRes.json();

        let storageHtml = pageData.body.storage.value;
        const currentVersion = pageData.version.number;

        // 2. 표에 새 행 이어붙이기
        if (storageHtml.includes('</tbody>')) {
          storageHtml = storageHtml.replace('</tbody>', `${newRow}</tbody>`);
        } else if (storageHtml.includes('</table>')) {
          storageHtml = storageHtml.replace('</table>', `${newRow}</table>`);
        } else {
          storageHtml += `<table><tbody><tr><th>등록자</th><th>질문</th><th>올바른 답변</th><th>참고 링크</th></tr>${newRow}</tbody></table>`;
        }

        // 3. PUT (최신 버전 + 1)
        const updateRes = await net.fetch(`${baseUrl}/wiki/rest/api/content/${pageId}`, {
          method: 'PUT', headers: confluenceHeaders,
          body: JSON.stringify({
            id: pageId, type: 'page', title: pageData.title,
            space: { key: pageData.space?.key || '~jsjang' },
            body: { storage: { value: storageHtml, representation: 'storage' } },
            version: { number: currentVersion + 1 }
          })
        });

        if (updateRes.ok) return { success: true };

        // 409 → 다른 사람이 먼저 수정함. 최신 버전으로 재시도.
        if (updateRes.status === 409) {
          console.warn(`[WriteErrorNote] 409 충돌 - 최신 버전으로 재시도 (${attempt}/${MAX_ATTEMPTS})`);
          if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 300));
          continue;
        }
        // 그 외 에러는 재시도해도 소용없음 → 즉시 실패.
        throw new Error(await updateRes.text());
      }

      // 재시도를 모두 소진했는데도 계속 충돌 → 마지막 수단으로 사용자에게 충돌 안내.
      console.error('[WriteErrorNote] 재시도 모두 409 충돌로 실패');
      return { success: false, isConflict: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  });
})