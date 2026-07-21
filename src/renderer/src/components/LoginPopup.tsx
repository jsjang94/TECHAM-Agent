import React, { useState } from 'react'

interface SetupPopupProps {
  onSuccess: () => void
}

// 최초 설정 화면: 관리자가 전달한 "설정 코드"(7개 키의 base64 JSON)를 붙여넣는다.
// 설정 코드는 main으로만 전송되어 safeStorage에 암호화 저장되고, 렌더러는 저장 후 즉시 비운다.
export default function LoginPopup({ onSuccess }: SetupPopupProps) {
  const [setupCode, setSetupCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async (): Promise<void> => {
    if (!setupCode.trim()) {
      setError('설정 코드를 입력해주세요.')
      return
    }
    setIsLoading(true)
    setError('')
    try {
      const electron = (window as any).electron
      if (!electron?.ipcRenderer) {
        setError('시스템 오류가 발생했습니다.')
        return
      }
      const res = await electron.ipcRenderer.invoke('save-credentials', setupCode.trim())
      if (res?.success) {
        setSetupCode('') // 렌더러 메모리에서 즉시 제거 (키를 오래 들고 있지 않음)
        onSuccess()
      } else {
        setError(res?.error || '설정 코드가 올바르지 않습니다.')
      }
    } catch {
      setError('설정 저장에 실패했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  // 설정 코드는 여러 줄일 수 있어 textarea라 Enter는 줄바꿈; Cmd/Ctrl+Enter로 제출
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave()
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '11px 14px', borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.06)',
    color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box'
  }

  return (
    <div
      className="interactable"
      style={{
        position: 'fixed', left: 'calc(50% - 180px)', bottom: '240px', width: '360px',
        backgroundColor: '#1c1c1e', borderRadius: '16px', padding: '32px 28px',
        border: '1px solid rgba(255,255,255,0.12)', boxSizing: 'border-box', zIndex: 9999,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔐</div>
        <h3 style={{ color: '#fff', marginBottom: '6px', fontSize: '18px' }}>TECHAM Agent 초기 설정</h3>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px' }}>관리자가 전달한 설정 코드를 붙여넣으세요</p>
      </div>

      <div style={{ marginBottom: error ? '10px' : '20px' }}>
        <textarea
          placeholder="설정 코드 붙여넣기 (한 줄)"
          value={setupCode}
          onChange={(e) => setSetupCode(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ ...inputStyle, height: '90px', resize: 'vertical', fontFamily: 'monospace', fontSize: '12px' }}
        />
      </div>

      {error && (
        <p style={{ color: '#ff3b30', fontSize: '12px', marginBottom: '16px', textAlign: 'center', whiteSpace: 'pre-wrap' }}>{error}</p>
      )}

      <button
        onClick={handleSave}
        disabled={isLoading}
        style={{
          width: '100%', padding: '12px', borderRadius: '8px', border: 'none',
          backgroundColor: isLoading ? 'rgba(var(--hive-blue-rgb), 0.5)' : 'var(--hive-blue)',
          color: '#fff', fontWeight: 'bold', cursor: isLoading ? 'default' : 'pointer', fontSize: '14px'
        }}
      >
        {isLoading ? '설정 저장 중...' : '설정 완료'}
      </button>
    </div>
  )
}
