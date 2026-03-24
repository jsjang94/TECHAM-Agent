import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { runWorkerAgent } from './workerAgent';

const PROXY_BASE_URL = 'https://techam-proxy.vercel.app'; // 끝에 슬래시 빼고 작성!

export async function processUserMessage(userMessage: string, chatHistory: any[], config: any): Promise<string> {
  const genAI = new GoogleGenerativeAI("NO_KEY_SECURE_MODE");
  
  const managerModel = genAI.getGenerativeModel({ 
    model: "gemini-3.1-pro-preview",
    tools: [{
      functionDeclarations: [{
        name: "delegate_to_worker",
        description: "사용자의 질문에 답하기 위해 사내 시스템(Jira, Zendesk, Confluence 등) 검색이 필요할 때 행동대장에게 지시를 내립니다. 요약된 검색 결과를 받아볼 수 있습니다.",
        parameters: { 
          type: SchemaType.OBJECT, 
          properties: { directive: { type: SchemaType.STRING, description: "행동대장에게 내릴 구체적인 검색 지시 (예: 'Zendesk에서 iOS 푸시 관련 이슈 찾아줘')" } }, 
          required: ["directive"] 
        }
      }]
    }]
  }, {
    baseUrl: `${PROXY_BASE_URL}/api/gemini`,
    customHeaders: { 'x-user-email': config.userEmail }
  });

  const chat = managerModel.startChat({ history: chatHistory });
  let result = await chat.sendMessage(userMessage);
  const functionCalls = result.response.functionCalls();

  if (functionCalls && functionCalls[0].name === 'delegate_to_worker') {
    const directive = (functionCalls[0].args as any).directive;
    const workerReport = await runWorkerAgent(directive, config);
    result = await chat.sendMessage([{
      functionResponse: { name: 'delegate_to_worker', response: { content: workerReport } }
    }]);
  }
  return result.response.text();
}