import { useCallback, useEffect, useRef, useState } from 'react'
import { createConversationSocket, fetchChatSettings } from '../api'
import { Button, Card, CardBody, CardHeader, Input, Select, Textarea } from '../components/ui'
import { useToast } from '../components/ui/Toast'
import { t } from '../i18n'
import type { ChatMessage, ChatSettingsResponse, ConversationServerEvent, ConversationStatus, ProviderId } from '../types'

const STATUS_LABELS: Record<ConversationStatus, string> = {
  idle: 'Ready',
  listening: 'Listening...',
  transcribing: 'Transcribing...',
  thinking: 'Thinking...',
  speaking: 'Speaking...',
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  idle: 'var(--color-gray-500)',
  listening: 'var(--color-success-500)',
  transcribing: 'var(--color-info-500)',
  thinking: 'var(--color-warning-500)',
  speaking: 'var(--color-primary-500)',
}

export default function ChatPage() {
  const { success, error: showError } = useToast()
  const [settings, setSettings] = useState<ChatSettingsResponse | null>(null)
  const [isLoadingSettings, setIsLoadingSettings] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [status, setStatus] = useState<ConversationStatus>('idle')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [currentTranscript, setCurrentTranscript] = useState('')
  const [currentAssistantText, setCurrentAssistantText] = useState('')

  const socketRef = useRef<WebSocket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    async function loadSettings() {
      try {
        setSettings(await fetchChatSettings())
      } catch {
        showError('Failed to load chat settings')
      } finally {
        setIsLoadingSettings(false)
      }
    }

    loadSettings()
  }, [showError])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentTranscript, currentAssistantText])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop())
    }
    mediaRecorderRef.current = null

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
  }, [])

  const disconnectSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close(1000)
      socketRef.current = null
    }
    stopRecording()
    setIsConnected(false)
    setStatus('idle')
  }, [stopRecording])

  useEffect(() => () => disconnectSocket(), [disconnectSocket])

  const addMessage = (message: Omit<ChatMessage, 'id'>) => {
    setMessages((prev) => [...prev, { ...message, id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` }])
  }

  const handleServerEvent = useCallback((event: ConversationServerEvent) => {
    switch (event.type) {
      case 'session.ready':
        setSettings(event.settings)
        break
      case 'asr.partial':
        setCurrentTranscript(event.text)
        break
      case 'asr.final':
        setCurrentTranscript('')
        addMessage({ role: 'user', text: event.text })
        break
      case 'llm.status':
        setStatus(event.phase)
        break
      case 'llm.delta':
        setCurrentAssistantText(event.text)
        break
      case 'assistant.complete':
        setCurrentAssistantText('')
        addMessage({ role: 'assistant', text: event.text })
        setStatus('idle')
        break
      case 'error':
        showError(event.detail)
        setStatus('idle')
        break
    }
  }, [showError])

  const connectSocket = useCallback(async () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) return
    setIsConnecting(true)

    try {
      const socket = createConversationSocket()
      socket.onopen = () => {
        setIsConnected(true)
        setIsConnecting(false)
        success(t('toast.voiceChatConnected') || 'Voice chat connected')
      }
      socket.onclose = (event) => {
        setIsConnected(false)
        setIsConnecting(false)
        setStatus('idle')
        if (event.code !== 1000) showError(`Connection closed unexpectedly (code ${event.code})`)
      }
      socket.onerror = () => {
        setIsConnected(false)
        setIsConnecting(false)
        showError('Failed to connect to voice chat')
      }
      socket.onmessage = (event) => {
        try {
          handleServerEvent(JSON.parse(event.data))
        } catch (err) {
          console.error('Failed to parse server event:', err)
        }
      }
      socketRef.current = socket
    } catch {
      setIsConnecting(false)
      showError('Failed to establish connection')
    }
  }, [handleServerEvent, showError, success])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioContextRef.current = new AudioContext()
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm',
      })

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0 && socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(await event.data.arrayBuffer())
        }
      }

      mediaRecorder.start(100)
      mediaRecorderRef.current = mediaRecorder
      setStatus('listening')
    } catch {
      showError(t('error.startMicrophoneFailed') || 'Failed to start microphone')
    }
  }

  const handleToggleRecording = () => {
    if (status === 'listening') {
      stopRecording()
      setStatus('idle')
      if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'audio.stop' }))
    } else if (status === 'idle' && isConnected) {
      startRecording()
    }
  }

  const handleSendText = () => {
    if (!inputText.trim() || !isConnected) return
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'text.message', text: inputText }))
      addMessage({ role: 'user', text: inputText })
      setInputText('')
      setStatus('thinking')
    }
  }

  if (isLoadingSettings) {
    return (
      <div className="page">
        <div className="page-container">
          <div className="loading-state">
            <div className="spinner" />
            <p>Loading chat settings...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page chat-page">
      <div className="page-container">
        <div className="page-header">
          <div className="header-content">
            <p className="chat-kicker">Realtime QA</p>
            <h1>{t('workspace.chat') || 'Voice Chat'}</h1>
            <p className="page-description">{t('voiceChat.lead') || 'Talk to an AI assistant using voice or text. Real-time speech recognition and synthesis.'}</p>
          </div>
          <div className="header-actions">
            <Button variant="secondary" onClick={() => setShowSettings((value) => !value)}>Settings</Button>
          </div>
        </div>

        <div className="chat-layout">
          {showSettings && (
            <div className="settings-panel">
              <Card>
                <CardHeader><h3>Chat Settings</h3></CardHeader>
                <CardBody>
                  <div className="settings-grid">
                    <Select
                      label="Provider"
                      value={settings?.defaults.active_provider || 'openai_compatible'}
                      onChange={(e) => settings && setSettings({ ...settings, defaults: { ...settings.defaults, active_provider: e.target.value as ProviderId } })}
                      options={[
                        { value: 'openai_compatible', label: 'OpenAI Compatible' },
                        { value: 'gemini', label: 'Gemini' },
                        { value: 'anthropic', label: 'Anthropic' },
                      ]}
                    />
                    <Input
                      label="Temperature"
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={settings?.defaults.temperature || 0.7}
                      onChange={(e) => settings && setSettings({ ...settings, defaults: { ...settings.defaults, temperature: parseFloat(e.target.value) } })}
                    />
                    <Textarea
                      label="System Prompt"
                      value={settings?.defaults.system_prompt || ''}
                      onChange={(e) => settings && setSettings({ ...settings, defaults: { ...settings.defaults, system_prompt: e.target.value } })}
                      className="settings-full-width"
                    />
                  </div>
                </CardBody>
              </Card>
            </div>
          )}

          <div className="chat-main">
            <div className="status-bar">
              <div className="status-indicator">
                <span className="status-dot" style={{ backgroundColor: isConnected ? STATUS_COLORS[status] : 'var(--color-gray-400)' }} />
                <span className="status-text">{isConnected ? STATUS_LABELS[status] : 'Disconnected'}</span>
              </div>
              {!isConnected ? (
                <Button variant="primary" onClick={connectSocket} isLoading={isConnecting}>Connect</Button>
              ) : (
                <Button variant="secondary" onClick={disconnectSocket}>Disconnect</Button>
              )}
            </div>

            <div className="messages-container">
              {messages.length === 0 && !currentTranscript && !currentAssistantText ? (
                <div className="empty-chat">
                  <span className="empty-icon">LIVE</span>
                  <h3>Start a Conversation</h3>
                  <p>Connect and use voice or text to validate reply behavior in real time.</p>
                </div>
              ) : (
                <div className="messages-list">
                  {messages.map((message) => (
                    <div key={message.id} className={`message message-${message.role}`}>
                      <div className="message-avatar">{message.role === 'user' ? 'You' : 'AI'}</div>
                      <div className="message-content">
                        <span className="message-role">{message.role === 'user' ? 'You' : 'Assistant'}</span>
                        <p className="message-text">{message.text}</p>
                      </div>
                    </div>
                  ))}

                  {currentTranscript && (
                    <div className="message message-user message-draft">
                      <div className="message-avatar">You</div>
                      <div className="message-content">
                        <span className="message-role">You</span>
                        <p className="message-text">{currentTranscript}</p>
                      </div>
                    </div>
                  )}

                  {currentAssistantText && (
                    <div className="message message-assistant message-draft">
                      <div className="message-avatar">AI</div>
                      <div className="message-content">
                        <span className="message-role">Assistant</span>
                        <p className="message-text">{currentAssistantText}</p>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            <div className="input-area">
              <button className={`mic-button ${status === 'listening' ? 'mic-button-active' : ''}`} onClick={handleToggleRecording} disabled={!isConnected || (status !== 'idle' && status !== 'listening')} aria-label={status === 'listening' ? 'Stop recording' : 'Start recording'}>
                {status === 'listening' ? 'Stop' : 'Talk'}
              </button>
              <div className="text-input-wrapper">
                <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendText() } }} placeholder={t('placeholder.typedMessage') || 'Type a message...'} disabled={!isConnected} className="form-input" />
              </div>
              <Button variant="primary" onClick={handleSendText} disabled={!isConnected || !inputText.trim()}>Send</Button>
              {messages.length > 0 && <Button variant="ghost" onClick={() => { setMessages([]); setCurrentTranscript(''); setCurrentAssistantText('') }}>Clear</Button>}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .chat-kicker {
          color: var(--color-primary-700);
          font-size: var(--text-xs);
          font-weight: var(--font-bold);
          letter-spacing: 0.16em;
          text-transform: uppercase;
          margin-bottom: var(--space-2);
        }
        .chat-page .page-container { max-width: 1000px; }
        .chat-page .page-header { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: var(--space-4); }
        .header-content { flex: 1; }
        .chat-layout { display: flex; flex-direction: column; gap: var(--space-4); }
        .settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-4); }
        .settings-full-width { grid-column: 1 / -1; }
        .chat-main {
          background: color-mix(in oklab, var(--color-surface-elevated) 88%, white 12%);
          border: 1px solid color-mix(in oklab, var(--color-line) 78%, white 22%);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-lg);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          min-height: 500px;
        }
        .status-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--space-3) var(--space-4);
          background: color-mix(in oklab, var(--color-surface) 84%, white 16%);
          border-bottom: 1px solid color-mix(in oklab, var(--color-line) 78%, white 22%);
        }
        .status-indicator { display: flex; align-items: center; gap: var(--space-2); }
        .status-dot { width: 10px; height: 10px; border-radius: 50%; animation: pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .status-text { font-weight: var(--font-medium); color: var(--color-gray-700); }
        .messages-container { flex: 1; overflow-y: auto; padding: var(--space-4); }
        .empty-chat {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 300px;
          text-align: center;
          color: var(--color-gray-500);
        }
        .empty-icon {
          display: inline-grid;
          place-items: center;
          min-width: 4.5rem;
          min-height: 4.5rem;
          border-radius: 1.2rem;
          background: color-mix(in oklab, var(--color-primary-100) 70%, white 30%);
          color: var(--color-primary-800);
          font-size: var(--text-sm);
          font-weight: var(--font-extrabold);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: var(--space-4);
        }
        .messages-list { display: flex; flex-direction: column; gap: var(--space-4); }
        .message { display: flex; gap: var(--space-3); max-width: 80%; }
        .message-user { align-self: flex-end; flex-direction: row-reverse; }
        .message-avatar {
          min-width: 3rem;
          height: 3rem;
          display: flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in oklab, var(--color-surface) 82%, white 18%);
          border: 1px solid color-mix(in oklab, var(--color-line) 78%, white 22%);
          border-radius: var(--radius-full);
          font-size: 0.72rem;
          font-weight: var(--font-extrabold);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          flex-shrink: 0;
        }
        .message-content {
          background: color-mix(in oklab, var(--color-surface) 84%, white 16%);
          border: 1px solid color-mix(in oklab, var(--color-line) 78%, white 22%);
          padding: var(--space-3) var(--space-4);
          border-radius: var(--radius-lg);
        }
        .message-user .message-content { background: color-mix(in oklab, var(--color-primary-50) 54%, white 46%); }
        .message-draft .message-content { opacity: 0.7; }
        .message-role { display: block; font-size: var(--text-xs); font-weight: var(--font-semibold); color: var(--color-gray-500); margin-bottom: var(--space-1); }
        .message-text { margin: 0; color: var(--color-gray-800); line-height: var(--leading-relaxed); white-space: pre-wrap; }
        .input-area {
          display: flex;
          gap: var(--space-3);
          padding: var(--space-4);
          border-top: 1px solid color-mix(in oklab, var(--color-line) 78%, white 22%);
          background: color-mix(in oklab, var(--color-surface) 84%, white 16%);
        }
        .mic-button {
          min-width: 4.25rem;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in oklab, var(--color-primary-50) 52%, white 48%);
          border: 1px solid color-mix(in oklab, var(--color-primary-200) 56%, var(--color-line) 44%);
          border-radius: var(--radius-full);
          font-size: var(--text-sm);
          font-weight: var(--font-bold);
        }
        .mic-button:disabled { opacity: 0.5; cursor: not-allowed; }
        .mic-button-active { background: var(--color-error-500); color: var(--color-white); animation: recording-pulse 1s infinite; }
        @keyframes recording-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
        .text-input-wrapper { flex: 1; }
        .text-input-wrapper .form-input { height: 48px; }
        .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 400px;
          gap: var(--space-4);
          color: var(--color-gray-500);
        }
        @media (max-width: 640px) {
          .chat-page .page-header, .input-area { flex-direction: column; }
          .message { max-width: 90%; }
          .text-input-wrapper { width: 100%; }
        }
      `}</style>
    </div>
  )
}
