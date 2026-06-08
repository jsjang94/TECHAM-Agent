import React, { useState, useEffect, useRef } from 'react'
import techamAgentImg from './assets/techamAgentImg.png'
import ChatWindow from './components/ChatWindow'
import LoginPopup from './components/LoginPopup'
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
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState([{ text: '모든 시스템과 직통 연결되었습니다. 무엇을 검색할까요?', isBot: true, isSystem: false }])
  const [isErrorNoteOpen, setIsErrorNoteOpen] = useState(false)
  const [errorNoteForm, setErrorNoteForm] = useState({ author: '', question: '', answer: '', link: '' })
  const [isAgentHovered, setIsAgentHovered] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isCheckingConnection, setIsCheckingConnection] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isWarmedUp, setIsWarmedUp] = useState(false)

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

  // 앱 시작 시 프록시 워밍업 완료 여부 폴링
  useEffect(() => {
    const electron = (window as any).electron
    if (!electron?.ipcRenderer) return
    let cancelled = false
    const poll = async () => {
      while (!cancelled) {
        const { ok } = await electron.ipcRenderer.invoke('ping-proxy')
        if (ok) { if (!cancelled) setIsWarmedUp(true); return }
        await new Promise(r => setTimeout(r, 3000))
      }
    }
    poll()
    return () => { cancelled = true }
  }, [])


  useEffect(() => {
    setIsAgentHovered(false)
    if (isChatOpen) {
      const savedEmail = localStorage.getItem('hive_user_email')
      const savedPassword = localStorage.getItem('hive_user_password')
      if (savedEmail && savedPassword) {
        const electron = (window as any).electron
        if (electron?.ipcRenderer) {
          electron.ipcRenderer.invoke('validate-credentials', savedEmail, savedPassword)
            .then(({ authorized }: { authorized: boolean }) => {
              if (authorized) {
                // 매번 명시적으로 userEmail 세팅 → stale closure 문제 방지
                setConfig(prev => ({ ...prev, userEmail: savedEmail }))
              } else {
                localStorage.removeItem('hive_user_email')
                localStorage.removeItem('hive_user_password')
                setConfig(prev => ({ ...prev, userEmail: '' }))
                setIsLoginOpen(true)
              }
            })
            .catch(() => {
              // 네트워크 오류 시 localStorage 값으로 유지
              setConfig(prev => ({ ...prev, userEmail: savedEmail }))
            })
        } else {
          setConfig(prev => ({ ...prev, userEmail: savedEmail }))
        }
      } else {
        setIsLoginOpen(true)
      }
      // 저장된 채팅창 위치 복원
      if (chatRef.current) {
        chatRef.current.style.left = chatPosRef.current.left + 'px'
        chatRef.current.style.top = chatPosRef.current.top + 'px'
      }
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

  const handleAgentClick = async () => {
    if (isChatOpen || isTransitioning || isCheckingConnection) return
    const electron = (window as any).electron
    if (!electron?.ipcRenderer) {
      setConnectionError('ELECTRON_IPC_UNAVAILABLE')
      return
    }
    // 이미 워밍업 완료 상태면 ping 생략하고 바로 진행
    if (isWarmedUp) {
      const savedEmail = localStorage.getItem('hive_user_email')
      const savedPassword = localStorage.getItem('hive_user_password')
      if (!savedEmail || !savedPassword) setIsLoginOpen(true)
      else toggleChat(true)
      return
    }
    setIsCheckingConnection(true)
    setConnectionError(null)
    try {
      const { ok, error } = await electron.ipcRenderer.invoke('ping-proxy')
      if (!ok) {
        setConnectionError(error || 'UNKNOWN_ERROR')
        return
      }
      setIsWarmedUp(true)
      const savedEmail = localStorage.getItem('hive_user_email')
      const savedPassword = localStorage.getItem('hive_user_password')
      if (!savedEmail || !savedPassword) {
        setIsLoginOpen(true)
      } else {
        toggleChat(true)
      }
    } finally {
      setIsCheckingConnection(false)
    }
  }

  const saveConfigAndConnect = async (newConfig: any) => {
    // 이메일은 로그인 시 이미 검증됨 — config.userEmail 유지
    const updatedConfig = { ...newConfig, userEmail: config.userEmail }
    setConfig(updatedConfig)
    localStorage.setItem('hive_conf_spaces', JSON.stringify(updatedConfig.confSpaces))
    localStorage.setItem('hive_jira_spaces', JSON.stringify(updatedConfig.jiraSpaces))
    setIsConfiguring(false)
    setIsErrorNoteOpen(false)
    setMessages(prev => [...prev, { text: `시스템 연동 완료! 보안 세션이 가동됩니다.`, isBot: true, isSystem: true }])
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
      {connectionError && (
        <div className="interactable" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#1c1c1e', borderRadius: '16px', padding: '36px 32px', border: '1px solid rgba(255,80,80,0.3)', width: '340px', boxSizing: 'border-box', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>⚠️</div>
            <h3 style={{ color: '#fff', marginBottom: '8px', fontSize: '18px' }}>프록시 서버 연결 실패</h3>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', marginBottom: '16px' }}>네트워크를 확인하거나 잠시 후 다시 시도해주세요.</p>
            <div style={{ backgroundColor: 'rgba(255,59,48,0.12)', border: '1px solid rgba(255,59,48,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '20px' }}>
              <code style={{ color: '#ff6b6b', fontSize: '12px', wordBreak: 'break-all' }}>{connectionError}</code>
            </div>
            <button
              onClick={() => setConnectionError(null)}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}
            >
              닫기
            </button>
          </div>
        </div>
      )}
      {isLoginOpen && (
        <LoginPopup
          onSuccess={(email) => {
            setConfig(prev => ({ ...prev, userEmail: email }))
            setIsLoginOpen(false)
            toggleChat(true)
          }}
        />
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
          onClick={handleAgentClick}
          style={{ width: '140px', height: '140px', position: 'relative', zIndex: 1, cursor: (isChatOpen || isCheckingConnection) ? 'default' : 'pointer', transition: isTransitioning ? 'none' : 'transform 0.25s ease', marginBottom: '20px', transform: (isAgentHovered && !isTransitioning) ? 'scale(1.15)' : 'scale(1)', pointerEvents: isTransitioning ? 'none' : 'auto' }}
          onMouseEnter={() => !isChatOpen && !isTransitioning && !isCheckingConnection && setIsAgentHovered(true)}
          onMouseLeave={() => setIsAgentHovered(false)}
        >
          <img src={techamAgentImg} alt="TECHAM Agent" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: isCheckingConnection ? 'brightness(0.6) drop-shadow(0 10px 15px rgba(0,0,0,0.5))' : 'drop-shadow(0 10px 15px rgba(0,0,0,0.5))', transition: 'filter 0.2s ease' }} />
          {/* 프록시 연결 상태 점: 주황(워밍업 중) → 초록(준비됨) */}
          <div style={{ position: 'absolute', bottom: '22px', right: '14px', width: '11px', height: '11px', borderRadius: '50%', backgroundColor: isWarmedUp ? '#34c759' : '#ff9f0a', border: '2px solid rgba(0,0,0,0.4)', boxShadow: isWarmedUp ? '0 0 6px rgba(52,199,89,0.9)' : '0 0 6px rgba(255,159,10,0.7)', animation: isWarmedUp ? 'none' : 'statusPulse 1.4s ease-in-out infinite', zIndex: 2 }} />
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