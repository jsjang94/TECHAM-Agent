import React, { useState, useEffect, useRef } from 'react'
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import hiveAgentImg from './assets/hivebot.png'
import ChatWindow from './components/ChatWindow'

const safeParse = (key: string, defaultVal: string[]) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || defaultVal; } 
  catch { return defaultVal; }
}

export default function App() {
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [shouldRenderChat, setShouldRenderChat] = useState(false)
  
  const [config, setConfig] = useState({
    apiKey: localStorage.getItem('hive_api_key') || '',
    confUrl: localStorage.getItem('hive_conf_url') || 'https://com2us.atlassian.net',
    confEmail: localStorage.getItem('hive_conf_email') || '',
    confToken: localStorage.getItem('hive_conf_token') || '',
    confSpaces: safeParse('hive_conf_spaces', ['GCPTAM']),
    jiraSpaces: safeParse('hive_jira_spaces', ['']),
    zendeskSubdomain: localStorage.getItem('hive_zendesk_subdomain') || '',
    zendeskEmail: localStorage.getItem('hive_zendesk_email') || '',
    zendeskToken: localStorage.getItem('hive_zendesk_token') || ''
  })
  
  const [isConfiguring, setIsConfiguring] = useState(!config.apiKey || !config.confUrl)
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState([{ text: '모든 시스템과 직통 연결되었습니다. 무엇을 검색할까요?', isBot: true, isSystem: false }])

  // 🌟 오답노트 관련 상태 추가
  const [isErrorNoteOpen, setIsErrorNoteOpen] = useState(false)
  const [errorNoteForm, setErrorNoteForm] = useState({ author: '', question: '', answer: '', link: '' })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatSessionRef = useRef<any>(null)

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const saveConfigAndConnect = async (newConfig: any) => {
    setConfig(newConfig)
    localStorage.setItem('hive_api_key', newConfig.apiKey)
    localStorage.setItem('hive_conf_url', newConfig.confUrl)
    localStorage.setItem('hive_conf_email', newConfig.confEmail)
    localStorage.setItem('hive_conf_token', newConfig.confToken)
    localStorage.setItem('hive_conf_spaces', JSON.stringify(newConfig.confSpaces))
    localStorage.setItem('hive_jira_spaces', JSON.stringify(newConfig.jiraSpaces))
    localStorage.setItem('hive_zendesk_subdomain', newConfig.zendeskSubdomain)
    localStorage.setItem('hive_zendesk_email', newConfig.zendeskEmail)
    localStorage.setItem('hive_zendesk_token', newConfig.zendeskToken)
    setIsLoading(true)

    try {
      const allTools = [
        {
          name: "search_confluence",
          description: "사내 Confluence 위키에서 문서를 검색합니다.",
          parameters: { type: SchemaType.OBJECT, properties: { cql: { type: SchemaType.STRING, description: "Confluence CQL 쿼리" } }, required: ["cql"] }
        },
        {
          name: "search_jira",
          // 🌟 지시어 강화: 핵심 키워드 추출 & text ~ 문법 강제
          description: "Jira에서 버그, 이슈, 티켓을 검색합니다. 사용자가 '비슷한 일감'을 찾을 경우 대화 문맥에서 핵심 명사 키워드(1~2개)만 추출하여 반드시 `text ~ \"키워드\"` 문법을 사용하세요. (예: `project in (\"GCPTAM\") AND text ~ \"푸시\"`)",
          parameters: { type: SchemaType.OBJECT, properties: { jql: { type: SchemaType.STRING, description: "Jira JQL 쿼리" } }, required: ["jql"] }
        },
        {
          name: "search_zendesk",
          description: "Zendesk에서 사내 비공개 고객 지원 티켓을 검색합니다.",
          parameters: { type: SchemaType.OBJECT, properties: { query: { type: SchemaType.STRING, description: "검색할 키워드" } }, required: ["query"] }
        },
        {
          name: "scrape_hive_docs",
          description: "Hive Developers 사이트의 문서를 읽어옵니다.",
          parameters: { type: SchemaType.OBJECT, properties: { urlPath: { type: SchemaType.STRING, description: "경로 (예: 'index.html')" } }, required: ["urlPath"] }
        }
      ];

      const genAI = new GoogleGenerativeAI(newConfig.apiKey)
      const model = genAI.getGenerativeModel({ 
        model: "gemini-3-pro-preview",
        tools: [{ functionDeclarations: allTools as any }] 
      })

      const validConfSpaces = newConfig.confSpaces.filter((s: string) => s.trim() !== '');
      const validJiraSpaces = newConfig.jiraSpaces.filter((s: string) => s.trim() !== '');
      
      const confSpaceRule = validConfSpaces.length > 0 ? `Confluence 검색 시 반드시 CQL에 \`space in ("${validConfSpaces.join('", "')}")\` 조건을 포함하세요.` : '';
      const jiraSpaceRule = validJiraSpaces.length > 0 ? `Jira 검색 시 반드시 JQL에 \`project in ("${validJiraSpaces.join('", "')}")\` 조건을 포함하세요.` : '';

      chatSessionRef.current = model.startChat({
        history: [
          { role: "user", parts: [{ text: `너는 사내 시스템을 통합 검색하는 Hive Agent야. 사용자가 질문하면 알맞은 도구(Confluence, Jira, Zendesk, Hive)를 선택해줘.\n\n[검색 필수 규칙]\n${confSpaceRule}\n${jiraSpaceRule}` }] },
          { role: "model", parts: [{ text: "네, 시스템 연동을 완료했습니다. 지정해주신 여러 스페이스(프로젝트) 내에서만 정확하게 통합 검색을 수행하겠습니다." }] }
        ]
      })
      
      setIsConfiguring(false)
      setIsErrorNoteOpen(false)
      setMessages(prev => [...prev, { text: `시스템 연동 완료! 지정된 스페이스 내에서 다중 검색 모드가 가동됩니다.`, isBot: true, isSystem: true }])
    } catch (err: any) {
      alert(`설정 실패: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  const toggleChat = (open: boolean) => {
    const electron = (window as any).electron
    if (open) {
      if (electron?.ipcRenderer) electron.ipcRenderer.send('resize-window', 750, 750)
      setTimeout(() => { setShouldRenderChat(true); setTimeout(() => setIsChatOpen(true), 10) }, 50)
    } else {
      setIsChatOpen(false)
      setTimeout(() => { setShouldRenderChat(false); if (electron?.ipcRenderer) electron.ipcRenderer.send('resize-window', 250, 250) }, 300)
    }
  }

  const handleSend = async () => {
    if (!inputText.trim() || !chatSessionRef.current) return
    const userMsg = inputText
    setInputText('')
    setMessages(prev => [...prev, { text: userMsg, isBot: false, isSystem: false }])
    setIsLoading(true)

    try {
      const electron = (window as any).electron;
      let finalMessageForAI = userMsg;

      // 🌟 [핵심] 사용자 몰래 오답노트 DB 우선 검색! (가로채기)
      if (electron?.ipcRenderer) {
        const errorNoteRule = await electron.ipcRenderer.invoke('search-error-note', config, userMsg);
        if (errorNoteRule) {
          // 백엔드에서 만든 완벽한 프롬프트를 그대로 얹어주기만 하면 됩니다!
          finalMessageForAI = `${errorNoteRule}\n\n사용자 질문: ${userMsg}`;
          setMessages(prev => [...prev, { text: `💡 (관련된 오답노트를 발견하여 문맥을 분석합니다)`, isBot: true, isSystem: true }]);
        }
      }

      let result = await chatSessionRef.current.sendMessage(finalMessageForAI)
      let functionCalls = result.response.functionCalls()
      
      while (functionCalls && functionCalls.length > 0) {
        setMessages(prev => [...prev, { text: `🔍 시스템 문서를 검색 중입니다... (${functionCalls!.length}건)`, isBot: true, isSystem: true }])
        
        const functionResponses = await Promise.all(functionCalls.map(async (call) => {
          let rawResult;
          try {
            if (call.name === 'search_confluence') rawResult = await electron.ipcRenderer.invoke('search-confluence', config, call.args.cql);
            else if (call.name === 'search_jira') rawResult = await electron.ipcRenderer.invoke('search-jira', config, call.args.jql);
            else if (call.name === 'search_zendesk') rawResult = await electron.ipcRenderer.invoke('search-zendesk', config, call.args.query);
            else if (call.name === 'scrape_hive_docs') rawResult = await electron.ipcRenderer.invoke('scrape-hive-docs', call.args.urlPath);
            
            let stringifiedResult = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
            if (stringifiedResult.length > 3000) stringifiedResult = stringifiedResult.substring(0, 3000) + "\n...[생략됨]...";

            return { functionResponse: { name: call.name, response: { content: stringifiedResult } } }
          } catch (e: any) {
            return { functionResponse: { name: call.name, response: { error: e.message } } }
          }
        }))

        result = await chatSessionRef.current.sendMessage(functionResponses)
        functionCalls = result.response.functionCalls()
      }

      const botReply = result.response.text()
      setMessages(prev => [...prev, { text: botReply, isBot: true, isSystem: false }])
    } catch (error: any) {
      setMessages(prev => [...prev, { text: `[시스템 오류] ${error.message}`, isBot: true, isSystem: true }])
    } finally {
      setIsLoading(false)
    }
  }

  // 🌟 오답노트 저장 버튼 클릭 시 (충돌 팝업 로직 추가)
  const submitErrorNote = async () => {
    if (!errorNoteForm.question || !errorNoteForm.answer) return alert('질문과 답변은 필수입니다!');
    
    setIsLoading(true);
    const electron = (window as any).electron;
    if (electron?.ipcRenderer) {
      const res = await electron.ipcRenderer.invoke('write-error-note', config, errorNoteForm);
      setIsLoading(false);

      if (res.success) {
        alert('오답노트가 Confluence 페이지 표에 성공적으로 추가되었습니다!');
        setIsErrorNoteOpen(false); // 창 닫고 채팅으로 복귀
        setErrorNoteForm({ author: '', question: '', answer: '', link: '' }); // 폼 초기화
      } else if (res.isConflict) {
        // 🌟 기획하신 다중 접속 충돌 방어 알림!
        alert('다른 사람과 동시에 등록해서 충돌이 났습니다. 잠시 후에 다시 시도해주세요.');
      } else {
        alert(`등록 실패: ${res.error}`);
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '20px' }}>
      {shouldRenderChat && (
        <ChatWindow 
          isChatOpen={isChatOpen} toggleChat={toggleChat} config={config} 
          isConfiguring={isConfiguring} setIsConfiguring={setIsConfiguring} saveConfigAndConnect={saveConfigAndConnect} 
          messages={messages} isLoading={isLoading} inputText={inputText} setInputText={setInputText} 
          handleSend={handleSend} handleKeyDown={handleKeyDown} messagesEndRef={messagesEndRef}
          isErrorNoteOpen={isErrorNoteOpen} setIsErrorNoteOpen={setIsErrorNoteOpen}
          errorNoteForm={errorNoteForm} setErrorNoteForm={setErrorNoteForm} submitErrorNote={submitErrorNote}
        />
      )}
      <div 
        onClick={() => toggleChat(!isChatOpen)}
        style={{ width: '250px', height: '250px', cursor: 'pointer', transition: 'transform 0.2s', zIndex: 10 }}
        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05) translateY(-5px)'}
        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1) translateY(0)'}
      >
        <img src={hiveAgentImg} alt="Hive Agent" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 10px 15px rgba(0,0,0,0.3))' }} />
      </div>
    </div>
  )
}