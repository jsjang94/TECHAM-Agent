import type { GoogleGenerativeAI } from '@google/generative-ai';
import { distillWith, type ModelConfig } from './types';

// Zendesk 전용 모델 설정 (독립 유지)
export const MODEL_CONFIG: ModelConfig = { model: 'gemini-2.5-flash', temperature: 0.1 };

const GUIDANCE = `Zendesk 고객 지원 티켓 검색 결과다. 각 <Source> 블록에 다음을 보존해라:
 - [티켓 번호]와 링크(URL) — 절대 생략 금지
 - [최초 문의]와 [팀원 답변] 흐름(문제 원인·현재 처리 상태)
 - 여러 티켓이 관련되면 임의로 1개만 고르지 말고 관련된 티켓을 모두 블록으로 남겨라(최신 순).
블록 제목 형식: "<Source: 티켓 #{번호} - Zendesk>"`;

export function distill(
  genAI: GoogleGenerativeAI,
  rawContext: string,
  userQuestion: string
): Promise<string> {
  return distillWith(genAI, MODEL_CONFIG, GUIDANCE, rawContext, userQuestion);
}
