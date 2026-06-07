import React, { useState, useEffect, useRef } from 'react'
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
  const [isUnauthorizedOpen, setIsUnauthorizedOpen] = useState(false)
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState([{ text: '모든 시스템과 직통 연결되었습니다. 무엇을 검색할까요?', isBot: true, isSystem: false }])
  const [isErrorNoteOpen, setIsErrorNoteOpen] = useState(false)
  const [errorNoteForm, setErrorNoteForm] = useState({ author: '', question: '', answer: '', link: '' })
  const [isAgentHovered, setIsAgentHovered] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)

  // 채팅창 CSS 드래그용 refs
  const chatRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const CHAT_W = Math.floor(window.screen.availWidth * 0.60)
  const CHAT_H = Math.floor(window.screen.availHeight * 0.70)
  const chatPosRef = useRef({
    left: Math.floor((window.screen.availWidth - CHAT_W) / 2),
    top: Math.floor(window.screen.availHeight - 170 - 24 - CHAT_H), // 에이전트(170px) 위 24px 여유
  })

  useEffect(() => {
    const chatArea = document.getElementById('chat-scroll-area');
    if (chatArea) chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' });
  }, [messages])

  useEffect(() => {
    setIsAgentHovered(false)
    if (isChatOpen && !config.userEmail) {
      setIsConfiguring(true)
      setIsErrorNoteOpen(false)
    }
    // 채팅창이 열릴 때 저장된 위치 복원
    if (isChatOpen && chatRef.current) {
      chatRef.current.style.left = chatPosRef.current.left + 'px'
      chatRef.current.style.top = chatPosRef.current.top + 'px'
    }
  }, [isChatOpen])

  useEffect(() => {
    const electron = (window as any).electron
    let currentlyIgnoring = true

    const onMouseMove = (e: MouseEvent) => {
      // 채팅창 드래그 처리
      if (isDraggingRef.current && chatRef.current) {
        const newLeft = e.clientX - dragOffsetRef.current.x
        const newTop = Math.max(0, e.clientY - dragOffsetRef.current.y)
        chatRef.current.style.left = newLeft + 'px'
        chatRef.current.style.top = newTop + 'px'
        chatPosRef.current = { left: newLeft, top: newTop }
      }

      // interactable 위에 있는지 확인해 클릭 통과 여부 토글
      if (electron?.ipcRenderer) {
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const shouldIgnore = el?.closest('.interactable') === null
        if (shouldIgnore !== currentlyIgnoring) {
          currentlyIgnoring = shouldIgnore
          electron.ipcRenderer.send('set-ignore-mouse', shouldIgnore)
        }
      }
    }
    const onMouseUp = () => { isDraggingRef.current = false }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const handleTitlebarMouseDown = (e: React.MouseEvent) => {
    if (!chatRef.current) return
    const rect = chatRef.current.getBoundingClientRect()
    isDraggingRef.current = true
    dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const saveConfigAndConnect = async (newConfig: any) => {
    const electron = (window as any).electron
    setIsLoading(true)
    try {
      if (electron?.ipcRenderer) {
        const { authorized } = await electron.ipcRenderer.invoke('validate-email', newConfig.userEmail)
        if (!authorized) {
          setIsUnauthorizedOpen(true)
          return
        }
      }
      setConfig(newConfig)
      localStorage.setItem('hive_user_email', newConfig.userEmail)
      localStorage.setItem('hive_conf_spaces', JSON.stringify(newConfig.confSpaces))
      localStorage.setItem('hive_jira_spaces', JSON.stringify(newConfig.jiraSpaces))
      setIsConfiguring(false)
      setIsErrorNoteOpen(false)
      setMessages(prev => [...prev, { text: `시스템 연동 완료! 보안 세션이 가동됩니다.`, isBot: true, isSystem: true }])
    } finally {
      setIsLoading(false)
    }
  }

  const toggleChat = (open: boolean) => {
    setIsAgentHovered(false)
    setIsTransitioning(true)
    setIsChatOpen(open)
    setTimeout(() => setIsTransitioning(false), 200)
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
      {isUnauthorizedOpen && (
        <div className="interactable" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#1c1c1e', borderRadius: '16px', padding: '36px 32px', border: '1px solid rgba(255,255,255,0.12)', textAlign: 'center', maxWidth: '300px', width: '90%' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🚫</div>
            <h3 style={{ color: '#fff', marginBottom: '10px', fontSize: '16px' }}>허가된 계정이 아닙니다</h3>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '13px', marginBottom: '28px', lineHeight: '1.6' }}>
              사용이 허가된 사내 계정으로<br />다시 시도해주세요.
            </p>
            <button
              onClick={() => setIsUnauthorizedOpen(false)}
              style={{ padding: '10px 32px', borderRadius: '8px', border: 'none', backgroundColor: '#00f3ff', color: '#000', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}
            >
              확인
            </button>
          </div>
        </div>
      )}
      {isChatOpen && (
        <div
          ref={chatRef}
          className="interactable"
          style={{ position: 'fixed', left: chatPosRef.current.left, top: chatPosRef.current.top, width: CHAT_W, height: CHAT_H, zIndex: 10, overflow: 'hidden', borderRadius: '12px' }}
        >
          <ChatWindow
            isChatOpen={isChatOpen} toggleChat={toggleChat} config={config}
            isConfiguring={isConfiguring} setIsConfiguring={setIsConfiguring} saveConfigAndConnect={saveConfigAndConnect}
            messages={messages as any} isLoading={isLoading} inputText={inputText} setInputText={setInputText}
            handleSend={handleSend} handleKeyDown={handleKeyDown}
            isErrorNoteOpen={isErrorNoteOpen} setIsErrorNoteOpen={setIsErrorNoteOpen}
            errorNoteForm={errorNoteForm} setErrorNoteForm={setErrorNoteForm} submitErrorNote={submitErrorNote}
            onTitlebarMouseDown={handleTitlebarMouseDown}
          />
        </div>
      )}
      {/* position: fixed 로 flex 레이아웃에서 완전히 분리 → 윈도우 리사이즈 중 움직임 없음 */}
      <div className="interactable" style={{ position: 'fixed', bottom: 0, left: 'calc(50% - 120px)', width: '240px', height: '170px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', zIndex: 20 }}>
        {/* 플로팅 도크 바: 가로 전체, 높이 = 에이전트(140px)의 80% = 112px */}
        <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, height: '112px', backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: '16px', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', boxShadow: '0 4px 20px rgba(0,0,0,0.22)', zIndex: 0 }} />

        {/* 에이전트 이미지 */}
        <div
          onClick={() => !isChatOpen && toggleChat(true)}
          style={{ width: '140px', height: '140px', position: 'relative', zIndex: 1, cursor: isChatOpen ? 'default' : 'pointer', transition: isTransitioning ? 'none' : 'transform 0.25s ease', marginBottom: '20px', transform: (isAgentHovered && !isTransitioning) ? 'scale(1.15)' : 'scale(1)', pointerEvents: isTransitioning ? 'none' : 'auto' }}
          onMouseEnter={() => !isChatOpen && !isTransitioning && setIsAgentHovered(true)}
          onMouseLeave={() => setIsAgentHovered(false)}
        >
          <img src={techamAgentImg} alt="TECHAM Agent" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 10px 15px rgba(0,0,0,0.5))' }} />
        </div>

        {/* 앱 종료 버튼: 바(height 112px, right 0) 우측 상단 모서리에 걸침 */}
        {/* center Y = bottom 112px → bottom: 112-14=98px, center X = right 0 → right: 8px (약간 안쪽) */}
        <button
          onClick={() => {
            const w = window as any
            if (w.api?.quitApp) w.api.quitApp()
            else w.electron?.ipcRenderer?.send('quit-app')
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.2)'; e.currentTarget.style.backgroundColor = 'rgba(80,80,80,0.75)' }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.backgroundColor = 'rgba(50,50,50,0.55)' }}
          title="앱 종료"
          style={{ position: 'absolute', bottom: '108px', right: '6px', width: '28px', height: '28px', borderRadius: '50%', border: 'none', backgroundColor: 'rgba(50,50,50,0.55)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', color: 'rgba(255,255,255,0.9)', cursor: 'pointer', fontSize: '20px', fontWeight: '300', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, lineHeight: '1', pointerEvents: 'auto', transition: 'transform 0.15s ease, background-color 0.15s ease' }}
        >
          ×
        </button>
      </div>
    </div>
  )
}