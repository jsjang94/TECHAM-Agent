import { SchemaType, FunctionDeclaration } from '@google/generative-ai';
import * as cheerio from 'cheerio';

// 만능 HTML 정제기 (유지)
export const stripHtml = (html: string) => {
  if (!html) return '';
  
  let processed = html
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '') 
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<[a-zA-Z0-9]+[^>]* (id|name)=["']([^"']*)["'][^>]*>/gi, '\n\n[SECTION: $2]\n\n')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, ' [$2]($1) ');

  return processed
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

// Jira 본문 추출기 (유지)
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

// 도구 명세서 (유지)
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
    name: "search_hive_docs",
    description: "사용자가 하이브(Hive) 개발자 사이트의 문서를 찾아달라고 할 때, 특정 키워드로 검색하여 관련 문서들의 URL 리스트와 요약을 가져옵니다. URL을 모를 때 이 도구로 먼저 검색하세요.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: { type: SchemaType.STRING, description: "검색할 키워드 (예: '빌링', '유저 인게이지먼트', '로그인')" }
      },
      required: ["query"]
    }
  },
  {
    name: "scrape_hive_docs",
    description: "하이브(Hive) 개발자 사이트의 특정 URL에 접속하여 문서의 본문 내용을 상세하게 읽어옵니다. URL을 이미 알고 있거나 search_hive_docs로 URL을 찾은 후에 문서 내용을 파악하기 위해 반드시 사용하세요.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        url: { type: SchemaType.STRING, description: "읽어올 Hive 개발자 사이트의 URL (예: https://developers.hiveplatform.ai/...)" }
      },
      required: ["url"]
    }
  }
];

const PROXY_BASE_URL = 'https://techam-proxy.vercel.app';

// 🌟 [핵심 변경] Atlassian (Jira/Confluence) 공통 토큰 발급 헬퍼 함수
async function getAtlassianAuth(userEmail: string): Promise<{ authHeader: string, baseUrl: string } | { error: string }> {
  try {
    const tokenRes = await fetch(`${PROXY_BASE_URL}/api/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail, target: 'atlassian-token' })
    });
    
    if (!tokenRes.ok) return { error: `Atlassian 인증 정보 획득 실패 (상태 코드: ${tokenRes.status})` };
    
    const data = await tokenRes.json();
    if (!data.baseUrl) return { error: "사내망 Atlassian 주소가 설정되지 않았습니다." };
    
    return { authHeader: data.authHeader, baseUrl: data.baseUrl };
  } catch (err: any) {
    return { error: `Atlassian 토큰 발급 중 시스템 에러: ${err.message}` };
  }
}

export async function executeMcpTool(name: string, args: any, config: any): Promise<string> {
  try {
    // =========================================================================
    // 📖 1. Jira 검색 (사내망 직결 + 공통 인증 헬퍼 사용)
    // =========================================================================
    if (name === 'search_jira') {
      const projects = config.jiraSpaces?.length > 0 ? `project in (${config.jiraSpaces.join(', ')}) AND ` : '';
      if (!args.keywords || args.keywords.length === 0) return "검색 키워드가 없습니다.";
      const keywordQueries = args.keywords.map((k: string) => `text ~ "${k.replace(/"/g, '')}"`).join(' AND ');
      const safeJql = `${projects}(${keywordQueries}) ORDER BY created DESC`;

      // 🌟 공통 헬퍼 함수로 토큰 호출 단일화
      const authResult = await getAtlassianAuth(config.userEmail);
      if ('error' in authResult) return authResult.error;
      const { authHeader, baseUrl } = authResult;

      const res = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ 
          jql: safeJql, 
          maxResults: 8, 
          fields: ["summary", "status", "description", "comment"] 
        })
      });

      if (!res.ok) return `사내 Jira API 직접 통신 실패 (상태 코드: ${res.status})`;
      
      const data = await res.json();
      if (!data.issues || data.issues.length === 0) return `해당 키워드 조합(${args.keywords.join(', ')})으로 검색된 Jira 이슈가 없습니다.`;

      return data.issues.map((i: any) => {
        let desc = extractTextFromJira(i.fields?.description);
        let commentsText = '';
        if (i.fields?.comment?.comments) {
            commentsText = i.fields.comment.comments.slice(-3).map((c: any) => `- ${extractTextFromJira(c.body).substring(0, 500)}`).join('\n');
        }
        const issueLink = `${baseUrl}/browse/${i.key}`;
        return `[일감]: ${i.key}\n[링크]: ${issueLink}\n[제목]: ${i.fields?.summary} (${i.fields?.status?.name})\n[본문]: ${desc.substring(0, 2000)}\n[댓글]:\n${commentsText || '없음'}`;
      }).join('\n\n--------------------\n\n');
    }

    // =========================================================================
    // 📖 2. Confluence 검색 (사내망 직결 + 공통 인증 헬퍼 사용)
    // =========================================================================
    if (name === 'search_confluence') {
      const spaces = config.confSpaces?.length > 0 ? `space in (${config.confSpaces.map((s: string) => `"${s}"`).join(', ')}) AND ` : '';
      if (!args.keywords || args.keywords.length === 0) return "검색 키워드가 없습니다.";
      const keywordQueries = args.keywords.map((k: string) => `text ~ "${k.replace(/"/g, '')}"`).join(' AND ');
      const safeCql = `${spaces}(${keywordQueries}) order by created desc`;

      // 🌟 공통 헬퍼 함수 재사용 (중복 코드 제거)
      const authResult = await getAtlassianAuth(config.userEmail);
      if ('error' in authResult) return authResult.error;
      const { authHeader, baseUrl } = authResult;

      const res = await fetch(`${baseUrl}/wiki/rest/api/content/search?cql=${encodeURIComponent(safeCql)}&limit=6&expand=body.plain`, {
        method: 'GET',
        headers: { 
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
      
      if (!res.ok) return `사내 Confluence API 직접 통신 실패 (상태 코드: ${res.status})`;
      
      const data = await res.json();
      if (!data.results || data.results.length === 0) return `검색된 Confluence 문서가 없습니다.`;
      
      return data.results.map((r: any) => {
        const contentLink = `${baseUrl}/wiki${r._links?.webui || ''}`;
        return `[문서 제목]: ${r.title}\n[링크]: ${contentLink}\n[본문 내용]: ${(r.body?.plain?.value || '').substring(0, 3000)}`;
      }).join('\n\n--------------------\n\n');
    }

    // =========================================================================
    // 📖 3. Zendesk 검색 (외부망 - 프록시 통신)
    // =========================================================================
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
      
      if (!res.ok) return `Zendesk API 통신 실패: ${res.status}`;
      const data = await res.json();
      if (!data.results || data.results.length === 0) return `검색된 Zendesk 티켓이 없습니다.`;
      
      const topTickets = data.results.slice(0, 8);
      const ticketDetails = await Promise.all(topTickets.map(async (t: any) => {
        try {
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

    // =========================================================================
    // 📖 4. Hive Docs 검색 및 스크래핑 (외부망 - DuckDuckGo)
    // =========================================================================
    else if (name === 'search_hive_docs') {
      try {
        if (!args.query) return "검색어가 없습니다.";

        const searchQuery = `site:developers.hiveplatform.ai/ko ${args.query}`;
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
          }
        });

        if (!res.ok) return `검색 실패: 상태 코드 ${res.status}`;
        
        const html = await res.text();
        const $ = cheerio.load(html);
        const results: string[] = [];

        $('.result').each((i, el) => {
          if (i >= 3) return false;
          const title = $(el).find('.result__title').text().trim();
          let urlText = $(el).find('.result__url').text().trim().replace(/\s+/g, '');
          const snippet = $(el).find('.result__snippet').text().trim();
          
          if (urlText) {
            if (!urlText.startsWith('http')) urlText = `https://${urlText}`;
            results.push(`[제목]: ${title}\n[URL]: ${urlText}\n[요약]: ${snippet}`);
          }
          return true;
        });

        if (results.length === 0) return "검색 결과가 없습니다.";
        return `[검색 결과]\n${results.join('\n\n')}\n\n(지시사항: 위 URL 중 질문과 가장 연관된 URL을 하나 골라 'scrape_hive_docs' 도구를 사용해 본문을 읽어오세요.)`;

      } catch (error: any) {
        return `검색 중 에러 발생: ${error.message}`;
      }
    }
    
    else if (name === 'scrape_hive_docs') {
      try {
        if (!args.url) return "URL이 없습니다.";
        
        const targetUrl = args.url;
        const urlObj = new URL(targetUrl);
        const targetHash = urlObj.hash.replace('#', ''); 

        const res = await fetch(urlObj.origin + urlObj.pathname, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'ko-KR,ko;q=0.9'
          }
        });

        if (!res.ok) return `크롤링 통신 실패: 상태 코드 ${res.status}`;
        
        const html = await res.text();
        const $ = cheerio.load(html);

        $('nav, footer, header, script, style, aside, .sidebar, .table-of-contents, .hash-link').remove();

        $('h1, h2, h3, h4, h5, h6').each((_, el) => {
          const id = $(el).attr('id');
          if (id) {
             const fullDeepLink = `${urlObj.origin}${urlObj.pathname}#${id}`;
             $(el).text(`\n[📍 가이드 링크: ${fullDeepLink}]\n${$(el).text()}`);
          }
        });

        let extractedText = '';

        if (targetHash) {
          let targetElement = $(`#${targetHash}`);
          let targetTagName = (targetElement[0] as any)?.name || '';

          if (targetElement.length > 0 && !targetTagName.match(/^h[1-6]$/i)) {
             const parentHeader = targetElement.closest('h1, h2, h3, h4, h5, h6');
             if (parentHeader.length > 0) {
                 targetElement = parentHeader;
                 targetTagName = (targetElement[0] as any)?.name || '';
             }
          }

          if (targetElement.length > 0) {
            extractedText += `[타겟 섹션]: ${targetElement.text().trim()}\n\n`;
            const targetHeaderLevel = parseInt(targetTagName.replace(/h/i, '') || '6', 10);
            let currentElement = targetElement.next();
            
            while (currentElement.length > 0) {
              const currentTagName = ((currentElement[0] as any)?.name || '').toLowerCase();
              if (currentTagName.match(/^h[1-6]$/)) {
                const currentHeaderLevel = parseInt(currentTagName.replace('h', ''), 10);
                if (currentHeaderLevel <= targetHeaderLevel) break; 
              }
              extractedText += currentElement.text().trim() + '\n\n';
              currentElement = currentElement.next();
            }
          }
        } 
        
        if (!extractedText.trim()) {
          const articleBody = $('main, article, .theme-doc-markdown').first();
          extractedText = articleBody.length > 0 ? articleBody.text() : $('body').text();
        }

        const cleanText = extractedText.replace(/\n{3,}/g, '\n\n').trim();

        let maxChars = 6000; 
        if (targetHash && cleanText.includes('[타겟 섹션]')) {
          maxChars = 10000; 
        }

        return `[문서 크롤링 결과]\n${cleanText.substring(0, maxChars)}`;

      } catch (error: any) {
        return `크롤링 중 에러 발생: ${error.message}`;
      }
    }

    return "알 수 없는 도구 명령입니다.";

  } catch (error: any) {
    return `도구 실행 중 시스템 에러 발생: ${error.message}`;
  }
}