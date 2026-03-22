import React, { useState, useEffect } from 'react'
import techamAgentImg from './assets/techamAgentImg.png'
import ChatWindow from './components/ChatWindow'
import './assets/main.css'

const safeParse = (key: string, defaultVal: string[]) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || defaultVal; } 
  catch { return defaultVal; }
}

export default function App() {
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [config, setConfig] = useState({
    userEmail: localStorage.getItem('hive_user_email') || '',
    confSpaces: safeParse('hive_conf_spaces', ['GCPTAM']),
    jiraSpaces: safeParse('hive_jira_spaces', ['GCPTAM']),
  })
  
  const [isConfiguring, setIsConfiguring] = useState(!config.userEmail)
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState([{ text: '모든 시스템과 직통 연결되었습니다. 무엇을 검색할까요?', isBot: true, isSystem: false }])
  const [isErrorNoteOpen, setIsErrorNoteOpen] = useState(false)
  const [errorNoteForm, setErrorNoteForm] = useState({ author: '', question: '', answer: '', link: '' })

  useEffect(() => {
    const chatArea = document.getElementById('chat-scroll-area');
    if (chatArea) chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' });
  }, [messages])

  const saveConfigAndConnect = async (newConfig: any) => {
    setConfig(newConfig)
    localStorage.setItem('hive_user_email', newConfig.userEmail)
    localStorage.setItem('hive_conf_spaces', JSON.stringify(newConfig.confSpaces))
    localStorage.setItem('hive_jira_spaces', JSON.stringify(newConfig.jiraSpaces))
    setIsConfiguring(false)
    setIsErrorNoteOpen(false)
    setMessages(prev => [...prev, { text: `시스템 연동 완료! 보안 세션이 가동됩니다.`, isBot: true, isSystem: true }])
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
    // 🌟 1번 버그 해결 (apiKey 검사 제거)
    if (!inputText.trim() || !config.userEmail) return
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
          .slice(-2)
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
        className="interactable" onClick={() => !isChatOpen && toggleChat(true)}
        style={{ width: '150px', height: '150px', flexShrink: 0, marginBottom: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: isChatOpen ? 'default' : 'pointer', transition: 'transform 0.2s ease' }}
        onMouseEnter={(e) => !isChatOpen && (e.currentTarget.style.transform = 'scale(1.05)')}
        onMouseLeave={(e) => !isChatOpen && (e.currentTarget.style.transform = 'scale(1)')}
      >
        <img src={techamAgentImg} alt="TECHAM Agent" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 10px 15px rgba(0,0,0,0.5))' }} />
      </div>
    </div>
  )
}