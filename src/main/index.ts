// src/main/index.ts
import { app, BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'path'
import { optimizer, is } from '@electron-toolkit/utils'
import { processUserMessage } from './agents/managerAgent'

const PROXY_BASE_URL = 'https://techam-proxy.vercel.app';

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
    app.exit(0)
  })

  // 마우스가 interactable 위: 클릭 캡처 / 투명 영역: 클릭 통과
  ipcMain.on('set-ignore-mouse', (event, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.setIgnoreMouseEvents(ignore, { forward: true })
  })

  // 이메일+비밀번호 로그인 검증
  ipcMain.handle('validate-credentials', async (_, email: string, password: string) => {
    try {
      const res = await fetch(`${PROXY_BASE_URL}/api/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: email.trim(), userPassword: password.trim(), target: 'login' })
      });
      return { authorized: res.status === 200 };
    } catch {
      return { authorized: false };
    }
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

  // 🌟 [기존 코드 유지] 오답노트 검색
  ipcMain.handle('search-error-note', async (_, config, userQuestion) => {
    try {
      const res = await fetch(`${PROXY_BASE_URL}/api/proxy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: config.userEmail, target: 'atlassian', method: 'GET', endpoint: '/wiki/rest/api/content/285802836?expand=body.storage' })
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
      // 1. GET 
      const getRes = await fetch(`${PROXY_BASE_URL}/api/proxy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: config.userEmail, target: 'atlassian', method: 'GET', endpoint: `/wiki/rest/api/content/${pageId}?expand=body.storage,version,space` })
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

      const updateRes = await fetch(`${PROXY_BASE_URL}/api/proxy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userEmail: config.userEmail, target: 'atlassian', method: 'PUT', endpoint: `/wiki/rest/api/content/${pageId}`,
          body: {
            id: pageId, type: 'page', title: pageData.title,
            space: { key: pageData.space?.key || '~jsjang' }, 
            body: { storage: { value: storageHtml, representation: 'storage' } },
            version: { number: currentVersion + 1 }
          }
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