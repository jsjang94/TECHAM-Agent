import React, { useState } from 'react'

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
  messagesEndRef: React.RefObject<HTMLDivElement> | any
  
  // 🌟 오답노트 프롭스
  isErrorNoteOpen: boolean
  setIsErrorNoteOpen: (val: boolean) => void
  errorNoteForm: any
  setErrorNoteForm: (val: any) => void
  submitErrorNote: () => Promise<void>
}

export default function ChatWindow({
  isChatOpen, toggleChat, config, isConfiguring, setIsConfiguring, saveConfigAndConnect,
  messages, isLoading, inputText, setInputText, handleSend, handleKeyDown, messagesEndRef,
  isErrorNoteOpen, setIsErrorNoteOpen, errorNoteForm, setErrorNoteForm, submitErrorNote
}: ChatWindowProps) {

  const [form, setForm] = useState(config)
  const [activeTab, setActiveTab] = useState('gemini')
  const [atlassianSubTab, setAtlassianSubTab] = useState('common')

  const inputStyle = { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'rgba(0,0,0,0.2)', color: '#fff', marginBottom: '10px', outline: 'none' }

  const handleArrayChange = (type: 'confSpaces' | 'jiraSpaces', idx: number, val: string) => {
    const newArr = [...form[type]];
    newArr[idx] = val;
    setForm({ ...form, [type]: newArr });
  }
  const addArrayItem = (type: 'confSpaces' | 'jiraSpaces') => {
    setForm({ ...form, [type]: [...form[type], ''] });
  }
  const removeArrayItem = (type: 'confSpaces' | 'jiraSpaces', idx: number) => {
    const newArr = form[type].filter((_, i) => i !== idx);
    setForm({ ...form, [type]: newArr });
  }

  return (
    <div style={{ width: '700px', height: '450px', backgroundColor: 'rgba(30, 30, 32, 0.75)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', marginBottom: '20px', display: 'flex', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', opacity: isChatOpen ? 1 : 0, transform: isChatOpen ? 'translateY(0) scale(1)' : 'translateY(15px) scale(0.98)', backdropFilter: isChatOpen ? 'blur(40px) saturate(150%)' : 'none', transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
      
      {/* 🌟 사이드바 */}
      <div style={{ width: '220px', borderRight: '1px solid rgba(255,255,255,0.08)', padding: '16px', backgroundColor: 'rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: '12px', padding: '12px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ width: '32px', height: '32px', backgroundColor: '#4a4a4a', borderRadius: '50%', marginRight: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '16px' }}>🤖</div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff' }}>Hive Agent</div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>통합 시스템 검색</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#ffd700' }}>
              <span style={{ width: '6px', height: '6px', backgroundColor: isLoading ? '#ff9500' : '#34c759', borderRadius: '50%' }}></span>
              {isLoading ? '연산/검색 중...' : '대기 중'}
            </div>
          </div>
          
          {/* 오답노트 관리 탭 버튼 */}
          <button 
            onClick={() => { setIsErrorNoteOpen(!isErrorNoteOpen); setIsConfiguring(false); }} 
            style={{ width: '100%', textAlign: 'left', background: isErrorNoteOpen ? 'rgba(0,243,255,0.1)' : 'transparent', border: 'none', color: isErrorNoteOpen ? '#00f3ff' : 'rgba(255,255,255,0.7)', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            📝 사내 오답노트 (규칙)
          </button>
        </div>
        <button onClick={() => { setIsConfiguring(true); setIsErrorNoteOpen(false); }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', textAlign: 'left', fontSize: '12px', padding: '8px' }}>⚙️ 시스템 연동 설정</button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <button onClick={() => toggleChat(false)} style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '18px', padding: '4px', zIndex: 10 }}>✕</button>

        {isConfiguring ? (
          /* 시스템 설정 화면 */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px', overflowY: 'auto' }}>
            <h3 style={{ color: '#fff', marginBottom: '16px' }}>시스템 연동 설정</h3>
            
            <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px' }}>
              <button onClick={() => setActiveTab('gemini')} style={{ background: activeTab === 'gemini' ? '#00f3ff' : 'transparent', color: activeTab === 'gemini' ? '#000' : '#fff', border: '1px solid #00f3ff', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>Gemini AI</button>
              <button onClick={() => setActiveTab('atlassian')} style={{ background: activeTab === 'atlassian' ? '#00f3ff' : 'transparent', color: activeTab === 'atlassian' ? '#000' : '#fff', border: '1px solid #00f3ff', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>Atlassian</button>
              <button onClick={() => setActiveTab('zendesk')} style={{ background: activeTab === 'zendesk' ? '#00f3ff' : 'transparent', color: activeTab === 'zendesk' ? '#000' : '#fff', border: '1px solid #00f3ff', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>Zendesk</button>
            </div>

            {activeTab === 'gemini' && (
              <div>
                <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px', marginBottom: '10px' }}>AI 에이전트 구동을 위한 메인 API 키입니다.</p>
                <input placeholder="Gemini API Key" value={form.apiKey} onChange={e => setForm({...form, apiKey: e.target.value})} style={inputStyle} />
              </div>
            )}

            {activeTab === 'atlassian' && (
              <div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
                  <button onClick={() => setAtlassianSubTab('common')} style={{ background: atlassianSubTab === 'common' ? 'rgba(255,255,255,0.2)' : 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '11px' }}>공통 설정</button>
                  <button onClick={() => setAtlassianSubTab('jira')} style={{ background: atlassianSubTab === 'jira' ? 'rgba(255,255,255,0.2)' : 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '11px' }}>Jira Space</button>
                  <button onClick={() => setAtlassianSubTab('confluence')} style={{ background: atlassianSubTab === 'confluence' ? 'rgba(255,255,255,0.2)' : 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '11px' }}>Confluence Space</button>
                </div>

                {atlassianSubTab === 'common' && (
                  <div>
                    <input placeholder="도메인 URL (예: https://com2us.atlassian.net)" value={form.confUrl} onChange={e => setForm({...form, confUrl: e.target.value})} style={inputStyle} />
                    <input placeholder="Atlassian 이메일 계정" value={form.confEmail} onChange={e => setForm({...form, confEmail: e.target.value})} style={inputStyle} />
                    <input type="password" placeholder="Atlassian API Token" value={form.confToken} onChange={e => setForm({...form, confToken: e.target.value})} style={inputStyle} />
                  </div>
                )}

                {atlassianSubTab === 'jira' && (
                  <div>
                    {form.jiraSpaces.map((space: string, idx: number) => (
                      <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                        <input placeholder="예: GCPTAM" value={space} onChange={e => handleArrayChange('jiraSpaces', idx, e.target.value)} style={{ ...inputStyle, marginBottom: 0, border: '1px solid #00f3ff', backgroundColor: 'rgba(0, 243, 255, 0.05)' }} />
                        {form.jiraSpaces.length > 1 && <button onClick={() => removeArrayItem('jiraSpaces', idx)} style={{ background: 'rgba(255,0,0,0.2)', color: '#ff4d4f', border: 'none', borderRadius: '8px', padding: '0 12px', cursor: 'pointer' }}>✕</button>}
                      </div>
                    ))}
                    <button onClick={() => addArrayItem('jiraSpaces')} style={{ background: 'transparent', color: '#00f3ff', border: '1px dashed #00f3ff', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', width: '100%', fontSize: '12px' }}>+ 스페이스 추가</button>
                  </div>
                )}

                {atlassianSubTab === 'confluence' && (
                  <div>
                    {form.confSpaces.map((space: string, idx: number) => (
                      <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                        <input placeholder="예: GCPPLAT" value={space} onChange={e => handleArrayChange('confSpaces', idx, e.target.value)} style={{ ...inputStyle, marginBottom: 0, border: '1px solid #00f3ff', backgroundColor: 'rgba(0, 243, 255, 0.05)' }} />
                        {form.confSpaces.length > 1 && <button onClick={() => removeArrayItem('confSpaces', idx)} style={{ background: 'rgba(255,0,0,0.2)', color: '#ff4d4f', border: 'none', borderRadius: '8px', padding: '0 12px', cursor: 'pointer' }}>✕</button>}
                      </div>
                    ))}
                    <button onClick={() => addArrayItem('confSpaces')} style={{ background: 'transparent', color: '#00f3ff', border: '1px dashed #00f3ff', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', width: '100%', fontSize: '12px' }}>+ 스페이스 추가</button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'zendesk' && (
              <div>
                <input placeholder="서브도메인 (예: com2us)" value={form.zendeskSubdomain} onChange={e => setForm({...form, zendeskSubdomain: e.target.value})} style={inputStyle} />
                <input placeholder="Zendesk 로그인 이메일" value={form.zendeskEmail} onChange={e => setForm({...form, zendeskEmail: e.target.value})} style={inputStyle} />
                <input type="password" placeholder="Zendesk API Token" value={form.zendeskToken} onChange={e => setForm({...form, zendeskToken: e.target.value})} style={inputStyle} />
              </div>
            )}
            
            <div style={{ flex: 1 }} />
            <button onClick={() => saveConfigAndConnect(form)} disabled={isLoading} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#00f3ff', color: '#000', fontWeight: 'bold', cursor: 'pointer', marginTop: '20px' }}>
              {isLoading ? '연결 중...' : '모든 설정 저장 및 가동'}
            </button>
          </div>
        ) : isErrorNoteOpen ? (
          /* 🌟 오답노트 작성 화면 */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px', overflowY: 'auto' }}>
            <h3 style={{ color: '#fff', marginBottom: '8px' }}>📝 사내 오답노트 등록</h3>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', marginBottom: '24px' }}>AI가 헛소리한 내용을 교정하여 Confluence DB에 기록합니다.</p>
            
            <p style={{ color: '#00f3ff', fontSize: '12px', marginBottom: '4px' }}>1. 등록자</p>
            <input placeholder="예: 플랫폼팀 홍길동" value={errorNoteForm.author} onChange={e => setErrorNoteForm({...errorNoteForm, author: e.target.value})} style={inputStyle} />
            
            <p style={{ color: '#00f3ff', fontSize: '12px', marginBottom: '4px' }}>2. 질문(키워드) - AI가 질문받으면 가로챌 문구</p>
            <textarea placeholder="질문을 입력하세요" value={errorNoteForm.question} onChange={e => setErrorNoteForm({...errorNoteForm, question: e.target.value})} style={{ ...inputStyle, height: '60px', resize: 'none' }} />
            
            <p style={{ color: '#00f3ff', fontSize: '12px', marginBottom: '4px' }}>3. 올바른 답변 - AI가 무조건 대답해야 할 내용</p>
            <textarea placeholder="정확한 가이드나 답변을 적어주세요." value={errorNoteForm.answer} onChange={e => setErrorNoteForm({...errorNoteForm, answer: e.target.value})} style={{ ...inputStyle, height: '100px', resize: 'none' }} />
            
            <p style={{ color: '#00f3ff', fontSize: '12px', marginBottom: '4px' }}>4. 참고 링크 (선택)</p>
            <input placeholder="https://..." value={errorNoteForm.link} onChange={e => setErrorNoteForm({...errorNoteForm, link: e.target.value})} style={inputStyle} />
            
            <div style={{ flex: 1 }} />
            <button onClick={submitErrorNote} disabled={isLoading} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#00f3ff', color: '#000', fontWeight: 'bold', cursor: 'pointer', marginTop: '20px' }}>
              {isLoading ? 'DB에 등록 중...' : '규칙 등록하기'}
            </button>
          </div>
        ) : (
          /* 기존 채팅 화면 영역 */
          <>
            <div style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {messages.map((msg, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.isBot ? 'flex-start' : 'flex-end' }}>
                  <div style={{ maxWidth: '80%', padding: '12px 16px', borderRadius: '12px', fontSize: '14px', lineHeight: '1.5', backgroundColor: msg.isSystem ? 'transparent' : (msg.isBot ? 'rgba(255,255,255,0.1)' : '#00f3ff'), color: msg.isSystem ? 'rgba(0, 243, 255, 0.8)' : (msg.isBot ? '#fff' : '#000'), border: msg.isSystem ? '1px dashed rgba(0, 243, 255, 0.4)' : 'none', borderBottomLeftRadius: msg.isBot ? '4px' : '12px', borderBottomRightRadius: msg.isBot ? '12px' : '4px', whiteSpace: 'pre-wrap' }}>
                    {msg.text}
                  </div>
                  
                  {/* 🌟 AI 답변 말풍선 바로 아래 노출되는 버튼 */}
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
              <div ref={messagesEndRef} />
            </div>
            
            {/* 하단 입력창 부분 */}
            <div style={{ padding: '16px 24px 24px 24px' }}>
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
          </>
        )}
      </div>
    </div>
  )
}