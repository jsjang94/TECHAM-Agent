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

const PROXY_BASE_URL = 'https://techam-proxy.vercel.app';

// 🌟 도구 실행기 (API 통신 전담)
export async function executeMcpTool(name: string, args: any, config: any): Promise<string> {
  try {
    if (name === 'search_jira') {
      const projects = config.jiraSpaces?.length > 0 ? `project in (${config.jiraSpaces.join(', ')}) AND ` : '';
      if (!args.keywords || args.keywords.length === 0) return "검색 키워드가 없습니다.";
      const keywordQueries = args.keywords.map((k: string) => `text ~ "${k.replace(/"/g, '')}"`).join(' AND ');
      const safeJql = `${projects}(${keywordQueries}) ORDER BY created DESC`;

      const res = await fetch(`${PROXY_BASE_URL}/api/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userEmail: config.userEmail, target: 'atlassian', method: 'POST', endpoint: '/rest/api/3/search/jql',
          body: { jql: safeJql, maxResults: 8, fields: ["summary", "status", "description", "comment"] }
        })
      });

      if (!res.ok) return `Jira API 통신 실패: ${await res.text()}`;
      const data = await res.json();
      if (!data.issues || data.issues.length === 0) return `해당 키워드 조합(${args.keywords.join(', ')})으로 검색된 Jira 이슈가 없습니다.`;

      return data.issues.map((i: any) => {
        let desc = extractTextFromJira(i.fields?.description);
        let commentsText = '';
        if (i.fields?.comment?.comments) {
            commentsText = i.fields.comment.comments.slice(-3).map((c: any) => `- ${extractTextFromJira(c.body).substring(0, 500)}`).join('\n');
        }
        return `[일감]: ${i.key}\n[링크]: ${i.issueLink}\n[제목]: ${i.fields?.summary} (${i.fields?.status?.name})\n[본문]: ${desc.substring(0, 2000)}\n[댓글]:\n${commentsText || '없음'}`;
      }).join('\n\n--------------------\n\n');
    }

    if (name === 'search_confluence') {
      const spaces = config.confSpaces?.length > 0 ? `space in (${config.confSpaces.map((s: string) => `"${s}"`).join(', ')}) AND ` : '';
      if (!args.keywords || args.keywords.length === 0) return "검색 키워드가 없습니다.";
      const keywordQueries = args.keywords.map((k: string) => `text ~ "${k.replace(/"/g, '')}"`).join(' AND ');
      const safeCql = `${spaces}(${keywordQueries}) order by created desc`;

      const res = await fetch(`${PROXY_BASE_URL}/api/proxy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userEmail: config.userEmail, target: 'atlassian', method: 'GET',
          endpoint: `/wiki/rest/api/content/search?cql=${encodeURIComponent(safeCql)}&limit=6&expand=body.plain`
        })
      });
      
      if (!res.ok) return `Confluence API 통신 실패: ${await res.text()}`;
      const data = await res.json();
      if (!data.results || data.results.length === 0) return `검색된 Confluence 문서가 없습니다.`;
      
      return data.results.map((r: any) => {
        // 🌟 핵심: Vercel이 만들어준 r.contentLink를 그대로 씁니다! (webLink 파싱 로직도 날려버립니다)
        return `[문서 제목]: ${r.title}\n[링크]: ${r.contentLink}\n[본문 내용]: ${(r.body?.plain?.value || '').substring(0, 3000)}`;
      }).join('\n\n--------------------\n\n');
    }

    if (name === 'search_zendesk') {
      if (!args.keywords || args.keywords.length === 0) return "검색 키워드가 없습니다.";
      const safeQuery = args.keywords.map((k: string) => `"${k.replace(/"/g, '')}"`).join(' ');
      
      const res = await fetch(`${PROXY_BASE_URL}/api/proxy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userEmail: config.userEmail, target: 'zendesk', method: 'GET',
          endpoint: `/api/v2/search.json?query=type:ticket%20${encodeURIComponent(safeQuery)}`
        })
      });
      
      if (!res.ok) return `Zendesk API 통신 실패: ${await res.text()}`;
      const data = await res.json();
      if (!data.results || data.results.length === 0) return `검색된 Zendesk 티켓이 없습니다.`;
      
      const topTickets = data.results.slice(0, 8);
      const ticketDetails = await Promise.all(topTickets.map(async (t: any) => {
        try {
          // 🌟 3번 버그 해결 (루프 내부 통신도 프록시로)
          const commentRes = await fetch(`${PROXY_BASE_URL}/api/proxy`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userEmail: config.userEmail, target: 'zendesk', method: 'GET', endpoint: `/api/v2/tickets/${t.id}/comments.json` })
          });
          const commentData = await commentRes.json();
          let conversation = `[최초 문의]: ${t.description?.substring(0, 300)}...`;
          if (commentData.comments?.length > 1) conversation += `\n[팀원 답변]: ${stripHtml(commentData.comments[commentData.comments.length - 1].body).substring(0, 600)}...`;

          return `[티켓 #${t.id}] ${t.subject}\n[링크]: ${t.ticketLink}\n${conversation}`;
        } catch (err) {
          return `[티켓 #${t.id}] ${t.subject}\n[링크]: ${t.ticketLink}\n[최초 문의]: ${t.description?.substring(0, 500)}...`;
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