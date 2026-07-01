import React, { useState, useEffect, useRef } from 'react'
import techamAgentImg from './assets/techamAgentImg.png'
import ChatWindow from './components/ChatWindow'
import LoginPopup from './components/LoginPopup'
import AlertModal from './components/AlertModal'
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
  const [messages, setMessages] = useState<{ text: string; isBot: boolean; isSystem: boolean }[]>([])
  const [isErrorNoteOpen, setIsErrorNoteOpen] = useState(false)
  const [errorNoteForm, setErrorNoteForm] = useState({ author: '', question: '', answer: '', link: '' })
  const [isAgentHovered, setIsAgentHovered] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isCheckingConnection, setIsCheckingConnection] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isWarmedUp, setIsWarmedUp] = useState(false)
  const [isWarmupFailed, setIsWarmupFailed] = useState(false)
  const [isNetworkLost, setIsNetworkLost] = useState(false)
  const [isNetworkReconnecting, setIsNetworkReconnecting] = useState(false)
  const [warmupDotIndex, setWarmupDotIndex] = useState(0)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isLoginRequesting, setIsLoginRequesting] = useState(false)
  const [isLoginSuccess, setIsLoginSuccess] = useState(false)
  const [loginDotIndex, setLoginDotIndex] = useState(0)
  const [reconnectDotIndex, setReconnectDotIndex] = useState(0)
  const [isChatMinimized, setIsChatMinimized] = useState(false)
  const [isChatMaximized, setIsChatMaximized] = useState(false)
  const hasSessionRef = useRef(false)
  const [alertModal, setAlertModal] = useState<{ emoji: string; message: string } | null>(null)
  const showAlert = (emoji: string, message: string) => setAlertModal({ emoji, message })

  // 채팅창 CSS 드래그용 refs
  const chatRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const CHAT_W = Math.floor(window.screen.availWidth * 0.60)
  const CHAT_H = Math.floor(window.screen.availHeight * 0.70)
  const CHAT_W_MAX = Math.floor(window.screen.availWidth * 0.85)
  const CHAT_H_MAX = Math.floor(window.screen.availHeight * 0.88)
  const chatPosRef = useRef({
    left: Math.floor((window.screen.availWidth - CHAT_W) / 2),
    top: Math.floor(window.screen.availHeight - 170 - 70 - CHAT_H), // 에이전트(170px) 위 60px 여유
  })

  useEffect(() => {
    const electron = (window as any).electron
    if (!electron?.ipcRenderer) return
    const onReconnecting = () => { setIsNetworkReconnecting(true); }
    const onError = () => { setIsNetworkLost(true); setIsNetworkReconnecting(true); }
    const onRestored = () => { setIsNetworkLost(false); setIsNetworkReconnecting(false); }
    electron.ipcRenderer.on('keepalive-reconnecting', onReconnecting)
    electron.ipcRenderer.on('keepalive-network-error', onError)
    electron.ipcRenderer.on('keepalive-restored', onRestored)
    return () => {
      electron.ipcRenderer.removeListener('keepalive-reconnecting', onReconnecting)
      electron.ipcRenderer.removeListener('keepalive-network-error', onError)
      electron.ipcRenderer.removeListener('keepalive-restored', onRestored)
    }
  }, [])

  // 기존 사용자(이미 이메일 연동됨)는 앱 시작 시 바로 웰컴 메시지 표시
  useEffect(() => {
    if (config.userEmail) {
      setMessages([{ text: '모든 시스템과 직통 연결되었습니다. 무엇을 검색할까요?', isBot: true, isSystem: false }])
    }
  }, [])

  useEffect(() => {
    const chatArea = document.getElementById('chat-scroll-area');
    if (chatArea) chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' });
  }, [messages])

  // 웜업 중 점 애니메이션 (클릭 후 활성화 중일 때만)
  useEffect(() => {
    if (!isCheckingConnection || isWarmedUp || isWarmupFailed) return
    const id = setInterval(() => setWarmupDotIndex(i => (i + 1) % 3), 600)
    return () => clearInterval(id)
  }, [isCheckingConnection, isWarmedUp, isWarmupFailed])

  // 로그인 중 점 애니메이션 (서버 통신 중일 때만)
  useEffect(() => {
    if (!isLoginRequesting) return
    const id = setInterval(() => setLoginDotIndex(i => (i + 1) % 3), 600)
    return () => clearInterval(id)
  }, [isLoginRequesting])

  // 네트워크 재연결 중 점 애니메이션
  useEffect(() => {
    if (!isNetworkReconnecting) return
    const id = setInterval(() => setReconnectDotIndex(i => (i + 1) % 3), 600)
    return () => clearInterval(id)
  }, [isNetworkReconnecting])

  useEffect(() => {
    setIsAgentHovered(false)
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

  const handleAgentClick = async (fromRetry = false) => {
    if (isChatOpen || isTransitioning || isCheckingConnection || (!fromRetry && isWarmupFailed)) return

    // 이미 로그인된 세션이면 웜업/로그인 체크 없이 바로 열기
    if (hasSessionRef.current) {
      toggleChat(true)
      return
    }

    const electron = (window as any).electron
    if (!electron?.ipcRenderer) {
      setConnectionError('ELECTRON_IPC_UNAVAILABLE')
      return
    }

    setIsCheckingConnection(true)
    setIsWarmedUp(false)
    setIsWarmupFailed(false)
    setIsLoginSuccess(false)
    setIsLoggingIn(false)
    setIsLoginRequesting(false)
    setConnectionError(null)

    // 로그인 팝업을 띄운 채로 반환하는 경우 finally에서 isLoggingIn을 초기화하지 않음
    let loginPopupShown = false

    try {
      // Step 1: 웜업 (메인 프로세스에서 최대 30회 시도 후 결과 반환)
      const { ok: warmedUp } = await electron.ipcRenderer.invoke('warmup-proxy')
      if (!warmedUp) { setIsWarmupFailed(true); return }
      setIsWarmedUp(true)
      await new Promise(r => setTimeout(r, 700)) // "에이전트 활성화 성공!" 잠깐 표시

      // Step 2: 로그인 (최초 1회만)
      const savedEmail = localStorage.getItem('hive_user_email')
      const savedPassword = localStorage.getItem('hive_user_password')
      if (!savedEmail || !savedPassword) {
        loginPopupShown = true
        setIsLoggingIn(true)
        setIsLoginOpen(true)
        return
      }

      setIsLoggingIn(true)
      setIsLoginRequesting(true)
      const { authorized } = await electron.ipcRenderer.invoke('validate-credentials', savedEmail, savedPassword)
      setIsLoginRequesting(false)

      if (!authorized) {
        localStorage.removeItem('hive_user_email')
        localStorage.removeItem('hive_user_password')
        setConfig(prev => ({ ...prev, userEmail: '' }))
        loginPopupShown = true
        setIsLoginOpen(true)
        return
      }
      setIsLoggingIn(false)

      setConfig(prev => ({ ...prev, userEmail: savedEmail }))
      hasSessionRef.current = true
      setIsLoginSuccess(true)
      await new Promise(r => setTimeout(r, 900))
      setIsLoginSuccess(false)
      toggleChat(true)

    } finally {
      setIsCheckingConnection(false)
      setIsLoginRequesting(false)
      if (!loginPopupShown) setIsLoggingIn(false)
    }
  }

  const saveConfigAndConnect = async (newConfig: any) => {
    const confSpaces = newConfig.confSpaces.map((s: string) => s.trim()).filter((s: string) => s.length > 0)
    const jiraSpaces = newConfig.jiraSpaces.map((s: string) => s.trim()).filter((s: string) => s.length > 0)
    if (confSpaces.length === 0 || jiraSpaces.length === 0) {
      showAlert('⚠️', '스페이스 키를 하나 이상 입력해주세요.')
      return
    }
    setConfig(prev => ({ ...prev, confSpaces, jiraSpaces }))
    localStorage.setItem('hive_conf_spaces', JSON.stringify(confSpaces))
    localStorage.setItem('hive_jira_spaces', JSON.stringify(jiraSpaces))
    setIsConfiguring(false)
    setIsErrorNoteOpen(false)
    showAlert('✅', '설정이 완료되었습니다.')
  }

  const handleNetworkReconnect = () => {
    setIsNetworkLost(false)
    // isNetworkReconnecting은 keepalive-restored 수신 시 자동 해제
    const electron = (window as any).electron
    electron?.ipcRenderer?.send('retry-keepalive')
  }

  const toggleChat = (open: boolean) => {
    setIsAgentHovered(false)
    setIsTransitioning(true)
    setIsChatOpen(open)
    if (!open) {
      setIsChatMinimized(false)
      setIsChatMaximized(false)
    }
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
    if (!errorNoteForm.question || !errorNoteForm.answer) return showAlert('✏️', '질문과 답변은 필수입니다!');
    setIsLoading(true);
    const electron = (window as any).electron;
    if (electron?.ipcRenderer) {
      const res = await electron.ipcRenderer.invoke('write-error-note', config, errorNoteForm);
      setIsLoading(false);
      if (res.success) {
        showAlert('📝', '오답노트가 성공적으로 추가되었습니다!');
        setIsErrorNoteOpen(false);
        setErrorNoteForm({ author: '', question: '', answer: '', link: '' });
      } else if (res.isConflict) showAlert('⚡', '충돌이 발생했습니다.\n다시 시도해주세요.');
      else showAlert('❌', `등록 실패: ${res.error}`);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { 
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend(); } 
  }

  return (
    <div className="main-container" style={{ width: '100vw', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', backgroundColor: 'transparent' }}>
      {alertModal && (
        <AlertModal emoji={alertModal.emoji} message={alertModal.message} onClose={() => setAlertModal(null)} />
      )}
      {isNetworkLost && (
        <div className="interactable" style={{ position: 'fixed', bottom: '240px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#1c1c1e', borderRadius: '16px', padding: '24px 28px', border: '1px solid rgba(255,80,80,0.3)', width: '320px', boxSizing: 'border-box', textAlign: 'center', zIndex: 9999, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          <h3 style={{ color: '#fff', marginBottom: '6px', fontSize: '15px' }}>네트워크 연결 끊김</h3>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px', marginBottom: '16px' }}>서버 유지에 10회 연속 실패했습니다.<br/>네트워크 상태를 확인해주세요.</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => { setIsNetworkLost(false); setIsNetworkReconnecting(false); toggleChat(false); setIsWarmedUp(false); hasSessionRef.current = false; }}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', backgroundColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}
            >
              닫기
            </button>
            <button
              onClick={handleNetworkReconnect}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', backgroundColor: 'rgba(255,159,10,0.2)', color: '#ff9f0a', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}
            >
              재시도
            </button>
          </div>
        </div>
      )}
      {isWarmupFailed && (
        <div className="interactable" style={{ position: 'fixed', bottom: '240px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#1c1c1e', borderRadius: '16px', padding: '24px 28px', border: '1px solid rgba(255,80,80,0.3)', width: '320px', boxSizing: 'border-box', textAlign: 'center', zIndex: 9999, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          <h3 style={{ color: '#fff', marginBottom: '6px', fontSize: '15px' }}>에이전트 활성화 실패</h3>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px', marginBottom: '16px' }}>Vercel 서버가 응답하지 않습니다.<br/>재시도하면 연결될 수 있습니다.</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setIsWarmupFailed(false)}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', backgroundColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}
            >
              닫기
            </button>
            <button
              onClick={() => handleAgentClick(true)}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', backgroundColor: 'rgba(255,159,10,0.2)', color: '#ff9f0a', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}
            >
              재시도
            </button>
          </div>
        </div>
      )}
      {connectionError && (
        <div className="interactable" style={{ position: 'fixed', bottom: '240px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#1c1c1e', borderRadius: '16px', padding: '24px 28px', border: '1px solid rgba(255,80,80,0.3)', width: '320px', boxSizing: 'border-box', textAlign: 'center', zIndex: 9999, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          <h3 style={{ color: '#fff', marginBottom: '6px', fontSize: '15px' }}>프록시 서버 연결 실패</h3>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', marginBottom: '12px' }}>네트워크를 확인하거나 잠시 후 다시 시도해주세요.</p>
          <div style={{ backgroundColor: 'rgba(255,59,48,0.12)', border: '1px solid rgba(255,59,48,0.3)', borderRadius: '8px', padding: '8px 12px', marginBottom: '16px' }}>
            <code style={{ color: '#ff6b6b', fontSize: '12px', wordBreak: 'break-all' }}>{connectionError}</code>
          </div>
          <button
            onClick={() => setConnectionError(null)}
            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none', backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}
          >
            닫기
          </button>
        </div>
      )}
      {isLoginOpen && (
        <LoginPopup
          onLoginStart={() => setIsLoginRequesting(true)}
          onLoginFail={() => setIsLoginRequesting(false)}
          onSuccess={async (email) => {
            setIsLoginRequesting(false)
            setIsLoggingIn(false)
            setIsLoginOpen(false)
            setConfig(prev => ({ ...prev, userEmail: email }))
            hasSessionRef.current = true
            setIsLoginSuccess(true)
            await new Promise(r => setTimeout(r, 900))
            setIsLoginSuccess(false)
            toggleChat(true)
          }}
        />
      )}
      {isChatOpen && (
        <div
          ref={chatRef}
          className="interactable"
          style={{
            position: 'fixed',
            left: chatPosRef.current.left,
            top: chatPosRef.current.top,
            width: isChatMaximized ? CHAT_W_MAX : CHAT_W,
            height: isChatMinimized ? 35 : (isChatMaximized ? CHAT_H_MAX : CHAT_H),
            zIndex: 10,
            overflow: 'hidden',
            borderRadius: '12px',
            transition: 'width 0.2s ease, height 0.2s ease',
          }}
        >
          <ChatWindow
            toggleChat={toggleChat} config={config}
            isConfiguring={isConfiguring} setIsConfiguring={setIsConfiguring} saveConfigAndConnect={saveConfigAndConnect}
            messages={messages as any} isLoading={isLoading} inputText={inputText} setInputText={setInputText}
            handleSend={handleSend} handleKeyDown={handleKeyDown}
            isNetworkReconnecting={isNetworkReconnecting}
            isErrorNoteOpen={isErrorNoteOpen} setIsErrorNoteOpen={setIsErrorNoteOpen}
            errorNoteForm={errorNoteForm} setErrorNoteForm={setErrorNoteForm} submitErrorNote={submitErrorNote}
            onTitlebarMouseDown={handleTitlebarMouseDown}
            isChatMinimized={isChatMinimized}
            isChatMaximized={isChatMaximized}
            onMinimize={() => setIsChatMinimized(v => !v)}
            onMaximize={() => { setIsChatMaximized(v => !v); setIsChatMinimized(false); }}
          />
        </div>
      )}
      {/* position: fixed 로 flex 레이아웃에서 완전히 분리 → 윈도우 리사이즈 중 움직임 없음 */}
      <div className="interactable" style={{ position: 'fixed', bottom: 0, left: 'calc(50% - 120px)', width: '240px', height: '222px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', zIndex: 20 }}>
        {/* 서버 상태 플로팅 바 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 14px', backgroundColor: 'rgba(100,100,100,0.60)', borderRadius: '8px', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.25)', boxShadow: '0 4px 20px rgba(0,0,0,0.25)', marginBottom: '16px', zIndex: 1 }}>
          {/* 프록시 연결 상태 점: 주황(워밍업 중) → 초록(준비됨) */}
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: isWarmupFailed ? '#ff3b30' : isNetworkReconnecting ? '#ff9f0a' : (isWarmedUp && !isLoggingIn) ? '#34c759' : isCheckingConnection ? '#ff9f0a' : 'rgba(255,255,255,0.30)', boxShadow: isWarmupFailed ? '0 0 5px rgba(255,59,48,0.95)' : isNetworkReconnecting ? '0 0 5px rgba(255,159,10,0.85)' : (isWarmedUp && !isLoggingIn) ? '0 0 5px rgba(52,199,89,0.95)' : isCheckingConnection ? '0 0 5px rgba(255,159,10,0.85)' : 'none', animation: ((isCheckingConnection && !isWarmedUp && !isWarmupFailed) || isLoginRequesting || isNetworkReconnecting) ? 'statusPulse 1.4s ease-in-out infinite' : 'none', flexShrink: 0 }} />
          <span style={{ fontSize: '13px', fontWeight: '400', color: 'rgba(255,255,255,0.92)', whiteSpace: 'nowrap', letterSpacing: '-0.2px' }}>
            {isNetworkReconnecting ? ['네트워크 연결 재시도 중..', '네트워크 연결 재시도 중...', '네트워크 연결 재시도 중....'][reconnectDotIndex]
              : isChatOpen ? '명령 대기 중'
              : isLoginSuccess ? '로그인 성공!'
              : isLoggingIn ? ['로그인 중..', '로그인 중...', '로그인 중...'][loginDotIndex]
              : isWarmedUp ? '에이전트 활성화 성공!'
              : isWarmupFailed ? '에이전트 활성화 실패'
              : isCheckingConnection ? ['에이전트 활성화 중..', '에이전트 활성화 중...', '에이전트 활성화 중....'][warmupDotIndex]
              : '에이전트 대기 중'}
          </span>
        </div>

        {/* 에이전트 뒤 반투명 배경 바 */}
        <div style={{ position: 'absolute', bottom: '14px', left: '-10px', right: '-10px', height: '105px', backgroundColor: 'rgba(130,130,130,0.42)', borderRadius: '16px', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.22)', boxShadow: '0 4px 18px rgba(0,0,0,0.18)', zIndex: 0 }} />

        {/* 에이전트 이미지 */}
        <div
          onClick={() => handleAgentClick()}
          style={{ width: '140px', height: '140px', position: 'relative', zIndex: 1, cursor: (isChatOpen || isCheckingConnection || isWarmupFailed) ? 'default' : 'pointer', transition: isTransitioning ? 'none' : 'transform 0.25s ease', marginBottom: '25px', transform: (isAgentHovered && !isTransitioning) ? 'scale(1.15)' : 'scale(1)', pointerEvents: isTransitioning ? 'none' : 'auto' }}
          onMouseEnter={() => !isChatOpen && !isTransitioning && !isCheckingConnection && setIsAgentHovered(true)}
          onMouseLeave={() => setIsAgentHovered(false)}
        >
          <img src={techamAgentImg} alt="TECHAM Agent" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: isCheckingConnection ? 'brightness(0.6) drop-shadow(0 10px 15px rgba(0,0,0,0.5))' : 'drop-shadow(0 10px 15px rgba(0,0,0,0.5))', transition: 'filter 0.2s ease' }} />
        </div>

        {/* 앱 종료 버튼 */}
        <button
          onClick={() => {
            const w = window as any
            if (w.api?.quitApp) w.api.quitApp()
            else w.electron?.ipcRenderer?.send('quit-app')
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.12)'; e.currentTarget.style.backgroundColor = 'rgba(60,60,60,0.80)' }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.backgroundColor = 'rgba(35,35,35,0.65)' }}
          title="앱 종료"
          style={{ position: 'absolute', bottom: '105px', right: '5px', width: '34px', height: '34px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.13)', backgroundColor: 'rgba(35,35,35,0.65)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', boxShadow: '0 4px 14px rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.82)', cursor: 'pointer', fontSize: '19px', fontWeight: '300', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, lineHeight: '1', pointerEvents: 'auto', transition: 'transform 0.15s ease, background-color 0.15s ease' }}
        >
          ×
        </button>
      </div>
    </div>
  )
}