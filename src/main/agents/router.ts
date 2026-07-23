// Phase 1: 지능형 라우팅.
// 네이티브 함수호출 대신 구조화 출력(responseSchema) 1회 호출로 "어떤 소스를,
// 어떤 키워드로 검색할지"만 판단한다. 이후 흐름은 managerAgent 코드가 제어한다.
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { SourceId, ModelConfig } from './distillers/types';

export const MODEL_CONFIG: ModelConfig = { model: 'gemini-2.5-flash', temperature: 0 };

export interface RouteDecision {
  scope: 'specific' | 'general';
  sources: SourceId[];
  queries: Partial<Record<SourceId, string[]>>;
}

const ALL_SOURCES: SourceId[] = ['jira', 'confluence', 'zendesk', 'hive'];

const SYSTEM_INSTRUCTION = `너는 사내 검색 에이전트의 '라우터'다. 사용자 질문을 분석해 어떤 소스를 검색할지와 소스별 검색 키워드를 결정만 해라. 답변은 생성하지 마라.

[소스 종류]
 - jira: 버그/이슈/일감 관리
 - confluence: 사내 위키 문서, 회의록, 설계·정책 문서
 - zendesk: 고객 지원 티켓
 - hive: Hive 개발자 사이트 공개 문서(SDK/가이드/함수)

[scope 판정]
 - "specific": 사용자가 특정 소스를 명시함 (예: "confluence에서 회의록 찾아줘", "zendesk 미해결 티켓 목록"). targets에는 명시된 소스만 넣어라.
 - "general": 특정 소스를 지목하지 않은 일반 업무 질문. 관련될 만한 소스를 모두 targets에 넣어라.
 - 환불·결제·로그인·문의·장애 등 고객 접점 주제는 zendesk(고객 지원 티켓)도 targets에 포함하고, 해당 소스용 키워드도 함께 뽑아라.

[키워드 규칙]
 - 각 소스별로 검색에 반드시 동시 포함돼야 할 핵심 '개념' 1~3개를, 중요한 것부터 순서대로 keywords 배열에 넣어라.
 - 한 개념에 한국어/영어 동의어나 표기 변형이 있으면 '|'로 묶어 하나의 항목으로 만들어라. 예: "쿼터|quota", "회원가입|signup|가입", "결제 실패|payment failed". 동의어가 없으면 단일 단어로 둔다.
 - 사내 문서는 한글, jira 티켓은 영문 코드/에러 용어가 섞여 있으니, 크로스랭귀지 검색을 위해 핵심 개념은 가능하면 한/영을 함께 '|'로 묶어라. hive는 영문/제품 용어 위주로 뽑아라.
 - 단순 인사·잡담 등 검색이 불필요하면 targets를 빈 배열로 두어라.`;

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
          keywords: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
        },
        required: ['source', 'keywords']
      }
    }
  },
  required: ['scope', 'targets']
} as const;

// general 질문에서 항상 검색할 내부 지식 소스 (Hive는 외부 공개 문서라 라우터 재량 유지)
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

// 라우팅 실패 시 폴백: 전체 소스를 질문 단어로 검색 (재현율 우선)
function fallbackDecision(userQuestion: string): RouteDecision {
  const kw = questionWords(userQuestion);
  const queries: Partial<Record<SourceId, string[]>> = {};
  for (const s of ALL_SOURCES) queries[s] = kw;
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

    const chat = model.startChat({ history: chatHistory });
    const result = await chat.sendMessage(userQuestion);
    const parsed = JSON.parse(result.response.text() || '{}');

    const queries: Partial<Record<SourceId, string[]>> = {};
    const sources: SourceId[] = [];
    for (const t of parsed.targets || []) {
      if (!t?.source || !ALL_SOURCES.includes(t.source)) continue;
      if (sources.includes(t.source)) continue;
      sources.push(t.source);
      queries[t.source] = Array.isArray(t.keywords) ? t.keywords.filter((k: any) => typeof k === 'string' && k.trim()) : [];
    }

    const scope = parsed.scope === 'specific' ? 'specific' : 'general';

    // general이고 "검색이 필요한" 질문(sources 비어있지 않음)이면 내부 3소스를 항상 포함한다.
    // LLM이 일부 소스를 누락하거나 키워드를 비워도 결정론적으로 커버리지를 보장(Hive는 재량 유지).
    // sources.length === 0 (인사·잡담)은 그대로 두어 검색 생략 동작을 유지.
    if (scope === 'general' && sources.length > 0) {
      // 백필 키워드: 내부 형제 소스가 뽑은 키워드를 우선 재사용(같은 언어·의도 카테고리),
      // 없으면 질문 단어로 폴백. (Hive의 영문 SDK 키워드가 내부 검색에 새는 것을 피함.)
      const backfillKw =
        INTERNAL_SOURCES.map((s) => queries[s]).find((k) => k && k.length > 0) ||
        questionWords(userQuestion);
      for (const s of INTERNAL_SOURCES) {
        if (!sources.includes(s)) sources.push(s);
        if (!queries[s] || queries[s]!.length === 0) queries[s] = backfillKw!;
      }
    }

    return { scope, sources, queries };
  } catch (err: any) {
    console.error(`[Router] 라우팅 실패, 폴백 사용: ${err.message}`);
    return fallbackDecision(userQuestion);
  }
}
