import { app, BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'path'
import { optimizer, is } from '@electron-toolkit/utils'

// HTML 태그 및 찌꺼기를 날려주는 만능 정제기
const stripHtml = (html: string) => {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

function createWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize
  const initialSize = 250

  const mainWindow = new BrowserWindow({
    width: initialSize, height: initialSize,
    x: Math.floor((width - initialSize) / 2), y: Math.floor(height - initialSize),
    transparent: true, frame: false, resizable: false, alwaysOnTop: true, hasShadow: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })

  mainWindow.on('ready-to-show', () => { mainWindow.show() })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  ipcMain.on('resize-window', (event, targetWidth, targetHeight) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const x = Math.floor((width - targetWidth) / 2)
    const y = Math.floor(height - targetHeight)
    win.setBounds({ x, y, width: targetWidth, height: targetHeight })
  })
}

app.whenReady().then(() => {
  app.on('browser-window-created', (_, window) => { optimizer.watchWindowShortcuts(window) })
  createWindow()

  // 1. Confluence 검색
  ipcMain.handle('search-confluence', async (_, config, cql) => {
    try {
      const auth = Buffer.from(`${config.confEmail}:${config.confToken}`).toString('base64');
      const baseUrl = config.confUrl.endsWith('/') ? config.confUrl.slice(0, -1) : config.confUrl;
      const apiUrl = baseUrl.includes('/wiki') ? `${baseUrl}/rest/api/content/search` : `${baseUrl}/wiki/rest/api/content/search`;
      
      const res = await fetch(`${apiUrl}?cql=${encodeURIComponent(cql)}&limit=3&expand=body.plain`, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
      });
      const data = await res.json();
      if (!data.results || data.results.length === 0) return "검색된 Confluence 문서가 없습니다.";
      
      return data.results.map((r: any) => {
        const text = r.body?.plain?.value || '내용 없음';
        return `[제목]: ${r.title}\n[본문]: ${text.substring(0, 1000)}...\n[링크]: ${baseUrl.split('/wiki')[0]}/wiki${r._links.webui}`;
      }).join('\n\n');
    } catch (e: any) { return `Confluence 검색 실패: ${e.message}`; }
  });

  // 2. Jira 검색 
  ipcMain.handle('search-jira', async (_, config, jql) => {
    try {
      const auth = Buffer.from(`${config.confEmail}:${config.confToken}`).toString('base64');
      const res = await fetch(`${config.confUrl}/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=3`, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
      });
      const data = await res.json();
      if (!data.issues || data.issues.length === 0) return "검색된 Jira 이슈가 없습니다.";
      
      return data.issues.map((i: any) => {
        const desc = i.fields.description || '내용 없음';
        return `[티켓]: ${i.key}\n[제목]: ${i.fields.summary} (상태: ${i.fields.status?.name})\n[본문]: ${desc.substring(0, 1000)}...`;
      }).join('\n\n');
    } catch (e: any) { return `Jira 검색 실패: ${e.message}`; }
  });

  // 3. Zendesk 검색 (사내 비공개 티켓 + 팀원 답변까지 싹쓸이 🌟)
  ipcMain.handle('search-zendesk', async (_, config, query) => {
    try {
      if (!config.zendeskEmail || !config.zendeskToken || !config.zendeskSubdomain) {
        return "Zendesk API 정보가 설정되지 않았습니다. 설정 화면에서 입력해주세요.";
      }
      
      const auth = Buffer.from(`${config.zendeskEmail}/token:${config.zendeskToken}`).toString('base64');
      const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };

      // 1단계: 조건에 맞는 티켓 3개 검색
      const searchRes = await fetch(`https://${config.zendeskSubdomain}.zendesk.com/api/v2/search.json?query=type:ticket ${encodeURIComponent(query)}`, { headers });
      const searchData = await searchRes.json();
      if (!searchData.results || searchData.results.length === 0) return "검색된 Zendesk 티켓이 없습니다.";
      
      const topTickets = searchData.results.slice(0, 3);

      // 2단계: 검색된 3개 티켓의 '답변(Comments)' 내용을 긁어와서 합치기
      const ticketDetails = await Promise.all(topTickets.map(async (t: any) => {
        try {
          const commentRes = await fetch(`https://${config.zendeskSubdomain}.zendesk.com/api/v2/tickets/${t.id}/comments.json`, { headers });
          const commentData = await commentRes.json();
          
          let conversation = `[최초 문의]: ${t.description?.substring(0, 300)}...`;

          // 코멘트가 2개 이상이면 (최초 문의 외에 누군가 답변을 달았다면)
          if (commentData.comments && commentData.comments.length > 1) {
            // 가장 마지막에 달린 코멘트(최신 답변)를 가져옴
            const lastComment = commentData.comments[commentData.comments.length - 1].body;
            // 찌꺼기 HTML 태그가 있을 수 있으니 stripHtml 함수로 정제
            conversation += `\n[팀원 답변]: ${stripHtml(lastComment).substring(0, 600)}...`;
          } else {
            conversation += `\n[팀원 답변]: (아직 답변이 등록되지 않았습니다)`;
          }

          return `[티켓 #${t.id}] ${t.subject}\n[상태]: ${t.status}\n${conversation}`;
        } catch (err) {
          // 코멘트 로드에 실패해도 티켓 기본 정보는 보여주도록 방어
          return `[티켓 #${t.id}] ${t.subject}\n[상태]: ${t.status}\n[최초 문의]: ${t.description?.substring(0, 500)}...`;
        }
      }));

      // AI가 보기 좋게 구분선을 넣어서 반환
      return ticketDetails.join('\n\n--------------------\n\n');
    } catch (e: any) { return `Zendesk 검색 실패: ${e.message}`; }
  });

  // 4. Hive Developers 문서 크롤링
  ipcMain.handle('scrape-hive-docs', async (_, urlPath) => {
    try {
      const targetUrl = `https://developers.hiveplatform.ai/ko/latest/${urlPath}`.replace(/([^:]\/)\/+/g, "$1");
      const res = await fetch(targetUrl);
      const html = await res.text();
      return `[출처: ${targetUrl}]\n${stripHtml(html).substring(0, 2000)}`;
    } catch (e: any) { return `Hive 문서 접근 실패: ${e.message}`; }
  });
})