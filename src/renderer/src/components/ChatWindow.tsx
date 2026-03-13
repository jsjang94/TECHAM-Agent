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

  return (
    <div style={{ 
      width: '700px', height: '450px', backgroundColor: 'rgba(30, 30, 32, 0.75)', 
      borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', marginBottom: '20px', 
      display: 'flex', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
      opacity: isChatOpen ? 1 : 0, transform: isChatOpen ? 'translateY(0) scale(1)' : 'translateY(15px) scale(0.98)',
      backdropFilter: isChatOpen ? 'blur(40px) saturate(150%)' : 'none', transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
    }}>
      
      {/* 사이드바 */}
      <div style={{ width: '220px', borderRight: '1px solid rgba(255,255,255,0.08)', padding: '16px', backgroundColor: 'rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: '12px', padding: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ width: '32px', height: '32px', backgroundColor: '#4a4a4a', borderRadius: '50%', marginRight: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '16px' }}>🤖</div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff' }}>Hive Agent</div>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Gemini Pro + MCP</div>
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
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '40px', overflowY: 'auto' }}>
            <h3 style={{ color: '#fff', marginBottom: '20px' }}>Gemini & Confluence 설정</h3>
            <input placeholder="Gemini API Key" value={form.apiKey} onChange={e => setForm({...form, apiKey: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'rgba(0,0,0,0.2)', color: '#fff', marginBottom: '10px' }} />
            <input placeholder="Confluence URL (예: https://com2us.atlassian.net)" value={form.confUrl} onChange={e => setForm({...form, confUrl: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'rgba(0,0,0,0.2)', color: '#fff', marginBottom: '10px' }} />
            <input placeholder="Confluence 이메일 계정" value={form.confEmail} onChange={e => setForm({...form, confEmail: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'rgba(0,0,0,0.2)', color: '#fff', marginBottom: '10px' }} />
            <input type="password" placeholder="Confluence API Token" value={form.confToken} onChange={e => setForm({...form, confToken: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'rgba(0,0,0,0.2)', color: '#fff', marginBottom: '10px' }} />
            
            {/* 🌟 타겟 스페이스 입력칸 추가 (눈에 잘 띄게 파란색 테두리) */}
            <input placeholder="검색 대상 Space Key (예: GCPTAM)" value={form.confSpace} onChange={e => setForm({...form, confSpace: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #00f3ff', backgroundColor: 'rgba(0, 243, 255, 0.05)', color: '#fff', marginBottom: '20px' }} />
            
            <button onClick={() => saveConfigAndConnect(form)} disabled={isLoading} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', backgroundColor: '#00f3ff', color: '#000', fontWeight: 'bold', cursor: 'pointer' }}>
              {isLoading ? '연결 중...' : '시스템 연동 및 시작'}
            </button>
          </div>
        ) : (
          <>
            <div style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {messages.map((msg, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: msg.isBot ? 'flex-start' : 'flex-end' }}>
                  <div style={{ 
                    maxWidth: '80%', padding: '12px 16px', borderRadius: '12px', fontSize: '14px', lineHeight: '1.5', 
                    backgroundColor: msg.isSystem ? 'transparent' : (msg.isBot ? 'rgba(255,255,255,0.1)' : '#00f3ff'), 
                    color: msg.isSystem ? 'rgba(0, 243, 255, 0.8)' : (msg.isBot ? '#fff' : '#000'), 
                    border: msg.isSystem ? '1px dashed rgba(0, 243, 255, 0.4)' : 'none',
                    borderBottomLeftRadius: msg.isBot ? '4px' : '12px', borderBottomRightRadius: msg.isBot ? '12px' : '4px', whiteSpace: 'pre-wrap' 
                  }}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{ padding: '12px 16px', borderRadius: '12px', backgroundColor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', fontSize: '13px' }}>🤖 열심히 분석 중...</div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            
            <div style={{ padding: '16px 24px 24px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', padding: '4px 4px 4px 16px' }}>
                <input type="text" placeholder="시스템에 질문하세요..." value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={handleKeyDown} disabled={isLoading} style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: '14px', outline: 'none', height: '36px' }} />
                <button onClick={handleSend} disabled={isLoading || !inputText.trim()} style={{ width: '32px', height: '32px', backgroundColor: inputText.trim() ? '#00f3ff' : 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', color: inputText.trim() ? '#000' : '#fff', cursor: inputText.trim() ? 'pointer' : 'default', marginLeft: '8px' }}>↑</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}