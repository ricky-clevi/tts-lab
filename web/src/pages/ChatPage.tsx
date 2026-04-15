import React from 'react'

export default function ChatPage() {
  return (
    <div className="chat-page">
      <h1>Voice Conversation</h1>
      <p>
        This page will contain the real-time voice chat interface.
        Content extracted from the original App.tsx.
      </p>
      <div style={{
        background: '#f0f0f0',
        padding: '2rem',
        borderRadius: '8px',
        textAlign: 'center',
        color: '#666'
      }}>
        🎤 Voice Chat Interface - Coming Soon
        <p style={{ fontSize: '0.9rem', marginTop: '1rem' }}>
          Backend is ready. Frontend UI components to be extracted from original App.tsx
        </p>
      </div>
      <style>{`
        .chat-page {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem;
        }
        .chat-page h1 {
          color: #333;
        }
        .chat-page p {
          color: #666;
        }
      `}</style>
    </div>
  )
}
