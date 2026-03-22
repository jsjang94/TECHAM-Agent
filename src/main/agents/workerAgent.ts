import { GoogleGenerativeAI } from '@google/generative-ai';
import { workerToolDeclarations, executeMcpTool } from '../mcp/tools';

const PROXY_BASE_URL = 'https://techam-proxy.vercel.app'; // 끝에 슬래시 빼고 작성!

export async function runWorkerAgent(directive: string, config: any): Promise<string> {
  const genAI = new GoogleGenerativeAI("NO_KEY_SECURE_MODE");
  
  const workerModel = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    tools: [{ functionDeclarations: workerToolDeclarations }]
  }, {
    baseUrl: `${PROXY_BASE_URL}/api/gemini`,
    customHeaders: { 'x-user-email': config.userEmail }
  });

  const chat = workerModel.startChat({
    history: [{ 
      role: "user", 
      parts: [{ text: "너는 사내 시스템 검색 전문 행동대장이야. 지휘관의 명령을 받으면 알맞은 도구를 찾아 검색하고, 방대한 데이터에서 핵심 내용과 '티켓/문서 링크(URL)'만 뽑아서 보고서 형태로 요약해. 특히 Hive 개발자 문서(scrape_hive_docs)를 탐색할 때 다음 전략을 따라: 1. **섹션 마커 인식**: 문서를 긁었을 때 나오는 '[SECTION: 이름]'은 HTML의 id(앵커) 위치를 의미한다. 2. **정밀 타격**: 사용자가 특정 앵커가 포함된 URL(예: #explicit-signin)을 원하면, 본문에서 '[SECTION: explicit-signin]' 마커를 찾아 그 바로 아래에 있는 설명을 집중적으로 분석해라.3. **링크와 앵커의 조합**: index.html에서 [명시적 로그인](login-helper.html#explicit-signin)과 같은 링크를 발견하면, 전체 경로인 'dev/authv4/login-helper.html#explicit-signin'으로 정확히 호출해라." }] 
    }]
  });

  let result = await chat.sendMessage(directive);
  let functionCalls = result.response.functionCalls();

  // 도구를 써야 한다면 API를 찔러서 결과를 가져옴
  while (functionCalls && functionCalls.length > 0) {
    const responses = await Promise.all(functionCalls.map(async (call) => {
      const rawData = await executeMcpTool(call.name, call.args, config);
      return { functionResponse: { name: call.name, response: { content: rawData } } };
    }));
    result = await chat.sendMessage(responses);
    functionCalls = result.response.functionCalls();
  }

  // 🌟 토큰 다이어트: 방대한 Raw 데이터를 핵심만 압축해서 지휘관에게 전달
  const summaryPrompt = `방금 검색한 내용들 중 지휘관의 명령("${directive}")에 부합하는 내용만 팩트 위주로 요약해. 검색된 관련 티켓이 여러 개라면 임의로 1개만 고르지 말고 관련된 티켓을 가급적 모두(최대 3~5개) 리스트업해서 보여줘. 이때 반드시 목록을 '최신 생성일(또는 티켓 번호가 높은 순)' 기준으로 내림차순 정렬해서 작성해. 티켓 번호나 링크(URL)가 있다면 절대로 누락하지 말고 포함시켜. 검색 결과가 없다면 없다고 솔직히 말해.`;
  const summaryResult = await chat.sendMessage(summaryPrompt);
  
  return summaryResult.response.text();
}