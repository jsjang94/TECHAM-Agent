// src/main/index.ts
import { app, BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'path'
import { optimizer, is } from '@electron-toolkit/utils'
import { processUserMessage } from './agents/managerAgent'

function createWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize
  const initialSize = 250 

  const mainWindow = new BrowserWindow({
    width: initialSize, height: initialSize,
    x: Math.floor((width - initialSize) / 2), y: Math.floor(height - initialSize),
    
    // 🌟 바탕화면이 보이도록 창 자체를 완전히 투명하게 뚫어줍니다!
    transparent: true, 
    frame: false, 
    resizable: false, 
    alwaysOnTop: true, 
    hasShadow: false, // 투명 창의 경우 기본 그림자를 끕니다
    // backgroundColor: '#1c1c1e' <- ❌ 창 전체를 까맣게 만들던 이 줄을 완전히 삭제했습니다!
    
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })

  mainWindow.on('ready-to-show', () => { mainWindow.show() })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 창 리사이징 IPC 로직 (채팅창 열릴 때 크기 조절)
  ipcMain.on('resize-window', (event, targetWidth, targetHeight, isResizable) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.workAreaSize

    const x = Math.floor((width - targetWidth) / 2)
    
    // 🌟 핵심: 채팅창이 열리든 말든, 창의 시작점(y)을 무조건 화면 맨 아래(bottom)에 고정시킵니다!
    // 이렇게 하면 창이 위로만 쑥 늘어나고 로봇은 제자리에 가만히 있게 됩니다.
    const y = Math.floor(height - targetHeight)

    win.setResizable(isResizable)
    win.setBounds({ x, y, width: targetWidth, height: targetHeight }, true)
  })
}

app.whenReady().then(() => {
  app.on('browser-window-created', (_, window) => { optimizer.watchWindowShortcuts(window) })
  createWindow()

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
      const auth = Buffer.from(`${config.confEmail}:${config.confToken}`).toString('base64');
      const baseUrl = config.confUrl.endsWith('/') ? config.confUrl.slice(0, -1) : config.confUrl;
      const pageId = '285802836'; 

      const res = await fetch(`${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.storage`, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
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
      const auth = Buffer.from(`${config.confEmail}:${config.confToken}`).toString('base64');
      const baseUrl = config.confUrl.endsWith('/') ? config.confUrl.slice(0, -1) : config.confUrl;
      const pageId = '285802836'; 
      const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json', 'Content-Type': 'application/json' };

      const getRes = await fetch(`${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.storage,version,space`, { headers });
      if (!getRes.ok) throw new Error('페이지를 읽어오지 못했습니다.');
      const pageData = await getRes.json();

      const currentVersion = pageData.version.number;
      let storageHtml = pageData.body.storage.value;

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

      const updateRes = await fetch(`${baseUrl}/wiki/rest/api/content/${pageId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          id: pageId,
          type: 'page',
          title: pageData.title,
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