// src/main/index.ts
import { app, BrowserWindow, screen, ipcMain, net } from 'electron'
import { join } from 'path'
import { optimizer, is } from '@electron-toolkit/utils'
import { processUserMessage } from './agents/managerAgent'

// Gemini SDK 등 서드파티 라이브러리의 fetch도 Chromium 네트워킹 사용하도록 전역 교체
(global as any).fetch = net.fetch.bind(net)

const PROXY_BASE_URL = 'https://techam-proxy.vercel.app';
let keepAliveInterval: ReturnType<typeof setInterval> | null = null;
let keepAliveRetries = 0;

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
  createWindow()

  ipcMain.on('quit-app', () => {
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    app.exit(0)
  })

  // 마우스가 interactable 위: 클릭 캡처 / 투명 영역: 클릭 통과
  ipcMain.on('set-ignore-mouse', (event, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.setIgnoreMouseEvents(ignore, { forward: true })
  })

  // 이메일+비밀번호 로그인 검증
  ipcMain.handle('validate-credentials', async (_, email: string, password: string) => {
    const url = `${PROXY_BASE_URL}/api/proxy`;
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 2000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[Login] 시도 ${attempt}/${MAX_RETRIES} - email: ${email}`);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10초 타임아웃
        const res = await net.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userEmail: email.trim(), userPassword: password.trim(), target: 'login' }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const body = await res.text();
        console.log(`[Login] 응답 상태: ${res.status}, 바디: ${body.substring(0, 200)}`);
        return { authorized: res.status === 200 };
      } catch (err: any) {
        const cause = err.cause ? ` (cause: ${err.cause?.code || err.cause?.message || err.cause})` : '';
        const errMsg = err.name === 'AbortError' ? '타임아웃(10s)' : err.message;
        console.error(`[Login] 시도 ${attempt} 실패: ${errMsg}${cause}`);
        if (attempt < MAX_RETRIES) {
          console.log(`[Login] ${RETRY_DELAY_MS / 1000}초 후 재시도...`);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        } else {
          console.error(`[Login] 최대 재시도 횟수 초과. 로그인 실패.`);
          return { authorized: false };
        }
      }
    }
    return { authorized: false };
  });

  // Vercel 웜업 (최대 10회, 두 엔드포인트 병렬 핑, 어댑티브 타임아웃)
  ipcMain.handle('warmup-proxy', async () => {
    // 초반엔 짧게(콜드스타트 트리거 후 빠른 재시도), 후반엔 길게(긴 콜드스타트 대기)
    const MAX_ATTEMPTS = 30;
    // 초반: 짧게 반복해서 서버 깨우기, 후반: 길게 대기해서 콜드스타트 기다리기
    const getTimeoutMs = (attempt: number) => attempt < 5 ? 5000 : attempt < 15 ? 10000 : 20000;

    const ping = async (endpoint: string, timeoutMs: number): Promise<void> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        await net.fetch(`${PROXY_BASE_URL}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: 'ping' }),
          signal: ctrl.signal
        });
      } finally {
        clearTimeout(timer);
      }
    };

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const timeoutMs = getTimeoutMs(i);
      console.log(`[Warmup] 시도 (${i + 1}/${MAX_ATTEMPTS}) - 타임아웃: ${timeoutMs / 1000}s`);
      try {
        // 두 엔드포인트 동시에 핑 — 둘 다 응답해야 성공
        await Promise.all([ping('/api/proxy', timeoutMs), ping('/api/gemini', timeoutMs)]);
        console.log(`[Warmup] 성공 (${i + 1}번째 시도)`);
        // 기존 인터벌 초기화 후 4분 간격 keep-alive 시작
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        keepAliveRetries = 0;
        const keepAlivePing = () => {
          console.log('[KeepAlive] 서버 유지 핑...');
          const p = (endpoint: string) => net.fetch(`${PROXY_BASE_URL}${endpoint}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'ping' })
          });
          Promise.allSettled([p('/api/proxy'), p('/api/gemini')]).then(([proxy, gemini]) => {
            const proxyOk = proxy.status === 'fulfilled';
            const geminiOk = gemini.status === 'fulfilled';
            console.log(`[KeepAlive] /api/proxy ${proxyOk ? 'OK' : '실패'}`);
            console.log(`[KeepAlive] /api/gemini ${geminiOk ? 'OK' : '실패'}`);
            if (!proxyOk && !geminiOk) {
              keepAliveRetries++;
              if (keepAliveRetries >= 10) {
                console.error('[KeepAlive] 10회 재시도 실패 — 네트워크 에러 알림');
                keepAliveRetries = 0;
                BrowserWindow.getAllWindows()[0]?.webContents.send('keepalive-network-error');
              } else {
                console.warn(`[KeepAlive] 네트워크 단절 감지, 30초 후 재시도 (${keepAliveRetries}/10)...`);
                setTimeout(keepAlivePing, 30 * 1000);
              }
            } else {
              keepAliveRetries = 0;
            }
          });
        };
        keepAliveInterval = setInterval(keepAlivePing, 3 * 60 * 1000);
        return { ok: true };
      } catch (err: any) {
        const isTimeout = err.name === 'AbortError';
        const code = isTimeout ? 'TIMEOUT' : (err.cause?.code || err.message || 'FETCH_FAILED');
        console.error(`[Warmup] 시도 ${i + 1}/${MAX_ATTEMPTS} 실패: ${code}`);
        if (i < MAX_ATTEMPTS - 1) await new Promise(r => setTimeout(r, isTimeout ? 500 : 2000));
      }
    }
    return { ok: false };
  });

  // 🌟 [기존 코드 유지] 멀티 에이전트 통신 파이프라인
  ipcMain.handle('chat-with-agent', async (_, config, userMessage, chatHistory) => {
    try {
      const reply = await processUserMessage(userMessage, chatHistory, config);
      return { success: true, text: reply };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Atlassian 자격증명 헬퍼
  const getAtlassianAuth = async (userEmail: string): Promise<{ authHeader: string, baseUrl: string }> => {
    const res = await net.fetch(`${PROXY_BASE_URL}/api/proxy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail, target: 'atlassian-token' })
    });
    if (!res.ok) throw new Error(`Atlassian 인증 실패 (${res.status})`);
    const data = await res.json();
    if (!data.baseUrl) throw new Error('Atlassian baseUrl 없음');
    return { authHeader: data.authHeader, baseUrl: data.baseUrl };
  };

  // 🌟 [기존 코드 유지] 오답노트 검색
  ipcMain.handle('search-error-note', async (_, config, userQuestion) => {
    try {
      const { authHeader, baseUrl } = await getAtlassianAuth(config.userEmail);
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
  ipcMain.handle('write-error-note', async (_, config, noteData) => {
    try {
      const pageId = '285802836';
      const { authHeader, baseUrl } = await getAtlassianAuth(config.userEmail);
      const confluenceHeaders = { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' };

      // 1. GET
      const getRes = await net.fetch(`${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.storage,version,space`, {
        method: 'GET', headers: confluenceHeaders
      });
      if (!getRes.ok) throw new Error('페이지를 읽어오지 못했습니다.');
      const pageData = await getRes.json();

      let storageHtml = pageData.body.storage.value;
      const currentVersion = pageData.version.number;

      const linkHtml = noteData.link ? `<a href="${noteData.link}">${noteData.link}</a>` : '';
      const formattedQ = noteData.question.replace(/\n/g, '<br/>');
      const formattedA = noteData.answer.replace(/\n/g, '<br/>');
      const newRow = `<tr><td>${noteData.author}</td><td>${formattedQ}</td><td>${formattedA}</td><td>${linkHtml}</td></tr>`;

      if (storageHtml.includes('</tbody>')) {
        storageHtml = storageHtml.replace('</tbody>', `${newRow}</tbody>`);
      } else if (storageHtml.includes('</table>')) {
        storageHtml = storageHtml.replace('</table>', `${newRow}</table>`);
      } else {
        storageHtml += `<table><tbody><tr><th>등록자</th><th>질문</th><th>올바른 답변</th><th>참고 링크</th></tr>${newRow}</tbody></table>`;
      }

      const updateRes = await net.fetch(`${baseUrl}/wiki/rest/api/content/${pageId}`, {
        method: 'PUT', headers: confluenceHeaders,
        body: JSON.stringify({
          id: pageId, type: 'page', title: pageData.title,
          space: { key: pageData.space?.key || '~jsjang' },
          body: { storage: { value: storageHtml, representation: 'storage' } },
          version: { number: currentVersion + 1 }
        })
      });

      if (!updateRes.ok) {
        if (updateRes.status === 409) return { success: false, isConflict: true };
        throw new Error(await updateRes.text());
      }
      return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  });
})