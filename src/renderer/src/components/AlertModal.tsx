import React from 'react'

interface AlertModalProps {
  emoji: string
  message: string
  onClose: () => void
}

export default function AlertModal({ emoji, message, onClose }: AlertModalProps) {
  return (
    <div
      className="interactable"
      style={{
        position: 'fixed', bottom: '240px', left: '50%', transform: 'translateX(-50%)',
        backgroundColor: '#1c1c1e', borderRadius: '16px', padding: '28px 28px 20px',
        border: '1px solid rgba(255,255,255,0.12)', width: '300px',
        boxSizing: 'border-box', textAlign: 'center', zIndex: 9999,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)'
      }}
    >
      <div style={{ fontSize: '36px', marginBottom: '12px' }}>{emoji}</div>
      <p style={{ color: '#fff', fontSize: '14px', lineHeight: '1.5', marginBottom: '20px', whiteSpace: 'pre-wrap' }}>
        {message}
      </p>
      <button
        onClick={onClose}
        style={{
          width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
          backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff',
          fontWeight: 'bold', cursor: 'pointer', fontSize: '13px'
        }}
      >
        확인
      </button>
    </div>
  )
}
