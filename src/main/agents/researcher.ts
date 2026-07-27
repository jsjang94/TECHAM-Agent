// Phase 2.5: 리서처 (에이전틱 멀티홉의 depth 담당).
// 지금까지 정제된 <Source> 블록을 보고, 질문에 충분히 답할 수 있는지 판단한다.
// 부족하거나 발견된 단서(문서에 언급된 Jira 키·마스킹 링크·미조회 항목)가 있으면
// "구체적인 후속 검색"을 제안한다. 검색·정제·종료 제어는 managerAgent가 한다.
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { SourceId, ModelConfig } from './distillers/types';

export const MODEL_CONFIG: ModelConfig = { model: 'gemini-2.5-flash', temperature: 0 };

const ALL_SOURCES: SourceId[] = ['jira', 'confluence', 'zendesk', 'hive'];

export interface FollowUp {
  source: SourceId;
  keywords: string[];
}
export interface ResearchDecision {
  done: boolean;
  followUp: FollowUp[];
}

const SYSTEM_INSTRUCTION = `너는 사내 검색 에이전트의 '리서처'다. 지금까지 각 소스에서 정제된 근거(<Source> 블록)를 보고, 사용자 질문에 '충분히' 답할 수 있는지 판단하고, 부족하면 딱 필요한 후속 검색만 제안해라. 답변 자체는 생성하지 마라.

[판단 원칙]
 - 지금 근거만으로 질문에 완결적으로 답할 수 있으면 done=true, followUp=[] 로 끝내라. 불필요한 추가 검색은 지연·노이즈만 늘린다.
 - 근거 안에서 '아직 조회하지 않은 단서'를 발견하면 그것을 후속 검색으로 만들어라. 예: 문서가 특정 Jira 이슈 키(GCPTAM-1234)나 티켓·페이지를 언급하는데 그 원문이 없을 때, 링크가 마스킹/생략되어 재검색이 필요할 때, 질문의 일부 측면만 커버됐을 때.
 - followUp의 각 항목은 { source, keywords }이며 keywords는 그 소스에서 동시에 포함돼야 할 핵심 개념 배열이다. 발견한 이슈 키·고유 식별자가 있으면 그대로 keywords에 넣어라(가장 정확한 재조회). 한/영 동의어는 '|'로 묶어도 된다.
 - 이미 검색한 쿼리는 절대 반복하지 마라(아래 '[이미 검색함]' 목록 참고). 새로운 각도·새로운 단서만 제안하라.
 - 후속 검색은 최대 3개까지만. 정말 필요한 것만.`;

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    done: { type: SchemaType.BOOLEAN },
    followUp: {
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
  required: ['done', 'followUp']
} as const;

export async function research(
  genAI: GoogleGenerativeAI,
  userQuestion: string,
  accumulatedBlocks: string,
  alreadySearched: string[]
): Promise<ResearchDecision> {
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

    const searchedList = alreadySearched.length > 0 ? alreadySearched.join('\n') : '(없음)';
    const prompt = `사용자 질문:\n${userQuestion}\n\n[이미 검색함]\n${searchedList}\n\n[지금까지 정제된 근거]\n${accumulatedBlocks || '(없음)'}`;
    const result = await model.generateContent(prompt);
    const parsed = JSON.parse(result.response.text() || '{}');

    const followUp: FollowUp[] = [];
    for (const f of parsed.followUp || []) {
      if (!f?.source || !ALL_SOURCES.includes(f.source)) continue;
      const keywords = Array.isArray(f.keywords)
        ? f.keywords.filter((k: any) => typeof k === 'string' && k.trim()).map((k: string) => k.trim())
        : [];
      if (keywords.length === 0) continue;
      followUp.push({ source: f.source, keywords });
    }
    return { done: parsed.done === true, followUp };
  } catch (err: any) {
    // 실패 시 안전하게 종료(추가 검색 없이 현재 근거로 종합).
    console.error(`[Researcher] 판단 실패, 종료로 폴백: ${err.message}`);
    return { done: true, followUp: [] };
  }
}
