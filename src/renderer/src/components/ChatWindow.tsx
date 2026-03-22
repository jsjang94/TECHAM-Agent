// src/components/ChatWindow.tsx
import React, { useState } from 'react'
import '../assets/ChatWindow.css'

interface ChatWindowProps {
  isChatOpen: boolean
  toggleChat: (open: boolean) => void
  config: any
  isConfiguring: boolean
  setIsConfiguring: (val: boolean) => void
  saveConfigAndConnect: (config: any) => Promise<void>
  messages: { text: string; isBot: boolean; isSystem?: boolean }[]
  isLoading: boolean
  inputText: string
  setInputText: (val: string) => void
  handleSend: () => Promise<void>
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  isErrorNoteOpen: boolean
  setIsErrorNoteOpen: (val: boolean) => void
  errorNoteForm: any
  setErrorNoteForm: (val: any) => void
  submitErrorNote: () => Promise<void>
}

export default function ChatWindow({
  isChatOpen, toggleChat, config, isConfiguring, setIsConfiguring, saveConfigAndConnect,
  messages, isLoading, inputText, setInputText, handleSend, handleKeyDown,
  isErrorNoteOpen, setIsErrorNoteOpen, errorNoteForm, setErrorNoteForm, submitErrorNote
}: ChatWindowProps) {

  const [form, setForm] = useState(config)
  const [activeTab, setActiveTab] = useState('gemini')
  const [atlassianSubTab, setAtlassianSubTab] = useState('common')

  const inputStyle = { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'rgba(0,0,0,0.2)', color: '#fff', marginBottom: '10px', outline: 'none' }

  const handleArrayChange = (type: 'confSpaces' | 'jiraSpaces', idx: number, val: string) => {
    const newArr = [...form[type]]; newArr[idx] = val; setForm({ ...form, [type]: newArr });
  }
  const addArrayItem = (type: 'confSpaces' | 'jiraSpaces') => { setForm({ ...form, [type]: [...form[type], ''] }); }
  const removeArrayItem = (type: 'confSpaces' | 'jiraSpaces', idx: number) => {
    const newArr = form[type].filter((_, i) => i !== idx); setForm({ ...form, [type]: newArr });
  }

  return (
    <div className="chat-container">
      
      {/* 🌟 타이틀바 (절대 고정) */}
      <div className="mac-titlebar">
        <div className="mac-buttons">
          <div className="mac-btn mac-close" onClick={() => toggleChat(false)} title="위젯으로 돌아가기"></div>
          <div className="mac-btn mac-min"></div>
          <div className="mac-btn mac-full" onClick={() => {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen();
            else if (document.exitFullscreen) document.exitFullscreen();
          }} title="전체화면"></div>
        </div>
      </div>

      <div className="chat-body">
        {/* 사이드바 (고정) */}
        <div className="agent-panel">
          <div>
            <div style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: '12px', padding: '12px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ width: '32px', height: '32px', backgroundColor: '#4a4a4a', borderRadius: '50%', marginRight: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '16px' }}>🤖</div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff' }}>TECHAM Agent</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>통합 시스템 검색</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#ffd700' }}>
                <span style={{ width: '6px', height: '6px', backgroundColor: isLoading ? '#ff9500' : '#34c759', borderRadius: '50%' }}></span>
                {isLoading ? '연산/검색 중...' : '대기 중'}
              </div>
            </div>
            
            <button 
              onClick={() => { setIsErrorNoteOpen(!isErrorNoteOpen); setIsConfiguring(false); }} 
              style={{ width: '100%', textAlign: 'left', background: isErrorNoteOpen ? 'rgba(0,243,255,0.1)' : 'transparent', border: 'none', color: isErrorNoteOpen ? '#00f3ff' : 'rgba(255,255,255,0.7)', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              📝 오답노트
            </button>
          </div>
          <button onClick={() => { setIsConfiguring(true); setIsErrorNoteOpen(false); }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', textAlign: 'left', fontSize: '12px', padding: '8px' }}>⚙️ 시스템 연동 설정</button>
        </div>

        {/* 우측 메인 콘텐츠 */}
        <div className="main-content">

          {isConfiguring ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px', minHeight: 0, overflow: 'hidden' }}>
              <h3 style={{ color: '#fff', marginBottom: '8px', flexShrink: 0 }}>시스템 연동 설정</h3>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', marginBottom: '24px', flexShrink: 0 }}>
                모든 통신은 보안 프록시를 통해 안전하게 처리됩니다. 사내 이메일 인증이 필요합니다.
              </p>
              
              <div style={{ flex: 1, overflowY: 'auto', paddingRight: '10px' }}>
                <p style={{ color: '#00f3ff', fontSize: '12px', marginBottom: '4px' }}>1. 사용자 인증 (사내 이메일)</p>
                <input placeholder="홍길동@com2us.com" value={form.userEmail} onChange={e => setForm({...form, userEmail: e.target.value})} style={inputStyle} />

                <p style={{ color: '#00f3ff', fontSize: '12px', marginBottom: '4px', marginTop: '16px' }}>2. Jira 타겟 스페이스</p>
                {form.jiraSpaces.map((space: string, idx: number) => ( 
                  <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <input value={space} onChange={e => handleArrayChange('jiraSpaces', idx, e.target.value)} style={{ ...inputStyle, marginBottom: 0 }} />
                    {form.jiraSpaces.length > 1 && <button onClick={() => removeArrayItem('jiraSpaces', idx)} style={{ background:'none', border:'none', color:'#fff', cursor:'pointer' }}>✕</button>}
                  </div> 
                ))} 
                <button onClick={() => addArrayItem('jiraSpaces')} style={{ background:'none', border:'none', color:'#00f3ff', cursor:'pointer', fontSize: '12px' }}>+ 추가</button>

                <p style={{ color: '#00f3ff', fontSize: '12px', marginBottom: '4px', marginTop: '16px' }}>3. Confluence 타겟 스페이스</p>
                {form.confSpaces.map((space: string, idx: number) => ( 
                  <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <input value={space} onChange={e => handleArrayChange('confSpaces', idx, e.target.value)} style={{ ...inputStyle, marginBottom: 0 }} />
                    {form.confSpaces.length > 1 && <button onClick={() => removeArrayItem('confSpaces', idx)} style={{ background:'none', border:'none', color:'#fff', cursor:'pointer' }}>✕</button>}
                  </div> 
                ))} 
                <button onClick={() => addArrayItem('confSpaces')} style={{ background:'none', border:'none', color:'#00f3ff', cursor:'pointer', fontSize: '12px' }}>+ 추가</button>
              </div>
              
              <button onClick={() => saveConfigAndConnect(form)} disabled={isLoading} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#00f3ff', color: '#000', fontWeight: 'bold', cursor: 'pointer', marginTop: '20px', flexShrink: 0 }}>
                {isLoading ? '설정 및 가동 중...' : '저장 및 가동'}
              </button>
            </div>
          ) : isErrorNoteOpen ? (
            /* 💡 오답노트 화면 (안쪽 옵션들만 스크롤) */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px', minHeight: 0, overflow: 'hidden' }}>
              <h3 style={{ color: '#fff', marginBottom: '8px', flexShrink: 0 }}>📝 오답노트 등록</h3>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', marginBottom: '24px', flexShrink: 0 }}>AI가 헛소리한 내용을 교정하여 기록합니다.</p>
              
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingRight: '10px' }}>
                <p style={{ color: '#00f3ff', fontSize: '12px', marginBottom: '4px' }}>1. 등록자</p>
                <input value={errorNoteForm.author} onChange={e => setErrorNoteForm({...errorNoteForm, author: e.target.value})} style={inputStyle} />
                
                <p style={{ color: '#00f3ff', fontSize: '12px', marginBottom: '4px' }}>2. 질문(키워드)</p>
                <textarea value={errorNoteForm.question} onChange={e => setErrorNoteForm({...errorNoteForm, question: e.target.value})} style={{ ...inputStyle, height: '60px', resize: 'vertical' }} />
                
                <p style={{ color: '#00f3ff', fontSize: '12px', marginBottom: '4px' }}>3. 올바른 답변</p>
                <textarea value={errorNoteForm.answer} onChange={e => setErrorNoteForm({...errorNoteForm, answer: e.target.value})} style={{ ...inputStyle, flex: 1, minHeight: '80px', resize: 'vertical' }} />
                
                <p style={{ color: '#00f3ff', fontSize: '12px', marginBottom: '4px' }}>4. 참고 링크 (선택)</p>
                <input value={errorNoteForm.link} onChange={e => setErrorNoteForm({...errorNoteForm, link: e.target.value})} style={inputStyle} />
              </div>
              
              <button onClick={submitErrorNote} disabled={isLoading} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#00f3ff', color: '#000', fontWeight: 'bold', cursor: 'pointer', marginTop: '20px', flexShrink: 0 }}>
                {isLoading ? 'DB에 등록 중...' : '규칙 등록하기'}
              </button>
            </div>

          ) : (
            /* 🌟 채팅 메시지 화면 */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              
              {/* 🌟 핵심 해결책: App.tsx가 스크롤을 찾을 수 있도록 id="chat-scroll-area" 추가! */}
              <div id="chat-scroll-area" style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {messages.map((msg, idx) => (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.isBot ? 'flex-start' : 'flex-end' }}>
                    <div style={{ maxWidth: '80%', padding: '12px 16px', borderRadius: '12px', fontSize: '14px', lineHeight: '1.5', backgroundColor: msg.isSystem ? 'transparent' : (msg.isBot ? 'rgba(255,255,255,0.1)' : '#00f3ff'), color: msg.isSystem ? 'rgba(0, 243, 255, 0.8)' : (msg.isBot ? '#fff' : '#000'), border: msg.isSystem ? '1px dashed rgba(0, 243, 255, 0.4)' : 'none', borderBottomLeftRadius: msg.isBot ? '4px' : '12px', borderBottomRightRadius: msg.isBot ? '12px' : '4px', whiteSpace: 'pre-wrap' }}>
                      {msg.text}
                    </div>
                    {msg.isBot && !msg.isSystem && (
                      <button 
                        onClick={() => {
                          const lastUserMsg = messages.slice(0, idx).reverse().find(m => !m.isBot)?.text || '';
                          setErrorNoteForm({ ...errorNoteForm, question: lastUserMsg });
                          setIsErrorNoteOpen(true);
                          setIsConfiguring(false);
                        }}
                        style={{ marginTop: '4px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        📝 오답노트 작성
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
                    placeholder="시스템에 질문하세요..." 
                    value={inputText} 
                    onChange={(e) => setInputText(e.target.value)} 
                    onKeyDown={handleKeyDown} 
                    disabled={isLoading} 
                    style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: '14px', outline: 'none', height: '36px' }} 
                  />
                  <button 
                    onClick={handleSend} 
                    disabled={isLoading || !inputText.trim()} 
                    style={{ width: '32px', height: '32px', backgroundColor: inputText.trim() ? '#00f3ff' : 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', color: inputText.trim() ? '#000' : '#fff', cursor: inputText.trim() ? 'pointer' : 'default', marginLeft: '8px' }}>
                    ↑
                  </button>
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  )
}