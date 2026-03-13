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

// 2. Jira 검색 (v3 API POST 방식 + 안전한 필드 파싱 🌟)
  ipcMain.handle('search-jira', async (_, config, jql) => {
    try {
      const auth = Buffer.from(`${config.confEmail}:${config.confToken}`).toString('base64');
      const baseUrl = config.confUrl.endsWith('/') ? config.confUrl.slice(0, -1) : config.confUrl;
      
      const res = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 
          'Authorization': `Basic ${auth}`, 
          'Accept': 'application/json',
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({
          jql: jql,
          maxResults: 5,
          // 🌟 방어 1: API에게 "제목, 상태, 본문" 필드만 콕 집어서 달라고 명시적으로 요청!
          fields: ["summary", "status", "description"]
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        return `[시스템 규칙: 에러 원인을 읽어줄 것]\nJira API 통신 실패 (${res.status}).\n원인: ${errText.substring(0, 300)}`;
      }

      const data = await res.json();
      
      if (data.errorMessages) return `JQL 문법 에러: ${data.errorMessages.join(', ')}`;
      if (!data.issues || data.issues.length === 0) return "검색된 Jira 이슈가 없습니다.";
      
      return data.issues.map((i: any) => {
        let desc = '내용 없음';
        
        // 🌟 방어 2: i.fields 자체가 아예 비어있을 경우를 대비한 완벽한 방어막(?.)
        if (i.fields?.description) {
          desc = typeof i.fields.description === 'string' 
            ? i.fields.description 
            : JSON.stringify(i.fields.description);
        }

        const summary = i.fields?.summary || '제목 없음';
        const status = i.fields?.status?.name || '상태 알 수 없음';

        return `[티켓]: ${i.key}\n[링크]: ${baseUrl}/browse/${i.key}\n[제목]: ${summary} (상태: ${status})\n[본문]: ${desc.substring(0, 800)}...`;
      }).join('\n\n--------------------\n\n');
    } catch (e: any) { 
      return `[시스템 규칙: 에러 원인을 읽어줄 것]\nJira 내부 코드 에러: ${e.message}`; 
    }
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

  // 5. 오답노트(일반 페이지) 검색 (스마트 문맥 가로채기 🌟)
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

      // 🌟 3. 스마트 문맥 필터링: '느슨한 투망(OR 조건)' 던지기
      const userText = userQuestion.toLowerCase();
      // 특수문자 제거 및 단어 쪼개기
      const userWords = userText.replace(/[^\w\s가-힣]/g, '').split(' ').filter(w => w.length > 0);

      const candidateNotes = notes.filter(note => {
        const qTarget = note.question.toLowerCase();
        const qWords = qTarget.replace(/[^\w\s가-힣]/g, '').split(' ').filter(w => w.length > 0);
        
        if (qWords.length === 0) return false;

        // 사용자의 단어가 노트 질문에 포함되거나, 노트 단어가 사용자 질문에 하나라도 포함되면 '후보'로 채택!
        return userWords.some(uw => qTarget.includes(uw)) || 
               qWords.some(qw => userText.includes(qw));
      });

      // 🌟 4. 건져올린 후보들을 AI에게 판단 맡기기
      if (candidateNotes.length > 0) {
         const ruleTexts = candidateNotes.map(n => 
           `[사내 규칙 후보]\n- 등록조건: ${n.question}\n- 준수할 답변: ${n.answer}\n- 참고링크: ${n.link}`
         ).join('\n\n');
         
         // AI 뇌에 꽂아버리는 아주 강력한 프롬프트 지시어
         return `다음은 사용자의 질문과 키워드가 일부 겹쳐 검색된 '사내 규칙 후보'들입니다. 사용자의 질문 문맥을 파악하여, 이 후보들 중 의미가 일치하는 규칙이 있다면 그 답변 가이드를 무조건 최우선으로 적용하여 대답하세요. (관련이 없다면 무시하세요.)\n\n${ruleTexts}`;
      }

      return null;
    } catch (e: any) { return null; }
  });

  // 6. 오답노트(일반 페이지) 쓰기 (테이블에 행 추가 및 충돌 방어 🌟)
  ipcMain.handle('write-error-note', async (_, config, noteData) => {
    try {
      const auth = Buffer.from(`${config.confEmail}:${config.confToken}`).toString('base64');
      const baseUrl = config.confUrl.endsWith('/') ? config.confUrl.slice(0, -1) : config.confUrl;
      const pageId = '285802836'; 
      const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json', 'Content-Type': 'application/json' };

      // 🌟 수정 1: URL 끝 expand에 'space'를 명시적으로 추가하여 스페이스 정보도 가져오기
      const getRes = await fetch(`${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.storage,version,space`, { headers });
      if (!getRes.ok) throw new Error('페이지를 읽어오지 못했습니다.');
      const pageData = await getRes.json();

      const currentVersion = pageData.version.number;
      let storageHtml = pageData.body.storage.value;

      // 2단계: 추가할 새 행(Row) HTML 만들기
      const linkHtml = noteData.link ? `<a href="${noteData.link}">${noteData.link}</a>` : '';
      const formattedQ = noteData.question.replace(/\n/g, '<br/>');
      const formattedA = noteData.answer.replace(/\n/g, '<br/>');
      const newRow = `<tr><td>${noteData.author}</td><td>${formattedQ}</td><td>${formattedA}</td><td>${linkHtml}</td></tr>`;

      // 3단계: 테이블 맨 아래(</tbody> 바로 앞)에 새 행 끼워 넣기
      if (storageHtml.includes('</tbody>')) {
        storageHtml = storageHtml.replace('</tbody>', `${newRow}</tbody>`);
      } else if (storageHtml.includes('</table>')) {
        storageHtml = storageHtml.replace('</table>', `${newRow}</table>`);
      } else {
        // 만약 문서가 비어있다면 표를 새로 그려줌
        storageHtml += `<table><tbody><tr><th>등록자</th><th>질문</th><th>올바른 답변</th><th>참고 링크</th></tr>${newRow}</tbody></table>`;
      }

      // 4단계: 버전을 +1 해서 업데이트(PUT) 요청
      const updateRes = await fetch(`${baseUrl}/wiki/rest/api/content/${pageId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          id: pageId,
          type: 'page',
          title: pageData.title,
          // 🌟 수정 2: space 정보가 없더라도 알려주신 개인 스페이스 키(~jsjang)로 강제 지정하는 안전장치!
          space: { key: pageData.space?.key || '~jsjang' }, 
          body: { storage: { value: storageHtml, representation: 'storage' } },
          version: { number: currentVersion + 1 }
        })
      });

      // [충돌 방어 로직] 409 Conflict 에러 시
      if (!updateRes.ok) {
        if (updateRes.status === 409) return { success: false, isConflict: true };
        throw new Error(await updateRes.text());
      }

      return { success: true };
    } catch (e: any) { 
      return { success: false, error: e.message }; 
    }
  });
})