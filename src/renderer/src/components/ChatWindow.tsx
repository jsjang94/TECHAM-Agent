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
}

export default function ChatWindow({
  isChatOpen, toggleChat, config, isConfiguring, setIsConfiguring, saveConfigAndConnect,
  messages, isLoading, inputText, setInputText, handleSend, handleKeyDown, messagesEndRef
}: ChatWindowProps) {

  const [form, setForm] = useState(config)
  const [activeTab, setActiveTab] = useState('gemini')
  const [atlassianSubTab, setAtlassianSubTab] = useState('common') // 🌟 작은 서브 탭 상태 추가!

  const inputStyle = { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'rgba(0,0,0,0.2)', color: '#fff', marginBottom: '10px' }

  // 🌟 배열 입력 필드 컨트롤 함수들
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
      
      <div style={{ width: '220px', borderRight: '1px solid rgba(255,255,255,0.08)', padding: '16px', backgroundColor: 'rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: '12px', padding: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
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
        <button onClick={() => setIsConfiguring(!isConfiguring)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', textAlign: 'left', fontSize: '12px', padding: '8px' }}>⚙️ 시스템 연동 설정</button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <button onClick={() => toggleChat(false)} style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '18px', padding: '4px', zIndex: 10 }}>✕</button>

        {isConfiguring ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px', overflowY: 'auto' }}>
            <h3 style={{ color: '#fff', marginBottom: '16px' }}>시스템 연동 설정</h3>
            
            {/* 메인 탭 */}
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
                {/* 🌟 Atlassian 작은 서브 탭 */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
                  <button onClick={() => setAtlassianSubTab('common')} style={{ background: atlassianSubTab === 'common' ? 'rgba(255,255,255,0.2)' : 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '11px' }}>공통 설정</button>
                  <button onClick={() => setAtlassianSubTab('jira')} style={{ background: atlassianSubTab === 'jira' ? 'rgba(255,255,255,0.2)' : 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '11px' }}>Jira Space</button>
                  <button onClick={() => setAtlassianSubTab('confluence')} style={{ background: atlassianSubTab === 'confluence' ? 'rgba(255,255,255,0.2)' : 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '11px' }}>Confluence Space</button>
                </div>

                {atlassianSubTab === 'common' && (
                  <div>
                    <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px', marginBottom: '10px' }}>계정 하나로 Jira와 Confluence에 동시 접속합니다.</p>
                    <input placeholder="도메인 URL (예: https://com2us.atlassian.net)" value={form.confUrl} onChange={e => setForm({...form, confUrl: e.target.value})} style={inputStyle} />
                    <input placeholder="Atlassian 이메일 계정" value={form.confEmail} onChange={e => setForm({...form, confEmail: e.target.value})} style={inputStyle} />
                    <input type="password" placeholder="Atlassian API Token" value={form.confToken} onChange={e => setForm({...form, confToken: e.target.value})} style={inputStyle} />
                  </div>
                )}

                {atlassianSubTab === 'jira' && (
                  <div>
                    <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px', marginBottom: '10px' }}>검색을 수행할 Jira 프로젝트(Space) 키를 입력하세요.</p>
                    {form.jiraSpaces.map((space: string, idx: number) => (
                      <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                        <input placeholder="예: GCPTAM" value={space} onChange={e => handleArrayChange('jiraSpaces', idx, e.target.value)} style={{ ...inputStyle, marginBottom: 0, border: '1px solid #00f3ff', backgroundColor: 'rgba(0, 243, 255, 0.05)' }} />
                        {form.jiraSpaces.length > 1 && (
                          <button onClick={() => removeArrayItem('jiraSpaces', idx)} style={{ background: 'rgba(255,0,0,0.2)', color: '#ff4d4f', border: 'none', borderRadius: '8px', padding: '0 12px', cursor: 'pointer' }}>✕</button>
                        )}
                      </div>
                    ))}
                    <button onClick={() => addArrayItem('jiraSpaces')} style={{ background: 'transparent', color: '#00f3ff', border: '1px dashed #00f3ff', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', width: '100%', fontSize: '12px' }}>+ 스페이스 추가</button>
                  </div>
                )}

                {atlassianSubTab === 'confluence' && (
                  <div>
                    <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px', marginBottom: '10px' }}>검색을 수행할 Confluence 스페이스 키를 입력하세요.</p>
                    {form.confSpaces.map((space: string, idx: number) => (
                      <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                        <input placeholder="예: GCPPLAT" value={space} onChange={e => handleArrayChange('confSpaces', idx, e.target.value)} style={{ ...inputStyle, marginBottom: 0, border: '1px solid #00f3ff', backgroundColor: 'rgba(0, 243, 255, 0.05)' }} />
                        {form.confSpaces.length > 1 && (
                          <button onClick={() => removeArrayItem('confSpaces', idx)} style={{ background: 'rgba(255,0,0,0.2)', color: '#ff4d4f', border: 'none', borderRadius: '8px', padding: '0 12px', cursor: 'pointer' }}>✕</button>
                        )}
                      </div>
                    ))}
                    <button onClick={() => addArrayItem('confSpaces')} style={{ background: 'transparent', color: '#00f3ff', border: '1px dashed #00f3ff', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', width: '100%', fontSize: '12px' }}>+ 스페이스 추가</button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'zendesk' && (
              <div>
                <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px', marginBottom: '10px' }}>사내 비공개 지원 티켓 검색을 위한 연동 정보입니다.</p>
                <input placeholder="서브도메인 (예: com2us)" value={form.zendeskSubdomain} onChange={e => setForm({...form, zendeskSubdomain: e.target.value})} style={inputStyle} />
                <input placeholder="Zendesk 로그인 이메일" value={form.zendeskEmail} onChange={e => setForm({...form, zendeskEmail: e.target.value})} style={inputStyle} />
                <input type="password" placeholder="Zendesk API Token" value={form.zendeskToken} onChange={e => setForm({...form, zendeskToken: e.target.value})} style={inputStyle} />
              </div>
            )}
            
            <div style={{ flex: 1 }} />
            
            <button onClick={() => saveConfigAndConnect(form)} disabled={isLoading} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#00f3ff', color: '#000', fontWeight: 'bold', cursor: 'pointer', marginTop: '20px' }}>
              {isLoading ? '연결 중...' : '모든 설정 저장 및 시스템 가동'}
            </button>
          </div>
        ) : (
          <>
            <div style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {messages.map((msg, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: msg.isBot ? 'flex-start' : 'flex-end' }}>
                  <div style={{ maxWidth: '80%', padding: '12px 16px', borderRadius: '12px', fontSize: '14px', lineHeight: '1.5', backgroundColor: msg.isSystem ? 'transparent' : (msg.isBot ? 'rgba(255,255,255,0.1)' : '#00f3ff'), color: msg.isSystem ? 'rgba(0, 243, 255, 0.8)' : (msg.isBot ? '#fff' : '#000'), border: msg.isSystem ? '1px dashed rgba(0, 243, 255, 0.4)' : 'none', borderBottomLeftRadius: msg.isBot ? '4px' : '12px', borderBottomRightRadius: msg.isBot ? '12px' : '4px', whiteSpace: 'pre-wrap' }}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{ padding: '12px 16px', borderRadius: '12px', backgroundColor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', fontSize: '13px' }}>🤖 여러 시스템을 병렬 검색 중...</div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            
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
                  style={{ 
                    width: '32px', 
                    height: '32px', 
                    backgroundColor: inputText.trim() ? '#00f3ff' : 'rgba(255,255,255,0.1)', 
                    border: 'none', 
                    borderRadius: '8px', 
                    color: inputText.trim() ? '#000' : '#fff', 
                    cursor: inputText.trim() ? 'pointer' : 'default', 
                    marginLeft: '8px' 
                  }}
                >
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}