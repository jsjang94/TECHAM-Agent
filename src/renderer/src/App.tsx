// src/App.tsx
import React, { useState, useEffect } from 'react'
import techamAgentImg from './assets/techamAgentImg.png'
// import techamAgentImg from './assets/techamAgentImg2.png'
// import techamAgentImg from './assets/testgif.gif'
import ChatWindow from './components/ChatWindow'
import './assets/main.css'

const safeParse = (key: string, defaultVal: string[]) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || defaultVal; } 
  catch { return defaultVal; }
}

export default function App() {
  const [isChatOpen, setIsChatOpen] = useState(false)
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
  const [isErrorNoteOpen, setIsErrorNoteOpen] = useState(false)
  const [errorNoteForm, setErrorNoteForm] = useState({ author: '', question: '', answer: '', link: '' })

  useEffect(() => {
    const chatArea = document.getElementById('chat-scroll-area');
    if (chatArea) {
      // 부모 창 전체를 건드리지 않고, 딱 '채팅 내역 영역' 내부의 스크롤만 부드럽게 내립니다.
      chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' });
    }
  }, [messages])

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
    } catch (err: any) { alert(`설정 실패: ${err.message}`) } 
    finally { setIsLoading(false) }
  }

  const toggleChat = (open: boolean) => {
    const electron = (window as any).electron
    setIsChatOpen(open);
    if (electron?.ipcRenderer) {
      if (open) {
        const chatHeight = Math.floor(window.screen.availHeight * 0.70);
        const targetWidth = Math.floor(window.screen.availWidth * 0.60); 
        const targetHeight = chatHeight + 250; 
        electron.ipcRenderer.send('resize-window', targetWidth, targetHeight, true);
      } else {
        electron.ipcRenderer.send('resize-window', 250, 250, false);
      }
    }
  }

  const handleSend = async () => {
    if (!inputText.trim() || !config.apiKey) return
    const userMsg = inputText
    setInputText('')
    setMessages(prev => [...prev, { text: userMsg, isBot: false, isSystem: false }])
    setIsLoading(true)

    try {
      const electron = (window as any).electron;
      let finalMessageForAI = userMsg;

      if (electron?.ipcRenderer) {
        const errorNoteRule = await electron.ipcRenderer.invoke('search-error-note', config, userMsg);
        if (errorNoteRule) {
          finalMessageForAI = `${errorNoteRule}\n\n사용자 질문: ${userMsg}`;
          setMessages(prev => [...prev, { text: `💡 (관련된 오답노트를 발견하여 문맥을 분석합니다)`, isBot: true, isSystem: true }]);
        }

        let pureHistory = messages
          .filter(m => !m.isSystem && m.text !== '모든 시스템과 직통 연결되었습니다. 무엇을 검색할까요?')
          .map(m => ({ role: m.isBot ? "model" : "user", parts: [{ text: m.text }] }));

        if (pureHistory.length > 0 && pureHistory[0].role === 'model') pureHistory.shift();

        const response = await electron.ipcRenderer.invoke('chat-with-agent', config, finalMessageForAI, pureHistory);
        if (response.success) setMessages(prev => [...prev, { text: response.text, isBot: true, isSystem: false }]);
        else setMessages(prev => [...prev, { text: `❌ 시스템 에러: ${response.error}`, isBot: true, isSystem: true }]);
      }
    } catch (error: any) { setMessages(prev => [...prev, { text: `[통신 오류] ${error.message}`, isBot: true, isSystem: true }]) } 
    finally { setIsLoading(false) }
  }

  const submitErrorNote = async () => {
    if (!errorNoteForm.question || !errorNoteForm.answer) return alert('질문과 답변은 필수입니다!');
    setIsLoading(true);
    const electron = (window as any).electron;
    if (electron?.ipcRenderer) {
      const res = await electron.ipcRenderer.invoke('write-error-note', config, errorNoteForm);
      setIsLoading(false);
      if (res.success) {
        alert('오답노트가 성공적으로 추가되었습니다!');
        setIsErrorNoteOpen(false); 
        setErrorNoteForm({ author: '', question: '', answer: '', link: '' }); 
      } else if (res.isConflict) alert('충돌이 발생했습니다. 다시 시도해주세요.');
      else alert(`등록 실패: ${res.error}`);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { 
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend(); } 
  }

  return (
    <div className="main-container" style={{ width: '100vw', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', backgroundColor: 'transparent' }}>
      
      {isChatOpen && (
        <div className="interactable" style={{ width: '100%', flex: 1, display: 'flex', paddingBottom: '0px', marginBottom: '40px', position:'relative', zIndex: 10, minHeight: 0, overflow: 'hidden' }}>
          {/* 🌟 messagesEndRef 속성을 지웠습니다 */}
          <ChatWindow 
            isChatOpen={isChatOpen} toggleChat={toggleChat} config={config} 
            isConfiguring={isConfiguring} setIsConfiguring={setIsConfiguring} saveConfigAndConnect={saveConfigAndConnect} 
            messages={messages as any} isLoading={isLoading} inputText={inputText} setInputText={setInputText} 
            handleSend={handleSend} handleKeyDown={handleKeyDown} 
            isErrorNoteOpen={isErrorNoteOpen} setIsErrorNoteOpen={setIsErrorNoteOpen}
            errorNoteForm={errorNoteForm} setErrorNoteForm={setErrorNoteForm} submitErrorNote={submitErrorNote}
          />
        </div>
      )}

      <div 
        className="interactable"
        onClick={() => !isChatOpen && toggleChat(true)}
        style={{
          width: '150px', height: '150px', flexShrink: 0, marginBottom: '10px',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          cursor: isChatOpen ? 'default' : 'pointer', transition: 'transform 0.2s ease',
        }}
        onMouseEnter={(e) => !isChatOpen && (e.currentTarget.style.transform = 'scale(1.05)')}
        onMouseLeave={(e) => !isChatOpen && (e.currentTarget.style.transform = 'scale(1)')}
      >
        <img src={techamAgentImg} alt="TECHAM Agent" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 10px 15px rgba(0,0,0,0.5))' }} />
      </div>
      
    </div>
  )
}