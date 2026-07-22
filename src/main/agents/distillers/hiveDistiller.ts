import type { GoogleGenerativeAI } from '@google/generative-ai';
import { distillWith, type ModelConfig } from './types';

// Hive 개발자 문서 전용 모델 설정 (독립 유지)
export const MODEL_CONFIG: ModelConfig = { model: 'gemini-2.5-flash', temperature: 0.1 };

const GUIDANCE = `Hive 개발자 사이트 문서를 크롤링한 결과다. 각 <Source> 블록에 다음을 보존해라:
 - 문서 제목과 질문과 관련된 핵심 설명·코드 예시(코드는 원문 그대로).
 - 본문에 '[📍 가이드 링크: URL]' 마커가 있으면, 관련 문단에 해당하는 마커 값을 그대로 보존해라(딥링크 출처로 쓰인다).
 - 짜집기 금지 — 원문에 있는 내용만 정제해라.
블록 제목 형식: "<Source: {문서 제목} - Hive>"`;

export function distill(
  genAI: GoogleGenerativeAI,
  rawContext: string,
  userQuestion: string
): Promise<string> {
  return distillWith(genAI, MODEL_CONFIG, GUIDANCE, rawContext, userQuestion);
}
