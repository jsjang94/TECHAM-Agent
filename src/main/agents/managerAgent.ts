// Phase 오케스트레이터 (헤드 에이전트).
// 1) 라우팅(router) → 2) 위키 게이트(short-circuit) → 3) 소스별 병렬 검색+정제 → 4) 종합.
// processUserMessage 시그니처/반환(string)은 유지 → IPC·렌더러 불변.
import { GoogleGenerativeAI } from '@google/generative-ai';
import { executeMcpTool } from '../mcp/tools';
import { getGeminiApiKey } from '../credentials';
import { route } from './router';
import { synthesize } from './synthesizer';
import { SOURCE_LABELS, type SourceId } from './distillers/types';
import * as jiraDistiller from './distillers/jiraDistiller';
import * as confDistiller from './distillers/confDistiller';
import * as zendeskDistiller from './distillers/zendeskDistiller';
import * as hiveDistiller from './distillers/hiveDistiller';

// 렌더러가 위키 후보를 찾으면 "[시스템 힌트: ...]\n\n사용자 질문: {질문}" 형태로 넘어온다.
// 순수 질문과 위키 힌트를 분리한다.
function parseIncoming(userMessage: string): { question: string; wikiHint: string | null } {
  const marker = '\n\n사용자 질문: ';
  if (userMessage.startsWith('[시스템 힌트:') && userMessage.includes(marker)) {
    const idx = userMessage.indexOf(marker);
    return {
      wikiHint: userMessage.slice(0, idx).trim(),
      question: userMessage.slice(idx + marker.length).trim()
    };
  }
  return { question: userMessage, wikiHint: null };
}

// 위키 강한 매치 확인 + short-circuit. 충분히 답하면 최종 답변 문자열, 아니면 null.
async function tryWikiShortCircuit(
  genAI: GoogleGenerativeAI,
  question: string,
  wikiHint: string
): Promise<string | null> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: `아래 '팀 위키 규칙 후보'가 사용자 질문에 충분히 답하는지 판단해라.
- 충분히 답한다면: 그 위키 내용을 근거로 최종 답변을 마크다운으로 작성해라. 참고링크가 있으면 [텍스트](URL) 형태로 포함해라.
- 충분히 답하지 못하거나 관련이 약하면: 정확히 'NEEDS_SEARCH' 한 단어만 출력해라(다른 말 금지).`,
    generationConfig: { temperature: 0.2 }
  });
  const result = await model.generateContent(`사용자 질문:\n${question}\n\n${wikiHint}`);
  const text = (result.response.text() || '').trim();
  if (!text || text.includes('NEEDS_SEARCH')) return null;
  return text;
}

// 소스별 검색(retrieval). LLM 없음 — 기존 executeMcpTool 재사용.
async function retrieve(source: SourceId, keywords: string[], config: any): Promise<string> {
  if (source === 'jira') return executeMcpTool('search_jira', { keywords }, config);
  if (source === 'confluence') return executeMcpTool('search_confluence', { keywords }, config);
  if (source === 'zendesk') return executeMcpTool('search_zendesk', { keywords }, config);
  if (source === 'hive') {
    // Hive는 2단계: URL 탐색 → 최상위 URL 본문 스크래핑
    // 동의어 그룹('A|B')은 '|'를 공백으로 풀어 검색어에 한/영 동의어를 모두 포함(DuckDuckGo 느슨 매칭).
    const query = keywords.map((k) => k.replace(/\|/g, ' ')).join(' ');
    const searchResult = await executeMcpTool('search_hive_docs', { query }, config);
    const urlMatch = searchResult.match(/\[URL\]:\s*(\S+)/);
    if (!urlMatch) return searchResult; // URL을 못 찾으면 검색 결과 텍스트를 그대로 전달
    return executeMcpTool('scrape_hive_docs', { url: urlMatch[1] }, config);
  }
  return '';
}

function distillFor(
  source: SourceId,
  genAI: GoogleGenerativeAI,
  raw: string,
  question: string
): Promise<string> {
  switch (source) {
    case 'jira':
      return jiraDistiller.distill(genAI, raw, question);
    case 'confluence':
      return confDistiller.distill(genAI, raw, question);
    case 'zendesk':
      return zendeskDistiller.distill(genAI, raw, question);
    case 'hive':
      return hiveDistiller.distill(genAI, raw, question);
  }
}

export async function processUserMessage(
  userMessage: string,
  chatHistory: any[],
  config: any
): Promise<string> {
  const genAI = new GoogleGenerativeAI(getGeminiApiKey());
  const { question, wikiHint } = parseIncoming(userMessage);

  // Phase 1: 라우팅
  const decision = await route(genAI, question, chatHistory);
  console.log(`[Router] scope=${decision.scope} sources=${decision.sources.join(',')}`);

  // 위키 우선 게이트: 일반 질문 + 위키 후보 있으면 short-circuit 시도
  if (decision.scope === 'general' && wikiHint) {
    const wikiAnswer = await tryWikiShortCircuit(genAI, question, wikiHint);
    if (wikiAnswer) {
      console.log('[Wiki] short-circuit 적용 — 타 소스 검색 생략');
      return wikiAnswer;
    }
  }

  // 검색 불필요(인사말·잡담 등) → 도구 없이 바로 응답
  if (decision.sources.length === 0) {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const chat = model.startChat({ history: chatHistory });
    const r = await chat.sendMessage(question);
    return (r.response.text() || '').trim() || '무엇을 도와드릴까요?';
  }

  // Phase 2: 소스별 검색 + 정제 (병렬, 일부 실패해도 계속)
  const settled = await Promise.allSettled(
    decision.sources.map(async (source) => {
      const raw = await retrieve(source, decision.queries[source] || [], config);
      const blocks = await distillFor(source, genAI, raw, question);
      return { source, blocks };
    })
  );

  const parts: string[] = [];
  const failed: string[] = [];
  settled.forEach((s, i) => {
    const source = decision.sources[i];
    if (s.status === 'fulfilled') {
      if (s.value.blocks && s.value.blocks.trim()) parts.push(s.value.blocks.trim());
    } else {
      failed.push(SOURCE_LABELS[source]);
      console.error(`[Distill:${source}] 실패:`, s.reason?.message || s.reason);
    }
  });
  if (failed.length > 0) parts.push(failed.map((f) => `[${f} 검색 실패]`).join('\n'));

  const sourceBlocks = parts.join('\n\n');

  // 관련 결과가 하나도 없음 → 정직하게 안내
  if (!sourceBlocks.trim() || parts.every((p) => p.includes('검색 실패'))) {
    const searched = decision.sources.map((s) => SOURCE_LABELS[s]).join(', ');
    const kw = decision.sources
      .map((s) => (decision.queries[s] || []).join('/'))
      .filter(Boolean)
      .join(' | ');
    return `검색했지만 질문과 관련된 결과를 찾지 못했습니다.\n- 검색한 소스: ${searched}\n- 사용한 키워드: ${kw || '(없음)'}\n질문을 좀 더 구체화하거나 다른 키워드로 다시 시도해 주세요.`;
  }

  // Phase 3: 종합 (general이고 위키 힌트가 있으나 short-circuit 안된 경우 보조 근거로 전달)
  const wikiSupport = decision.scope === 'general' ? wikiHint : null;
  const answer = await synthesize(genAI, question, sourceBlocks, wikiSupport, chatHistory);
  if (!answer) return '검색을 완료했지만 응답을 생성하지 못했습니다. 다시 시도해주세요.';
  return answer;
}
