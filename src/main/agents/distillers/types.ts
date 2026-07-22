// 정제기(distiller) 공통 계약.
// 서브에이전트는 '정제 전용' — 검색은 하지 않고, executeMcpTool이 반환한 raw 원문을
// 받아 질문 관련성으로 필터·압축해 <Source> XML 블록으로만 반환한다.
import type { GoogleGenerativeAI } from '@google/generative-ai';

export type SourceId = 'jira' | 'confluence' | 'zendesk' | 'hive';

export const SOURCE_LABELS: Record<SourceId, string> = {
  jira: 'Jira',
  confluence: 'Confluence',
  zendesk: 'Zendesk',
  hive: 'Hive'
};

// 각 정제기 파일 상단에서 이 타입으로 독립 MODEL_CONFIG를 유지한다(PRD 가드레일).
// 지금은 전부 gemini-2.5-flash지만, 소스별 교체가 필요하면 각 파일에서만 바꾸면 된다.
export interface ModelConfig {
  model: string;
  temperature?: number;
}

// 모든 정제기에 공통으로 주입되는 규칙 (PRD Rule 1/2/3 + 관련성 필터)
const COMMON_DISTILL_RULES = `너는 검색 원문에서 사용자 질문에 답하는 데 필요한 정보만 추려내는 '정제 전용' 에이전트다. 최종 답변을 생성하지 말고, 아래 규칙에 따라 원문을 정제해서 <Source> 블록으로만 출력해라.

[Rule 1. 노이즈 제거]
 - 시스템 로그, 의미 없는 HTML/마크다운 잔재, 인사말, API 메타데이터 등 분석에 불필요한 요소는 삭제한다.

[Rule 2. 상세 컨텍스트 보존 (매우 중요)]
 - 아래 요소는 헤드 에이전트의 교차검증에 필요하므로 절대 요약·축약하지 말고 원문 그대로 보존한다:
   티켓/이슈 상태 변경 히스토리, 발생·수정 날짜 및 시간, 담당자/팀원 코멘트 전문, 에러 코드, 첨부 문서·티켓의 URL 링크.

[Rule 3. 질문 관련성 필터]
 - 원문에 여러 건이 있어도 사용자 질문과 실제로 관련된 건만 남기고 무관한 건은 버려라.
 - 관련된 건이 하나도 없으면 아무것도 출력하지 마라(빈 출력).
 - 원문 맨 앞에 '[안내: ...]'가 있으면 정확 일치가 아닌 연관 검색 결과라는 뜻이니, 관련성이 낮은 건은 더 엄격히 걸러내라.

[출력 형식 — 반드시 이 형식만]
<Source: {티켓번호 또는 문서제목} - {시스템명}>
(여기에 Rule 1·2가 적용된 상세 내용을 원문에 가깝게 배치)
</Source>

관련된 건 수만큼 블록을 여러 개 출력할 수 있다. 블록 바깥의 부연 설명은 절대 하지 마라.`;

// 정제 LLM 호출의 기계적 부분을 공유. 각 distiller는 자신의 MODEL_CONFIG와
// 소스별 특이사항(sourceGuidance)만 넘긴다.
export async function distillWith(
  genAI: GoogleGenerativeAI,
  config: ModelConfig,
  sourceGuidance: string,
  rawContext: string,
  userQuestion: string
): Promise<string> {
  if (!rawContext || !rawContext.trim()) return '';

  const model = genAI.getGenerativeModel({
    model: config.model,
    systemInstruction: `${COMMON_DISTILL_RULES}\n\n[이번 소스 특이사항]\n${sourceGuidance}`,
    generationConfig: { temperature: config.temperature ?? 0.1 }
  });

  const result = await model.generateContent(
    `사용자 질문:\n${userQuestion}\n\n검색 원문:\n${rawContext}`
  );
  return (result.response.text() || '').trim();
}
