import { SchemaType, FunctionDeclaration } from '@google/generative-ai';

// 만능 HTML 정제기
export const stripHtml = (html: string) => {
  if (!html) return '';
  
  let processed = html
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '') 
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    // 🌟 핵심 1: id나 name 속성을 [SECTION: id명] 형태의 텍스트로 치환하여 AI에게 위치를 알려줌
    .replace(/<[a-zA-Z0-9]+[^>]* (id|name)=["']([^"']*)["'][^>]*>/gi, '\n\n[SECTION: $2]\n\n')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // 🌟 핵심 2: 링크 정보를 [텍스트](주소) 형태로 보존
    .replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, ' [$2]($1) ');

  return processed
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const extractTextFromJira = (content: any): string => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  
  let text = '';
  if (content.type === 'text' && content.text) {
    text += content.text + ' ';
  }
  if (content.content && Array.isArray(content.content)) {
    content.content.forEach((node: any) => {
      text += extractTextFromJira(node);
    });
  }
  return text.trim();
};

// 🌟 행동대장(Flash)이 사용할 도구 명세서
export const workerToolDeclarations: FunctionDeclaration[] = [
  {
    name: "search_confluence",
    description: "사내 Confluence 위키에서 문서를 검색합니다. 사용자의 질문 맥락을 정확히 파악하여, 검색에 반드시 동시 포함되어야 할 핵심 단어들을 1~3개 추출해 배열로 넘겨주세요.",
    parameters: { 
      type: SchemaType.OBJECT, 
      properties: { 
        keywords: { 
          type: SchemaType.ARRAY, 
          items: { type: SchemaType.STRING },
          description: "검색할 핵심 키워드 목록 (예: ['결제', '오류', '가이드'])" 
        } 
      }, 
      required: ["keywords"] 
    }
  },
  {
    name: "search_jira",
    description: "Jira에서 버그, 이슈 일감을 검색합니다. 사용자의 질문 맥락을 정확히 파악하여, 검색에 반드시 동시 포함되어야 할 핵심 단어들을 1~3개 추출해 배열로 넘겨주세요.",
    parameters: { 
      type: SchemaType.OBJECT, 
      properties: { 
        // 🌟 단순 STRING에서 ARRAY로 변경! 여러 키워드를 받습니다.
        keywords: { 
          type: SchemaType.ARRAY, 
          items: { type: SchemaType.STRING },
          description: "검색할 핵심 키워드 목록 (예: ['purchase', 'error', 'timeout'])" 
        } 
      }, 
      required: ["keywords"] 
    }
  },
  {
    name: "search_zendesk",
    description: "Zendesk에서 사내 비공개 고객 지원 티켓을 검색합니다. 사용자의 질문 맥락을 파악하여, 검색에 반드시 동시 포함되어야 할 핵심 단어들을 1~3개 추출해 배열로 넘겨주세요.",
    parameters: { 
      type: SchemaType.OBJECT, 
      properties: { 
        keywords: { 
          type: SchemaType.ARRAY, 
          items: { type: SchemaType.STRING },
          description: "검색할 핵심 키워드 목록 (예: ['환불', '지연', '영수증'])" 
        } 
      }, 
      required: ["keywords"] 
    }
  },
  {
    name: "scrape_hive_docs",
    description: "Hive Developers 사이트의 문서를 읽어옵니다. 상세 경로를 모를 경우, 해당 카테고리의 'index.html'을 먼저 읽어 링크를 확인한 후 이동하세요. (예: 'dev/authv4/index.html')",
    parameters: { 
      type: SchemaType.OBJECT, 
      properties: { 
        urlPath: { 
          type: SchemaType.STRING, 
          description: "문서 상대 경로 (반드시 .html 포함. 예: 'dev/authv4/login-helper.html')" 
        } 
      }, 
      required: ["urlPath"] 
    }
  }
];

// 🌟 도구 실행기 (API 통신 전담)
export async function executeMcpTool(name: string, args: any, config: any): Promise<string> {
  const auth = Buffer.from(`${config.confEmail}:${config.confToken}`).toString('base64');
  const baseUrl = config.confUrl.endsWith('/') ? config.confUrl.slice(0, -1) : config.confUrl;

  try {
    if (name === 'search_jira') {
      const projects = config.jiraSpaces && config.jiraSpaces.length > 0
        ? `project in (${config.jiraSpaces.join(', ')}) AND `
        : '';

      if (!args.keywords || args.keywords.length === 0) return "검색 키워드가 없습니다.";

      const keywordQueries = args.keywords
        .map((k: string) => `text ~ "${k.replace(/"/g, '')}"`)
        .join(' AND ');

      const safeJql = `${projects}(${keywordQueries}) ORDER BY created DESC`;

      const res = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          jql: safeJql, 
          // 🌟 다이어트 1: "6100201" 처럼 고유 키워드를 쓴다면 상위 8개면 충분히 힌트를 찾습니다. (15 -> 8)
          maxResults: 8, 
          fields: ["summary", "status", "description", "comment"] 
        })
      });

      if (!res.ok) return `Jira API 통신 실패 (${res.status}): ${await res.text()}`;

      const data = await res.json();
      if (!data.issues || data.issues.length === 0) return `해당 키워드 조합(${args.keywords.join(', ')})으로 검색된 Jira 이슈가 없습니다.`;

      return data.issues.map((i: any) => {
        const summary = i.fields?.summary;
        const status = i.fields?.status?.name;
        
        // 🌟 다이어트 2: JSON 구조를 날리고 순수 텍스트만 추출합니다. 
        // 텍스트만 뽑았기 때문에 3500자가 아니라 2000자만 해도 본문 전체를 넉넉히 커버합니다.
        let desc = extractTextFromJira(i.fields?.description);
          
        let commentsText = '';
        if (i.fields?.comment?.comments && i.fields.comment.comments.length > 0) {
            // 댓글도 최신 3개 정도의 순수 텍스트만 가져옵니다.
            const latestComments = i.fields.comment.comments.slice(-3);
            commentsText = latestComments.map((c: any) => {
                const cleanComment = extractTextFromJira(c.body);
                return `- ${cleanComment.substring(0, 500)}`;
            }).join('\n');
        }
        
        // 불필요한 기호(JSON)가 사라져서 토큰 사용량이 확 줄어듭니다.
        return `[일감]: ${i.key}\n[링크]: ${baseUrl}/browse/${i.key}\n[제목]: ${summary} (${status})\n[본문]: ${desc.substring(0, 2000)}\n[댓글]:\n${commentsText || '없음'}`;
      }).join('\n\n--------------------\n\n');
    }

    if (name === 'search_confluence') {
      const spaces = config.confSpaces && config.confSpaces.length > 0
        ? `space in (${config.confSpaces.map((s: string) => `"${s}"`).join(', ')}) AND `
        : '';

      if (!args.keywords || args.keywords.length === 0) return "검색 키워드가 없습니다.";

      // 🌟 개선 1: Confluence의 text 필드는 제목, 본문, 댓글을 모두 포괄하여 딥서치합니다.
      const keywordQueries = args.keywords
        .map((k: string) => `text ~ "${k.replace(/"/g, '')}"`)
        .join(' AND ');

      // 🌟 개선 2: 최신 생성 문서가 먼저 오도록 정렬 (created desc)
      const safeCql = `${spaces}(${keywordQueries}) order by created desc`;

      const apiUrl = baseUrl.includes('/wiki') ? `${baseUrl}/rest/api/content/search` : `${baseUrl}/wiki/rest/api/content/search`;
      
      // 🌟 개선 3: limit을 10으로 늘리고, 토큰 낭비를 막기 위해 순수 텍스트(body.plain)만 요청합니다.
      const res = await fetch(`${apiUrl}?cql=${encodeURIComponent(safeCql)}&limit=6&expand=body.plain`, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
      });
      
      if (!res.ok) return `Confluence API 통신 실패 (${res.status}): ${await res.text()}`;

      const data = await res.json();
      if (!data.results || data.results.length === 0) return `해당 키워드 조합(${args.keywords.join(', ')})으로 검색된 Confluence 문서가 없습니다.`;
      
      return data.results.map((r: any) => {
        // body.plain.value는 이미 HTML이 제거된 깔끔한 텍스트입니다.
        const plainText = r.body?.plain?.value || '내용 없음';
        
        // 🌟 개선 4: 넉넉하게 2000자까지 잘라서 AI에게 문맥을 충분히 줍니다.
        return `[문서 제목]: ${r.title}\n[링크]: ${baseUrl.split('/wiki')[0]}/wiki${r._links.webui}\n[본문 내용]: ${plainText.substring(0, 3000)}`;
      }).join('\n\n--------------------\n\n');
    }

    if (name === 'search_zendesk') {
      if (!args.keywords || args.keywords.length === 0) return "검색 키워드가 없습니다.";

      // Zendesk 검색 엔진이 각각의 단어를 반드시 포함해야 하는 단어로 인식하도록 따옴표로 감싸고 띄어쓰기로 연결합니다.
      // 예시: type:ticket "환불" "지연" "영수증"
      const safeQuery = args.keywords.map((k: string) => `"${k.replace(/"/g, '')}"`).join(' ');

      const zenAuth = Buffer.from(`${config.zendeskEmail}/token:${config.zendeskToken}`).toString('base64');
      const zenHeaders = { 'Authorization': `Basic ${zenAuth}`, 'Accept': 'application/json' };
      
      const res = await fetch(`https://${config.zendeskSubdomain}.zendesk.com/api/v2/search.json?query=type:ticket ${encodeURIComponent(safeQuery)}`, { headers: zenHeaders });
      
      if (!res.ok) return `Zendesk API 통신 실패 (${res.status}): ${await res.text()}`;
      
      const data = await res.json();
      if (!data.results || data.results.length === 0) return `해당 키워드 조합(${args.keywords.join(', ')})으로 검색된 Zendesk 티켓이 없습니다.`;
      
      // 🌟 AI가 문맥을 필터링할 수 있도록 3개에서 5개로 늘립니다. (Zendesk는 코멘트 통신이 무거워서 5개가 적당합니다)
      const topTickets = data.results.slice(0, 5);
      const ticketDetails = await Promise.all(topTickets.map(async (t: any) => {
        try {
          const commentRes = await fetch(`https://${config.zendeskSubdomain}.zendesk.com/api/v2/tickets/${t.id}/comments.json`, { headers: zenHeaders });
          const commentData = await commentRes.json();
          let conversation = `[최초 문의]: ${t.description?.substring(0, 300)}...`;
          if (commentData.comments && commentData.comments.length > 1) {
            conversation += `\n[팀원 답변]: ${stripHtml(commentData.comments[commentData.comments.length - 1].body).substring(0, 600)}...`;
          }
          return `[티켓 #${t.id}] ${t.subject}\n[링크]: https://${config.zendeskSubdomain}.zendesk.com/agent/tickets/${t.id}\n${conversation}`;
        } catch (err) {
          return `[티켓 #${t.id}] ${t.subject}\n[링크]: https://${config.zendeskSubdomain}.zendesk.com/agent/tickets/${t.id}\n[최초 문의]: ${t.description?.substring(0, 500)}...`;
        }
      }));
      return ticketDetails.join('\n\n--------------------\n\n');
    }

    else if (name === 'scrape_hive_docs') {
      const [purePath, anchor] = args.urlPath.split('#');
      let path = purePath.trim();
      if (!path.endsWith('.html') && !path.includes('.') && !path.endsWith('/')) path += '.html';
      
      const targetUrl = `https://developers.hiveplatform.ai/ko/latest/${path}`.replace(/([^:]\/)\/+/g, "$1");
      
      try {
        const res = await fetch(targetUrl);
        if (!res.ok) return `[404] ${targetUrl} 접속 실패. 경로를 확인하세요.`;

        const html = await res.text();
        const cleanText = stripHtml(html);

        if (anchor) {
          const marker = `[SECTION: ${anchor}]`;
          const anchorIndex = cleanText.indexOf(marker);
          if (anchorIndex !== -1) {
            // 앵커를 찾은 경우 해당 부분부터 반환
            return `[성공: ${targetUrl}#${anchor}]\n\n${cleanText.substring(anchorIndex, anchorIndex + 5000)}`;
          }
          // 앵커를 못 찾은 경우 안내 문구와 함께 전체 본문 반환
          return `[주의: 앵커 '${anchor}'를 찾지 못함]\n\n${cleanText.substring(0, 8000)}`;
        }

        return `[성공: ${targetUrl}]\n\n${cleanText.substring(0, 8000)}`;
      } catch (e: any) {
        return `스크래핑 중 네트워크 에러: ${e.message}`;
      }
    }

    // 5. 알 수 없는 도구일 경우 (이게 없으면 Promise<string> 에러가 납니다)
    return "알 수 없는 도구 명령입니다.";

  } catch (error: any) {
    // 최상위 에러 핸들링
    return `도구 실행 중 시스템 에러 발생: ${error.message}`;
  }
}