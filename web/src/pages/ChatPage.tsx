import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioCapture } from '../audioCapture'
import {
  createConversationSocket,
  fetchChatSettings,
  saveChatSettings,
  testChatProvider,
} from '../api'
import '../styles/pages/chat.css'
import { Button, Card, CardBody, CardHeader, Input, LoadingState, Select, Textarea, useToast } from '../components/ui'
import { t } from '../i18n'
import { createClientId } from '../lib/clientIds'
import { localizeChatSettings } from '../lib/formatters'
import { StreamAudioPlayer } from '../streamAudioPlayer'
import type {
  ChatMessage,
  ChatSettingsDraft,
  ChatSettingsResponse,
  ConversationServerEvent,
  ConversationStatus,
  ProviderId,
  ProviderSettingsDraft,
} from '../types'

type ProviderSettingsForm = ProviderSettingsDraft & {
  has_api_key?: boolean
  masked_api_key?: string | null
}

type ChatSettingsForm = {
  defaults: ChatSettingsDraft['defaults']
  openai_compatible: ProviderSettingsForm
  gemini: ProviderSettingsForm
  anthropic: ProviderSettingsForm
}

const PROVIDERS: ProviderId[] = ['openai_compatible', 'gemini', 'anthropic']

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

function mapSettingsResponseToForm(response: ChatSettingsResponse): ChatSettingsForm {
  const localized = localizeChatSettings(response)

  return {
    defaults: localized.defaults,
    openai_compatible: {
      base_url: localized.openai_compatible.base_url ?? '',
      api_key: '',
      model: localized.openai_compatible.model,
      api_mode: localized.openai_compatible.api_mode,
      has_api_key: localized.openai_compatible.has_api_key,
      masked_api_key: localized.openai_compatible.masked_api_key,
    },
    gemini: {
      base_url: localized.gemini.base_url ?? '',
      api_key: '',
      model: localized.gemini.model,
      api_mode: null,
      has_api_key: localized.gemini.has_api_key,
      masked_api_key: localized.gemini.masked_api_key,
    },
    anthropic: {
      base_url: localized.anthropic.base_url ?? '',
      api_key: '',
      model: localized.anthropic.model,
      api_mode: null,
      has_api_key: localized.anthropic.has_api_key,
      masked_api_key: localized.anthropic.masked_api_key,
    },
  }
}

function serializeSettings(form: ChatSettingsForm): ChatSettingsDraft {
  return {
    defaults: {
      ...form.defaults,
      temperature: Number(form.defaults.temperature) || 0.7,
      max_output_tokens: Number(form.defaults.max_output_tokens) || 512,
      silence_timeout_ms: Number(form.defaults.silence_timeout_ms) || 1200,
      max_turn_seconds: Number(form.defaults.max_turn_seconds) || 45,
    },
    openai_compatible: {
      base_url: form.openai_compatible.base_url || '',
      api_key: form.openai_compatible.api_key,
      model: form.openai_compatible.model,
      api_mode: form.openai_compatible.api_mode ?? null,
    },
    gemini: {
      base_url: form.gemini.base_url || '',
      api_key: form.gemini.api_key,
      model: form.gemini.model,
      api_mode: null,
    },
    anthropic: {
      base_url: form.anthropic.base_url || '',
      api_key: form.anthropic.api_key,
      model: form.anthropic.model,
      api_mode: null,
    },
  }
}

function getProviderConfig(settings: ChatSettingsForm, provider: ProviderId): ProviderSettingsForm {
  return settings[provider]
}

export default function ChatPage() {
  const { success, error: showError } = useToast()
  const [settings, setSettings] = useState<ChatSettingsForm | null>(null)
  const [isLoadingSettings, setIsLoadingSettings] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [isTestingProvider, setIsTestingProvider] = useState(false)
  const [providerTab, setProviderTab] = useState<ProviderId>('openai_compatible')
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [status, setStatus] = useState<ConversationStatus>('idle')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [currentTranscript, setCurrentTranscript] = useState('')
  const [currentAssistantText, setCurrentAssistantText] = useState('')

  const socketRef = useRef<WebSocket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const captureRef = useRef<AudioCapture | null>(null)
  const chatPlayerRef = useRef<StreamAudioPlayer | null>(null)

  const currentProviderConfig = useMemo(
    () => (settings ? getProviderConfig(settings, providerTab) : null),
    [providerTab, settings],
  )

  const displayStatus: ConversationStatus = status === 'listening' && !isRecording ? 'idle' : status

  useEffect(() => {
    async function loadSettings() {
      try {
        const loaded = mapSettingsResponseToForm(await fetchChatSettings())
        setSettings(loaded)
        setProviderTab(loaded.defaults.active_provider)
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

  const addMessage = useCallback((message: Omit<ChatMessage, 'id'>) => {
    setMessages((prev) => [...prev, { ...message, id: createClientId('msg') }])
  }, [])

  const setProviderConfig = useCallback((provider: ProviderId, updater: (value: ProviderSettingsForm) => ProviderSettingsForm) => {
    setSettings((current) => {
      if (!current) return current
      return { ...current, [provider]: updater(current[provider]) }
    })
  }, [])

  const configureOpenSocket = useCallback((nextSettings: ChatSettingsForm) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'session.configure', settings: serializeSettings(nextSettings) }))
    }
  }, [])

  const stopPlayback = useCallback(async () => {
    await chatPlayerRef.current?.stop()
    chatPlayerRef.current = null
  }, [])

  const stopRecording = useCallback(async (commitTurn = false) => {
    await captureRef.current?.stop()
    captureRef.current = null
    setIsRecording(false)

    if (commitTurn && socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'turn.commit' }))
      setStatus('transcribing')
    }
  }, [])

  const disconnectSocket = useCallback(async () => {
    if (socketRef.current) {
      if (socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'session.close' }))
      }
      socketRef.current.close(1000)
      socketRef.current = null
    }
    await stopRecording(false)
    await stopPlayback()
    setIsConnected(false)
    setIsConnecting(false)
    setStatus('idle')
    setCurrentTranscript('')
    setCurrentAssistantText('')
  }, [stopPlayback, stopRecording])

  useEffect(() => () => {
    void disconnectSocket()
  }, [disconnectSocket])

  const handleServerEvent = useCallback(async (event: ConversationServerEvent) => {
    switch (event.type) {
      case 'session.ready': {
        const mappedSettings = mapSettingsResponseToForm(event.settings)
        setSettings(mappedSettings)
        setProviderTab(mappedSettings.defaults.active_provider)
        break
      }
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
      case 'tts.audio_chunk':
        if (!chatPlayerRef.current) {
          chatPlayerRef.current = new StreamAudioPlayer(0.35)
        }
        await chatPlayerRef.current.enqueueBase64Pcm16(event.pcm16_base64, event.sample_rate, {
          autoplay: true,
          forceStart: event.is_final_chunk,
        })
        break
      case 'assistant.complete':
        setCurrentAssistantText('')
        addMessage({ role: 'assistant', text: event.text })
        setStatus('idle')
        break
      case 'error':
        showError(event.detail)
        setStatus('idle')
        setIsRecording(false)
        break
      case 'llm.sentence':
      case 'tts.segment_start':
      case 'tts.segment_complete':
      case 'perf.metric':
        break
    }
  }, [addMessage, showError])

  const connectSocket = useCallback(async () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) return
    if (!settings) {
      showError(t('chat.error.loadSettings'))
      return
    }

    setIsConnecting(true)

    try {
      const socket = createConversationSocket()
      socket.onopen = () => {
        setIsConnected(true)
        setIsConnecting(false)
        socket.send(JSON.stringify({ type: 'session.configure', settings: serializeSettings(settings) }))
        success(t('toast.voiceChatConnected'))
      }
      socket.onclose = (event) => {
        setIsConnected(false)
        setIsConnecting(false)
        setIsRecording(false)
        setStatus('idle')
        socketRef.current = null
        if (event.code !== 1000) showError(t('chat.error.connectionClosed', { code: event.code }))
      }
      socket.onerror = () => {
        setIsConnected(false)
        setIsConnecting(false)
        setIsRecording(false)
        showError(t('chat.error.connect'))
      }
      socket.onmessage = (event) => {
        try {
          void handleServerEvent(JSON.parse(event.data))
        } catch (err) {
          console.error('Failed to parse server event:', err)
        }
      }
      socketRef.current = socket
    } catch {
      setIsConnecting(false)
      showError(t('chat.error.establishConnection'))
    }
  }, [handleServerEvent, settings, showError, success])

  const startRecording = async () => {
    if (!settings || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return

    try {
      await stopPlayback()
      socketRef.current.send(JSON.stringify({ type: 'assistant.stop' }))
      const capture = new AudioCapture()
      captureRef.current = capture
      setIsRecording(true)
      setStatus('listening')

      await capture.start({
        targetSampleRate: 16000,
        chunkDurationMs: 250,
        onChunk: ({ pcm16Base64, sampleRate }) => {
          const socket = socketRef.current
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'audio.append', pcm16_base64: pcm16Base64, sample_rate: sampleRate }))
          }
        },
      })
    } catch {
      setIsRecording(false)
      captureRef.current = null
      showError(t('error.startMicrophoneFailed'))
    }
  }

  const handleToggleRecording = () => {
    if (isRecording) {
      void stopRecording(true)
      return
    }

    if (isConnected && (displayStatus === 'idle' || displayStatus === 'listening')) {
      void startRecording()
    }
  }

  const handleSendText = async () => {
    const cleaned = inputText.trim()
    if (!cleaned || !isConnected) return
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      await stopPlayback()
      socketRef.current.send(JSON.stringify({ type: 'text.submit', text: cleaned }))
      addMessage({ role: 'user', text: cleaned })
      setInputText('')
      setStatus('thinking')
    }
  }

  const handleSaveSettings = async () => {
    if (!settings) return
    setIsSavingSettings(true)
    try {
      const saved = mapSettingsResponseToForm(await saveChatSettings(serializeSettings(settings)))
      setSettings(saved)
      setProviderTab(saved.defaults.active_provider)
      configureOpenSocket(saved)
      success(t('toast.settingsSaved'))
    } catch (err) {
      showError(err instanceof Error ? err.message : t('error.saveSettingsFailed'))
    } finally {
      setIsSavingSettings(false)
    }
  }

  const handleProviderTest = async () => {
    if (!settings || !currentProviderConfig) return
    setIsTestingProvider(true)
    try {
      const result = await testChatProvider(providerTab, {
        base_url: currentProviderConfig.base_url,
        api_key: currentProviderConfig.api_key,
        model: currentProviderConfig.model,
        api_mode: providerTab === 'openai_compatible' ? currentProviderConfig.api_mode ?? null : null,
      })

      if (result.success) {
        if (providerTab === 'openai_compatible' && result.api_mode) {
          setProviderConfig(providerTab, (current) => ({ ...current, api_mode: result.api_mode }))
        }
        success(t('toast.providerConnectionOk', { latency: result.latency_ms ?? 0 }))
      } else {
        showError(result.error ?? t('error.providerTestFailed'))
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : t('error.providerTestFailed'))
    } finally {
      setIsTestingProvider(false)
    }
  }

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
          {showSettings && settings && currentProviderConfig && (
            <div className="settings-panel" id="chat-settings-panel">
              <Card>
                <CardHeader>
                  <h3>{t('chat.settings.title')}</h3>
                </CardHeader>
                <CardBody>
                  <div className="provider-tabs" role="tablist" aria-label={t('section.provider')}>
                    {PROVIDERS.map((provider) => (
                      <button
                        key={provider}
                        type="button"
                        className={`provider-tab ${providerTab === provider ? 'provider-tab-active' : ''}`}
                        role="tab"
                        aria-selected={providerTab === provider}
                        onClick={() => {
                          setProviderTab(provider)
                          setSettings((current) =>
                            current
                              ? { ...current, defaults: { ...current.defaults, active_provider: provider } }
                              : current,
                          )
                        }}
                      >
                        {t(`provider.${provider}`)}
                      </button>
                    ))}
                  </div>

                  <div className="settings-grid settings-section">
                    <Input
                      label={t('field.baseUrl')}
                      value={currentProviderConfig.base_url}
                      onChange={(event) =>
                        setProviderConfig(providerTab, (current) => ({ ...current, base_url: event.target.value }))
                      }
                    />
                    <Input
                      label={t('field.apiKey')}
                      type="password"
                      value={currentProviderConfig.api_key}
                      placeholder={
                        currentProviderConfig.has_api_key
                          ? currentProviderConfig.masked_api_key ?? t('placeholder.apiKeySaved')
                          : t('placeholder.apiKeyEnter')
                      }
                      onChange={(event) =>
                        setProviderConfig(providerTab, (current) => ({ ...current, api_key: event.target.value }))
                      }
                    />
                    <Input
                      label={t('field.model')}
                      value={currentProviderConfig.model}
                      onChange={(event) =>
                        setProviderConfig(providerTab, (current) => ({ ...current, model: event.target.value }))
                      }
                    />
                    {providerTab === 'openai_compatible' && currentProviderConfig.api_mode ? (
                      <p className="settings-hint settings-full-width">
                        {t('hint.detectedApiMode', { mode: currentProviderConfig.api_mode })}
                      </p>
                    ) : null}
                  </div>

                  <div className="settings-grid settings-section">
                    <Select
                      label={t('field.activeProvider')}
                      value={settings.defaults.active_provider}
                      onChange={(event) => {
                        const nextProvider = event.target.value as ProviderId
                        setProviderTab(nextProvider)
                        setSettings((current) =>
                          current
                            ? { ...current, defaults: { ...current.defaults, active_provider: nextProvider } }
                            : current,
                        )
                      }}
                      options={PROVIDERS.map((provider) => ({ value: provider, label: t(`provider.${provider}`) }))}
                    />
                    <Input
                      label={t('field.temperature')}
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={settings.defaults.temperature}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? { ...current, defaults: { ...current.defaults, temperature: Number(event.target.value) } }
                            : current,
                        )
                      }
                    />
                    <Input
                      label={t('field.maxOutputTokens')}
                      type="number"
                      min="64"
                      max="8192"
                      step="1"
                      value={settings.defaults.max_output_tokens}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? { ...current, defaults: { ...current.defaults, max_output_tokens: Number(event.target.value) } }
                            : current,
                        )
                      }
                    />
                    <Textarea
                      label={t('field.systemPrompt')}
                      value={settings.defaults.system_prompt}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? { ...current, defaults: { ...current.defaults, system_prompt: event.target.value } }
                            : current,
                        )
                      }
                      className="settings-full-width"
                      rows={4}
                    />
                  </div>

                  <div className="settings-grid settings-section">
                    <Input
                      label={t('field.asrModel')}
                      value={settings.defaults.asr_model}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? { ...current, defaults: { ...current.defaults, asr_model: event.target.value } }
                            : current,
                        )
                      }
                    />
                    <Input
                      label={t('field.language')}
                      value={settings.defaults.asr_language}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? { ...current, defaults: { ...current.defaults, asr_language: event.target.value } }
                            : current,
                        )
                      }
                    />
                    <Input
                      label={t('field.silenceTimeoutMs')}
                      type="number"
                      min="300"
                      max="6000"
                      value={settings.defaults.silence_timeout_ms}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? { ...current, defaults: { ...current.defaults, silence_timeout_ms: Number(event.target.value) } }
                            : current,
                        )
                      }
                    />
                    <Input
                      label={t('field.maxTurnSeconds')}
                      type="number"
                      min="5"
                      max="600"
                      value={settings.defaults.max_turn_seconds}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? { ...current, defaults: { ...current.defaults, max_turn_seconds: Number(event.target.value) } }
                            : current,
                        )
                      }
                    />
                    <label className="chat-checkbox settings-full-width">
                      <input
                        type="checkbox"
                        checked={settings.defaults.live_captions}
                        onChange={(event) =>
                          setSettings((current) =>
                            current
                              ? { ...current, defaults: { ...current.defaults, live_captions: event.target.checked } }
                              : current,
                          )
                        }
                      />
                      <span>{t('toggle.liveCaptions')}</span>
                    </label>
                  </div>

                  <div className="settings-actions">
                    <Button variant="secondary" onClick={() => void handleProviderTest()} isLoading={isTestingProvider}>
                      {t('button.testConnection')}
                    </Button>
                    <Button variant="primary" onClick={() => void handleSaveSettings()} isLoading={isSavingSettings}>
                      {t('button.saveSettings')}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </div>
          )}

          <div className="chat-main">
            <div className="status-bar" role="status" aria-live="polite">
              <div className="status-indicator">
                <span
                  className="status-dot"
                  data-status={isConnected ? displayStatus : 'disconnected'}
                  style={{ backgroundColor: isConnected ? STATUS_COLORS[displayStatus] : 'var(--color-gray-500)' }}
                  aria-hidden="true"
                />
                <div className="status-label">
                  <span className="status-badge">{t('chat.status.label')}</span>
                  <span className="status-text" data-status={isConnected ? displayStatus : 'disconnected'}>
                    {isConnected ? t(STATUS_LABELS[displayStatus]) : t('chat.status.disconnected')}
                  </span>
                </div>
              </div>
              <div className="status-bar-actions">
                {!isConnected ? (
                  <Button variant="primary" onClick={connectSocket} isLoading={isConnecting}>
                    {t('chat.connect')}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => void disconnectSocket()}>
                    {t('chat.disconnect')}
                  </Button>
                )}
              </div>
            </div>

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

            <div className="input-area">
              <button
                type="button"
                className={`mic-button ${isRecording ? 'mic-button-active' : ''}`}
                onClick={handleToggleRecording}
                disabled={!isConnected || (!isRecording && displayStatus !== 'idle')}
                aria-label={isRecording ? t('chat.record.stopAria') : t('chat.record.startAria')}
                aria-pressed={isRecording}
              >
                {isRecording ? t('chat.record.stop') : t('chat.record.talk')}
              </button>

              <div className="text-input-wrapper">
                <input
                  type="text"
                  value={inputText}
                  onChange={(event) => setInputText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void handleSendText()
                    }
                  }}
                  placeholder={t('placeholder.typedMessage')}
                  disabled={!isConnected}
                  className="form-input"
                  aria-label={t('placeholder.typedMessage')}
                />
              </div>

              <div className="input-actions">
                <Button variant="primary" onClick={() => void handleSendText()} disabled={!isConnected || !inputText.trim()}>
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
