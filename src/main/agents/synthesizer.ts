// Phase 3: 교차검증 및 최종 답변 생성.
// 정제기들이 반환한 <Source> 블록을 취합해 최신성·신뢰도를 교차검증하고
// 출처 링크가 포함된 최종 마크다운 답변을 만든다.
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ModelConfig } from './distillers/types';

// 종합기는 교차검증·상충 판단·최종 구조화를 담당 → 상위 모델 사용.
export const MODEL_CONFIG: ModelConfig = { model: 'gemini-3.5-flash', temperature: 0.2 };
// MODEL_CONFIG.model이 존재하지 않거나 일시적으로 실패할 경우의 폴백 모델.
const FALLBACK_MODEL = 'gemini-2.5-flash';

const SYSTEM_INSTRUCTION = `너는 사내 시스템(Jira/Confluence/Zendesk/Hive) 검색 결과를 종합하는 헤드 에이전트다. 아래는 각 소스별 서브에이전트가 원문에서 정제한 <Source> 블록들이다. 이 블록들만 근거로 최종 답변을 작성해라.

[교차검증 원칙]
 1. 여러 소스의 정보가 서로 일치하는지 비교해라. 상충하면 <Source> 블록에 보존된 날짜/시간·상태 변경 히스토리를 근거로 더 최신이거나 공식적인 정보를 우선하되, 상충한다는 사실 자체를 답변에 명시해라.
 2. '[팀 위키 우선 참고]' 컨텍스트가 함께 주어졌다면 그 내용을 최우선 근거로 삼아라.

[공통 절대 규칙]
 1. 팩트 엄수: 주어진 <Source> 블록에 있는 내용에 근거해서만 답하고, 절대 지어내거나 서로 다른 블록의 내용을 부적절하게 짜집기하지 마라.
 2. 링크 제공: 블록에 포함된 모든 출처 URL은 [표시 텍스트](URL) 형태의 클릭 가능한 마크다운 링크로 반드시 제공해라. Hive 블록에 '[📍 가이드 링크: URL]' 마커가 있으면 그 값을 그대로 딥링크로 써라.
 3. 결과 없음: 근거가 될 블록이 없으면 없다고 솔직히 말하고, 질문을 좁히거나 바꿀 방법을 제안해라.
 4. 답변 구조: ① 핵심 결론(1~3문장) → ② 상세 근거(소스별로 구분, 표/목록 활용 가능) → ③ 참고 링크 목록.
 5. '[{소스} 검색 실패]' 표기가 있으면 해당 소스는 조회하지 못했음을 답변에 간단히 언급해라.`;

async function runSynthesis(
  genAI: GoogleGenerativeAI,
  modelName: string,
  prompt: string,
  chatHistory: any[]
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: { temperature: MODEL_CONFIG.temperature }
  });
  const chat = model.startChat({ history: chatHistory });
  const result = await chat.sendMessage(prompt);
  return (result.response.text() || '').trim();
}

export async function synthesize(
  genAI: GoogleGenerativeAI,
  userQuestion: string,
  sourceBlocks: string,
  wikiContext: string | null,
  chatHistory: any[] = []
): Promise<string> {
  const contextParts: string[] = [];
  if (wikiContext) contextParts.push(`[팀 위키 우선 참고]\n${wikiContext}`);
  contextParts.push(`[정제된 소스 컨텍스트]\n${sourceBlocks}`);
  const prompt = `사용자 질문:\n${userQuestion}\n\n${contextParts.join('\n\n')}`;

  try {
    return await runSynthesis(genAI, MODEL_CONFIG.model, prompt, chatHistory);
  } catch (err: any) {
    if (MODEL_CONFIG.model === FALLBACK_MODEL) throw err;
    console.error(`[Synthesizer] ${MODEL_CONFIG.model} 실패, ${FALLBACK_MODEL}로 폴백: ${err.message}`);
    return runSynthesis(genAI, FALLBACK_MODEL, prompt, chatHistory);
  }
}
