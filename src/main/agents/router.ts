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

[키워드 규칙]
 - 각 소스별로 검색에 반드시 동시 포함돼야 할 핵심 단어 1~3개를, 중요한 것부터 순서대로 keywords 배열에 넣어라.
 - jira는 영문 코드/에러 용어가 있으면 우선, hive는 영문/제품 용어 위주로 뽑아라.
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

// 라우팅 실패 시 폴백: 전체 소스를 질문 단어로 검색 (재현율 우선)
function fallbackDecision(userQuestion: string): RouteDecision {
  const words = userQuestion
    .replace(/[^\w\s가-힣]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 3);
  const kw = words.length > 0 ? words : [userQuestion.trim()];
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

    return { scope: parsed.scope === 'specific' ? 'specific' : 'general', sources, queries };
  } catch (err: any) {
    console.error(`[Router] 라우팅 실패, 폴백 사용: ${err.message}`);
    return fallbackDecision(userQuestion);
  }
}
