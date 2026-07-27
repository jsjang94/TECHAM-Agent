// Phase 1: 지능형 라우팅 + 쿼리 분해(플래너).
// 구조화 출력(responseSchema) 1회 호출로 "어떤 소스를, 어떤 여러 각도의 쿼리로
// 검색할지"를 결정만 한다. 이후 흐름(검색·정제·멀티홉·종합)은 managerAgent가 제어한다.
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { SourceId, ModelConfig } from './distillers/types';

export const MODEL_CONFIG: ModelConfig = { model: 'gemini-2.5-flash', temperature: 0 };

// 소스별 "쿼리 세트" 배열. 각 쿼리 세트(string[])는 동시에 포함돼야 할 핵심 개념들이며,
// 한 개념은 '|'로 묶인 한/영 동의어 그룹일 수 있다. 여러 세트 = 여러 검색 각도(breadth).
export interface RouteDecision {
  scope: 'specific' | 'general';
  sources: SourceId[];
  queries: Partial<Record<SourceId, string[][]>>;
  // 질문에 기간/날짜가 있으면 오늘 기준으로 계산한 검색 기간(YYYY-MM-DD). 없으면 undefined.
  dateRange?: { from: string; to: string };
}

const ALL_SOURCES: SourceId[] = ['jira', 'confluence', 'zendesk', 'hive'];

// 소스당 최대 쿼리 세트 수 (breadth 상한)
const MAX_QUERY_SETS = 3;

const SYSTEM_INSTRUCTION = `너는 사내 검색 에이전트의 '플래너'다. 사용자 질문을 분석해 어떤 소스를, 어떤 여러 각도의 쿼리로 검색할지 결정만 해라. 답변은 생성하지 마라.

[소스 종류]
 - jira: 버그/이슈/일감 관리
 - confluence: 사내 위키 문서, 회의록, 설계·정책 문서
 - zendesk: 고객 지원 티켓
 - hive: Hive 개발자 사이트 공개 문서(SDK/가이드/함수)

[scope 판정]
 - "specific": 사용자가 특정 소스를 명시함 (예: "confluence에서 회의록 찾아줘", "zendesk 미해결 티켓 목록"). targets에는 명시된 소스만 넣어라.
 - "general": 특정 소스를 지목하지 않은 일반 업무 질문. 관련될 만한 소스를 모두 targets에 넣어라.
 - 환불·결제·로그인·문의·장애 등 고객 접점 주제는 zendesk(고객 지원 티켓)도 targets에 포함하라.

[검색 쿼리 규칙 — 매우 중요]
 - 각 소스마다 서로 다른 각도의 검색 쿼리를 1~3개 만들어 querySets에 넣어라. 각 쿼리(하나의 세트)는 "동시에 포함돼야 할 핵심 개념 1~3개"의 배열이다.
 - 복잡하거나 여러 갈래인 질문은 측면·하위질문별로 쿼리를 나눠 재현율을 높여라. 예: "스타세일러 7월 문의 대응 내용" → [["스타세일러","문의"], ["스타세일러","대응"], ["스타세일러","주간보고|주간 보고"]].
 - 한 개념에 한국어/영어 동의어나 표기 변형이 있으면 '|'로 묶어 하나의 항목으로 만들어라. 예: "쿼터|quota", "회원가입|signup|가입", "결제 실패|payment failed". 동의어가 없으면 단일 단어.
 - 사내 문서는 한글, jira 티켓은 영문 코드/에러 용어가 섞여 있으니 크로스랭귀지 검색을 위해 핵심 개념은 가능하면 한/영을 함께 '|'로 묶어라. hive는 영문/제품 용어 위주로 뽑아라.
 - 단순 인사·잡담 등 검색이 불필요하면 targets를 빈 배열로 두어라.

[기간 인식 — dateRange]
 - 질문에 기간·날짜(예: "7월", "지난주", "최근 한 달", "6~7월", "어제")가 있으면, 프롬프트 맨 앞의 '오늘 날짜'를 기준으로 계산해 dateRange.from/to를 YYYY-MM-DD로 채워라. 예: 오늘이 2026-07-27이고 "7월"이면 from=2026-07-01, to=2026-07-31.
 - 기간·날짜 언급이 전혀 없으면 dateRange를 생략하라(넣지 마라). 이 값은 검색을 좁히는 하드 필터가 아니라 해당 기간 항목의 재현율·순위를 높이는 데 쓰인다.`;

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    scope: { type: SchemaType.STRING, format: 'enum', enum: ['specific', 'general'] },
    targets: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          source: { type: SchemaType.STRING, format: 'enum', enum: ALL_SOURCES },
          querySets: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
          }
        },
        required: ['source', 'querySets']
      }
    },
    dateRange: {
      type: SchemaType.OBJECT,
      properties: {
        from: { type: SchemaType.STRING },
        to: { type: SchemaType.STRING }
      }
    }
  },
  required: ['scope', 'targets']
} as const;

// general 질문에서 항상 검색할 내부 지식 소스 (Hive는 외부 공개 문서라 플래너 재량 유지)
const INTERNAL_SOURCES: SourceId[] = ['jira', 'confluence', 'zendesk'];

// 질문에서 검색어 후보 단어 추출 (폴백·백필 공용)
function questionWords(userQuestion: string): string[] {
  const words = userQuestion
    .replace(/[^\w\s가-힣]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 3);
  return words.length > 0 ? words : [userQuestion.trim()];
}

// LLM이 준 querySets를 안전하게 정규화: 문자열 배열의 배열로, 빈 항목 제거, 최대 MAX_QUERY_SETS.
function normalizeQuerySets(raw: any): string[][] {
  if (!Array.isArray(raw)) return [];
  const sets: string[][] = [];
  for (const set of raw) {
    if (!Array.isArray(set)) continue;
    const kw = set.filter((k: any) => typeof k === 'string' && k.trim()).map((k: string) => k.trim());
    if (kw.length > 0) sets.push(kw);
    if (sets.length >= MAX_QUERY_SETS) break;
  }
  return sets;
}

// 라우팅 실패 시 폴백: 전체 소스를 질문 단어 단일 세트로 검색 (재현율 우선)
function fallbackDecision(userQuestion: string): RouteDecision {
  const kw = questionWords(userQuestion);
  const queries: Partial<Record<SourceId, string[][]>> = {};
  for (const s of ALL_SOURCES) queries[s] = [kw];
  return { scope: 'general', sources: [...ALL_SOURCES], queries };
}

export async function route(
  genAI: GoogleGenerativeAI,
  userQuestion: string,
  chatHistory: any[] = []
): Promise<RouteDecision> {
  try {
    const model = genAI.getGenerativeModel({
      model: MODEL_CONFIG.model,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: MODEL_CONFIG.temperature,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA as any
      }
    });

    // 상대 기간("7월", "지난주")을 절대 날짜로 계산할 수 있도록 오늘 날짜를 함께 준다(메인 프로세스라 Date 사용 가능).
    const today = new Date().toISOString().slice(0, 10);
    const chat = model.startChat({ history: chatHistory });
    const result = await chat.sendMessage(`오늘 날짜: ${today}\n\n${userQuestion}`);
    const parsed = JSON.parse(result.response.text() || '{}');

    const queries: Partial<Record<SourceId, string[][]>> = {};
    const sources: SourceId[] = [];
    for (const t of parsed.targets || []) {
      if (!t?.source || !ALL_SOURCES.includes(t.source)) continue;
      if (sources.includes(t.source)) continue;
      const sets = normalizeQuerySets(t.querySets);
      if (sets.length === 0) continue; // 쿼리 세트가 하나도 없으면 그 소스는 스킵
      sources.push(t.source);
      queries[t.source] = sets;
    }

    const scope = parsed.scope === 'specific' ? 'specific' : 'general';

    // 기간 파싱: from/to가 둘 다 YYYY-MM-DD일 때만 채택(형식 불량은 무시 → 하드 필터로 잘못 좁히는 사고 방지).
    const ymd = (s: any): boolean => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const dateRange =
      parsed.dateRange && ymd(parsed.dateRange.from) && ymd(parsed.dateRange.to)
        ? { from: parsed.dateRange.from, to: parsed.dateRange.to }
        : undefined;

    // general이고 "검색이 필요한" 질문(sources 비어있지 않음)이면 내부 3소스를 항상 포함한다.
    // LLM이 일부 소스를 누락하거나 쿼리를 비워도 결정론적으로 커버리지를 보장(Hive는 재량 유지).
    // sources.length === 0 (인사·잡담)은 그대로 두어 검색 생략 동작을 유지.
    if (scope === 'general' && sources.length > 0) {
      // 백필 쿼리 세트: 내부 형제 소스가 뽑은 세트를 우선 재사용(같은 언어·의도 카테고리),
      // 없으면 질문 단어 단일 세트로 폴백. (Hive의 영문 SDK 키워드가 내부 검색에 새는 것을 피함.)
      const backfillSets =
        INTERNAL_SOURCES.map((s) => queries[s]).find((q) => q && q.length > 0) ||
        [questionWords(userQuestion)];
      for (const s of INTERNAL_SOURCES) {
        if (!sources.includes(s)) sources.push(s);
        if (!queries[s] || queries[s]!.length === 0) queries[s] = backfillSets!;
      }
    }

    return { scope, sources, queries, dateRange };
  } catch (err: any) {
    console.error(`[Planner] 라우팅 실패, 폴백 사용: ${err.message}`);
    return fallbackDecision(userQuestion);
  }
}
