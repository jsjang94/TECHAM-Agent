import React, { useState, useEffect, useRef } from 'react'
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
    jiraSpaces: safeParse('hive_jira_spaces', ['GCPTAM']),
    zendeskSubdomain: localStorage.getItem('hive_zendesk_subdomain') || 'com2usplatformcorp',
    zendeskEmail: localStorage.getItem('hive_zendesk_email') || '',
    zendeskToken: localStorage.getItem('hive_zendesk_token') || ''
  })
  
  const [isConfiguring, setIsConfiguring] = useState(!config.apiKey || !config.confUrl)
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState([{ text: '모든 시스템과 직통 연결되었습니다. 무엇을 검색할까요?', isBot: true, isSystem: false }])

  // 🌟 오답노트 관련 상태 유지
  const [isErrorNoteOpen, setIsErrorNoteOpen] = useState(false)
  const [errorNoteForm, setErrorNoteForm] = useState({ author: '', question: '', answer: '', link: '' })

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // 🌟 프론트엔드 제미나이 초기화 로직 싹 걷어냄! (백엔드가 알아서 함)
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
      setIsConfiguring(false)
      setIsErrorNoteOpen(false)
      setMessages(prev => [...prev, { text: `시스템 연동 완료! 지정된 스페이스 내에서 다중 검색 모드가 가동됩니다. (백엔드 에이전트 연결됨)`, isBot: true, isSystem: true }])
    } catch (err: any) {
      alert(`설정 실패: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  // 🌟 질문자님의 천재적인 Electron 창 사이즈 조절 로직 완벽 복구
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

  // 🌟 멀티 에이전트 지휘관(Manager)에게 통신하는 새 두뇌!
  const handleSend = async () => {
    if (!inputText.trim() || !config.apiKey) return
    const userMsg = inputText
    setInputText('')
    setMessages(prev => [...prev, { text: userMsg, isBot: false, isSystem: false }])
    setIsLoading(true)

    try {
      const electron = (window as any).electron;
      let finalMessageForAI = userMsg;

      // [핵심] 오답노트 DB 우선 검색 (가로채기)
      if (electron?.ipcRenderer) {
        const errorNoteRule = await electron.ipcRenderer.invoke('search-error-note', config, userMsg);
        if (errorNoteRule) {
          finalMessageForAI = `${errorNoteRule}\n\n사용자 질문: ${userMsg}`;
          setMessages(prev => [...prev, { text: `💡 (관련된 오답노트를 발견하여 문맥을 분석합니다)`, isBot: true, isSystem: true }]);
        }

       // [핵심] 순수 대화 기록 추출 (시스템 메시지 및 첫 인사말 제외)
        let pureHistory = messages
          .filter(m => !m.isSystem && m.text !== '모든 시스템과 직통 연결되었습니다. 무엇을 검색할까요?')
          .map(m => ({
            role: m.isBot ? "model" : "user",
            parts: [{ text: m.text }]
          }));

        // 🌟 제미나이 방어 코드: 만약 그래도 맨 앞이 'model'이라면 강제로 하나 빼버립니다!
        if (pureHistory.length > 0 && pureHistory[0].role === 'model') {
          pureHistory.shift();
        }

        // [핵심] 백엔드의 지휘관 에이전트 호출!
        const response = await electron.ipcRenderer.invoke('chat-with-agent', config, finalMessageForAI, pureHistory);
        
        if (response.success) {
          setMessages(prev => [...prev, { text: response.text, isBot: true, isSystem: false }]);
        } else {
          setMessages(prev => [...prev, { text: `❌ 시스템 에러: ${response.error}`, isBot: true, isSystem: true }]);
        }
      }
    } catch (error: any) {
      setMessages(prev => [...prev, { text: `[통신 오류] ${error.message}`, isBot: true, isSystem: true }])
    } finally {
      setIsLoading(false)
    }
  }

  // 🌟 오답노트 저장 버튼 클릭 시
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
        alert('다른 사람과 동시에 등록해서 충돌이 났습니다. 잠시 후에 다시 시도해주세요.');
      } else {
        alert(`등록 실패: ${res.error}`);
      }
    }
  }

  // 한글 입력기 중복(isComposing) 방어 추가
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { 
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { 
      e.preventDefault(); 
      handleSend(); 
    } 
  }

  // 🌟 질문자님의 완벽한 원본 레이아웃!
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '20px' }}>
      {shouldRenderChat && (
        <ChatWindow 
          isChatOpen={isChatOpen} toggleChat={toggleChat} config={config} 
          isConfiguring={isConfiguring} setIsConfiguring={setIsConfiguring} saveConfigAndConnect={saveConfigAndConnect} 
          messages={messages as any} isLoading={isLoading} inputText={inputText} setInputText={setInputText} 
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