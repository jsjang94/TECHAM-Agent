import React, { useState, useEffect, useRef } from 'react'
import { GoogleGenerativeAI } from '@google/generative-ai'
import hiveAgentImg from './assets/hivebot.png'
import ChatWindow from './components/ChatWindow'

export default function App() {
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [shouldRenderChat, setShouldRenderChat] = useState(false)
  
  // 🌟 [수정됨] 스페이스 설정(confSpace) 추가 및 기본값 세팅
  const [config, setConfig] = useState({
    apiKey: localStorage.getItem('hive_api_key') || '',
    confUrl: localStorage.getItem('hive_conf_url') || 'https://com2us.atlassian.net',
    confEmail: localStorage.getItem('hive_conf_email') || '',
    confToken: localStorage.getItem('hive_conf_token') || '',
    confSpace: localStorage.getItem('hive_conf_space') || 'GCPTAM'
  })
  
  const [isConfiguring, setIsConfiguring] = useState(!config.apiKey || !config.confUrl)
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState([{ text: '시스템 가동. 어떤 정보를 검색할까요?', isBot: true, isSystem: false }])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatSessionRef = useRef<any>(null)
  const mcpToolsRef = useRef<any[]>([])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // 🌟 Gemini가 거부하는 JSON Schema 불순물을 싹 제거해주는 정수기 함수
  const sanitizeGeminiSchema = (obj: any): any => {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(sanitizeGeminiSchema);
    
    const cleaned = { ...obj };
    delete cleaned.$schema;
    delete cleaned.additionalProperties;
    delete cleaned.propertyNames;
    delete cleaned.default;
    
    if (typeof cleaned.type === 'string') {
      cleaned.type = cleaned.type.toUpperCase();
    }
    
    for (const key in cleaned) {
      if (typeof cleaned[key] === 'object') {
        cleaned[key] = sanitizeGeminiSchema(cleaned[key]);
      }
    }
    return cleaned;
  };

  const saveConfigAndConnect = async (newConfig: any) => {
    setConfig(newConfig)
    localStorage.setItem('hive_api_key', newConfig.apiKey)
    localStorage.setItem('hive_conf_url', newConfig.confUrl)
    localStorage.setItem('hive_conf_email', newConfig.confEmail)
    localStorage.setItem('hive_conf_token', newConfig.confToken)
    localStorage.setItem('hive_conf_space', newConfig.confSpace) // 스페이스 저장
    setIsLoading(true)

    try {
      const electron = (window as any).electron
      const response = await electron.ipcRenderer.invoke('connect-mcp', newConfig)
      if (!response.success) throw new Error(response.error)
      
      const formattedTools = response.tools.map(t => {
        let safeSchema = { type: "OBJECT", properties: {} };
        if (t.inputSchema) {
          safeSchema = sanitizeGeminiSchema(t.inputSchema);
          if (!safeSchema.type) safeSchema.type = "OBJECT";
        }
        return { name: t.name.replace(/-/g, '_'), description: t.description || "사내 시스템 검색 도구", parameters: safeSchema }
      })
      
      mcpToolsRef.current = response.tools 
      const genAI = new GoogleGenerativeAI(newConfig.apiKey)
      const model = genAI.getGenerativeModel({ 
        model: "gemini-3-pro-preview",
        tools: formattedTools.length > 0 ? [{ functionDeclarations: formattedTools }] : undefined
      })

      // 🌟 [핵심] 특정 스페이스만 검색하도록 강력한 프롬프트 주입
      const spacePrompt = newConfig.confSpace 
        ? `\n\n[매우 중요] 너는 반드시 '${newConfig.confSpace}' 스페이스(Space) 내에서만 문서를 검색해야 해. 검색 도구(CQL 등)를 사용할 때 무조건 \`space = "${newConfig.confSpace}"\` 조건을 포함해서 검색해!` 
        : '';

      chatSessionRef.current = model.startChat({
        history: [
          { role: "user", parts: [{ text: `너는 사내 Confluence 위키를 검색해주는 Hive Agent야. 사용자가 질문하면 반드시 제공된 검색 도구를 활용해서 문서 내용을 바탕으로 대답해줘.${spacePrompt}` }] },
          { role: "model", parts: [{ text: "네, 명심하겠습니다. 지정된 스페이스 내에서만 문서를 검색하고 정확하게 답변하겠습니다." }] }
        ]
      })
      
      setIsConfiguring(false)
      setMessages(prev => [...prev, { text: `Confluence 시스템 연동 완료. [${newConfig.confSpace}] 스페이스에서 무엇을 찾아드릴까요?`, isBot: true, isSystem: true }])
    } catch (err: any) {
      alert(`연결 실패: ${err.message}`)
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
      let result = await chatSessionRef.current.sendMessage(userMsg)
      let functionCalls = result.response.functionCalls()
      
      while (functionCalls && functionCalls.length > 0) {
        setMessages(prev => [...prev, { text: `🔍 시스템 문서를 검색 중입니다... (${functionCalls!.length}건)`, isBot: true, isSystem: true }])
        
        const functionResponses = await Promise.all(functionCalls.map(async (call) => {
          const originalToolName = mcpToolsRef.current.find(t => t.name.replace(/-/g, '_') === call.name)?.name || call.name
          const electron = (window as any).electron
          
          try {
            const mcpResult = await electron.ipcRenderer.invoke('call-mcp', originalToolName, call.args)
            return { functionResponse: { name: call.name, response: { content: mcpResult } } }
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '20px' }}>
      {shouldRenderChat && (
        <ChatWindow 
          isChatOpen={isChatOpen} toggleChat={toggleChat} config={config} 
          isConfiguring={isConfiguring} setIsConfiguring={setIsConfiguring} saveConfigAndConnect={saveConfigAndConnect} 
          messages={messages} isLoading={isLoading} inputText={inputText} setInputText={setInputText} 
          handleSend={handleSend} handleKeyDown={handleKeyDown} messagesEndRef={messagesEndRef}
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