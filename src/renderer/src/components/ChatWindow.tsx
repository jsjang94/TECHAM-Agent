// src/components/ChatWindow.tsx
import React, { useState, useRef, useEffect } from 'react'
import { Settings, BookOpen, Send, Circle, X, Minus, Maximize2, Minimize2, Eraser, RotateCcw, RefreshCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import '../assets/ChatWindow.css'

// 마크다운 링크는 앱 창을 이동시키지 않고 기본 브라우저로 열기
const openExternalLink = (href?: string) => {
  if (!href) return
  const w = window as any
  if (w.api?.openExternal) w.api.openExternal(href)
  else w.electron?.ipcRenderer?.send('open-external', href)
}

// AI가 툴 결과 포맷(`[일감]:`, `[링크]: url`)을 그대로 흘리면 마크다운이 이를
// 링크 참조 정의로 오인해 해당 줄을 통째로 삭제한다. 라벨 대괄호를 escape 해서
// 링크·본문이 소리 없이 사라지지 않도록 방어한다. (인라인 링크 `[텍스트](url)`는 `]:`가
// 아니라 `](` 이므로 영향 없음)
const normalizeBotMarkdown = (text: string): string =>
  text.replace(/^( {0,3})\[([^\]\n]+)\]:/gm, '$1\\[$2\\]:')

// 봇 답변 전용 마크다운 렌더러 (링크·목록·표·코드블록 등 지원)
const MarkdownMessage = ({ text }: { text: string }) => (
  <div className="md-content">
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => { e.preventDefault(); openExternalLink(href) }}
          >
            {children}
          </a>
        )
      }}
    >
      {normalizeBotMarkdown(text)}
    </ReactMarkdown>
  </div>
)

interface ChatWindowProps {
  toggleChat: (open: boolean) => void
  config: any
  initialConfig: any
  isConfiguring: boolean
  setIsConfiguring: (val: boolean) => void
  saveConfigAndConnect: (config: any) => Promise<void>
  messages: { text: string; isBot: boolean; isSystem?: boolean }[]
  isChatLoading: boolean
  isSubmittingNote: boolean
  inputText: string
  setInputText: (val: string) => void
  handleSend: () => Promise<void>
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  isErrorNoteOpen: boolean
  setIsErrorNoteOpen: (val: boolean) => void
  errorNoteForm: any
  setErrorNoteForm: (val: any) => void
  submitErrorNote: () => Promise<void>
  hasSavedSpaces: boolean
  showAlert: (emoji: string, message: string) => void
  onTitlebarMouseDown: (e: React.MouseEvent) => void
  isChatMaximized: boolean
  onMinimize: () => void
  onMaximize: () => void
  isNetworkReconnecting?: boolean
  integrationsHealth: { gemini: boolean | null; atlassian: boolean | null; zendesk: boolean | null }
  isCheckingHealth: boolean
  onRetryConnections: () => void
}

export default function ChatWindow({
  toggleChat, config, initialConfig, isConfiguring, setIsConfiguring, saveConfigAndConnect,
  messages, isChatLoading, isSubmittingNote, inputText, setInputText, handleSend, handleKeyDown,
  isErrorNoteOpen, setIsErrorNoteOpen, errorNoteForm, setErrorNoteForm, submitErrorNote,
  hasSavedSpaces, showAlert,
  onTitlebarMouseDown, isChatMaximized, onMinimize, onMaximize,
  isNetworkReconnecting = false, integrationsHealth, isCheckingHealth, onRetryConnections
}: ChatWindowProps) {

  const [form, setForm] = useState(config)

  // 설정 화면이 "열리는 순간"마다 현재 config를 form에 다시 로드한다 (렌더 단계에서 이전 값과 비교).
  // → 저장하지 않고 닫았던 편집 잔재를 버리고(허점1), 저장 시 정리된(trim·빈행 제거) 값을 반영(허점2).
  const [wasConfiguring, setWasConfiguring] = useState(isConfiguring)
  if (isConfiguring !== wasConfiguring) {
    setWasConfiguring(isConfiguring)
    if (isConfiguring) setForm(config)
  }

  const statusColor = (status: boolean | null | 'warn') =>
    status === 'warn' ? '#ff9f0a' : status === null ? 'rgba(255,255,255,0.3)' : status ? '#34c759' : '#ff3b30'

  const StatusDot = ({ status }: { status: boolean | null | 'warn' }) => (
    <Circle
      size={8}
      color={statusColor(status)}
      fill={statusColor(status)}
      style={{ flexShrink: 0, animation: (status === 'warn' || status === null) ? 'statusPulse 1.4s ease-in-out infinite' : 'none' }}
    />
  )

  const inputStyle = { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'rgba(0,0,0,0.2)', color: '#fff', marginBottom: '10px', outline: 'none' }

  // 설정/위키 화면 하단 버튼 (닫기: 밝은 회색 / 저장·등록: 하이브 블루)
  const footerBtnBase: React.CSSProperties = { width: '20%', padding: '12px', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: 'pointer' }
  const footerCloseBtnStyle: React.CSSProperties = { ...footerBtnBase, backgroundColor: '#d1d1d6', color: '#1c1c1e' }
  const footerSubmitBtnStyle: React.CSSProperties = { ...footerBtnBase, backgroundColor: 'var(--hive-blue)', color: '#fff' }

  // 헤더 아이콘 클릭 시 1회성 마이크로 애니메이션 재생 트리거 — key를 바꿔 강제 리마운트해 CSS 애니메이션을 처음부터 다시 실행
  const [wikiIconPlay, setWikiIconPlay] = useState(0)
  const [settingsIconPlay, setSettingsIconPlay] = useState(0)

  // 스페이스 설정 저장 전에는 위키 화면 이동 차단
  const openWiki = () => {
    if (!hasSavedSpaces) { showAlert('⚙️', '스페이스 설정 후 이용 가능합니다.'); return }
    setWikiIconPlay(k => k + 1)
    setIsErrorNoteOpen(true)
    setIsConfiguring(false)
  }

  // 위키 등록 폼 초기화: 오답노트를 지우개로 지우는 흐름 — 1차 클릭은 3초짜리 확인 대기(arm),
  // 그 안에 재클릭해야 실제로 지운다. 답변란처럼 긴 글을 실수로 날리는 사고를 막기 위함
  // (이 앱엔 확인 모달이 없어 새로 만들기보다 버튼 자체 상태로 처리).
  const [isWikiResetArmed, setIsWikiResetArmed] = useState(false)
  const [isWikiWiping, setIsWikiWiping] = useState(false)
  const wikiResetArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => { if (wikiResetArmTimerRef.current) clearTimeout(wikiResetArmTimerRef.current) }
  }, [])

  const isWikiFormEmpty =
    !errorNoteForm.author && !errorNoteForm.question && !errorNoteForm.answer && !errorNoteForm.link

  const handleWikiResetClick = (): void => {
    if (!isWikiResetArmed) {
      setIsWikiResetArmed(true)
      if (wikiResetArmTimerRef.current) clearTimeout(wikiResetArmTimerRef.current)
      wikiResetArmTimerRef.current = setTimeout(() => setIsWikiResetArmed(false), 3000)
      return
    }

    if (wikiResetArmTimerRef.current) clearTimeout(wikiResetArmTimerRef.current)
    setIsWikiResetArmed(false)

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) {
      setErrorNoteForm({ author: '', question: '', answer: '', link: '' })
      return
    }
    setIsWikiWiping(true)
    setTimeout(() => {
      setErrorNoteForm({ author: '', question: '', answer: '', link: '' })
      setIsWikiWiping(false)
    }, 260)
  }

  // 스페이스 설정 되돌리기: 최초 스냅샷(initialConfig)으로 form 복귀.
  // 위키 지우기 버튼과 같은 2단계 arm-confirm 흐름을 재사용.
  // 이미 원본과 동일하면(되돌릴 게 없음) 비활성 — 단, "직전 저장값과 같은 상태"는 원본과 다를 수 있어 활성 유지.
  const [isConfigRevertArmed, setIsConfigRevertArmed] = useState(false)
  const [isConfigReverting, setIsConfigReverting] = useState(false)
  const configRevertArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => { if (configRevertArmTimerRef.current) clearTimeout(configRevertArmTimerRef.current) }
  }, [])

  const isFormAtInitial =
    JSON.stringify(form.jiraSpaces) === JSON.stringify(initialConfig.jiraSpaces) &&
    JSON.stringify(form.confSpaces) === JSON.stringify(initialConfig.confSpaces)

  const handleConfigRevertClick = (): void => {
    if (!isConfigRevertArmed) {
      setIsConfigRevertArmed(true)
      if (configRevertArmTimerRef.current) clearTimeout(configRevertArmTimerRef.current)
      configRevertArmTimerRef.current = setTimeout(() => setIsConfigRevertArmed(false), 3000)
      return
    }

    if (configRevertArmTimerRef.current) clearTimeout(configRevertArmTimerRef.current)
    setIsConfigRevertArmed(false)

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) {
      setForm({ ...initialConfig })
      return
    }
    setIsConfigReverting(true)
    setTimeout(() => {
      setForm({ ...initialConfig })
      setIsConfigReverting(false)
    }, 260)
  }

  const handleArrayChange = (type: 'confSpaces' | 'jiraSpaces', idx: number, val: string) => {
    const newArr = [...form[type]]; newArr[idx] = val; setForm({ ...form, [type]: newArr });
  }
  const addArrayItem = (type: 'confSpaces' | 'jiraSpaces') => { setForm({ ...form, [type]: [...form[type], ''] }); }
  const removeArrayItem = (type: 'confSpaces' | 'jiraSpaces', idx: number) => {
    const newArr = form[type].filter((_: string, i: number) => i !== idx); setForm({ ...form, [type]: newArr });
  }

  return (
    <div className="chat-container" style={{ borderRadius: isChatMaximized ? 0 : undefined, transition: 'border-radius 0.25s ease' }}>
      
      {/* 🌟 타이틀바 (절대 고정) */}
      <div className="mac-titlebar" onMouseDown={onTitlebarMouseDown}>
        <div className="mac-buttons">
          <div className="mac-btn mac-close" onClick={() => toggleChat(false)} title="닫기">
            <X className="mac-icon" size={8} strokeWidth={1.5} absoluteStrokeWidth />
          </div>
          <div className="mac-btn mac-min" onClick={onMinimize} title="최소화">
            <Minus className="mac-icon" size={9} strokeWidth={1.5} absoluteStrokeWidth />
          </div>
          <div className="mac-btn mac-full" onClick={onMaximize} title={isChatMaximized ? '기본 크기로' : '확대'}>
            {isChatMaximized ? (
              <Minimize2 className="mac-icon" size={7} strokeWidth={1.5} absoluteStrokeWidth />
            ) : (
              <Maximize2 className="mac-icon" size={7} strokeWidth={1.5} absoluteStrokeWidth />
            )}
          </div>
        </div>
      </div>

      {/* 🌟 상단 헤더: 타이틀/상태(세로 배치) + 오답노트/설정 아이콘 */}
      <div className="app-header">
        <div className="app-header-main">
          <span className="app-header-title">TECHAM AGENT</span>
          <div className="app-header-status">
            <span className="status-item">
              <StatusDot status={isNetworkReconnecting ? 'warn' : integrationsHealth.gemini} />
              Gemini API {isNetworkReconnecting ? '재연결 중...' : integrationsHealth.gemini === null ? '확인 중...' : integrationsHealth.gemini ? '정상' : '연결 실패'}
            </span>
            <span className="status-item">
              <StatusDot status={integrationsHealth.atlassian} />
              Atlassian {integrationsHealth.atlassian === null ? '확인 중...' : integrationsHealth.atlassian ? '연결됨' : '연결 실패'}
            </span>
            <span className="status-item">
              <StatusDot status={integrationsHealth.zendesk} />
              Zendesk {integrationsHealth.zendesk === null ? '확인 중...' : integrationsHealth.zendesk ? '연결됨' : '연결 실패'}
            </span>
          </div>
        </div>
        <div className="app-header-actions">
          <button
            className={`app-header-icon-btn${isCheckingHealth ? ' is-spinning' : ''}`}
            onClick={onRetryConnections}
            disabled={isCheckingHealth}
            title="연결 상태 새로고침"
          ><RefreshCw size={16} /></button>
          <button
            className="app-header-icon-btn"
            onClick={openWiki}
            title="팀 위키"
          ><span key={wikiIconPlay} className="wiki-icon-anim"><BookOpen size={16} /></span></button>
          <button
            className="app-header-icon-btn"
            onClick={() => { setSettingsIconPlay(k => k + 1); setIsConfiguring(true); setIsErrorNoteOpen(false); }}
            title="Atlassian 연동 설정"
          ><span key={settingsIconPlay} className="settings-icon-anim"><Settings size={16} /></span></button>
        </div>
      </div>

      {/* 메인 콘텐츠 */}
      <div className="main-content">

          {isConfiguring ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px', minHeight: 0, overflow: 'hidden' }}>
              <h3 style={{ color: '#fff', marginBottom: '8px', flexShrink: 0 }}>스페이스 연동 설정</h3>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '24px', flexShrink: 0 }}>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', margin: 0 }}>
                  검색 대상 스페이스를 설정하세요.
                </p>
                {hasSavedSpaces && (
                  <button
                    className={`inline-reset-btn${isConfigRevertArmed ? ' is-armed' : ''}`}
                    onClick={handleConfigRevertClick}
                    disabled={isFormAtInitial}
                    title={isConfigRevertArmed ? '다시 누르면 처음 설정으로 되돌립니다' : '처음 저장했던 설정으로 되돌립니다'}
                  >
                    <RotateCcw size={11} strokeWidth={2} />
                    {isConfigRevertArmed ? '정말요? 다시 누르면 되돌려요' : '처음 설정으로 되돌리기'}
                  </button>
                )}
              </div>

              <div className={`config-fields${isConfigReverting ? ' is-reverting' : ''}`} style={{ flex: 1, overflowY: 'auto', paddingRight: '10px' }}>
                <p style={{ color: '#fff', fontSize: '12px', marginBottom: '4px' }}>1. Jira 타겟 스페이스</p>
                {form.jiraSpaces.map((space: string, idx: number) => ( 
                  <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <input value={space} onChange={e => handleArrayChange('jiraSpaces', idx, e.target.value)} style={{ ...inputStyle, marginBottom: 0 }} />
                    {form.jiraSpaces.length > 1 && <button onClick={() => removeArrayItem('jiraSpaces', idx)} style={{ background:'none', border:'none', color:'#fff', cursor:'pointer' }}>✕</button>}
                  </div> 
                ))} 
                <button onClick={() => addArrayItem('jiraSpaces')} style={{ background:'none', border:'none', color:'var(--hive-blue)', cursor:'pointer', fontSize: '12px' }}>+ 추가</button>

                <p style={{ color: '#fff', fontSize: '12px', marginBottom: '4px', marginTop: '16px' }}>2. Confluence 타겟 스페이스</p>
                {form.confSpaces.map((space: string, idx: number) => ( 
                  <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <input value={space} onChange={e => handleArrayChange('confSpaces', idx, e.target.value)} style={{ ...inputStyle, marginBottom: 0 }} />
                    {form.confSpaces.length > 1 && <button onClick={() => removeArrayItem('confSpaces', idx)} style={{ background:'none', border:'none', color:'#fff', cursor:'pointer' }}>✕</button>}
                  </div> 
                ))} 
                <button onClick={() => addArrayItem('confSpaces')} style={{ background:'none', border:'none', color:'var(--hive-blue)', cursor:'pointer', fontSize: '12px' }}>+ 추가</button>
              </div>
              
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '20px', flexShrink: 0 }}>
                {/* 첫 설정(저장 이력 없음) 시에는 닫기 없이 저장을 완료해야 함 */}
                {hasSavedSpaces && (
                  <button onClick={() => setIsConfiguring(false)} style={footerCloseBtnStyle}>닫기</button>
                )}
                <button onClick={() => saveConfigAndConnect(form)} style={footerSubmitBtnStyle}>
                  설정 저장
                </button>
              </div>
            </div>
          ) : isErrorNoteOpen ? (
            /* 💡 오답노트 화면 (안쪽 옵션들만 스크롤) */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px', minHeight: 0, overflow: 'hidden' }}>
              <h3 style={{ color: '#fff', marginBottom: '8px', flexShrink: 0 }}>📝 팀 위키 문서 등록</h3>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '24px', flexShrink: 0 }}>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', margin: 0 }}>팀원들에게 공유할 내용을 기록합니다.</p>
                <button
                  className={`inline-reset-btn${isWikiResetArmed ? ' is-armed' : ''}`}
                  onClick={handleWikiResetClick}
                  disabled={isWikiFormEmpty}
                  title={isWikiResetArmed ? '다시 누르면 모든 내용이 지워집니다' : '입력한 내용을 모두 지웁니다'}
                >
                  <Eraser size={11} strokeWidth={2} />
                  {isWikiResetArmed ? '정말요? 다시 누르면 지워요' : '모두 지우기'}
                </button>
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingRight: '10px' }}>
                <p style={{ color: '#fff', fontSize: '12px', marginBottom: '4px' }}>1. 등록자</p>
                <div className={`wiki-field${isWikiWiping ? ' is-wiping' : ''}`} style={{ display: 'flex', gap: '8px', marginBottom: '10px', transitionDelay: isWikiWiping ? '0ms' : undefined }}>
                  <input value={errorNoteForm.author} onChange={e => setErrorNoteForm({...errorNoteForm, author: e.target.value})} style={{ ...inputStyle, marginBottom: 0 }} />
                </div>

                <p style={{ color: '#fff', fontSize: '12px', marginBottom: '4px' }}>2. 질문(키워드)</p>
                <div className={`wiki-field${isWikiWiping ? ' is-wiping' : ''}`} style={{ display: 'flex', gap: '8px', marginBottom: '10px', transitionDelay: isWikiWiping ? '60ms' : undefined }}>
                  <textarea value={errorNoteForm.question} onChange={e => setErrorNoteForm({...errorNoteForm, question: e.target.value})} style={{ ...inputStyle, marginBottom: 0, height: '40px', resize: 'vertical' }} />
                </div>

                <p style={{ color: '#fff', fontSize: '12px', marginBottom: '4px' }}>3. 올바른 답변</p>
                <div className={`wiki-field${isWikiWiping ? ' is-wiping' : ''}`} style={{ display: 'flex', gap: '8px', marginBottom: '10px', flex: 1, transitionDelay: isWikiWiping ? '120ms' : undefined }}>
                  <textarea value={errorNoteForm.answer} onChange={e => setErrorNoteForm({...errorNoteForm, answer: e.target.value})} style={{ ...inputStyle, marginBottom: 0, flex: 1, height: '40px', resize: 'vertical' }} />
                </div>

                <p style={{ color: '#fff', fontSize: '12px', marginBottom: '4px' }}>4. 참고 링크 (선택)</p>
                <div className={`wiki-field${isWikiWiping ? ' is-wiping' : ''}`} style={{ display: 'flex', gap: '8px', marginBottom: '10px', transitionDelay: isWikiWiping ? '180ms' : undefined }}>
                  <input value={errorNoteForm.link} onChange={e => setErrorNoteForm({...errorNoteForm, link: e.target.value})} style={{ ...inputStyle, marginBottom: 0 }} />
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '20px', flexShrink: 0 }}>
                <button onClick={() => setIsErrorNoteOpen(false)} style={footerCloseBtnStyle}>닫기</button>
                <button onClick={submitErrorNote} disabled={isSubmittingNote} style={footerSubmitBtnStyle}>
                  {isSubmittingNote ? '위키에 등록 중...' : '등록하기'}
                </button>
              </div>
            </div>

          ) : (
            /* 🌟 채팅 메시지 화면 */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', position: 'relative' }}>
              {isNetworkReconnecting && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(28,28,30,0.88)', backdropFilter: 'blur(4px)' }}>
                  <div className="reconnect-spinner" />
                  <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '13px', marginTop: '14px' }}>서버 재연결 중...</p>
                </div>
              )}
              
              {/* 🌟 핵심 해결책: App.tsx가 스크롤을 찾을 수 있도록 id="chat-scroll-area" 추가! */}
              <div id="chat-scroll-area" style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {messages.map((msg, idx) => (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.isBot ? 'flex-start' : 'flex-end' }}>
                    <div style={{ maxWidth: '80%', padding: '12px 16px', borderRadius: '12px', fontSize: '14px', lineHeight: '1.5', backgroundColor: msg.isSystem ? 'transparent' : (msg.isBot ? 'rgba(255,255,255,0.1)' : 'var(--hive-blue)'), color: msg.isSystem ? 'rgba(var(--hive-blue-rgb), 0.85)' : '#fff', border: msg.isSystem ? '1px dashed rgba(var(--hive-blue-rgb), 0.4)' : 'none', borderBottomLeftRadius: msg.isBot ? '4px' : '12px', borderBottomRightRadius: msg.isBot ? '12px' : '4px', whiteSpace: (msg.isBot && !msg.isSystem) ? 'normal' : 'pre-wrap' }}>
                      {(msg.isBot && !msg.isSystem) ? <MarkdownMessage text={msg.text} /> : msg.text}
                    </div>
                    {msg.isBot && !msg.isSystem && (
                      <button
                        onClick={() => {
                          if (!hasSavedSpaces) { showAlert('⚙️', '스페이스 설정 후 이용 가능합니다.'); return }
                          const lastUserMsg = messages.slice(0, idx).reverse().find(m => !m.isBot)?.text || '';
                          setErrorNoteForm({ ...errorNoteForm, question: lastUserMsg });
                          setIsErrorNoteOpen(true);
                          setIsConfiguring(false);
                        }}
                        style={{ marginTop: '4px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        📝 팀 위키 작성
                      </button>
                    )}
                  </div>
                ))}
              </div>
              
              {/* 하단 입력창 (flexShrink: 0을 걸어 압착 방지) */}
              <div style={{ padding: '16px 24px 24px 24px', backgroundColor: '#1c1c1e', borderTop: '1px solid #3c3c3e', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', padding: '4px 4px 4px 16px' }}>
                  <input 
                    type="text" 
                    placeholder="문제를 해결합시다!" 
                    value={inputText} 
                    onChange={(e) => setInputText(e.target.value)} 
                    onKeyDown={handleKeyDown} 
                    disabled={isChatLoading || isNetworkReconnecting}
                    style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: '14px', outline: 'none', height: '36px' }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={isChatLoading || isNetworkReconnecting || !inputText.trim()}
                    style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: inputText.trim() ? 'var(--hive-blue)' : 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', color: '#fff', cursor: inputText.trim() ? 'pointer' : 'default', marginLeft: '8px' }}>
                    <Send size={16} />
                  </button>
                </div>
              </div>

            </div>
          )}
        </div>
    </div>
  )
}