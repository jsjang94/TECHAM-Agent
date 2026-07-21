import React, { useState, useEffect, useRef } from 'react'
import techamAgentImg from './assets/techamAgentImg.png'
import ChatWindow from './components/ChatWindow'
import LoginPopup from './components/LoginPopup'
import AlertModal from './components/AlertModal'
import './assets/main.css'

const WELCOME_MESSAGE = '모든 시스템과 정상적으로 연결되었습니다. 무엇을 검색할까요?'

// 대화 히스토리: 최근 3왕복(6개)이면 후속 질문("그럼 애플은?")의 맥락 해소에 충분.
// 봇 답변은 600자로 잘라서 전달 — 대명사/주제 파악에는 충분하되, 이전 답변의 긴 스크랩·URL 목록이
// 통째로 실려 모델이 재검색 없이 과거 답을 재활용(환각·낡은 답 유발)하는 것을 막는다.
// 재검색 강제는 시스템 프롬프트의 '재검색 원칙'과 함께 이중으로 방어한다.
const HISTORY_LIMIT = 6
const HISTORY_BOT_MAX_CHARS = 600

// 채팅창 최대화/복원 애니메이션 (드래그 중에는 잠시 꺼서 커서를 즉시 따라가게 함)
const CHAT_TRANSITION = 'left 0.25s ease, top 0.25s ease, width 0.25s ease, height 0.25s ease, border-radius 0.25s ease'

const safeParse = (key: string, defaultVal: string[]) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || defaultVal; }
  catch { return defaultVal; }
}

export default function App() {
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [config, setConfig] = useState({
    confSpaces: safeParse('hive_conf_spaces', ['GCPTAM']),
    jiraSpaces: safeParse('hive_jira_spaces', ['GCPTAM']),
  })

  // "처음 설정으로 되돌리기"가 복귀할 최초 스냅샷.
  // 앱은 항상 "가장 최근 저장값"으로 시작하므로 세션 시작값을 쓰면 사실상 직전 저장값이 된다.
  // 그래서 이 기능이 처음 동작하는 시점의 저장값을 hive_initial_* 키에 딱 한 번만 굳혀 저장하고,
  // 이후 저장·재시작으로 config가 바뀌어도 이 원본은 변하지 않는다. (useState lazy init로 1회만 실행)
  const [initialConfig] = useState(() => {
    const hasInitial = !!localStorage.getItem('hive_initial_conf_spaces') && !!localStorage.getItem('hive_initial_jira_spaces')
    if (hasInitial) {
      return {
        confSpaces: safeParse('hive_initial_conf_spaces', ['GCPTAM']),
        jiraSpaces: safeParse('hive_initial_jira_spaces', ['GCPTAM']),
      }
    }
    const seed = {
      confSpaces: safeParse('hive_conf_spaces', ['GCPTAM']),
      jiraSpaces: safeParse('hive_jira_spaces', ['GCPTAM']),
    }
    localStorage.setItem('hive_initial_conf_spaces', JSON.stringify(seed.confSpaces))
    localStorage.setItem('hive_initial_jira_spaces', JSON.stringify(seed.jiraSpaces))
    return seed
  })

  const hasSavedSpacesInitially = !!localStorage.getItem('hive_conf_spaces') && !!localStorage.getItem('hive_jira_spaces')
  // 스페이스 설정을 저장한 적이 없으면 채팅 진입 시 바로 설정 화면부터 보여준다
  const [isConfiguring, setIsConfiguring] = useState(!hasSavedSpacesInitially)
  // 스페이스 설정을 저장한 적이 있는지 (저장 전에는 위키 화면 이동 차단 + 설정 화면 닫기 불가)
  const [hasSavedSpaces, setHasSavedSpaces] = useState(hasSavedSpacesInitially)
  // 로컬 자격증명(설정 코드)이 저장돼 있는지 — 채팅 진입 게이트. main에 물어서 세팅한다.
  const [hasCredentials, setHasCredentials] = useState(false)
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [inputText, setInputText] = useState('')
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [isSubmittingNote, setIsSubmittingNote] = useState(false)
  const [messages, setMessages] = useState<{ text: string; isBot: boolean; isSystem: boolean }[]>([])
  const [isErrorNoteOpen, setIsErrorNoteOpen] = useState(false)
  const [errorNoteForm, setErrorNoteForm] = useState({ author: '', question: '', answer: '', link: '' })
  const [isAgentHovered, setIsAgentHovered] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isSetupSuccess, setIsSetupSuccess] = useState(false)
  const [isChatMaximized, setIsChatMaximized] = useState(false)
  const [alertModal, setAlertModal] = useState<{ emoji: string; message: string } | null>(null)
  const showAlert = (emoji: string, message: string) => setAlertModal({ emoji, message })
  const [integrationsHealth, setIntegrationsHealth] = useState<{ gemini: boolean | null; atlassian: boolean | null; zendesk: boolean | null }>({ gemini: null, atlassian: null, zendesk: null })

  // 채팅창 CSS 드래그용 refs
  const chatRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const CHAT_W = Math.floor(window.screen.availWidth * 0.60)
  const CHAT_H = Math.floor(window.screen.availHeight * 0.70)
  const chatPosRef = useRef({
    left: Math.floor((window.screen.availWidth - CHAT_W) / 2),
    top: Math.floor(window.screen.availHeight - 170 - 70 - CHAT_H), // 에이전트(170px) 위 60px 여유
  })

  // 시작 시: 로컬 자격증명 존재 여부 확인 + 구버전(프록시/이메일 시절) localStorage 잔재 정리
  useEffect(() => {
    localStorage.removeItem('hive_user_password')
    localStorage.removeItem('hive_user_email')
    const electron = (window as any).electron
    electron?.ipcRenderer?.invoke('has-credentials').then((ok: boolean) => setHasCredentials(!!ok))
  }, [])

  // 채팅창이 열려 있는 동안 Gemini/Atlassian/Zendesk 연결 상태를 로컬 자격증명으로 직접 확인하고,
  // 셋 다 정상일 때만 웰컴 메시지를 표시 (시작하자마자 무조건 뜨지 않게)
  useEffect(() => {
    const electron = (window as any).electron
    if (!isChatOpen || !hasCredentials || !electron?.ipcRenderer) return
    let cancelled = false
    setIntegrationsHealth({ gemini: null, atlassian: null, zendesk: null })
    electron.ipcRenderer.invoke('check-integrations-health').then((result: { gemini: boolean; atlassian: boolean; zendesk: boolean }) => {
      if (cancelled) return
      setIntegrationsHealth(result)
      if (result.gemini && result.atlassian && result.zendesk) {
        setMessages(prev => prev.length === 0 ? [{ text: WELCOME_MESSAGE, isBot: true, isSystem: false }] : prev)
      }
    })
    return () => { cancelled = true }
  }, [isChatOpen, hasCredentials])

  useEffect(() => {
    const chatArea = document.getElementById('chat-scroll-area');
    if (chatArea) chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' });
  }, [messages])

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
    const onMouseUp = () => {
      if (isDraggingRef.current && chatRef.current) chatRef.current.style.transition = CHAT_TRANSITION
      isDraggingRef.current = false
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const handleTitlebarMouseDown = (e: React.MouseEvent) => {
    if (!chatRef.current || isChatMaximized) return // 최대화 상태에서는 드래그 불가 (mac 최대화 창과 동일)
    const rect = chatRef.current.getBoundingClientRect()
    isDraggingRef.current = true
    chatRef.current.style.transition = 'none' // 드래그 중 transition 끔 → 커서 즉시 추적
    dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // 프록시/웜업 제거: 자격증명이 있으면 즉시 채팅, 없으면 설정 코드 입력 팝업.
  const handleAgentClick = () => {
    if (isChatOpen || isTransitioning) return
    if (hasCredentials) { toggleChat(true); return }
    setIsLoginOpen(true)
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
    setHasSavedSpaces(true)
    setIsConfiguring(false)
    setIsErrorNoteOpen(false)
    showAlert('✅', '설정이 완료되었습니다.')
  }

  const toggleChat = (open: boolean) => {
    setIsAgentHovered(false)
    setIsTransitioning(true)
    setIsChatOpen(open)
    if (!open) {
      setIsChatMaximized(false)
    }
    setTimeout(() => setIsTransitioning(false), 200)
  }

  const handleSend = async () => {
    if (!inputText.trim() || !hasCredentials) return
    const userMsg = inputText
    setInputText('')
    setMessages(prev => [...prev, { text: userMsg, isBot: false, isSystem: false }])
    setIsChatLoading(true)

    try {
      const electron = (window as any).electron;
      let finalMessageForAI = userMsg;

      if (electron?.ipcRenderer) {
        const errorNoteRule = await electron.ipcRenderer.invoke('search-error-note', config, userMsg);
        if (errorNoteRule) {
          finalMessageForAI = `${errorNoteRule}\n\n사용자 질문: ${userMsg}`;
          setMessages(prev => [...prev, { text: `💡 (관련된 내용을 발견하여 문맥을 분석합니다)`, isBot: true, isSystem: true }]);
        }

        let pureHistory = messages
          .filter(m => !m.isSystem && m.text !== WELCOME_MESSAGE)
          .slice(-HISTORY_LIMIT)
          .map(m => ({
            role: m.isBot ? "model" : "user",
            parts: [{
              text: (m.isBot && m.text.length > HISTORY_BOT_MAX_CHARS)
                ? m.text.slice(0, HISTORY_BOT_MAX_CHARS) + '\n...(이하 생략 — 자세한 내용이 필요하면 도구로 다시 검색할 것)'
                : m.text
            }]
          }));
        if (pureHistory.length > 0 && pureHistory[0].role === 'model') pureHistory.shift();

        const response = await electron.ipcRenderer.invoke('chat-with-agent', config, finalMessageForAI, pureHistory);
        if (response.success) setMessages(prev => [...prev, { text: response.text, isBot: true, isSystem: false }]);
        else setMessages(prev => [...prev, { text: `❌ 시스템 에러: ${response.error}`, isBot: true, isSystem: true }]);
      }
    } catch (error: any) { setMessages(prev => [...prev, { text: `[통신 오류] ${error.message}`, isBot: true, isSystem: true }]) }
    finally { setIsChatLoading(false) }
  }

  const submitErrorNote = async () => {
    if (!errorNoteForm.question || !errorNoteForm.answer) return showAlert('✏️', '질문과 답변은 필수입니다!');
    setIsSubmittingNote(true);
    try {
      const electron = (window as any).electron;
      if (!electron?.ipcRenderer) { showAlert('❌', '시스템 오류가 발생했습니다.'); return; }
      const res = await electron.ipcRenderer.invoke('write-error-note', config, errorNoteForm);
      if (res.success) {
        showAlert('📝', '팀 위키 문서에 성공적으로 추가되었습니다!');
        setIsErrorNoteOpen(false);
        setErrorNoteForm({ author: '', question: '', answer: '', link: '' });
      } else if (res.isConflict) showAlert('⚡', '충돌이 발생했습니다.\n다시 시도해주세요.');
      else showAlert('❌', `등록 실패: ${res.error}`);
    } catch (error: any) {
      showAlert('❌', `등록 중 오류가 발생했습니다: ${error.message}`);
    } finally {
      setIsSubmittingNote(false);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend(); }
  }

  // 팝업 위치: 채팅창이 열려 있으면 채팅창 정중앙(드래그/최대화 반영), 닫혀 있으면 에이전트 위
  const popupPosStyle: React.CSSProperties = isChatOpen
    ? (isChatMaximized
        ? { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
        : { position: 'fixed', left: chatPosRef.current.left + CHAT_W / 2, top: chatPosRef.current.top + CHAT_H / 2, transform: 'translate(-50%, -50%)' })
    : { position: 'fixed', bottom: '240px', left: '50%', transform: 'translateX(-50%)' }

  return (
    <div className="main-container" style={{ width: '100vw', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', backgroundColor: 'transparent' }}>
      {alertModal && (
        <AlertModal emoji={alertModal.emoji} message={alertModal.message} onClose={() => setAlertModal(null)} positionStyle={popupPosStyle} />
      )}
      {isLoginOpen && (
        <LoginPopup
          onSuccess={async () => {
            setIsLoginOpen(false)
            setHasCredentials(true)
            // 설정 코드를 방금 입력했으면 localStorage에 예전 스페이스 값이 남아있어도
            // 항상 스페이스 설정 화면부터 보여준다 (마운트 시점 계산에 기대지 않음)
            setIsConfiguring(true)
            setIsSetupSuccess(true)
            await new Promise(r => setTimeout(r, 900))
            setIsSetupSuccess(false)
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
            left: isChatMaximized ? 0 : chatPosRef.current.left,
            top: isChatMaximized ? 0 : chatPosRef.current.top,
            width: isChatMaximized ? '100vw' : CHAT_W,
            height: isChatMaximized ? '100vh' : CHAT_H,
            zIndex: 10,
            overflow: 'hidden',
            borderRadius: isChatMaximized ? 0 : '12px',
            transition: CHAT_TRANSITION,
          }}
        >
          <ChatWindow
            toggleChat={toggleChat} config={config} initialConfig={initialConfig}
            isConfiguring={isConfiguring} setIsConfiguring={setIsConfiguring} saveConfigAndConnect={saveConfigAndConnect}
            messages={messages as any} isChatLoading={isChatLoading} isSubmittingNote={isSubmittingNote} inputText={inputText} setInputText={setInputText}
            handleSend={handleSend} handleKeyDown={handleKeyDown}
            integrationsHealth={integrationsHealth}
            hasSavedSpaces={hasSavedSpaces} showAlert={showAlert}
            isErrorNoteOpen={isErrorNoteOpen} setIsErrorNoteOpen={setIsErrorNoteOpen}
            errorNoteForm={errorNoteForm} setErrorNoteForm={setErrorNoteForm} submitErrorNote={submitErrorNote}
            onTitlebarMouseDown={handleTitlebarMouseDown}
            isChatMaximized={isChatMaximized}
            onMinimize={() => {
              const w = window as any
              if (w.api?.minimizeApp) w.api.minimizeApp()
              else w.electron?.ipcRenderer?.send('minimize-app')
            }}
            onMaximize={() => setIsChatMaximized(v => !v)}
          />
        </div>
      )}
      {/* position: fixed 로 flex 레이아웃에서 완전히 분리 → 윈도우 리사이즈 중 움직임 없음 */}
      {/* 최대화 시 Dock으로 사라지듯 아래로 슬라이드, 복원 시 원위치 */}
      <div className="interactable" style={{ position: 'fixed', bottom: 0, left: 'calc(50% - 120px)', width: '240px', height: '222px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', zIndex: 20, transform: isChatMaximized ? 'translateY(260px) scale(0.85)' : 'translateY(0) scale(1)', opacity: isChatMaximized ? 0 : 1, pointerEvents: isChatMaximized ? 'none' : 'auto', transition: 'transform 0.35s ease-in-out, opacity 0.3s ease' }}>
        {/* 상태 플로팅 바 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 14px', backgroundColor: 'rgba(100,100,100,0.60)', borderRadius: '8px', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.25)', boxShadow: '0 4px 20px rgba(0,0,0,0.25)', marginBottom: '16px', zIndex: 1 }}>
          {/* 상태 점: 설정 완료(초록) / 미설정(회색) */}
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: hasCredentials ? '#34c759' : 'rgba(255,255,255,0.30)', boxShadow: hasCredentials ? '0 0 5px rgba(52,199,89,0.95)' : 'none', flexShrink: 0 }} />
          <span style={{ fontSize: '13px', fontWeight: '400', color: 'rgba(255,255,255,0.92)', whiteSpace: 'nowrap', letterSpacing: '-0.2px' }}>
            {isChatOpen ? '명령 대기 중'
              : isSetupSuccess ? '설정 완료!'
              : hasCredentials ? '에이전트 대기 중'
              : '설정 코드 입력 필요'}
          </span>
        </div>

        {/* 에이전트 뒤 반투명 배경 바 */}
        <div style={{ position: 'absolute', bottom: '14px', left: '-10px', right: '-10px', height: '105px', backgroundColor: 'rgba(130,130,130,0.42)', borderRadius: '16px', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.22)', boxShadow: '0 4px 18px rgba(0,0,0,0.18)', zIndex: 0 }} />

        {/* 에이전트 이미지 */}
        <div
          onClick={() => handleAgentClick()}
          style={{ width: '140px', height: '140px', position: 'relative', zIndex: 1, cursor: isChatOpen ? 'default' : 'pointer', transition: isTransitioning ? 'none' : 'transform 0.25s ease', marginBottom: '25px', transform: (isAgentHovered && !isTransitioning) ? 'scale(1.15)' : 'scale(1)', pointerEvents: isTransitioning ? 'none' : 'auto' }}
          onMouseEnter={() => !isChatOpen && !isTransitioning && setIsAgentHovered(true)}
          onMouseLeave={() => setIsAgentHovered(false)}
        >
          <img src={techamAgentImg} alt="TECHAM Agent" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 10px 15px rgba(0,0,0,0.5))', transition: 'filter 0.2s ease' }} />
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
