import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Button, Card, CardBody, CardHeader, Input, Textarea, Select } from '../components/ui'
import { useToast } from '../components/ui/Toast'
import { fetchChatSettings, createConversationSocket } from '../api'
import { t } from '../i18n'
import type {
  ChatSettingsResponse,
  ConversationStatus,
  ConversationServerEvent,
  ChatMessage,
  ProviderId,
} from '../types'

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

  // Settings state
  const [settings, setSettings] = useState<ChatSettingsResponse | null>(null)
  const [isLoadingSettings, setIsLoadingSettings] = useState(true)
  const [showSettings, setShowSettings] = useState(false)

  // Connection state
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [status, setStatus] = useState<ConversationStatus>('idle')

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [currentTranscript, setCurrentTranscript] = useState('')
  const [currentAssistantText, setCurrentAssistantText] = useState('')

  // Refs
  const socketRef = useRef<WebSocket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  // Load settings on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await fetchChatSettings()
        setSettings(data)
      } catch (err) {
        showError('Failed to load chat settings')
      } finally {
        setIsLoadingSettings(false)
      }
    }
    loadSettings()
  }, [])

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentTranscript, currentAssistantText])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectSocket()
    }
  }, [])

  const connectSocket = useCallback(async () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      return
    }

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

        if (event.code !== 1000) {
          showError(`Connection closed unexpectedly (code ${event.code})`)
        }
      }

      socket.onerror = () => {
        setIsConnected(false)
        setIsConnecting(false)
        showError('Failed to connect to voice chat')
      }

      socket.onmessage = (event) => {
        try {
          const data: ConversationServerEvent = JSON.parse(event.data)
          handleServerEvent(data)
        } catch (err) {
          console.error('Failed to parse server event:', err)
        }
      }

      socketRef.current = socket
    } catch (err) {
      setIsConnecting(false)
      showError('Failed to establish connection')
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
  }, [])

  const handleServerEvent = (event: ConversationServerEvent) => {
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

      case 'llm.sentence':
        // Sentence complete, update running text
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
  }

  const addMessage = (message: Omit<ChatMessage, 'id'>) => {
    setMessages((prev) => [
      ...prev,
      { ...message, id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` },
    ])
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      audioContextRef.current = new AudioContext()
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      })

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0 && socketRef.current?.readyState === WebSocket.OPEN) {
          const arrayBuffer = await event.data.arrayBuffer()
          socketRef.current.send(arrayBuffer)
        }
      }

      mediaRecorder.start(100) // Send chunks every 100ms
      mediaRecorderRef.current = mediaRecorder
      setStatus('listening')
    } catch (err) {
      showError(t('error.startMicrophoneFailed') || 'Failed to start microphone')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop())
    }
    mediaRecorderRef.current = null

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
  }

  const handleToggleRecording = () => {
    if (status === 'listening') {
      stopRecording()
      setStatus('idle')
      // Send stop signal to server
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'audio.stop' }))
      }
    } else if (status === 'idle' && isConnected) {
      startRecording()
    }
  }

  const handleSendText = () => {
    if (!inputText.trim() || !isConnected) return

    // Send text message
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'text.message', text: inputText }))
      addMessage({ role: 'user', text: inputText })
      setInputText('')
      setStatus('thinking')
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendText()
    }
  }

  const handleClearChat = () => {
    setMessages([])
    setCurrentTranscript('')
    setCurrentAssistantText('')
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
            <h1>💬 {t('workspace.chat') || 'Voice Chat'}</h1>
            <p className="page-description">
              {t('voiceChat.lead') || 'Talk to an AI assistant using voice or text. Real-time speech recognition and synthesis.'}
            </p>
          </div>
          <div className="header-actions">
            <Button
              variant="secondary"
              onClick={() => setShowSettings(!showSettings)}
            >
              ⚙️ Settings
            </Button>
          </div>
        </div>

        <div className="chat-layout">
          {/* Settings Panel */}
          {showSettings && (
            <div className="settings-panel">
              <Card>
                <CardHeader>
                  <h3>Chat Settings</h3>
                </CardHeader>
                <CardBody>
                  <div className="settings-grid">
                    <Select
                      label="Provider"
                      value={settings?.defaults.active_provider || 'openai_compatible'}
                      onChange={(e) => {
                        if (settings) {
                          setSettings({
                            ...settings,
                            defaults: { ...settings.defaults, active_provider: e.target.value as ProviderId },
                          })
                        }
                      }}
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
                      onChange={(e) => {
                        if (settings) {
                          setSettings({
                            ...settings,
                            defaults: { ...settings.defaults, temperature: parseFloat(e.target.value) },
                          })
                        }
                      }}
                    />

                    <Textarea
                      label="System Prompt"
                      value={settings?.defaults.system_prompt || ''}
                      onChange={(e) => {
                        if (settings) {
                          setSettings({
                            ...settings,
                            defaults: { ...settings.defaults, system_prompt: e.target.value },
                          })
                        }
                      }}
                      className="settings-full-width"
                    />
                  </div>
                </CardBody>
              </Card>
            </div>
          )}

          {/* Main Chat Area */}
          <div className="chat-main">
            {/* Status Bar */}
            <div className="status-bar">
              <div className="status-indicator">
                <span
                  className="status-dot"
                  style={{ backgroundColor: isConnected ? STATUS_COLORS[status] : 'var(--color-gray-400)' }}
                />
                <span className="status-text">
                  {isConnected ? STATUS_LABELS[status] : 'Disconnected'}
                </span>
              </div>
              <div className="status-actions">
                {!isConnected ? (
                  <Button
                    variant="primary"
                    onClick={connectSocket}
                    isLoading={isConnecting}
                  >
                    Connect
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={disconnectSocket}>
                    Disconnect
                  </Button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="messages-container">
              {messages.length === 0 && !currentTranscript && !currentAssistantText ? (
                <div className="empty-chat">
                  <span className="empty-icon">🎤</span>
                  <h3>Start a Conversation</h3>
                  <p>Connect and click the microphone to talk, or type a message below.</p>
                </div>
              ) : (
                <div className="messages-list">
                  {messages.map((message) => (
                    <div key={message.id} className={`message message-${message.role}`}>
                      <div className="message-avatar">
                        {message.role === 'user' ? '👤' : '🤖'}
                      </div>
                      <div className="message-content">
                        <span className="message-role">
                          {message.role === 'user' ? 'You' : 'Assistant'}
                        </span>
                        <p className="message-text">{message.text}</p>
                      </div>
                    </div>
                  ))}

                  {/* Live transcript */}
                  {currentTranscript && (
                    <div className="message message-user message-draft">
                      <div className="message-avatar">👤</div>
                      <div className="message-content">
                        <span className="message-role">You</span>
                        <p className="message-text">{currentTranscript}</p>
                      </div>
                    </div>
                  )}

                  {/* Live assistant response */}
                  {currentAssistantText && (
                    <div className="message message-assistant message-draft">
                      <div className="message-avatar">🤖</div>
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

            {/* Input Area */}
            <div className="input-area">
              <button
                className={`mic-button ${status === 'listening' ? 'mic-button-active' : ''}`}
                onClick={handleToggleRecording}
                disabled={!isConnected || (status !== 'idle' && status !== 'listening')}
                aria-label={status === 'listening' ? 'Stop recording' : 'Start recording'}
              >
                {status === 'listening' ? '⏹️' : '🎤'}
              </button>

              <div className="text-input-wrapper">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={t('placeholder.typedMessage') || 'Type a message...'}
                  disabled={!isConnected}
                  className="form-input"
                />
              </div>

              <Button
                variant="primary"
                onClick={handleSendText}
                disabled={!isConnected || !inputText.trim()}
              >
                Send
              </Button>

              {messages.length > 0 && (
                <Button variant="ghost" onClick={handleClearChat}>
                  Clear
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .chat-page .page-container {
          max-width: 1000px;
        }

        .chat-page .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: var(--space-4);
        }

        .header-content {
          flex: 1;
        }

        .header-actions {
          flex-shrink: 0;
        }

        .chat-layout {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .settings-panel {
          animation: slide-down var(--transition-base);
        }

        @keyframes slide-down {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .settings-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: var(--space-4);
        }

        .settings-full-width {
          grid-column: 1 / -1;
        }

        .chat-main {
          background: var(--color-white);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-md);
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
          background: var(--color-gray-50);
          border-bottom: 1px solid var(--border-color);
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }

        .status-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .status-text {
          font-weight: var(--font-medium);
          color: var(--color-gray-700);
        }

        .messages-container {
          flex: 1;
          overflow-y: auto;
          padding: var(--space-4);
        }

        .empty-chat {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          min-height: 300px;
          text-align: center;
          color: var(--color-gray-500);
        }

        .empty-icon {
          font-size: 4rem;
          margin-bottom: var(--space-4);
        }

        .empty-chat h3 {
          margin: 0 0 var(--space-2);
          color: var(--color-gray-700);
        }

        .empty-chat p {
          margin: 0;
          max-width: 300px;
        }

        .messages-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .message {
          display: flex;
          gap: var(--space-3);
          max-width: 80%;
        }

        .message-user {
          align-self: flex-end;
          flex-direction: row-reverse;
        }

        .message-assistant {
          align-self: flex-start;
        }

        .message-avatar {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-gray-100);
          border-radius: var(--radius-full);
          font-size: var(--text-lg);
          flex-shrink: 0;
        }

        .message-content {
          background: var(--color-gray-100);
          padding: var(--space-3) var(--space-4);
          border-radius: var(--radius-lg);
        }

        .message-user .message-content {
          background: var(--color-primary-100);
        }

        .message-draft .message-content {
          opacity: 0.7;
        }

        .message-role {
          display: block;
          font-size: var(--text-xs);
          font-weight: var(--font-semibold);
          color: var(--color-gray-500);
          margin-bottom: var(--space-1);
        }

        .message-text {
          margin: 0;
          color: var(--color-gray-800);
          line-height: var(--leading-relaxed);
          white-space: pre-wrap;
        }

        .input-area {
          display: flex;
          gap: var(--space-3);
          padding: var(--space-4);
          border-top: 1px solid var(--border-color);
          background: var(--color-gray-50);
        }

        .mic-button {
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-gray-200);
          border: none;
          border-radius: var(--radius-full);
          font-size: var(--text-xl);
          cursor: pointer;
          transition: all var(--transition-fast);
          flex-shrink: 0;
        }

        .mic-button:hover:not(:disabled) {
          background: var(--color-gray-300);
        }

        .mic-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .mic-button-active {
          background: var(--color-error-500);
          animation: recording-pulse 1s infinite;
        }

        @keyframes recording-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }

        .text-input-wrapper {
          flex: 1;
        }

        .text-input-wrapper .form-input {
          height: 48px;
        }

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
          .chat-page .page-header {
            flex-direction: column;
          }

          .message {
            max-width: 90%;
          }

          .input-area {
            flex-wrap: wrap;
          }

          .text-input-wrapper {
            order: 1;
            width: 100%;
          }

          .mic-button {
            order: 2;
          }
        }
      `}</style>
    </div>
  )
}
