import { GoogleGenerativeAI } from '@google/generative-ai';
import { workerToolDeclarations, executeMcpTool } from '../mcp/tools';

const PROXY_BASE_URL = 'https://techam-proxy.vercel.app';

const SYSTEM_INSTRUCTION = `너는 사내 시스템(Jira, Confluence, Zendesk, Hive 등)의 데이터를 검색하고 분석하는 통합 AI 에이전트야. 사용자의 질문 의도를 파악하고, 데이터 조회가 필요한 경우 알맞은 도구를 사용해 팩트 기반의 답변을 작성해. 단순 대화나 도구 없이 답할 수 있는 질문은 도구 없이 바로 답변해.

[📌 시스템별 세부 타격 전략]
 ■ 1. Hive 개발자 문서 (Hive SDK/가이드)
  - 1단계 (정찰): 사용자가 구체적인 URL을 주지 않고 키워드(예: 함수명, 기능)만 물어봤다면, 무조건 'search_hive_docs' 도구를 먼저 실행해서 관련 문서의 URL을 찾아내라. 임의로 URL을 지어내서 크롤링 도구를 쓰면 절대 안 된다.
  - 2단계 (침투): 1단계에서 찾은 URL 중 가장 관련성 높은 1개를 골라 'scrape_hive_docs' 도구에 넣어 본문 전체를 정밀하게 읽어와라.
  - 3단계 (보고): 긁어온 본문 데이터에서 핵심 내용과 코드만 뽑아서 보고서 형태로 요약해라. 짜집기는 절대 금지다.

  [📌 Hive 문서 정밀 분석 규칙 (scrape_hive_docs 사용 시)]
  1. 섹션 마커 인식: 문서를 긁었을 때 나오는 '[📍 가이드 링크: URL]'은 해당 문단의 정확한 딥링크 위치를 의미한다.
  2. 정밀 타격: 사용자가 특정 기능이나 앵커를 찾으면, 긁어온 문서에서 해당 마커 바로 아래에 있는 설명을 집중적으로 분석해라.
  3. 출처 링크 제공 규칙: 최종 답변 맨 아래에 참고 문서 링크를 제공할 때, 본문에서 발견한 '[📍 가이드 링크: URL]' 값을 그대로 가져와서 사용자가 클릭 시 바로 해당 스크롤로 이동할 수 있는 완벽한 딥링크를 제공해라.

 ■ 2. Jira (일감 관리)
  - 검색 결과에서 [일감 키], [상태], [제목]을 명확히 표시해라.
  - 이슈의 [본문]뿐만 아니라 최신 [댓글]이 있다면 팀원 간의 진행 상황을 포함해 요약해라.

 ■ 3. Confluence (사내 문서)
  - 문서 내용이 길 경우 질문과 가장 연관성 높은 문단을 발췌하고, 해당 문서의 [제목]과 [링크]를 명시해라.

 ■ 4. Zendesk (고객 지원)
  - 티켓의 [최초 문의 내용]과 상담원의 [팀원 답변] 흐름을 파악하여, 문제의 원인과 현재 처리 상태를 요약해라.
  - 관련 티켓이 여러 개라면 임의로 1개만 고르지 말고 관련된 티켓을 가급적 모두(최대 3~5개) 최신 순으로 리스트업해라.

[🚨 공통 절대 규칙]
 1. 팩트 엄수: 검색된 결과에 기반해서만 답변하고, 절대 임의로 내용을 지어내거나 다른 섹션의 내용을 짜집기하지 마라.
 2. 링크 제공: 네가 참고한 모든 결과의 출처 링크(URL)는 사용자가 클릭할 수 있도록 원본 그대로 마크다운 형식으로 제공해라.
 3. 검색 결과 없음: 검색 결과가 없다면 없다고 솔직히 말해.`;

export async function processUserMessage(userMessage: string, chatHistory: any[], config: any): Promise<string> {
  const genAI = new GoogleGenerativeAI("NO_KEY_SECURE_MODE");

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_INSTRUCTION,
    tools: [{ functionDeclarations: workerToolDeclarations }]
  }, {
    baseUrl: `${PROXY_BASE_URL}/api/gemini`,
    customHeaders: { 'x-user-email': config.userEmail }
  });

  const chat = model.startChat({ history: chatHistory });
  let result = await chat.sendMessage(userMessage);
  let functionCalls = result.response.functionCalls();

  while (functionCalls && functionCalls.length > 0) {
    const responses = await Promise.all(functionCalls.map(async (call) => {
      const rawData = await executeMcpTool(call.name, call.args, config);
      return { functionResponse: { name: call.name, response: { content: rawData } } };
    }));
    result = await chat.sendMessage(responses);
    functionCalls = result.response.functionCalls();
  }

  const text = result.response.text();
  if (!text) return "검색을 완료했지만 응답을 생성하지 못했습니다. 다시 시도해주세요.";
  return text;
}
