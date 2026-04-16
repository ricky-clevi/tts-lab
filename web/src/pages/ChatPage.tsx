import { useCallback, useEffect, useRef, useState } from 'react'
import { createConversationSocket, fetchChatSettings } from '../api'
import '../styles/pages/chat.css'
import { Button, Card, CardBody, CardHeader, Input, LoadingState, Select, Textarea, useToast } from '../components/ui'
import { t } from '../i18n'
import { createClientId } from '../lib/clientIds'
import { localizeChatSettings } from '../lib/formatters'
import type { ChatMessage, ChatSettingsResponse, ConversationServerEvent, ConversationStatus, ProviderId } from '../types'

const STATUS_LABELS: Record<ConversationStatus, string> = {
  idle: 'chat.status.idle',
  listening: 'chat.status.listening',
  transcribing: 'chat.status.transcribing',
  thinking: 'chat.status.thinking',
  speaking: 'chat.status.speaking',
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  idle: 'var(--color-gray-500)',
  listening: 'var(--color-success-500)',
  transcribing: 'var(--color-info-500)',
  thinking: 'var(--color-warning-500)',
  speaking: 'var(--color-primary-400)',
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
        setSettings(localizeChatSettings(await fetchChatSettings()))
      } catch {
        showError(t('chat.error.loadSettings'))
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
    setMessages((prev) => [...prev, { ...message, id: createClientId('msg') }])
  }

  const handleServerEvent = useCallback((event: ConversationServerEvent) => {
    switch (event.type) {
      case 'session.ready':
        setSettings(localizeChatSettings(event.settings))
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
        success(t('toast.voiceChatConnected'))
      }
      socket.onclose = (event) => {
        setIsConnected(false)
        setIsConnecting(false)
        setStatus('idle')
        if (event.code !== 1000) showError(t('chat.error.connectionClosed', { code: event.code }))
      }
      socket.onerror = () => {
        setIsConnected(false)
        setIsConnecting(false)
        showError(t('chat.error.connect'))
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
      showError(t('chat.error.establishConnection'))
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
      showError(t('error.startMicrophoneFailed'))
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

  const currentStatusKey = isConnected ? status : 'disconnected'

  if (isLoadingSettings) {
    return (
      <div className="page">
        <div className="page-container">
          <LoadingState message={t('chat.loadingSettings')} />
        </div>
      </div>
    )
  }

  return (
    <div className="page chat-page">
      <div className="page-container">
        <div className="page-header">
          <div className="header-content">
            <p className="chat-kicker">{t('chat.kicker')}</p>
            <h1>{t('workspace.chat')}</h1>
            <p className="page-description">{t('voiceChat.lead')}</p>
          </div>
          <div className="header-actions">
            <Button
              variant="secondary"
              onClick={() => setShowSettings((value) => !value)}
              aria-expanded={showSettings}
              aria-controls="chat-settings-panel"
            >
              {t('chat.settings.toggle')}
            </Button>
          </div>
        </div>

        <div className="chat-layout">
          {showSettings && (
            <div className="settings-panel" id="chat-settings-panel">
              <Card>
                <CardHeader>
                  <h3>{t('chat.settings.title')}</h3>
                </CardHeader>
                <CardBody>
                  <div className="settings-grid">
                    <Select
                      label={t('chat.settings.provider')}
                      value={settings?.defaults.active_provider || 'openai_compatible'}
                      onChange={(e) =>
                        settings &&
                        setSettings({
                          ...settings,
                          defaults: { ...settings.defaults, active_provider: e.target.value as ProviderId },
                        })
                      }
                      options={[
                        { value: 'openai_compatible', label: t('provider.openai_compatible') },
                        { value: 'gemini', label: t('provider.gemini') },
                        { value: 'anthropic', label: t('provider.anthropic') },
                      ]}
                    />
                    <Input
                      label={t('field.temperature')}
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={settings?.defaults.temperature || 0.7}
                      onChange={(e) =>
                        settings &&
                        setSettings({
                          ...settings,
                          defaults: { ...settings.defaults, temperature: parseFloat(e.target.value) },
                        })
                      }
                    />
                    <Textarea
                      label={t('field.systemPrompt')}
                      value={settings?.defaults.system_prompt || ''}
                      onChange={(e) =>
                        settings &&
                        setSettings({
                          ...settings,
                          defaults: { ...settings.defaults, system_prompt: e.target.value },
                        })
                      }
                      className="settings-full-width"
                    />
                  </div>
                </CardBody>
              </Card>
            </div>
          )}

          <div className="chat-main">
            {/* Status Bar - Professional Control Panel */}
            <div className="status-bar" role="status" aria-live="polite">
              <div className="status-indicator">
                <span
                  className="status-dot"
                  data-status={currentStatusKey}
                  style={{ backgroundColor: isConnected ? STATUS_COLORS[status] : 'var(--color-gray-500)' }}
                  aria-hidden="true"
                />
                <div className="status-label">
                  <span className="status-badge">{t('chat.status.label')}</span>
                  <span className="status-text" data-status={currentStatusKey}>
                    {isConnected ? t(STATUS_LABELS[status]) : t('chat.status.disconnected')}
                  </span>
                </div>
              </div>
              <div className="status-bar-actions">
                {!isConnected ? (
                  <Button variant="primary" onClick={connectSocket} isLoading={isConnecting}>
                    {t('chat.connect')}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={disconnectSocket}>
                    {t('chat.disconnect')}
                  </Button>
                )}
              </div>
            </div>

            {/* Messages Container */}
            <div className="messages-container" role="log" aria-label={t('chat.messagesLabel')}>
              {messages.length === 0 && !currentTranscript && !currentAssistantText ? (
                <div className="empty-chat">
                  <span className="empty-icon" aria-hidden="true">
                    {t('chat.empty.badge')}
                  </span>
                  <h3>{t('chat.empty.title')}</h3>
                  <p>{t('chat.empty.description')}</p>
                  <div className="empty-instructions">
                    <div className="empty-step">
                      <span className="empty-step-number" aria-hidden="true">1</span>
                      <span>{t('chat.empty.step1')}</span>
                    </div>
                    <div className="empty-step">
                      <span className="empty-step-number" aria-hidden="true">2</span>
                      <span>{t('chat.empty.step2')}</span>
                    </div>
                    <div className="empty-step">
                      <span className="empty-step-number" aria-hidden="true">3</span>
                      <span>{t('chat.empty.step3')}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="messages-list">
                  {messages.map((message) => (
                    <div key={message.id} className={`message message-${message.role}`}>
                      <div className="message-avatar" aria-hidden="true">
                        {message.role === 'user' ? t('chat.avatar.user') : t('chat.avatar.ai')}
                      </div>
                      <div className="message-content">
                        <span className="message-role">
                          {message.role === 'user' ? t('chatRole.user') : t('chatRole.assistant')}
                        </span>
                        <p className="message-text">{message.text}</p>
                      </div>
                    </div>
                  ))}

                  {/* Partial Transcript - User is speaking */}
                  {currentTranscript && (
                    <div className="message message-user message-draft" aria-label={t('chat.transcribing')}>
                      <div className="message-avatar" aria-hidden="true">
                        {t('chat.avatar.user')}
                      </div>
                      <div className="message-content">
                        <span className="message-role">{t('chatRole.user')}</span>
                        <p className="message-text">{currentTranscript}</p>
                      </div>
                    </div>
                  )}

                  {/* Streaming Response - Assistant is responding */}
                  {currentAssistantText && (
                    <div className="message message-assistant message-draft" aria-label={t('chat.responding')}>
                      <div className="message-avatar" aria-hidden="true">
                        {t('chat.avatar.ai')}
                      </div>
                      <div className="message-content">
                        <span className="message-role">{t('chatRole.assistant')}</span>
                        <p className="message-text">{currentAssistantText}</p>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input Area - Professional Control Strip */}
            <div className="input-area">
              <button
                type="button"
                className={`mic-button ${status === 'listening' ? 'mic-button-active' : ''}`}
                onClick={handleToggleRecording}
                disabled={!isConnected || (status !== 'idle' && status !== 'listening')}
                aria-label={status === 'listening' ? t('chat.record.stopAria') : t('chat.record.startAria')}
                aria-pressed={status === 'listening'}
              >
                {status === 'listening' ? t('chat.record.stop') : t('chat.record.talk')}
              </button>

              <div className="text-input-wrapper">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendText()
                    }
                  }}
                  placeholder={t('placeholder.typedMessage')}
                  disabled={!isConnected}
                  className="form-input"
                  aria-label={t('placeholder.typedMessage')}
                />
              </div>

              <div className="input-actions">
                <Button variant="primary" onClick={handleSendText} disabled={!isConnected || !inputText.trim()}>
                  {t('chat.send')}
                </Button>
                {messages.length > 0 && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setMessages([])
                      setCurrentTranscript('')
                      setCurrentAssistantText('')
                    }}
                  >
                    {t('chat.clear')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
