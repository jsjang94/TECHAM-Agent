import React, { useState } from 'react'

interface LoginPopupProps {
  onSuccess: (email: string) => void
  onLoginStart?: () => void
  onLoginFail?: () => void
}

export default function LoginPopup({ onSuccess, onLoginStart, onLoginFail }: LoginPopupProps) {
  const [email, setEmail] = useState(localStorage.getItem('hive_user_email') || '')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('이메일과 비밀번호를 모두 입력해주세요.')
      return
    }
    setIsLoading(true)
    setError('')
    onLoginStart?.()
    try {
      const electron = (window as any).electron
      if (!electron?.ipcRenderer) {
        setError('시스템 오류가 발생했습니다.')
        onLoginFail?.()
        return
      }
      const { authorized } = await electron.ipcRenderer.invoke('validate-credentials', email.trim(), password.trim())
      if (authorized) {
        localStorage.setItem('hive_user_email', email.trim())
        localStorage.setItem('hive_user_password', password.trim())
        onSuccess(email.trim())
      } else {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.')
        onLoginFail?.()
      }
    } catch {
      setError('서버 연결에 실패했습니다.')
      onLoginFail?.()
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin()
  }

  return (
    <div className="interactable" style={{ position: 'fixed', left: 'calc(50% - 160px)', bottom: '260px', width: '320px', backgroundColor: '#1c1c1e', borderRadius: '16px', padding: '36px 32px', border: '1px solid rgba(255,255,255,0.12)', boxSizing: 'border-box', zIndex: 9999, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
      <div>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔐</div>
          <h3 style={{ color: '#fff', marginBottom: '6px', fontSize: '18px' }}>TECHAM Agent</h3>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px' }}>사내 계정으로 로그인하세요</p>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <input
            type="email"
            placeholder="사내 이메일"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ width: '100%', padding: '11px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: error ? '10px' : '20px' }}>
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ width: '100%', padding: '11px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        {error && (
          <p style={{ color: '#ff3b30', fontSize: '12px', marginBottom: '16px', textAlign: 'center' }}>{error}</p>
        )}
        <button
          onClick={handleLogin}
          disabled={isLoading}
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: isLoading ? 'rgba(0,243,255,0.5)' : '#00f3ff', color: '#000', fontWeight: 'bold', cursor: isLoading ? 'default' : 'pointer', fontSize: '14px' }}
        >
          {isLoading ? '로그인 중...' : '로그인'}
        </button>
      </div>
    </div>
  )
}
