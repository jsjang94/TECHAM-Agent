import type { GoogleGenerativeAI } from '@google/generative-ai';
import { distillWith, type ModelConfig } from './types';

// Confluence 전용 모델 설정 (독립 유지)
export const MODEL_CONFIG: ModelConfig = { model: 'gemini-2.5-flash', temperature: 0.1 };

const GUIDANCE = `Confluence 사내 문서 검색 결과다. 각 <Source> 블록에 다음을 보존해라:
 - [문서 제목]과 링크(URL) — 절대 생략 금지
 - 질문과 가장 관련된 문단을 원문에 가깝게 발췌(회의록·설계 문서라면 날짜/결정사항/담당자를 살려라).
 - 문서가 길어도 무관한 부분은 버리고 관련 문단만 남겨라.
블록 제목 형식: "<Source: {문서 제목} - Confluence>"`;

export function distill(
  genAI: GoogleGenerativeAI,
  rawContext: string,
  userQuestion: string
): Promise<string> {
  return distillWith(genAI, MODEL_CONFIG, GUIDANCE, rawContext, userQuestion);
}
