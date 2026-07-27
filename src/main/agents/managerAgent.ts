// Phase 오케스트레이터 (헤드 에이전트).
// 1) 플래닝(router) → 2) 위키 게이트(short-circuit) → 3) 제한된 멀티홉 검색+정제
//    (round 0: 플래너 다중쿼리 / 추가 라운드: 리서처가 발견한 단서로 후속 검색) → 4) 종합.
// processUserMessage 시그니처/반환(string)은 유지 → IPC·렌더러 불변. onProgress는 선택.
import { GoogleGenerativeAI } from '@google/generative-ai';
import { executeMcpTool, dedupResultBlocks, RESULT_SEPARATOR } from '../mcp/tools';
import { getGeminiApiKey } from '../credentials';
import { route } from './router';
import { research, type FollowUp } from './researcher';
import { synthesize } from './synthesizer';
import { SOURCE_LABELS, type SourceId } from './distillers/types';
import * as jiraDistiller from './distillers/jiraDistiller';
import * as confDistiller from './distillers/confDistiller';
import * as zendeskDistiller from './distillers/zendeskDistiller';
import * as hiveDistiller from './distillers/hiveDistiller';

// 멀티홉 상한: round 0(플래너) 이후 추가 라운드는 최대 2회, 라운드당 후속 검색 최대 3개.
const MAX_EXTRA_ROUNDS = 2;
const MAX_FOLLOWUP = 3;

// 진행 상황 콜백(선택). 렌더러 진행 표시용 — 미주입 시 no-op.
export type ProgressPhase = 'plan' | 'search' | 'research' | 'followup' | 'synthesize';
export interface ProgressEvent {
  phase: ProgressPhase;
  round?: number;
  maxRounds?: number;
}
export type ProgressFn = (e: ProgressEvent) => void;

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
// querySets: 이 소스에서 실행할 여러 쿼리(각 쿼리는 키워드 배열). 결과는 병합·중복제거.
// dateRange: 질문에 기간이 있으면 그 기간 항목의 재현율·순위를 높이는 데 쓴다(jira/confluence만 활용).
async function retrieve(
  source: SourceId,
  querySets: string[][],
  config: any,
  dateRange?: { from: string; to: string }
): Promise<string> {
  if (!querySets || querySets.length === 0) return '';

  if (source === 'hive') {
    // Hive는 2단계(URL 탐색 → 스크래핑)이고 스크래핑 비용이 커서 첫 쿼리 세트만 사용.
    // 동의어 그룹('A|B')은 '|'를 공백으로 풀어 검색어에 모두 포함(DuckDuckGo 느슨 매칭).
    const query = querySets[0].map((k) => k.replace(/\|/g, ' ')).join(' ');
    const searchResult = await executeMcpTool('search_hive_docs', { query }, config);
    const urlMatch = searchResult.match(/\[URL\]:\s*(\S+)/);
    if (!urlMatch) return searchResult; // URL을 못 찾으면 검색 결과 텍스트를 그대로 전달
    return executeMcpTool('scrape_hive_docs', { url: urlMatch[1] }, config);
  }

  const toolName =
    source === 'jira' ? 'search_jira' : source === 'confluence' ? 'search_confluence' : 'search_zendesk';
  // 기간 필터는 jira/confluence만 활용(zendesk는 현행 유지).
  const dr = source === 'zendesk' ? undefined : dateRange;
  // 각 쿼리 세트를 병렬 검색.
  const results = await Promise.all(querySets.map((keywords) => executeMcpTool(toolName, { keywords, dateRange: dr }, config)));
  // 실제 결과 블록은 모두 '[링크]:' 라인을 포함한다. sentinel("...없습니다.")·에러 문자열은 제외.
  const real = results.filter((r) => r && r.includes('[링크]:'));
  if (real.length === 0) return results[0] || '';
  return dedupResultBlocks(real.join(RESULT_SEPARATOR));
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

// 이미 실행한 쿼리 식별용 시그니처(소스 + 정규화 키워드).
function sig(source: SourceId, keywords: string[]): string {
  return `${source}: ${keywords.map((k) => k.toLowerCase().trim()).sort().join(' + ')}`;
}

// 한 라운드: 주어진 소스들을 병렬 검색+정제. 정제된 블록과 실패한 소스 라벨을 반환.
// dateRange: round 0(플래너)에서만 전달. 후속 라운드(리서처 단서 기반)는 미전달.
async function runRound(
  genAI: GoogleGenerativeAI,
  sources: SourceId[],
  queriesOf: (s: SourceId) => string[][],
  question: string,
  config: any,
  dateRange?: { from: string; to: string }
): Promise<{ blocks: string[]; failed: string[] }> {
  const settled = await Promise.allSettled(
    sources.map(async (source) => {
      const raw = await retrieve(source, queriesOf(source), config, dateRange);
      const blocks = await distillFor(source, genAI, raw, question);
      return { source, blocks };
    })
  );
  const blocks: string[] = [];
  const failed: string[] = [];
  settled.forEach((s, i) => {
    const source = sources[i];
    if (s.status === 'fulfilled') {
      if (s.value.blocks && s.value.blocks.trim()) blocks.push(s.value.blocks.trim());
    } else {
      failed.push(SOURCE_LABELS[source]);
      console.error(`[Distill:${source}] 실패:`, s.reason?.message || s.reason);
    }
  });
  return { blocks, failed };
}

export async function processUserMessage(
  userMessage: string,
  chatHistory: any[],
  config: any,
  onProgress?: ProgressFn
): Promise<string> {
  const genAI = new GoogleGenerativeAI(getGeminiApiKey());
  const { question, wikiHint } = parseIncoming(userMessage);
  const progress: ProgressFn = (e) => {
    try {
      onProgress?.(e);
    } catch {
      /* 진행 표시 실패는 무시 */
    }
  };

  // Phase 1: 플래닝(라우팅 + 쿼리 분해)
  progress({ phase: 'plan' });
  const decision = await route(genAI, question, chatHistory);
  console.log(`[Planner] scope=${decision.scope} sources=${decision.sources.join(',')}`);

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

  const accumulated: string[] = [];
  const failedLabels = new Set<string>();
  const searched = new Set<string>();

  // Phase 2 — round 0: 플래너 다중쿼리로 검색+정제 (병렬, 커버리지 보장은 라우터에서 처리됨)
  progress({ phase: 'search', round: 0 });
  const round0 = await runRound(genAI, decision.sources, (s) => decision.queries[s] || [], question, config, decision.dateRange);
  accumulated.push(...round0.blocks);
  round0.failed.forEach((f) => failedLabels.add(f));
  decision.sources.forEach((s) => (decision.queries[s] || []).forEach((set) => searched.add(sig(s, set))));

  // Phase 2.5 — 제한된 멀티홉: 리서처가 부족분·단서로 후속 검색을 제안하면 추가 라운드 실행.
  for (let round = 1; round <= MAX_EXTRA_ROUNDS; round++) {
    progress({ phase: 'research', round, maxRounds: MAX_EXTRA_ROUNDS });
    const { done, followUp } = await research(genAI, question, accumulated.join('\n\n'), [...searched]);
    // 이미 검색한 쿼리는 제외하고, 남은 것 중 최대 MAX_FOLLOWUP개만.
    const fresh = followUp
      .filter((f: FollowUp) => f.keywords.length > 0 && !searched.has(sig(f.source, f.keywords)))
      .slice(0, MAX_FOLLOWUP);
    // 종료 3중 보장: done | 새 후속 없음 | (루프 상한은 for 조건)
    if (done || fresh.length === 0) break;
    console.log(
      `[Researcher] round ${round} 후속: ${fresh.map((f) => `${f.source}[${f.keywords.join(',')}]`).join(' ')}`
    );
    fresh.forEach((f) => searched.add(sig(f.source, f.keywords)));

    progress({ phase: 'followup', round, maxRounds: MAX_EXTRA_ROUNDS });
    const followSources = [...new Set(fresh.map((f) => f.source))];
    const followMap = (s: SourceId): string[][] => fresh.filter((f) => f.source === s).map((f) => f.keywords);
    const r = await runRound(genAI, followSources, followMap, question, config);
    accumulated.push(...r.blocks);
    r.failed.forEach((f) => failedLabels.add(f));
  }

  const parts = [...accumulated];
  if (failedLabels.size > 0) parts.push([...failedLabels].map((f) => `[${f} 검색 실패]`).join('\n'));
  const sourceBlocks = parts.join('\n\n');

  // 관련 결과가 하나도 없음 → 정직하게 안내
  if (accumulated.length === 0) {
    const searchedSources = decision.sources.map((s) => SOURCE_LABELS[s]).join(', ');
    const kw = decision.sources
      .map((s) => (decision.queries[s] || []).map((set) => set.join('+')).join(' / '))
      .filter(Boolean)
      .join(' | ');
    return `검색했지만 질문과 관련된 결과를 찾지 못했습니다.\n- 검색한 소스: ${searchedSources}\n- 사용한 키워드: ${kw || '(없음)'}\n질문을 좀 더 구체화하거나 다른 키워드로 다시 시도해 주세요.`;
  }

  // Phase 3: 종합 (general이고 위키 힌트가 있으나 short-circuit 안된 경우 보조 근거로 전달)
  progress({ phase: 'synthesize' });
  const wikiSupport = decision.scope === 'general' ? wikiHint : null;
  const answer = await synthesize(genAI, question, sourceBlocks, wikiSupport, chatHistory);
  if (!answer) return '검색을 완료했지만 응답을 생성하지 못했습니다. 다시 시도해주세요.';
  return answer;
}
