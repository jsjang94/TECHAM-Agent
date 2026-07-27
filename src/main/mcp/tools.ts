import { SchemaType, FunctionDeclaration } from '@google/generative-ai';
import * as cheerio from 'cheerio';
import { request as httpsRequest } from 'https';
import { getAtlassianAuth, getZendeskAuth } from '../credentials';

// Electron net.fetch는 Chromium 세션 쿠키·Origin 헤더를 붙여 Jira XSRF를 유발.
// Node.js https 모듈로 직접 호출해 순수 API 요청으로 처리.
export function nodeHttpsFetch(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string }
): Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpsRequest(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: options.method, headers: options.headers },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(JSON.parse(raw)), text: () => Promise.resolve(raw) });
        });
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

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

// text ~ 절 빌더. "A|B" 동의어 그룹은 (text ~ "A" OR text ~ "B")로 묶어 개념 내 OR·개념 간 AND를 만든다.
export const buildTextClauses = (keywords: string[]): string[] =>
  keywords.map((k) => {
    const terms = k.split('|').map((t) => t.trim().replace(/"/g, '')).filter(Boolean);
    const clauses = terms.map((t) => `text ~ "${t}"`);
    return clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0];
  });

// '[안내: ...]' 표기용: 동의어 구분자 '|'를 '/'로 바꿔 사람이 읽기 좋게.
const prettyKeywords = (keywords: string[]): string => keywords.map((k) => k.replace(/\|/g, '/')).join(', ');

// 게임 개발 프로젝트/스페이스 식별 휴리스틱(목록 유지 불필요). 우리 팀 것은 키에 'GCP'가 포함된다는 관례.
// '모든 스페이스' 검색 시 GCP 미포함 항목(게임 개발로 추정)을 랭킹 후순위로 미루는 데 쓴다. 순수 함수.
export const containsGcp = (key: string): boolean => (key || '').toUpperCase().includes('GCP');
// Jira 일감 키에서 프로젝트 접두 추출 (예: 'GCPTAM-3050' → 'GCPTAM').
export const jiraProjectOf = (issueKey: string): string => (issueKey || '').split('-')[0];
// JQL/CQL에 날짜를 끼워넣기 전 형식 검증(주입 방지). YYYY-MM-DD만 허용. 순수 함수.
export const isYmd = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
// ISO 날짜/시각 문자열의 날짜부(YYYY-MM-DD)가 [from,to] 범위에 드는지(문자열 비교). 순수 함수.
export const dayInRange = (isoLike: string, from: string, to: string): boolean => {
  const d = (isoLike || '').slice(0, 10);
  return isYmd(d) && d >= from && d <= to;
};

// 여러 쿼리 결과를 합칠 때 사용하는 블록 구분자 (각 검색 함수의 join과 동일).
export const RESULT_SEPARATOR = '\n\n--------------------\n\n';

// 여러 쿼리에서 같은 결과 블록([일감]/[문서 제목]/[티켓 #]/URL 첫 줄이 동일)이 중복 반환되면 하나로 병합한다.
// '[안내:...]' 폴백 표기는 있으면 맨 앞에 한 번만 보존한다. 순수 함수(노드 스크립트 검증 가능).
export const dedupResultBlocks = (combined: string): string => {
  if (!combined) return combined;
  const noteMatch = combined.match(/\[안내:[^\]]*\]/);
  const note = noteMatch ? noteMatch[0] : '';
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const rawBlock of combined.split(RESULT_SEPARATOR)) {
    // 블록 앞에 붙은 '[안내:...]' 프리픽스를 떼어낸 뒤 식별한다.
    const block = rawBlock.replace(/^\s*\[안내:[^\]]*\]\s*/, '').trim();
    if (!block) continue;
    const idLine = block.split('\n')[0].trim();
    if (seen.has(idLine)) continue;
    seen.add(idLine);
    kept.push(block);
  }
  const body = kept.join(RESULT_SEPARATOR);
  if (!body) return note; // 실제 블록이 없으면 표기만(또는 빈 문자열) 반환
  return note ? `${note}\n\n${body}` : body;
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
          description: "검색할 핵심 키워드 목록. 반드시 중요한(질문의 핵심인) 단어부터 순서대로 나열 (예: ['결제', '오류', '가이드'])"
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
          description: "검색할 핵심 키워드 목록. 반드시 중요한(질문의 핵심인) 단어부터 순서대로 나열 (예: ['purchase', 'error', 'timeout'])"
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
          description: "검색할 핵심 키워드 목록. 반드시 중요한(질문의 핵심인) 단어부터 순서대로 나열 (예: ['환불', '지연', '영수증'])"
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

export async function executeMcpTool(name: string, args: any, config: any): Promise<string> {
  try {
    // =========================================================================
    // 📖 1. Jira 검색 (사내망 직결 + 공통 인증 헬퍼 사용)
    // =========================================================================
    if (name === 'search_jira') {
      if (!args.keywords || args.keywords.length === 0) return "검색 키워드가 없습니다.";
      const projects = config.jiraSpaces?.length > 0 ? `project in (${config.jiraSpaces.join(', ')}) AND ` : '';
      // 'jiraSpaces'가 비어있음 = 렌더러가 '모든 스페이스' 옵션을 켠 상태(App.tsx withSearchScope).
      // 이때만 게임(비-GCP) 프로젝트를 랭킹 후순위로 미룬다. 개별 스페이스 지정 시엔 사용자 범위를 존중.
      const isAllSpaces = !(config.jiraSpaces?.length > 0);

      // 기간 필터(선택). 플래너가 질문에서 뽑은 dateRange. from/to가 둘 다 YYYY-MM-DD일 때만 사용(주입 방지).
      const dateRange = args.dateRange && isYmd(args.dateRange.from) && isYmd(args.dateRange.to) ? args.dateRange : null;

      // 리서처가 발견한 이슈 키(예: GCPTAM-3050)는 퍼지 텍스트 검색이 아니라 정확 조회로 처리한다.
      // jiraSpaces 제한은 정확 조회에도 그대로 적용(설정 경계 우회 금지 — 사용자 승인 사항).
      const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]{1,9}-\d+$/i;
      const keyTerms = args.keywords.filter((k: string) => ISSUE_KEY_RE.test(k.trim())).map((k: string) => k.trim().toUpperCase());
      const textTerms = args.keywords.filter((k: string) => !ISSUE_KEY_RE.test(k.trim()));

      // 🌟 공통 헬퍼 함수로 토큰 호출 단일화
      const { authHeader, baseUrl } = getAtlassianAuth();

      // 최신 진행 상황(댓글 포함) 반영을 위해 updated 기준 정렬
      const runJiraSearch = async (jql: string): Promise<any[] | string> => {
        console.log(`[Jira Search] JQL: ${jql}`);
        const res = await nodeHttpsFetch(`${baseUrl}/rest/api/3/search/jql`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            jql,
            maxResults: 25,
            fields: ["summary", "status", "description", "comment", "created", "updated"]
          })
        });
        console.log(`[Jira Search] 응답 상태: ${res.status}`);
        if (!res.ok) {
          const errBody = await res.text();
          console.error(`[Jira Search] 오류 응답 바디: ${errBody}`);
          return `사내 Jira API 직접 통신 실패 (상태 코드: ${res.status})`;
        }
        const data = await res.json();
        return data.issues || [];
      };

      // 정확 조회: 발견된 이슈 키가 있으면 project 스코프를 존중하며 key in (...)으로 바로 fetch.
      let keyIssues: any[] = [];
      if (keyTerms.length > 0) {
        const keyResult = await runJiraSearch(`${projects}key in (${keyTerms.join(', ')})`);
        if (typeof keyResult === 'string') return keyResult;
        keyIssues = keyResult;
      }

      // 퍼지 텍스트 검색: 키가 아닌 나머지 키워드만 대상으로 기존 AND→OR 폴백 로직 유지.
      let textIssues: any[] = [];
      let fallbackNote = '';
      if (textTerms.length > 0) {
        const keywordClauses = buildTextClauses(textTerms);
        // 1차: 모든 키워드 AND (정확 일치) → 0건이면 2차: OR (연관 검색) 폴백으로 재현율 확보
        let issues = await runJiraSearch(`${projects}(${keywordClauses.join(' AND ')}) ORDER BY updated DESC`);
        if (typeof issues === 'string') return issues;
        if (issues.length === 0 && keywordClauses.length > 1) {
          issues = await runJiraSearch(`${projects}(${keywordClauses.join(' OR ')}) ORDER BY updated DESC`);
          if (typeof issues === 'string') return issues;
          fallbackNote = `[안내: 모든 키워드(${prettyKeywords(textTerms)})가 동시에 포함된 이슈는 없어, 일부 키워드만 일치하는 연관 이슈를 반환합니다. 질문과의 연관성을 직접 판단해서 활용하세요.]\n\n`;
        }
        textIssues = issues;

        // 기간 확장(선택): 하드 필터로 좁히는 게 아니라, 그 기간에 수정된 관련 이슈를 '추가로' 더 끌어와 재현율을 높인다.
        // 키워드 OR + updated 범위로 별도 조회 후 병합·dedup. 질문에 기간이 있을 때만.
        if (dateRange) {
          const rangeIssues = await runJiraSearch(
            `${projects}(${keywordClauses.join(' OR ')}) AND updated >= "${dateRange.from}" AND updated <= "${dateRange.to}" ORDER BY updated DESC`
          );
          if (typeof rangeIssues !== 'string') {
            const seen = new Set(textIssues.map((i: any) => i.key));
            textIssues = [...textIssues, ...rangeIssues.filter((i: any) => !seen.has(i.key))];
          }
        }
      }

      if (keyIssues.length === 0 && textIssues.length === 0) {
        return textTerms.length === 0
          ? `이슈 키(${keyTerms.join(', ')})에 해당하는 Jira 이슈를 찾을 수 없습니다.`
          : `해당 키워드 조합(${prettyKeywords(args.keywords)})으로 검색된 Jira 이슈가 없습니다.`;
      }

      // JQL엔 텍스트 스코어 정렬이 없어 클라이언트에서 관련도 재랭킹(제목×3 + 댓글×2 + 본문×1, 필드별 독립 가산).
      // 댓글에 진행 상황·CS 대응 이력이 담기는 경우가 많아 제목/본문과 별도로 채점한다.
      // Array.sort는 stable → 동점은 JQL의 updated DESC 순서 유지. OR 폴백 시 특히 효과적.
      const scoreTerms = textTerms.flatMap((k: string) => k.split('|')).map((t: string) => t.trim().toLowerCase()).filter(Boolean);
      const scoreIssue = (i: any): number => {
        const summary = (i.fields?.summary || '').toLowerCase();
        const body = extractTextFromJira(i.fields?.description).toLowerCase();
        const comments = (i.fields?.comment?.comments || []).map((c: any) => extractTextFromJira(c.body)).join(' ').toLowerCase();
        let s = 0;
        for (const t of scoreTerms) {
          if (summary.includes(t)) s += 3;
          if (body.includes(t)) s += 1;
          if (comments.includes(t)) s += 2;
        }
        // 기간 가점: 질문에 기간이 있으면 그 기간에 생성/수정된 이슈를 순위에 반영(+2). 관련도를 압도하지 않는 보정 수준.
        if (dateRange && (dayInRange(i.fields?.updated, dateRange.from, dateRange.to) || dayInRange(i.fields?.created, dateRange.from, dateRange.to))) s += 2;
        return s;
      };
      // 재랭킹: 점수 1회 계산 후 정렬. 전체검색 모드에서만 GCP 포함 프로젝트를 1차 정렬키로 앞세우고(비-GCP=게임 후순위),
      // 관련도 점수를 2차 키로. Array.sort는 stable → 동점은 JQL의 updated DESC 순서 유지.
      const scored = textIssues.map((i: any) => ({ i, score: scoreIssue(i), prio: containsGcp(jiraProjectOf(i.key)) }));
      scored.sort((a, b) => {
        if (isAllSpaces && a.prio !== b.prio) return a.prio ? -1 : 1;
        return b.score - a.score;
      });
      const rankedText = scored.slice(0, 10).map((x) => x.i);

      // 정확 키 조회 결과는 항상 포함(우선), 퍼지 검색 결과는 재랭킹 후 상위 10건. 중복은 키 기준 제거.
      const seenKeys = new Set(keyIssues.map((i: any) => i.key));
      const issues = [...keyIssues, ...rankedText.filter((i: any) => !seenKeys.has(i.key))];

      return fallbackNote + issues.map((i: any) => {
        let desc = extractTextFromJira(i.fields?.description);
        let commentsText = '';
        if (i.fields?.comment?.comments) {
            commentsText = i.fields.comment.comments.slice(-5).map((c: any) => `- ${extractTextFromJira(c.body).substring(0, 500)}`).join('\n');
        }
        const issueLink = `${baseUrl}/browse/${i.key}`;
        const created = (i.fields?.created || '').slice(0, 10);
        const updated = (i.fields?.updated || '').slice(0, 10);
        const dateLine = `[생성]: ${created || '알수없음'}\n[수정]: ${updated || '알수없음'}`;
        return `[일감]: ${i.key}\n[링크]: ${issueLink}\n[제목]: ${i.fields?.summary} (${i.fields?.status?.name})\n${dateLine}\n[본문]: ${desc.substring(0, 4000)}\n[댓글]:\n${commentsText || '없음'}`;
      }).join('\n\n--------------------\n\n');
    }

    // =========================================================================
    // 📖 2. Confluence 검색 (사내망 직결 + 공통 인증 헬퍼 사용)
    // =========================================================================
    if (name === 'search_confluence') {
      const spaces = config.confSpaces?.length > 0 ? `space in (${config.confSpaces.map((s: string) => `"${s}"`).join(', ')}) AND ` : '';
      if (!args.keywords || args.keywords.length === 0) return "검색 키워드가 없습니다.";
      const keywordClauses = buildTextClauses(args.keywords);
      // 'confSpaces'가 비어있음 = '모든 스페이스' 옵션. 이때만 게임(비-GCP) 스페이스를 랭킹 후순위로 미룬다.
      const isAllSpaces = !(config.confSpaces?.length > 0);
      // 기간 필터(선택). from/to가 둘 다 YYYY-MM-DD일 때만 사용(주입 방지).
      const dateRange = args.dateRange && isYmd(args.dateRange.from) && isYmd(args.dateRange.to) ? args.dateRange : null;

      // 🌟 공통 헬퍼 함수 재사용 (중복 코드 제거)
      const { authHeader, baseUrl } = getAtlassianAuth();

      // order by를 지정하지 않아 CQL 기본 정렬(관련도 relevance)을 사용 → 최신순보다 질문 연관 문서가 상위로.
      // expand: body.view(렌더 HTML, 매크로 앵커 보존) + space(GCP 판정용 스페이스 키) + version(수정일)/history(생성일).
      const runConfSearch = async (cql: string): Promise<any[] | string> => {
        console.log(`[Confluence Search] CQL: ${cql}`);
        const res = await nodeHttpsFetch(`${baseUrl}/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=12&expand=body.view,space,version,history`, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json'
          }
        });
        console.log(`[Confluence Search] 응답 상태: ${res.status}`);
        if (!res.ok) {
          const errBody = await res.text();
          console.error(`[Confluence Search] 오류 응답 바디: ${errBody}`);
          return `사내 Confluence API 직접 통신 실패 (상태 코드: ${res.status})`;
        }
        const data = await res.json();
        return data.results || [];
      };

      // 1차: 모든 키워드 AND (정확 일치) → 0건이면 2차: OR (연관 검색) 폴백으로 재현율 확보
      let results = await runConfSearch(`${spaces}(${keywordClauses.join(' AND ')})`);
      if (typeof results === 'string') return results;
      let fallbackNote = '';
      if (results.length === 0 && keywordClauses.length > 1) {
        results = await runConfSearch(`${spaces}(${keywordClauses.join(' OR ')})`);
        if (typeof results === 'string') return results;
        fallbackNote = `[안내: 모든 키워드(${prettyKeywords(args.keywords)})가 동시에 포함된 문서는 없어, 일부 키워드만 일치하는 연관 문서를 반환합니다. 질문과의 연관성을 직접 판단해서 활용하세요.]\n\n`;
      }

      // 기간 확장(선택): 하드 필터로 좁히지 않고, 그 기간에 수정된 관련 문서를 '추가로' 더 끌어와 재현율을 높인다.
      if (dateRange) {
        const rangeResults = await runConfSearch(
          `${spaces}(${keywordClauses.join(' OR ')}) AND lastmodified >= "${dateRange.from}" AND lastmodified <= "${dateRange.to}"`
        );
        if (typeof rangeResults !== 'string') {
          const seen = new Set(results.map((r: any) => r.id));
          results = [...results, ...rangeResults.filter((r: any) => !seen.has(r.id))];
        }
      }

      if (results.length === 0) return `검색된 Confluence 문서가 없습니다.`;

      // CQL 관련도 순서를 '보존'하면서(안정정렬) 우선순위 파티션만 얹는다.
      // 전체검색 모드: GCP 스페이스를 앞으로 → (기간 있으면) 그 기간 수정 문서를 앞으로. 개별 스페이스 모드는 GCP 파티션 생략.
      if (isAllSpaces || dateRange) {
        results = [...results].sort((a: any, b: any) => {
          if (isAllSpaces) {
            const pa = containsGcp(a.space?.key), pb = containsGcp(b.space?.key);
            if (pa !== pb) return pa ? -1 : 1;
          }
          if (dateRange) {
            const ia = dayInRange(a.version?.when, dateRange.from, dateRange.to);
            const ib = dayInRange(b.version?.when, dateRange.from, dateRange.to);
            if (ia !== ib) return ia ? -1 : 1;
          }
          return 0;
        });
      }

      return fallbackNote + results.map((r: any) => {
        const contentLink = `${baseUrl}/wiki${r._links?.webui || ''}`;
        const bodyText = stripHtml(r.body?.view?.value || '');
        const created = (r.history?.createdDate || '').slice(0, 10);
        const updated = (r.version?.when || '').slice(0, 10);
        const dateLine = `[생성]: ${created || '알수없음'}\n[수정]: ${updated || '알수없음'}`;
        return `[문서 제목]: ${r.title}\n[링크]: ${contentLink}\n${dateLine}\n[본문 내용]: ${bodyText.substring(0, 6000)}`;
      }).join('\n\n--------------------\n\n');
    }

    // =========================================================================
    // 📖 3. Zendesk 검색 (외부망 직결 + 공통 인증 헬퍼 사용)
    // =========================================================================
    if (name === 'search_zendesk') {
      if (!args.keywords || args.keywords.length === 0) return "검색 키워드가 없습니다.";
      // Zendesk 검색 문법은 괄호 OR을 깔끔히 지원하지 않으므로 각 개념의 첫 term만 사용(동의어는 무해하게 생략).
      const quoted = args.keywords.map((k: string) => `"${k.split('|')[0].trim().replace(/"/g, '')}"`);

      const { authHeader, baseUrl } = getZendeskAuth();

      const runZendeskSearch = async (query: string): Promise<any[] | string> => {
        console.log(`[Zendesk Search] query: type:ticket ${query}`);
        const res = await nodeHttpsFetch(`${baseUrl}/api/v2/search.json?query=type:ticket%20${encodeURIComponent(query)}`, {
          method: 'GET',
          headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
        });
        if (!res.ok) return `Zendesk API 직접 통신 실패 (상태 코드: ${res.status})`;
        const data = await res.json();
        return data.results || [];
      };

      // 1차: 모든 키워드(공백 구분 = AND) → 0건이면 2차: 가장 핵심 키워드(첫 번째) 하나로 폴백
      let found = await runZendeskSearch(quoted.join(' '));
      if (typeof found === 'string') return found;
      let fallbackNote = '';
      if (found.length === 0 && quoted.length > 1) {
        found = await runZendeskSearch(quoted[0]);
        if (typeof found === 'string') return found;
        fallbackNote = `[안내: 모든 키워드(${prettyKeywords(args.keywords)})가 동시에 포함된 티켓은 없어, 핵심 키워드("${args.keywords[0].split('|')[0].trim()}")만으로 검색한 연관 티켓을 반환합니다. 질문과의 연관성을 직접 판단해서 활용하세요.]\n\n`;
      }
      if (found.length === 0) return `검색된 Zendesk 티켓이 없습니다.`;

      const topTickets = found.slice(0, 10);
      const ticketDetails = await Promise.all(topTickets.map(async (t: any) => {
        const ticketLink = `${baseUrl}/agent/tickets/${t.id}`;
        try {
          const commentRes = await nodeHttpsFetch(`${baseUrl}/api/v2/tickets/${t.id}/comments.json`, {
            method: 'GET',
            headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
          });
          const commentData = await commentRes.json();
          let conversation = `[최초 문의]: ${t.description?.substring(0, 600)}...`;
          if (commentData.comments?.length > 1) conversation += `\n[팀원 답변]: ${stripHtml(commentData.comments[commentData.comments.length - 1].body).substring(0, 1200)}...`;

          return `[티켓 #${t.id}] ${t.subject}\n[링크]: ${ticketLink}\n${conversation}`;
        } catch (err) {
          return `[티켓 #${t.id}] ${t.subject}\n[링크]: ${ticketLink}\n[최초 문의]: ${t.description?.substring(0, 800)}...`;
        }
      }));
      return fallbackNote + ticketDetails.join('\n\n--------------------\n\n');
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

        // 🌟 바로 여기입니다! 리턴하기 직전에 콘솔을 찍어봅니다. 🌟
        // console.log("\n=== [크롤링 결과 앞부분 200자 확인] ===");
        // console.log(cleanText.substring(0, 200));
        // console.log("======================================\n");

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