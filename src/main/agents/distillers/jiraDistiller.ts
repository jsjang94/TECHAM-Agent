import type { GoogleGenerativeAI } from '@google/generative-ai';
import { distillWith, type ModelConfig } from './types';

// Jira 전용 모델 설정 (독립 유지 — 나중에 긴 컨텍스트 모델 등으로 교체 가능)
export const MODEL_CONFIG: ModelConfig = { model: 'gemini-2.5-flash', temperature: 0.1 };

const GUIDANCE = `Jira 이슈 검색 결과다. 각 <Source> 블록에 다음을 반드시 보존해라:
 - [일감 키], [상태], [제목]
 - 링크(URL) — 절대 생략 금지
 - 이슈 본문의 핵심과 최신 댓글 내용(팀원 간 진행 상황)
 - 상태 변경 이력·발생/수정 날짜가 있으면 그대로 살려라.
블록 제목 형식: "<Source: {일감 키} - Jira>"`;

export function distill(
  genAI: GoogleGenerativeAI,
  rawContext: string,
  userQuestion: string
): Promise<string> {
  return distillWith(genAI, MODEL_CONFIG, GUIDANCE, rawContext, userQuestion);
}
