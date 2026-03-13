import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { runWorkerAgent } from './workerAgent';

export async function processUserMessage(userMessage: string, chatHistory: any[], config: any): Promise<string> {
  const genAI = new GoogleGenerativeAI(config.apiKey);
  
  // 🌟 지휘관: 똑똑하고 문맥 파악에 능한 3.1 Pro 모델
  const managerModel = genAI.getGenerativeModel({ 
    model: "gemini-3-pro-preview",
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
  });

  // 시스템 프롬프트 없이 순수 대화 기록만 주입
  const chat = managerModel.startChat({ history: chatHistory });
  
  let result = await chat.sendMessage(userMessage);
  const functionCalls = result.response.functionCalls();

  // 검색이 필요하다고 판단하여 행동대장을 호출한 경우
  if (functionCalls && functionCalls[0].name === 'delegate_to_worker') {
    const directive = (functionCalls[0].args as any).directive;
    
    // 🌟 행동대장 출동!
    const workerReport = await runWorkerAgent(directive, config);
    
    // 행동대장의 요약 보고서를 지휘관에게 전달
    result = await chat.sendMessage([{
      functionResponse: { name: 'delegate_to_worker', response: { content: workerReport } }
    }]);
  }

  // 지휘관의 우아한 최종 답변 반환
  return result.response.text();
}