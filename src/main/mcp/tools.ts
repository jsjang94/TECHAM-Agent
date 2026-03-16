import { SchemaType, FunctionDeclaration } from '@google/generative-ai';

// 만능 HTML 정제기
export const stripHtml = (html: string) => {
  if (!html) return '';
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
             .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
             .replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
};

// 🌟 행동대장(Flash)이 사용할 도구 명세서
export const workerToolDeclarations: FunctionDeclaration[] = [
  {
    name: "search_confluence",
    description: "사내 Confluence 위키에서 문서를 검색합니다.",
    parameters: { type: SchemaType.OBJECT, properties: { cql: { type: SchemaType.STRING, description: "Confluence CQL 쿼리" } }, required: ["cql"] }
  },
  {
    name: "search_jira",
    description: "Jira에서 버그, 이슈 일감을 검색합니다. 사용자가 '비슷한 일감'을 찾을 경우 대화 문맥에서 핵심 명사 키워드(1~2개)만 추출하여 반드시 `text ~ \"키워드\"` 문법을 사용하세요. (예: `text ~ \"푸시\"`)",
    parameters: { type: SchemaType.OBJECT, properties: { jql: { type: SchemaType.STRING, description: "Jira JQL 쿼리" } }, required: ["jql"] }
  },
  {
    name: "search_zendesk",
    description: "Zendesk에서 사내 비공개 고객 지원 티켓을 검색합니다. 사용자의 질문에서 핵심 명사 키워드(1~2개)만 추출하여 띄어쓰기로 연결해 검색어로 사용하세요.",
    parameters: { type: SchemaType.OBJECT, properties: { query: { type: SchemaType.STRING, description: "검색할 핵심 키워드" } }, required: ["query"] }
  },
  {
    name: "scrape_hive_docs",
    description: "Hive Developers 사이트의 문서를 읽어옵니다.",
    parameters: { type: SchemaType.OBJECT, properties: { urlPath: { type: SchemaType.STRING, description: "경로 (예: 'index.html')" } }, required: ["urlPath"] }
  }
];

// 🌟 도구 실행기 (API 통신 전담)
export async function executeMcpTool(name: string, args: any, config: any): Promise<string> {
  const auth = Buffer.from(`${config.confEmail}:${config.confToken}`).toString('base64');
  const baseUrl = config.confUrl.endsWith('/') ? config.confUrl.slice(0, -1) : config.confUrl;

  try {
    if (name === 'search_jira') {
      const res = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jql: args.jql, maxResults: 5, fields: ["summary", "status", "description"] })
      });
      if (!res.ok) return `Jira API 통신 실패 (${res.status}): ${await res.text()}`;
      const data = await res.json();
      if (!data.issues || data.issues.length === 0) return "검색된 Jira 이슈가 없습니다.";
      return data.issues.map((i: any) => {
        let desc = i.fields?.description ? (typeof i.fields.description === 'string' ? i.fields.description : JSON.stringify(i.fields.description)) : '내용 없음';
        return `[일감]: ${i.key}\n[링크]: ${baseUrl}/browse/${i.key}\n[제목]: ${i.fields?.summary} (상태: ${i.fields?.status?.name})\n[본문]: ${desc.substring(0, 800)}...`;
      }).join('\n\n--------------------\n\n');
    }

    if (name === 'search_confluence') {
      const apiUrl = baseUrl.includes('/wiki') ? `${baseUrl}/rest/api/content/search` : `${baseUrl}/wiki/rest/api/content/search`;
      const res = await fetch(`${apiUrl}?cql=${encodeURIComponent(args.cql)}&limit=3&expand=body.plain`, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
      });
      const data = await res.json();
      if (!data.results || data.results.length === 0) return "검색된 Confluence 문서가 없습니다.";
      return data.results.map((r: any) => `[제목]: ${r.title}\n[링크]: ${baseUrl.split('/wiki')[0]}/wiki${r._links.webui}\n[본문]: ${r.body?.plain?.value?.substring(0, 1000)}`).join('\n\n--------------------\n\n');
    }

    if (name === 'search_zendesk') {
      const zenAuth = Buffer.from(`${config.zendeskEmail}/token:${config.zendeskToken}`).toString('base64');
      const zenHeaders = { 'Authorization': `Basic ${zenAuth}`, 'Accept': 'application/json' };
      const res = await fetch(`https://${config.zendeskSubdomain}.zendesk.com/api/v2/search.json?query=type:ticket ${encodeURIComponent(args.query)}`, { headers: zenHeaders });
      if (!res.ok) return `Zendesk API 통신 실패 (${res.status}): ${await res.text()}`;
      const data = await res.json();
      if (!data.results || data.results.length === 0) return "검색된 Zendesk 티켓이 없습니다.";
      
      const topTickets = data.results.slice(0, 3);
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

    if (name === 'scrape_hive_docs') {
      const targetUrl = `https://developers.hiveplatform.ai/ko/latest/${args.urlPath}`.replace(/([^:]\/)\/+/g, "$1");
      const res = await fetch(targetUrl);
      return `[출처: ${targetUrl}]\n${stripHtml(await res.text()).substring(0, 2000)}`;
    }

    return "알 수 없는 도구입니다.";
  } catch (error: any) {
    return `도구 실행 중 시스템 에러 발생: ${error.message}`;
  }
}