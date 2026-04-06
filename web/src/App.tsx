import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import { AudioCapture } from './audioCapture'
import {
  createReplyVoiceCloneProfile,
  createConversationSocket,
  fetchCapabilities,
  fetchChatSettings,
  fetchHealth,
  generateRun,
  generateRunStream,
  saveChatSettings,
  testChatProvider,
  transcribeAsrFile,
} from './api'
import './App.css'
import { StreamAudioPlayer } from './streamAudioPlayer'
import type {
  AsrTranscriptionResponse,
  AudioClip,
  CapabilitiesResponse,
  ChatMessage,
  CloneVoiceProfileResponse,
  ChatSettingsDraft,
  ChatSettingsResponse,
  ConversationServerEvent,
  ConversationStatus,
  GenerationRun,
  HealthResponse,
  Mode,
  ProviderId,
  StreamRunEvent,
  StreamSettings,
  Workspace,
} from './types'

type StyleControls = {
  mood: string
  emotionIntensity: string
  pace: string
  energy: string
  expressiveness: string
}

type Segment = {
  id: string
  text: string
}

type CustomFormState = {
  language: string
  speaker: string
  instruct: string
  style: StyleControls
  segments: Segment[]
  generation: {
    temperature: string
    top_p: string
    max_new_tokens: string
    seed: string
  }
}

type DesignFormState = {
  language: string
  instruct: string
  style: StyleControls
  segments: Segment[]
  generation: {
    temperature: string
    top_p: string
    max_new_tokens: string
    seed: string
  }
}

type CloneFormState = {
  language: string
  refText: string
  xVectorOnlyMode: boolean
  referenceFile: File | null
  segments: Segment[]
  generation: {
    temperature: string
    top_p: string
    max_new_tokens: string
    seed: string
  }
}

type LiveSegmentState = {
  segmentIndex: number
  text: string
  sampleRate: number
  chunkCount: number
  bufferedSeconds: number
  status: 'queued' | 'streaming' | 'complete'
  clip?: AudioClip
}

type LiveStreamState = {
  status: 'idle' | 'streaming' | 'complete' | 'error'
  mode: Mode | null
  run: GenerationRun | null
  segments: LiveSegmentState[]
  chunksReceived: number
  bufferedSeconds: number
  playbackStarted: boolean
  message: string
}

type ChatSettingsForm = {
  defaults: {
    activeProvider: ProviderId
    systemPrompt: string
    temperature: string
    maxOutputTokens: string
    asrModel: string
    asrLanguage: string
    silenceTimeoutMs: string
    maxTurnSeconds: string
    liveCaptions: boolean
    replyVoice: {
      mode: 'custom' | 'design' | 'clone'
      language: string
      speaker: string
      instruct: string
      style: StyleControls
      cloneProfileId: string
      cloneProfileLabel: string
      cloneAudioPath: string
      cloneReferenceText: string
      cloneEmbeddingPath: string
    }
  }
  openaiCompatible: {
    baseUrl: string
    apiKey: string
    model: string
    apiMode?: 'responses' | 'chat_completions' | null
    hasApiKey?: boolean
    maskedApiKey?: string | null
  }
  gemini: {
    baseUrl: string
    apiKey: string
    model: string
    apiMode?: 'responses' | 'chat_completions' | null
    hasApiKey?: boolean
    maskedApiKey?: string | null
  }
  anthropic: {
    baseUrl: string
    apiKey: string
    model: string
    apiMode?: 'responses' | 'chat_completions' | null
    hasApiKey?: boolean
    maskedApiKey?: string | null
  }
}

type ReplyVoiceCloneDraft = {
  file: File | null
  label: string
  referenceText: string
  pending: boolean
  preparedProfile: CloneVoiceProfileResponse | null
}

type ToastTone = 'success' | 'error'

type Toast = {
  id: string
  tone: ToastTone
  message: string
}

type SettingsSectionId = 'provider' | 'conversation' | 'asr' | 'replyVoice'

const MOOD_OPTIONS = [
  { id: 'neutral', label: 'Neutral', prompt: 'Keep the emotional tone neutral, composed, and matter-of-fact.' },
  { id: 'calm', label: 'Calm', prompt: 'Sound calm, relaxed, and emotionally steady.' },
  { id: 'warm', label: 'Warm', prompt: 'Sound warm, friendly, and reassuring.' },
  { id: 'happy', label: 'Happy', prompt: 'Sound lightly happy and upbeat without becoming cartoonish.' },
  { id: 'confident', label: 'Confident', prompt: 'Sound confident, assured, and articulate.' },
  { id: 'serious', label: 'Serious', prompt: 'Sound serious, focused, and professional.' },
  { id: 'empathetic', label: 'Empathetic', prompt: 'Sound empathetic and caring while staying controlled.' },
  { id: 'sad', label: 'Sad', prompt: 'Sound gently sad and reflective without audible crying.' },
]

const EMOTION_INTENSITY_OPTIONS = [
  { id: 'restrained', label: 'Restrained', prompt: 'Keep emotional expression restrained and subtle.' },
  { id: 'balanced', label: 'Balanced', prompt: 'Use moderate emotional expression with natural variation.' },
  { id: 'expressive', label: 'Expressive', prompt: 'Allow stronger emotional expression when the text supports it.' },
]

const PACE_OPTIONS = [
  { id: 'slower', label: 'Slower', prompt: 'Use a slightly slower speaking pace with clear phrasing.' },
  { id: 'steady', label: 'Steady', prompt: 'Maintain a steady, natural speaking pace.' },
  { id: 'faster', label: 'Faster', prompt: 'Use a slightly quicker pace while staying intelligible.' },
]

const ENERGY_OPTIONS = [
  { id: 'soft', label: 'Soft', prompt: 'Keep the vocal energy soft and low-pressure.' },
  { id: 'balanced', label: 'Balanced', prompt: 'Use balanced vocal energy with a natural conversational lift.' },
  { id: 'high', label: 'High', prompt: 'Use stronger vocal energy and clearer emphasis.' },
]

const EXPRESSIVENESS_OPTIONS = [
  { id: 'controlled', label: 'Controlled', prompt: 'Keep prosody controlled with limited melodrama.' },
  { id: 'natural', label: 'Natural', prompt: 'Use natural prosodic variation and human-like emphasis.' },
  { id: 'dramatic', label: 'Dramatic', prompt: 'Allow broader pitch movement and more dramatic phrasing.' },
]

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`
}

function makeSegment(text = ''): Segment {
  return { id: makeId(), text }
}

function makeStyleControls(): StyleControls {
  return {
    mood: 'neutral',
    emotionIntensity: 'restrained',
    pace: 'steady',
    energy: 'balanced',
    expressiveness: 'controlled',
  }
}

function makeLiveStreamState(): LiveStreamState {
  return {
    status: 'idle',
    mode: null,
    run: null,
    segments: [],
    chunksReceived: 0,
    bufferedSeconds: 0,
    playbackStarted: false,
    message: '',
  }
}

function compactGenerationSettings(values: Record<string, string>) {
  return Object.entries(values).reduce<Record<string, number>>((accumulator, [key, value]) => {
    if (!value.trim()) {
      return accumulator
    }

    const parsed = Number(value)
    if (!Number.isNaN(parsed)) {
      accumulator[key] = parsed
    }
    return accumulator
  }, {})
}

function formatTimestamp(isoTimestamp: string) {
  return new Date(isoTimestamp).toLocaleString()
}

function buildWaveformBars(seed: string) {
  const bars: number[] = []
  let value = 0
  for (const character of seed) {
    value += character.charCodeAt(0)
  }
  for (let index = 0; index < 28; index += 1) {
    value = (value * 1664525 + 1013904223) % 4294967296
    bars.push(18 + (value % 44))
  }
  return bars
}

function optionPrompt(options: Array<{ id: string; prompt: string }>, id: string) {
  return options.find((option) => option.id === id)?.prompt ?? ''
}

function composeInstruction(baseInstruction: string, style: StyleControls, mode: 'custom' | 'design') {
  const guidance = [
    mode === 'custom' ? 'Preserve the core identity of the selected preset speaker.' : '',
    optionPrompt(MOOD_OPTIONS, style.mood),
    optionPrompt(EMOTION_INTENSITY_OPTIONS, style.emotionIntensity),
    optionPrompt(PACE_OPTIONS, style.pace),
    optionPrompt(ENERGY_OPTIONS, style.energy),
    optionPrompt(EXPRESSIVENESS_OPTIONS, style.expressiveness),
  ].filter(Boolean)

  if (
    style.mood !== 'sad' &&
    (style.emotionIntensity === 'restrained' || style.expressiveness === 'controlled')
  ) {
    guidance.push(
      'Avoid exaggerated sadness, trembling, sobbing, or a crying delivery unless the text explicitly asks for it.',
    )
  }

  const customGuidance = baseInstruction.trim()
  if (customGuidance) {
    guidance.push(`Additional guidance: ${customGuidance}`)
  }

  return guidance.join(' ')
}

function mapSettingsResponseToForm(response: ChatSettingsResponse): ChatSettingsForm {
  return {
    defaults: {
      activeProvider: response.defaults.active_provider,
      systemPrompt: response.defaults.system_prompt,
      temperature: String(response.defaults.temperature),
      maxOutputTokens: String(response.defaults.max_output_tokens),
      asrModel: response.defaults.asr_model,
      asrLanguage: response.defaults.asr_language,
      silenceTimeoutMs: String(response.defaults.silence_timeout_ms),
      maxTurnSeconds: String(response.defaults.max_turn_seconds),
      liveCaptions: response.defaults.live_captions,
      replyVoice: {
        mode: response.defaults.reply_voice.mode,
        language: response.defaults.reply_voice.language,
        speaker: response.defaults.reply_voice.speaker,
        instruct: response.defaults.reply_voice.instruct,
        cloneProfileId: response.defaults.reply_voice.clone_profile_id ?? '',
        cloneProfileLabel: response.defaults.reply_voice.clone_profile_label ?? '',
        cloneAudioPath: response.defaults.reply_voice.clone_audio_path ?? '',
        cloneReferenceText: response.defaults.reply_voice.clone_reference_text ?? '',
        cloneEmbeddingPath: response.defaults.reply_voice.clone_embedding_path ?? '',
        style: {
          mood: response.defaults.reply_voice.style.mood,
          emotionIntensity: response.defaults.reply_voice.style.emotion_intensity,
          pace: response.defaults.reply_voice.style.pace,
          energy: response.defaults.reply_voice.style.energy,
          expressiveness: response.defaults.reply_voice.style.expressiveness,
        },
      },
    },
    openaiCompatible: {
      baseUrl: response.openai_compatible.base_url ?? '',
      apiKey: '',
      model: response.openai_compatible.model,
      apiMode: response.openai_compatible.api_mode,
      hasApiKey: response.openai_compatible.has_api_key,
      maskedApiKey: response.openai_compatible.masked_api_key,
    },
    gemini: {
      baseUrl: response.gemini.base_url ?? '',
      apiKey: '',
      model: response.gemini.model,
      apiMode: null,
      hasApiKey: response.gemini.has_api_key,
      maskedApiKey: response.gemini.masked_api_key,
    },
    anthropic: {
      baseUrl: response.anthropic.base_url ?? '',
      apiKey: '',
      model: response.anthropic.model,
      apiMode: null,
      hasApiKey: response.anthropic.has_api_key,
      maskedApiKey: response.anthropic.masked_api_key,
    },
  }
}

function serializeSettings(form: ChatSettingsForm): ChatSettingsDraft {
  return {
    defaults: {
      active_provider: form.defaults.activeProvider,
      system_prompt: form.defaults.systemPrompt,
      temperature: Number(form.defaults.temperature) || 0.7,
      max_output_tokens: Number(form.defaults.maxOutputTokens) || 512,
      asr_model: form.defaults.asrModel,
      asr_language: form.defaults.asrLanguage,
      silence_timeout_ms: Number(form.defaults.silenceTimeoutMs) || 1200,
      max_turn_seconds: Number(form.defaults.maxTurnSeconds) || 45,
      live_captions: form.defaults.liveCaptions,
      reply_voice: {
        mode: form.defaults.replyVoice.mode,
        language: form.defaults.replyVoice.language,
        speaker: form.defaults.replyVoice.speaker,
        instruct: form.defaults.replyVoice.instruct,
        clone_profile_id: form.defaults.replyVoice.cloneProfileId || null,
        clone_profile_label: form.defaults.replyVoice.cloneProfileLabel || null,
        clone_audio_path: form.defaults.replyVoice.cloneAudioPath || null,
        clone_reference_text: form.defaults.replyVoice.cloneReferenceText || null,
        clone_embedding_path: form.defaults.replyVoice.cloneEmbeddingPath || null,
        style: {
          mood: form.defaults.replyVoice.style.mood,
          emotion_intensity: form.defaults.replyVoice.style.emotionIntensity,
          pace: form.defaults.replyVoice.style.pace,
          energy: form.defaults.replyVoice.style.energy,
          expressiveness: form.defaults.replyVoice.style.expressiveness,
        },
      },
    },
    openai_compatible: {
      base_url: form.openaiCompatible.baseUrl || '',
      api_key: form.openaiCompatible.apiKey,
      model: form.openaiCompatible.model,
      api_mode: form.openaiCompatible.apiMode ?? null,
    },
    gemini: {
      base_url: form.gemini.baseUrl || '',
      api_key: form.gemini.apiKey,
      model: form.gemini.model,
    },
    anthropic: {
      base_url: form.anthropic.baseUrl || '',
      api_key: form.anthropic.apiKey,
      model: form.anthropic.model,
    },
  }
}

function emptyChatSettings(defaultAsrModel = ''): ChatSettingsForm {
  return {
    defaults: {
      activeProvider: 'openai_compatible',
      systemPrompt: 'You are a concise, helpful voice assistant.',
      temperature: '0.7',
      maxOutputTokens: '512',
      asrModel: defaultAsrModel,
      asrLanguage: 'Auto',
      silenceTimeoutMs: '1200',
      maxTurnSeconds: '45',
      liveCaptions: true,
      replyVoice: {
        mode: 'custom',
        language: 'English',
        speaker: 'Ryan',
        instruct: '',
        cloneProfileId: '',
        cloneProfileLabel: '',
        cloneAudioPath: '',
        cloneReferenceText: '',
        cloneEmbeddingPath: '',
        style: makeStyleControls(),
      },
    },
    openaiCompatible: { baseUrl: '', apiKey: '', model: '', apiMode: null },
    gemini: { baseUrl: '', apiKey: '', model: '', apiMode: null },
    anthropic: { baseUrl: '', apiKey: '', model: '', apiMode: null },
  }
}

function clearPreparedReplyVoice(replyVoice: ChatSettingsForm['defaults']['replyVoice']) {
  return {
    ...replyVoice,
    cloneProfileId: '',
    cloneProfileLabel: '',
    cloneAudioPath: '',
    cloneReferenceText: '',
    cloneEmbeddingPath: '',
  }
}

function App() {
  const [workspace, setWorkspace] = useState<Workspace>('tts')
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [chatSettings, setChatSettings] = useState<ChatSettingsForm>(emptyChatSettings())
  const [providerTab, setProviderTab] = useState<ProviderId>('openai_compatible')
  const [mode, setMode] = useState<Mode>('custom')
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runs, setRuns] = useState<GenerationRun[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [customForm, setCustomForm] = useState<CustomFormState>({
    language: 'English',
    speaker: 'Ryan',
    instruct: '',
    style: makeStyleControls(),
    segments: [makeSegment()],
    generation: { temperature: '', top_p: '', max_new_tokens: '', seed: '' },
  })
  const [designForm, setDesignForm] = useState<DesignFormState>({
    language: 'English',
    instruct: '',
    style: makeStyleControls(),
    segments: [makeSegment()],
    generation: { temperature: '', top_p: '', max_new_tokens: '', seed: '' },
  })
  const [cloneForm, setCloneForm] = useState<CloneFormState>({
    language: 'Auto',
    refText: '',
    xVectorOnlyMode: false,
    referenceFile: null,
    segments: [makeSegment()],
    generation: { temperature: '', top_p: '', max_new_tokens: '', seed: '' },
  })
  const [streamSettings, setStreamSettings] = useState<StreamSettings>({
    enabled: false,
    autoplay: true,
    streamingInterval: '0.32',
  })
  const [liveStream, setLiveStream] = useState<LiveStreamState>(makeLiveStreamState())
  const [conversationStatus, setConversationStatus] = useState<ConversationStatus>('idle')
  const [conversationMessages, setConversationMessages] = useState<ChatMessage[]>([])
  const [liveCaption, setLiveCaption] = useState('')
  const [typedMessage, setTypedMessage] = useState('')
  const [fileUpload, setFileUpload] = useState<File | null>(null)
  const [fileTranscript, setFileTranscript] = useState<AsrTranscriptionResponse | null>(null)
  const [fileSendToChat, setFileSendToChat] = useState(false)
  const [replyVoiceCloneDraft, setReplyVoiceCloneDraft] = useState<ReplyVoiceCloneDraft>({
    file: null,
    label: '',
    referenceText: '',
    pending: false,
    preparedProfile: null,
  })
  const [micActive, setMicActive] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(430)
  const [collapsedSections, setCollapsedSections] = useState<Record<SettingsSectionId, boolean>>({
    provider: false,
    conversation: false,
    asr: false,
    replyVoice: false,
  })
  const [toasts, setToasts] = useState<Toast[]>([])

  const shellRef = useRef<HTMLElement | null>(null)
  const playerRef = useRef<StreamAudioPlayer | null>(null)
  const chatPlayerRef = useRef<StreamAudioPlayer | null>(null)
  const captureRef = useRef<AudioCapture | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const socketPromiseRef = useRef<Promise<WebSocket> | null>(null)
  const toastTimeoutsRef = useRef<Map<string, number>>(new Map())
  const sessionReadySeenRef = useRef(false)
  const listeningEnabledRef = useRef(false)
  const speechDetectedRef = useRef(false)
  const silenceStartedAtRef = useRef<number | null>(null)
  const speechStartedAtRef = useRef<number | null>(null)

  useEffect(() => {
    let alive = true

    async function loadBootData() {
      try {
        const [capabilitiesResponse, healthResponse, chatSettingsResponse] = await Promise.all([
          fetchCapabilities(),
          fetchHealth(),
          fetchChatSettings(),
        ])

        if (!alive) {
          return
        }

        setCapabilities(capabilitiesResponse)
        setHealth(healthResponse)
        const mappedSettings = mapSettingsResponseToForm(chatSettingsResponse)
        setChatSettings(mappedSettings)
        setProviderTab(mappedSettings.defaults.activeProvider)

        setCustomForm((current) => ({
          ...current,
          language: capabilitiesResponse.languages.includes(current.language)
            ? current.language
            : capabilitiesResponse.languages[0],
          speaker: capabilitiesResponse.speakers.some((speaker) => speaker.id === current.speaker)
            ? current.speaker
            : (capabilitiesResponse.speakers[0]?.id ?? ''),
        }))
        setDesignForm((current) => ({
          ...current,
          language: capabilitiesResponse.languages.includes(current.language)
            ? current.language
            : capabilitiesResponse.languages[0],
        }))
        setCloneForm((current) => ({
          ...current,
          language: capabilitiesResponse.languages.includes(current.language)
            ? current.language
            : capabilitiesResponse.languages[0],
        }))
      } catch (loadError) {
        if (alive) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to reach the local API.')
        }
      } finally {
        if (alive) {
          setLoading(false)
        }
      }
    }

    void loadBootData()

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    return () => {
      void playerRef.current?.stop()
      void chatPlayerRef.current?.stop()
      void captureRef.current?.stop()
      socketRef.current?.close()
      for (const timeoutId of toastTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId)
      }
      toastTimeoutsRef.current.clear()
    }
  }, [])

  useEffect(() => {
    const replyVoice = chatSettings.defaults.replyVoice
    if (replyVoice.cloneProfileId && replyVoice.cloneAudioPath) {
      setReplyVoiceCloneDraft((current) => ({
        ...current,
        label: current.label || replyVoice.cloneProfileLabel,
        referenceText: current.referenceText || replyVoice.cloneReferenceText,
        preparedProfile: {
          id: replyVoice.cloneProfileId,
          label: replyVoice.cloneProfileLabel,
          language: replyVoice.language,
          reference_text: replyVoice.cloneReferenceText,
          audio_file_name: replyVoice.cloneAudioPath.split('/').pop() ?? 'reference.wav',
          audio_path: replyVoice.cloneAudioPath,
          speaker_embedding_path: replyVoice.cloneEmbeddingPath || null,
          created_at: new Date().toISOString(),
        },
      }))
      return
    }

    setReplyVoiceCloneDraft((current) => ({
      ...current,
      preparedProfile: null,
    }))
  }, [
    chatSettings.defaults.replyVoice.cloneAudioPath,
    chatSettings.defaults.replyVoice.cloneEmbeddingPath,
    chatSettings.defaults.replyVoice.cloneProfileId,
    chatSettings.defaults.replyVoice.cloneProfileLabel,
    chatSettings.defaults.replyVoice.cloneReferenceText,
    chatSettings.defaults.replyVoice.language,
  ])

  const activeRun = runs.find((run) => run.run_id === activeRunId) ?? runs[0] ?? null
  const modeMeta = capabilities?.modes.find((item) => item.id === mode)
  const currentProviderConfig = useMemo(() => {
    if (providerTab === 'openai_compatible') {
      return chatSettings.openaiCompatible
    }
    if (providerTab === 'gemini') {
      return chatSettings.gemini
    }
    return chatSettings.anthropic
  }, [chatSettings, providerTab])

  const shellStyle = useMemo(
    () => ({ '--sidebar-width': `${sidebarWidth}px` }) as CSSProperties,
    [sidebarWidth],
  )

  function dismissToast(toastId: string) {
    const timeoutId = toastTimeoutsRef.current.get(toastId)
    if (timeoutId) {
      window.clearTimeout(timeoutId)
      toastTimeoutsRef.current.delete(toastId)
    }
    setToasts((current) => current.filter((toast) => toast.id !== toastId))
  }

  function pushToast(tone: ToastTone, message: string) {
    const id = makeId()
    setToasts((current) => [...current, { id, tone, message }])
    const timeoutId = window.setTimeout(() => {
      toastTimeoutsRef.current.delete(id)
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 4200)
    toastTimeoutsRef.current.set(id, timeoutId)
  }

  function toggleSection(sectionId: SettingsSectionId) {
    setCollapsedSections((current) => ({ ...current, [sectionId]: !current[sectionId] }))
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (window.innerWidth <= 1180) {
      return
    }
    event.preventDefault()
    const shellBounds = shellRef.current?.getBoundingClientRect()
    if (!shellBounds) {
      return
    }

    const minWidth = 360
    const maxWidth = Math.max(
      minWidth,
      Math.min(shellBounds.width * 0.72, shellBounds.width - 380),
    )

    const handleMove = (moveEvent: PointerEvent) => {
      const proposedWidth = moveEvent.clientX - shellBounds.left - 4
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, proposedWidth))
      setSidebarWidth(nextWidth)
    }

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      document.body.classList.remove('is-resizing')
    }

    document.body.classList.add('is-resizing')
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp, { once: true })
  }

  function updateSegments(targetMode: Mode, updater: (segments: Segment[]) => Segment[]) {
    if (targetMode === 'custom') {
      setCustomForm((current) => ({ ...current, segments: updater(current.segments) }))
      return
    }
    if (targetMode === 'design') {
      setDesignForm((current) => ({ ...current, segments: updater(current.segments) }))
      return
    }
    setCloneForm((current) => ({ ...current, segments: updater(current.segments) }))
  }

  function addSegment() {
    updateSegments(mode, (segments) => [...segments, makeSegment()])
  }

  function removeSegment(segmentId: string) {
    updateSegments(mode, (segments) => (segments.length === 1 ? segments : segments.filter((segment) => segment.id !== segmentId)))
  }

  function updateSegment(segmentId: string, value: string) {
    updateSegments(mode, (segments) =>
      segments.map((segment) => (segment.id === segmentId ? { ...segment, text: value } : segment)),
    )
  }

  function getStreamingInterval() {
    const parsed = Number(streamSettings.streamingInterval)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.32
  }

  async function stopLivePlayback() {
    if (playerRef.current) {
      await playerRef.current.stop()
      playerRef.current = null
    }
    setLiveStream((current) => ({ ...current, playbackStarted: false }))
  }

  async function startLivePlayback() {
    if (!playerRef.current) {
      playerRef.current = new StreamAudioPlayer()
    }
    await playerRef.current.start()
    setLiveStream((current) => ({ ...current, playbackStarted: true }))
  }

  async function refreshHealth() {
    try {
      setHealth(await fetchHealth())
    } catch {
      // Ignore transient refresh failures after generation.
    }
  }

  function upsertAssistantDraft(text: string, state: 'draft' | 'final') {
    setConversationMessages((current) => {
      const last = current[current.length - 1]
      if (last?.role === 'assistant') {
        return [...current.slice(0, -1), { ...last, text, state }]
      }
      return [...current, { id: makeId(), role: 'assistant', text, state }]
    })
  }

  function setProviderConfig(provider: ProviderId, updater: (value: ChatSettingsForm[typeof provider extends never ? never : 'openaiCompatible']) => object) {
    setChatSettings((current) => {
      if (provider === 'openai_compatible') {
        return { ...current, openaiCompatible: updater(current.openaiCompatible) as ChatSettingsForm['openaiCompatible'] }
      }
      if (provider === 'gemini') {
        return { ...current, gemini: updater(current.gemini) as ChatSettingsForm['gemini'] }
      }
      return { ...current, anthropic: updater(current.anthropic) as ChatSettingsForm['anthropic'] }
    })
  }

  async function ensureConversationSocket(settingsOverride?: ChatSettingsForm) {
    const effectiveSettings = settingsOverride ?? chatSettings

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({ type: 'session.configure', settings: serializeSettings(effectiveSettings) }),
      )
      return socketRef.current
    }

    if (socketPromiseRef.current) {
      return socketPromiseRef.current
    }

    const socketPromise = new Promise<WebSocket>((resolve, reject) => {
      const socket = createConversationSocket()
      socketRef.current = socket
      let settled = false
      const timeoutId = window.setTimeout(() => {
        if (settled) {
          return
        }
        settled = true
        socket.close()
        socketRef.current = null
        socketPromiseRef.current = null
        reject(new Error('Unable to connect to the conversation server. Check that the local API is running and refresh the page.'))
      }, 5000)

      const settleFailure = (message: string) => {
        if (settled) {
          return
        }
        settled = true
        window.clearTimeout(timeoutId)
        socketRef.current = null
        socketPromiseRef.current = null
        reject(new Error(message))
      }

      socket.onopen = () => {
        settled = true
        window.clearTimeout(timeoutId)
        socket.send(JSON.stringify({ type: 'session.configure', settings: serializeSettings(effectiveSettings) }))
        resolve(socket)
      }

      socket.onerror = () => {
        settleFailure('Unable to open the conversation socket. Check the local frontend proxy or backend websocket path.')
      }

      socket.onclose = (event) => {
        if (!settled) {
          settleFailure(
            event.code === 1006
              ? 'The conversation socket closed before it connected. Refresh the page and try again.'
              : `The conversation socket closed before it connected (code ${event.code}).`,
          )
          return
        }
        socketRef.current = null
        socketPromiseRef.current = null
        sessionReadySeenRef.current = false
        if (event.code !== 1000) {
          void captureRef.current?.stop()
          captureRef.current = null
          pushToast(
            'error',
            event.code === 1006
              ? 'The conversation socket dropped unexpectedly. Refresh the page and try again.'
              : `The conversation socket closed unexpectedly (code ${event.code}).`,
          )
          setConversationStatus('idle')
          setMicActive(false)
          listeningEnabledRef.current = false
        }
      }

      socket.onmessage = (messageEvent) => {
        const event = JSON.parse(String(messageEvent.data)) as ConversationServerEvent
        void handleConversationEvent(event)
      }
    })

    socketPromiseRef.current = socketPromise
    return socketPromise
  }

  async function prepareReplyVoiceClone(auto = false) {
    if (!replyVoiceCloneDraft.file) {
      throw new Error('Choose a reference voice clip before preparing the cloned reply voice.')
    }

    const profile = await createReplyVoiceCloneProfile({
      file: replyVoiceCloneDraft.file,
      language: chatSettings.defaults.replyVoice.language,
      label: replyVoiceCloneDraft.label || replyVoiceCloneDraft.file.name.replace(/\.[^.]+$/, ''),
      referenceText: replyVoiceCloneDraft.referenceText,
    })

    setReplyVoiceCloneDraft((current) => ({
      ...current,
      pending: false,
      preparedProfile: profile,
      referenceText: profile.reference_text,
      label: profile.label,
    }))

    const nextSettings: ChatSettingsForm = {
      ...chatSettings,
      defaults: {
        ...chatSettings.defaults,
        replyVoice: {
          ...chatSettings.defaults.replyVoice,
          mode: 'clone',
          cloneProfileId: profile.id,
          cloneProfileLabel: profile.label,
          cloneAudioPath: profile.audio_path,
          cloneReferenceText: profile.reference_text,
          cloneEmbeddingPath: profile.speaker_embedding_path ?? '',
          language: profile.language,
        },
      },
    }

    setChatSettings(nextSettings)
    pushToast('success', auto ? `Prepared cloned voice automatically: ${profile.label}.` : `Prepared cloned reply voice: ${profile.label}.`)
    return nextSettings
  }

  async function ensureReplyVoiceReady() {
    if (chatSettings.defaults.replyVoice.mode !== 'clone') {
      return chatSettings
    }

    if (
      chatSettings.defaults.replyVoice.cloneAudioPath &&
      chatSettings.defaults.replyVoice.cloneReferenceText &&
      chatSettings.defaults.replyVoice.cloneEmbeddingPath
    ) {
      return chatSettings
    }

    setReplyVoiceCloneDraft((current) => ({ ...current, pending: true }))
    try {
      return await prepareReplyVoiceClone(true)
    } catch (cloneError) {
      setReplyVoiceCloneDraft((current) => ({ ...current, pending: false }))
      throw cloneError
    }
  }

  async function handleConversationEvent(event: ConversationServerEvent) {
    if (event.type === 'session.ready') {
      const mappedSettings = mapSettingsResponseToForm(event.settings)
      setChatSettings(mappedSettings)
      setProviderTab(mappedSettings.defaults.activeProvider)
      if (!sessionReadySeenRef.current) {
        sessionReadySeenRef.current = true
        pushToast('success', 'Voice chat connected.')
      }
      return
    }

    if (event.type === 'asr.partial') {
      setLiveCaption(event.text)
      return
    }

    if (event.type === 'asr.final') {
      setLiveCaption('')
      setConversationMessages((current) => [
        ...current,
        { id: makeId(), role: 'user', text: event.text, state: 'final' },
      ])
      return
    }

    if (event.type === 'llm.status') {
      setConversationStatus(event.phase)
      if (event.phase === 'listening' && micActive) {
        listeningEnabledRef.current = true
        speechDetectedRef.current = false
        silenceStartedAtRef.current = null
        speechStartedAtRef.current = null
      }
      return
    }

    if (event.type === 'llm.delta') {
      upsertAssistantDraft(event.text, 'draft')
      return
    }

    if (event.type === 'assistant.complete') {
      upsertAssistantDraft(event.text, 'final')
      return
    }

    if (event.type === 'tts.audio_chunk') {
      if (!chatPlayerRef.current) {
        chatPlayerRef.current = new StreamAudioPlayer(0.35)
      }
      await chatPlayerRef.current.enqueueBase64Pcm16(event.pcm16_base64, event.sample_rate, {
        autoplay: true,
        forceStart: event.is_final_chunk,
      })
      return
    }

    if (event.type === 'error') {
      pushToast('error', event.detail)
    }
  }

  async function handleStreamGenerate() {
    const streamingInterval = getStreamingInterval()
    await stopLivePlayback()
    playerRef.current = new StreamAudioPlayer()

    setLiveStream({
      status: 'streaming',
      mode,
      run: null,
      segments: [],
      chunksReceived: 0,
      bufferedSeconds: 0,
      playbackStarted: false,
      message: 'Waiting for the first audio chunk…',
    })

    const autoplay = streamSettings.autoplay
    let completedRun: GenerationRun | null = null

    if (autoplay) {
      await startLivePlayback()
      setLiveStream((current) => ({
        ...current,
        message: 'Opening the audio output and buffering the first live chunks…',
      }))
    }

    const applyEvent = async (event: StreamRunEvent) => {
      if (event.type === 'run_start') {
        setLiveStream((current) => ({ ...current, run: event.run, message: 'Generating live audio…' }))
        return
      }
      if (event.type === 'segment_start') {
        setLiveStream((current) => ({
          ...current,
          segments: [
            ...current.segments,
            {
              segmentIndex: event.segment_index,
              text: event.text,
              sampleRate: event.sample_rate,
              chunkCount: 0,
              bufferedSeconds: 0,
              status: 'streaming',
            },
          ],
          message: `Streaming segment ${event.segment_index + 1}…`,
        }))
        return
      }
      if (event.type === 'audio_chunk') {
        if (!playerRef.current) {
          playerRef.current = new StreamAudioPlayer()
        }
        await playerRef.current.enqueueBase64Pcm16(event.pcm16_base64, event.sample_rate, {
          autoplay,
          forceStart: event.is_final_chunk,
        })
        setLiveStream((current) => ({
          ...current,
          chunksReceived: current.chunksReceived + 1,
          bufferedSeconds: Number((current.bufferedSeconds + event.duration_seconds).toFixed(2)),
          playbackStarted: current.playbackStarted || autoplay,
          segments: current.segments.map((segment) =>
            segment.segmentIndex === event.segment_index
              ? {
                  ...segment,
                  chunkCount: segment.chunkCount + 1,
                  bufferedSeconds: Number((segment.bufferedSeconds + event.duration_seconds).toFixed(2)),
                  sampleRate: event.sample_rate,
                  status: event.is_final_chunk ? 'complete' : 'streaming',
                }
              : segment,
          ),
        }))
        return
      }
      if (event.type === 'segment_complete') {
        setLiveStream((current) => ({
          ...current,
          segments: current.segments.map((segment) =>
            segment.segmentIndex === event.segment_index ? { ...segment, status: 'complete', clip: event.clip } : segment,
          ),
          message: `Segment ${event.segment_index + 1} ready.`,
        }))
        return
      }
      if (event.type === 'run_complete') {
        completedRun = event.run
        startTransition(() => {
          setRuns((current) => [event.run, ...current])
          setActiveRunId(event.run.run_id)
        })
        setLiveStream((current) => ({
          ...current,
          status: 'complete',
          run: event.run,
          message: 'Live stream finished. Full clip saved to run history.',
        }))
        return
      }
      if (event.type === 'error') {
        throw new Error(event.detail)
      }
    }

    if (mode === 'custom') {
      for await (const event of generateRunStream('custom', {
        segments: customForm.segments.map((segment) => segment.text),
        language: customForm.language,
        speaker: customForm.speaker,
        instruct: composeInstruction(customForm.instruct, customForm.style, 'custom'),
        streaming_interval: streamingInterval,
        generation: compactGenerationSettings(customForm.generation),
      })) {
        await applyEvent(event)
      }
    } else if (mode === 'design') {
      for await (const event of generateRunStream('design', {
        segments: designForm.segments.map((segment) => segment.text),
        language: designForm.language,
        instruct: composeInstruction(designForm.instruct, designForm.style, 'design'),
        streaming_interval: streamingInterval,
        generation: compactGenerationSettings(designForm.generation),
      })) {
        await applyEvent(event)
      }
    } else {
      if (!cloneForm.referenceFile) {
        throw new Error('Add a reference clip before running voice clone.')
      }
      const payload = new FormData()
      payload.append('segments', JSON.stringify(cloneForm.segments.map((segment) => segment.text)))
      payload.append('language', cloneForm.language)
      payload.append('ref_text', cloneForm.refText)
      payload.append('x_vector_only_mode', String(cloneForm.xVectorOnlyMode))
      payload.append('generation', JSON.stringify(compactGenerationSettings(cloneForm.generation)))
      payload.append('streaming_interval', String(streamingInterval))
      payload.append('ref_audio', cloneForm.referenceFile)
      for await (const event of generateRunStream('clone', payload)) {
        await applyEvent(event)
      }
    }

    if (completedRun) {
      await refreshHealth()
    }
  }

  async function handleGenerate() {
    setError(null)
    setPending(true)

    try {
      if (streamSettings.enabled) {
        await handleStreamGenerate()
        return
      }

      let run: GenerationRun

      if (mode === 'custom') {
        run = await generateRun('custom', {
          segments: customForm.segments.map((segment) => segment.text),
          language: customForm.language,
          speaker: customForm.speaker,
          instruct: composeInstruction(customForm.instruct, customForm.style, 'custom'),
          generation: compactGenerationSettings(customForm.generation),
        })
      } else if (mode === 'design') {
        run = await generateRun('design', {
          segments: designForm.segments.map((segment) => segment.text),
          language: designForm.language,
          instruct: composeInstruction(designForm.instruct, designForm.style, 'design'),
          generation: compactGenerationSettings(designForm.generation),
        })
      } else {
        if (!cloneForm.referenceFile) {
          throw new Error('Add a reference clip before running voice clone.')
        }
        const payload = new FormData()
        payload.append('segments', JSON.stringify(cloneForm.segments.map((segment) => segment.text)))
        payload.append('language', cloneForm.language)
        payload.append('ref_text', cloneForm.refText)
        payload.append('x_vector_only_mode', String(cloneForm.xVectorOnlyMode))
        payload.append('generation', JSON.stringify(compactGenerationSettings(cloneForm.generation)))
        payload.append('ref_audio', cloneForm.referenceFile)
        run = await generateRun('clone', payload)
      }

      startTransition(() => {
        setRuns((current) => [run, ...current])
        setActiveRunId(run.run_id)
      })
      await refreshHealth()
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Generation failed.')
    } finally {
      setPending(false)
    }
  }

  async function handleSaveSettings() {
    setError(null)
    try {
      const saved = await saveChatSettings(serializeSettings(chatSettings))
      const mappedSettings = mapSettingsResponseToForm(saved)
      setChatSettings(mappedSettings)
      setProviderTab(mappedSettings.defaults.activeProvider)
      pushToast('success', 'Settings saved on the local server.')
      const socket = socketRef.current
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'session.configure', settings: serializeSettings(mappedSettings) }))
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save settings.')
    }
  }

  async function handleProviderTest() {
    try {
      const draft =
        providerTab === 'openai_compatible'
          ? chatSettings.openaiCompatible
          : providerTab === 'gemini'
            ? chatSettings.gemini
            : chatSettings.anthropic
      const result = await testChatProvider(providerTab, {
        base_url: draft.baseUrl,
        api_key: draft.apiKey,
        model: draft.model,
        api_mode: providerTab === 'openai_compatible' ? draft.apiMode ?? null : null,
      } as never)
      if (result.success && providerTab === 'openai_compatible' && result.api_mode) {
        setChatSettings((current) => ({
          ...current,
          openaiCompatible: { ...current.openaiCompatible, apiMode: result.api_mode },
        }))
      }
      pushToast(result.success ? 'success' : 'error', result.success ? `Connection OK in ${result.latency_ms ?? 0} ms.` : result.error ?? 'Provider test failed.')
    } catch (testError) {
      pushToast('error', testError instanceof Error ? testError.message : 'Provider test failed.')
    }
  }

  async function startConversation() {
    try {
      const effectiveSettings = await ensureReplyVoiceReady()
      const socket = await ensureConversationSocket(effectiveSettings)
      if (micActive) {
        return
      }

      const capture = new AudioCapture()
      captureRef.current = capture
      listeningEnabledRef.current = true
      speechDetectedRef.current = false
      silenceStartedAtRef.current = null
      speechStartedAtRef.current = null
      setMicActive(true)
      setConversationStatus('listening')

      await capture.start({
        targetSampleRate: capabilities?.conversation.input_sample_rate ?? 16000,
        chunkDurationMs: 250,
        onChunk: ({ pcm16Base64, sampleRate, rms }) => {
          if (!listeningEnabledRef.current || socket.readyState !== WebSocket.OPEN) {
            return
          }
          socket.send(JSON.stringify({ type: 'audio.append', pcm16_base64: pcm16Base64, sample_rate: sampleRate }))

          if (rms > 0.018) {
            if (!speechDetectedRef.current) {
              speechStartedAtRef.current = Date.now()
            }
            speechDetectedRef.current = true
            silenceStartedAtRef.current = null
          } else {
            if (!speechDetectedRef.current) {
              return
            }

            if (silenceStartedAtRef.current === null) {
              silenceStartedAtRef.current = Date.now()
            }
          }

          const silenceTimeout = Number(chatSettings.defaults.silenceTimeoutMs) || 1200
          const maxTurnMs = (Number(chatSettings.defaults.maxTurnSeconds) || 45) * 1000
          const silenceExceeded =
            silenceStartedAtRef.current !== null && Date.now() - silenceStartedAtRef.current >= silenceTimeout
          const maxTurnExceeded =
            speechStartedAtRef.current !== null && Date.now() - speechStartedAtRef.current >= maxTurnMs

          if (silenceExceeded || maxTurnExceeded) {
            listeningEnabledRef.current = false
            speechDetectedRef.current = false
            silenceStartedAtRef.current = null
            speechStartedAtRef.current = null
            setConversationStatus('transcribing')
            socket.send(JSON.stringify({ type: 'turn.commit' }))
          }
        },
      })
    } catch (conversationError) {
      listeningEnabledRef.current = false
      speechDetectedRef.current = false
      silenceStartedAtRef.current = null
      speechStartedAtRef.current = null
      await captureRef.current?.stop()
      captureRef.current = null
      setMicActive(false)
      setConversationStatus('idle')
      pushToast(
        'error',
        conversationError instanceof Error ? conversationError.message : 'Unable to start the microphone.',
      )
    }
  }

  async function stopConversationListening() {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'turn.commit' }))
    }
    listeningEnabledRef.current = false
    speechDetectedRef.current = false
    silenceStartedAtRef.current = null
    speechStartedAtRef.current = null
    await captureRef.current?.stop()
    captureRef.current = null
    setMicActive(false)
    setConversationStatus('idle')
  }

  async function interruptAssistant() {
    socketRef.current?.send(JSON.stringify({ type: 'assistant.stop' }))
    await chatPlayerRef.current?.stop()
    chatPlayerRef.current = null
    setConversationStatus(micActive ? 'listening' : 'idle')
    listeningEnabledRef.current = micActive
  }

  async function sendTypedMessage(text: string) {
    const cleaned = text.trim()
    if (!cleaned) {
      return
    }
    try {
      const effectiveSettings = await ensureReplyVoiceReady()
      const socket = await ensureConversationSocket(effectiveSettings)
      setConversationMessages((current) => [
        ...current,
        { id: makeId(), role: 'user', text: cleaned, state: 'final' },
      ])
      setTypedMessage('')
      setConversationStatus('thinking')
      socket.send(JSON.stringify({ type: 'text.submit', text: cleaned }))
    } catch (submitError) {
      pushToast('error', submitError instanceof Error ? submitError.message : 'Unable to send the message.')
    }
  }

  async function handleFileTranscription() {
    if (!fileUpload) {
      pushToast('error', 'Choose an audio file before transcribing.')
      return
    }
    try {
      const transcript = await transcribeAsrFile({
        file: fileUpload,
        modelId: chatSettings.defaults.asrModel,
        language: chatSettings.defaults.asrLanguage,
        sendToChat: fileSendToChat,
      })
      setFileTranscript(transcript)
      pushToast('success', 'Transcription finished.')
      if (fileSendToChat && transcript.text) {
        await sendTypedMessage(transcript.text)
      }
    } catch (transcriptionError) {
      pushToast(
        'error',
        transcriptionError instanceof Error ? transcriptionError.message : 'Unable to transcribe the file.',
      )
    }
  }

  async function handlePrepareReplyVoiceClone() {
    setReplyVoiceCloneDraft((current) => ({ ...current, pending: true }))
    try {
      await prepareReplyVoiceClone(false)
    } catch (cloneError) {
      setReplyVoiceCloneDraft((current) => ({ ...current, pending: false }))
      pushToast(
        'error',
        cloneError instanceof Error ? cloneError.message : 'Unable to prepare the cloned reply voice.',
      )
    }
  }

  function renderSegments(segments: Segment[]) {
    return segments.map((segment, index) => (
      <div className="segment-row" key={segment.id}>
        <label className="field-label" htmlFor={segment.id}>
          Text segment {index + 1}
        </label>
        <textarea
          id={segment.id}
          className="text-input segment-input"
          value={segment.text}
          onChange={(event) => updateSegment(segment.id, event.target.value)}
          placeholder="Paste text to synthesize."
          rows={3}
        />
        <button className="ghost-button" type="button" onClick={() => removeSegment(segment.id)} disabled={segments.length === 1}>
          Remove segment
        </button>
      </div>
    ))
  }

  function renderGenerationControls(values: Record<string, string>, onChange: (key: string, value: string) => void) {
    return (
      <details className="advanced-panel">
        <summary>Advanced generation</summary>
        <div className="advanced-grid">
          {[
            ['temperature', 'Temperature', '0.7', 'decimal'],
            ['top_p', 'Top P', '0.9', 'decimal'],
            ['max_new_tokens', 'Max new tokens', '2048', 'numeric'],
            ['seed', 'Seed', 'Optional', 'numeric'],
          ].map(([key, label, placeholder, inputMode]) => (
            <label className="field" key={key}>
              <span className="field-label">{label}</span>
              <input
                className="text-input"
                inputMode={inputMode as 'decimal' | 'numeric'}
                value={values[key] ?? ''}
                onChange={(event) => onChange(key, event.target.value)}
                placeholder={placeholder}
              />
            </label>
          ))}
        </div>
      </details>
    )
  }

  function renderStyleControls(values: StyleControls, onChange: (key: keyof StyleControls, value: string) => void, styleMode: 'custom' | 'design') {
    const stylePreview = composeInstruction('', values, styleMode)

    return (
      <section className="style-panel">
        <div className="style-panel-head">
          <div>
            <p className="mode-label">Performance controls</p>
            <p className="style-panel-copy">
              These settings are converted into a natural-language instruction for Qwen.
            </p>
          </div>
        </div>
        <div className="style-grid">
          {[
            { key: 'mood', label: 'Mood', options: MOOD_OPTIONS },
            { key: 'emotionIntensity', label: 'Emotion intensity', options: EMOTION_INTENSITY_OPTIONS },
            { key: 'pace', label: 'Pace', options: PACE_OPTIONS },
            { key: 'energy', label: 'Energy', options: ENERGY_OPTIONS },
            { key: 'expressiveness', label: 'Expressiveness', options: EXPRESSIVENESS_OPTIONS },
          ].map(({ key, label, options }) => (
            <label className={`field ${key === 'expressiveness' ? 'style-grid-full' : ''}`} key={key}>
              <span className="field-label">{label}</span>
              <select
                className="text-input"
                value={values[key as keyof StyleControls]}
                onChange={(event) => onChange(key as keyof StyleControls, event.target.value)}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="style-preview">{stylePreview}</p>
      </section>
    )
  }

  function renderStreamControls() {
    return (
      <section className="stream-panel">
        <div className="style-panel-head">
          <div>
            <p className="mode-label">Realtime streaming</p>
            <p className="style-panel-copy">Start playback from buffered chunks while Qwen is still generating the rest.</p>
          </div>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={streamSettings.enabled}
            onChange={(event) => setStreamSettings((current) => ({ ...current, enabled: event.target.checked }))}
          />
          <span>Enable live audio streaming</span>
        </label>
        {streamSettings.enabled ? (
          <div className="style-grid">
            <label className="field">
              <span className="field-label">Chunk interval (seconds)</span>
              <input
                className="text-input"
                inputMode="decimal"
                value={streamSettings.streamingInterval}
                onChange={(event) => setStreamSettings((current) => ({ ...current, streamingInterval: event.target.value }))}
                placeholder="0.32"
              />
            </label>
            <label className="toggle stream-toggle">
              <input
                type="checkbox"
                checked={streamSettings.autoplay}
                onChange={(event) => setStreamSettings((current) => ({ ...current, autoplay: event.target.checked }))}
              />
              <span>Autoplay when buffer is ready</span>
            </label>
          </div>
        ) : null}
      </section>
    )
  }

  function renderSettingsSection(
    sectionId: SettingsSectionId,
    title: string,
    children: ReactNode,
    copy?: string,
    className?: string,
  ) {
    const collapsed = collapsedSections[sectionId]
    return (
      <section className={`settings-section ${collapsed ? 'settings-section-collapsed' : ''} ${className ?? ''}`.trim()}>
        <button
          className="settings-section-toggle"
          type="button"
          onClick={() => toggleSection(sectionId)}
          aria-expanded={!collapsed}
        >
          <span className="settings-section-title">{title}</span>
          <span className="settings-section-icon" aria-hidden="true">
            {collapsed ? '+' : '−'}
          </span>
        </button>
        {!collapsed ? (
          <div className="settings-section-body">
            {copy ? <p className="section-copy">{copy}</p> : null}
            {children}
          </div>
        ) : null}
      </section>
    )
  }

  function renderLiveStream() {
    if (liveStream.status === 'idle') {
      return null
    }

    return (
      <section className="live-stream-card">
        <div className="live-stream-head">
          <div>
            <p className="eyebrow">Live stream</p>
            <p className="run-title">{liveStream.mode ? `${liveStream.mode} stream` : 'Streaming generation'}</p>
            <p className="clip-copy">{liveStream.message}</p>
          </div>
          <div className="live-stream-actions">
            {!streamSettings.autoplay && liveStream.status === 'streaming' ? (
              <button className="ghost-button" type="button" onClick={() => void startLivePlayback()}>
                {liveStream.playbackStarted ? 'Playback running' : 'Start playback'}
              </button>
            ) : null}
            {liveStream.playbackStarted ? (
              <button className="ghost-button" type="button" onClick={() => void stopLivePlayback()}>
                Stop playback
              </button>
            ) : null}
          </div>
        </div>
        <dl className="clip-meta">
          <div>
            <dt>Status</dt>
            <dd>{liveStream.status}</dd>
          </div>
          <div>
            <dt>Chunks</dt>
            <dd>{liveStream.chunksReceived}</dd>
          </div>
          <div>
            <dt>Buffered</dt>
            <dd>{liveStream.bufferedSeconds}s</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{liveStream.mode ?? 'N/A'}</dd>
          </div>
        </dl>
      </section>
    )
  }

  function renderTtsControls() {
    return (
      <>
        <div className="hero">
          <p className="eyebrow">Local speech evaluation</p>
          <h1>Qwen3-TTS Lab</h1>
          <p className="lead">Switch between preset voices, natural-language voice design, and voice cloning without leaving the same session.</p>
        </div>

        <div className="status-strip">
          <span>Device: {health?.selected_device ?? '—'}</span>
          <span>Active mode: {health?.active_mode ?? 'idle'}</span>
        </div>

        <div className="workspace-tabs">
          <button className={workspace === 'tts' ? 'tab tab-active' : 'tab'} type="button" onClick={() => setWorkspace('tts')}>
            TTS Lab
          </button>
          <button className={workspace === 'chat' ? 'tab tab-active' : 'tab'} type="button" onClick={() => setWorkspace('chat')}>
            Voice Chat
          </button>
        </div>

        <div className="tabs">
          {capabilities?.modes.map((item) => (
            <button
              key={item.id}
              className={item.id === mode ? 'tab tab-active' : 'tab'}
              type="button"
              onClick={() => {
                setMode(item.id)
                if (item.id === 'clone') {
                  setCloneForm((current) => ({
                    ...current,
                    language: current.language === 'English' ? 'Auto' : current.language,
                  }))
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <section className="mode-summary">
          <p className="mode-label">{modeMeta?.label}</p>
          <p className="lead">{modeMeta?.description}</p>
          <p className="hint">{modeMeta?.checkpoint}</p>
        </section>

        <section className="editor">
          {mode === 'custom' ? (
            <>
              <label className="field">
                <span className="field-label">Language</span>
                <select className="text-input" value={customForm.language} onChange={(event) => setCustomForm((current) => ({ ...current, language: event.target.value }))}>
                  {capabilities?.languages.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Speaker</span>
                <select className="text-input" value={customForm.speaker} onChange={(event) => setCustomForm((current) => ({ ...current, speaker: event.target.value }))}>
                  {capabilities?.speakers.map((speaker) => (
                    <option key={speaker.id} value={speaker.id}>
                      {speaker.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Additional instruction</span>
                <textarea className="text-input segment-input" value={customForm.instruct} onChange={(event) => setCustomForm((current) => ({ ...current, instruct: event.target.value }))} rows={3} />
              </label>
              {renderStyleControls(customForm.style, (key, value) => setCustomForm((current) => ({ ...current, style: { ...current.style, [key]: value } })), 'custom')}
              {renderSegments(customForm.segments)}
              {renderGenerationControls(customForm.generation, (key, value) => setCustomForm((current) => ({ ...current, generation: { ...current.generation, [key]: value } })))}
            </>
          ) : null}

          {mode === 'design' ? (
            <>
              <label className="field">
                <span className="field-label">Language</span>
                <select className="text-input" value={designForm.language} onChange={(event) => setDesignForm((current) => ({ ...current, language: event.target.value }))}>
                  {capabilities?.languages.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Voice persona</span>
                <textarea className="text-input segment-input" value={designForm.instruct} onChange={(event) => setDesignForm((current) => ({ ...current, instruct: event.target.value }))} rows={4} />
              </label>
              {renderStyleControls(designForm.style, (key, value) => setDesignForm((current) => ({ ...current, style: { ...current.style, [key]: value } })), 'design')}
              {renderSegments(designForm.segments)}
              {renderGenerationControls(designForm.generation, (key, value) => setDesignForm((current) => ({ ...current, generation: { ...current.generation, [key]: value } })))}
            </>
          ) : null}

          {mode === 'clone' ? (
            <>
              <label className="field">
                <span className="field-label">Language</span>
                <select className="text-input" value={cloneForm.language} onChange={(event) => setCloneForm((current) => ({ ...current, language: event.target.value }))}>
                  {capabilities?.languages.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">Auto is recommended for cloned voices unless you know the target language should be forced.</p>
              <label className="field">
                <span className="field-label">Reference audio</span>
                <input className="text-input" type="file" accept="audio/*" onChange={(event) => setCloneForm((current) => ({ ...current, referenceFile: event.target.files?.[0] ?? null }))} />
              </label>
              <label className="field">
                <span className="field-label">Reference transcript</span>
                <textarea className="text-input segment-input" value={cloneForm.refText} onChange={(event) => setCloneForm((current) => ({ ...current, refText: event.target.value }))} rows={3} />
              </label>
              <p className="hint">This field must match the uploaded reference clip only. Do not paste the long target text here.</p>
              <p className="hint">Leave the transcript blank to let local Qwen ASR transcribe the reference clip automatically before cloning.</p>
              <label className="toggle">
                <input type="checkbox" checked={cloneForm.xVectorOnlyMode} onChange={(event) => setCloneForm((current) => ({ ...current, xVectorOnlyMode: event.target.checked }))} />
                <span>X-vector only mode</span>
              </label>
              <p className="hint">Uses a speaker-embedding-only clone path for faster synthesis. Transcript-backed clone usually preserves style and pronunciation better.</p>
              {renderSegments(cloneForm.segments)}
              {renderGenerationControls(cloneForm.generation, (key, value) => setCloneForm((current) => ({ ...current, generation: { ...current.generation, [key]: value } })))}
            </>
          ) : null}

          {renderStreamControls()}

          <div className="controls-footer">
            <button className="ghost-button" type="button" onClick={addSegment}>
              Add segment
            </button>
            <button className="primary-button" type="button" onClick={() => void handleGenerate()} disabled={pending}>
              {pending ? 'Generating…' : 'Generate audio'}
            </button>
          </div>
        </section>
      </>
    )
  }

  function renderProviderPanel() {
    return (
      <>
        <div className="provider-tabs">
          {(['openai_compatible', 'gemini', 'anthropic'] as ProviderId[]).map((provider) => (
            <button
              key={provider}
              className={providerTab === provider ? 'tab tab-active' : 'tab'}
              type="button"
              onClick={() => {
                setProviderTab(provider)
                setChatSettings((current) => ({
                  ...current,
                  defaults: { ...current.defaults, activeProvider: provider },
                }))
              }}
            >
              {provider === 'openai_compatible' ? 'OpenAI-compatible' : provider === 'gemini' ? 'Gemini' : 'Anthropic'}
            </button>
          ))}
        </div>
        <div className="responsive-field-grid">
          <label className="field">
            <span className="field-label">Base URL</span>
            <input
              className="text-input"
              value={currentProviderConfig.baseUrl}
              onChange={(event) =>
                setProviderConfig(providerTab, (current) => ({ ...current, baseUrl: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span className="field-label">API key</span>
            <input
              className="text-input"
              type="password"
              value={currentProviderConfig.apiKey}
              onChange={(event) =>
                setProviderConfig(providerTab, (current) => ({ ...current, apiKey: event.target.value }))
              }
              placeholder={currentProviderConfig.hasApiKey ? currentProviderConfig.maskedApiKey ?? 'Saved locally' : 'Enter API key'}
            />
          </label>
          <label className="field">
            <span className="field-label">Model</span>
            <input
              className="text-input"
              value={currentProviderConfig.model}
              onChange={(event) =>
                setProviderConfig(providerTab, (current) => ({ ...current, model: event.target.value }))
              }
            />
          </label>
        </div>
        {providerTab === 'openai_compatible' && currentProviderConfig.apiMode ? (
          <p className="hint">Detected API mode: {currentProviderConfig.apiMode}</p>
        ) : null}
        <div className="controls-footer">
          <button className="ghost-button" type="button" onClick={() => void handleProviderTest()}>
            Test connection
          </button>
          <button className="primary-button" type="button" onClick={() => void handleSaveSettings()}>
            Save settings
          </button>
        </div>
      </>
    )
  }

  function renderVoiceChatControls() {
    return (
      <>
        <div className="hero">
          <p className="eyebrow">Realtime speech loop</p>
          <h1>Voice Chat</h1>
          <p className="lead">Talk into local Qwen ASR, route the transcript through your chosen LLM, then hear the reply through local Qwen TTS.</p>
        </div>
        <div className="status-strip">
          <span>ASR: {(health?.active_asr_model ?? chatSettings.defaults.asrModel) || 'idle'}</span>
          <span>Phase: {conversationStatus}</span>
        </div>
        <div className="workspace-tabs">
          <button className={workspace === 'tts' ? 'tab tab-active' : 'tab'} type="button" onClick={() => setWorkspace('tts')}>
            TTS Lab
          </button>
          <button className={workspace === 'chat' ? 'tab tab-active' : 'tab'} type="button" onClick={() => setWorkspace('chat')}>
            Voice Chat
          </button>
        </div>
        <div className="settings-board">
          {renderSettingsSection(
            'provider',
            'Provider',
            renderProviderPanel(),
            'Pick the active LLM connection and keep credentials local to this server.',
            'settings-section-compact',
          )}
          {renderSettingsSection(
            'conversation',
            'Conversation',
            <>
              <div className="responsive-field-grid">
                <label className="field">
                  <span className="field-label">Active provider</span>
                  <select className="text-input" value={chatSettings.defaults.activeProvider} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, activeProvider: event.target.value as ProviderId } }))}>
                    {capabilities?.chat.providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field field-span-full">
                  <span className="field-label">System prompt</span>
                  <textarea className="text-input segment-input" value={chatSettings.defaults.systemPrompt} rows={4} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, systemPrompt: event.target.value } }))} />
                </label>
              </div>
              <div className="responsive-field-grid">
                <label className="field">
                  <span className="field-label">Temperature</span>
                  <input className="text-input" inputMode="decimal" value={chatSettings.defaults.temperature} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, temperature: event.target.value } }))} />
                </label>
                <label className="field">
                  <span className="field-label">Max output tokens</span>
                  <input className="text-input" inputMode="numeric" value={chatSettings.defaults.maxOutputTokens} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, maxOutputTokens: event.target.value } }))} />
                </label>
              </div>
              <p className="hint">Reply chunking: sentence-sized speech streaming.</p>
            </>,
            'Define how the assistant reasons and how long each reply can run.',
            'settings-section-compact',
          )}
          {renderSettingsSection(
            'asr',
            'ASR',
            <>
              <div className="responsive-field-grid">
                <label className="field">
                  <span className="field-label">Model</span>
                  <select className="text-input" value={chatSettings.defaults.asrModel} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, asrModel: event.target.value } }))}>
                    {capabilities?.asr.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Language</span>
                  <select className="text-input" value={chatSettings.defaults.asrLanguage} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, asrLanguage: event.target.value } }))}>
                    {capabilities?.languages.map((language) => (
                      <option key={language} value={language}>
                        {language}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Silence timeout ms</span>
                  <input className="text-input" inputMode="numeric" value={chatSettings.defaults.silenceTimeoutMs} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, silenceTimeoutMs: event.target.value } }))} />
                </label>
                <label className="field">
                  <span className="field-label">Max turn seconds</span>
                  <input className="text-input" inputMode="numeric" value={chatSettings.defaults.maxTurnSeconds} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, maxTurnSeconds: event.target.value } }))} />
                </label>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={chatSettings.defaults.liveCaptions} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, liveCaptions: event.target.checked } }))} />
                <span>Live captions</span>
              </label>
              <div className="upload-card">
                <label className="field">
                  <span className="field-label">Upload audio for transcription</span>
                  <input className="text-input" type="file" accept="audio/*" onChange={(event) => setFileUpload(event.target.files?.[0] ?? null)} />
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={fileSendToChat} onChange={(event) => setFileSendToChat(event.target.checked)} />
                  <span>Send transcript into chat after transcription</span>
                </label>
                <button className="ghost-button" type="button" onClick={() => void handleFileTranscription()}>
                  Transcribe file
                </button>
                {fileTranscript ? <p className="style-preview">{fileTranscript.text}</p> : null}
              </div>
            </>,
            'Tune transcription behavior, turn timing, and file-based transcript import.',
            'settings-section-compact',
          )}
          {renderSettingsSection(
            'replyVoice',
            'Reply voice',
            <>
          <div className="responsive-field-grid">
            <label className="field">
              <span className="field-label">Voice mode</span>
              <select
                className="text-input"
                value={chatSettings.defaults.replyVoice.mode}
                onChange={(event) =>
                  setChatSettings((current) => {
                    const nextMode = event.target.value as 'custom' | 'design' | 'clone'
                    return {
                      ...current,
                      defaults: {
                        ...current.defaults,
                        replyVoice: {
                          ...current.defaults.replyVoice,
                          mode: nextMode,
                          language:
                            nextMode === 'clone' && current.defaults.replyVoice.language === 'English'
                              ? 'Auto'
                              : current.defaults.replyVoice.language,
                        },
                      },
                    }
                  })
                }
              >
                <option value="custom">Custom Voice</option>
                <option value="design">Voice Design</option>
                <option value="clone">Cloned Voice</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Language</span>
              <select className="text-input" value={chatSettings.defaults.replyVoice.language} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, replyVoice: { ...current.defaults.replyVoice, language: event.target.value } } }))}>
                {capabilities?.languages.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            </label>
            {chatSettings.defaults.replyVoice.mode === 'custom' ? (
              <label className="field">
                <span className="field-label">Speaker</span>
                <select className="text-input" value={chatSettings.defaults.replyVoice.speaker} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, replyVoice: { ...current.defaults.replyVoice, speaker: event.target.value } } }))}>
                  {capabilities?.speakers.map((speaker) => (
                    <option key={speaker.id} value={speaker.id}>
                      {speaker.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {chatSettings.defaults.replyVoice.mode === 'clone' ? (
            <div className="upload-card reply-voice-clone-grid">
              <label className="field field-span-full">
                <span className="field-label">Reference voice clip</span>
                <input
                  className="text-input"
                  type="file"
                  accept="audio/*"
                  onChange={(event) =>
                    {
                      const nextFile = event.target.files?.[0] ?? null
                      setReplyVoiceCloneDraft((current) => ({
                        ...current,
                        file: nextFile,
                        preparedProfile: null,
                      }))
                      setChatSettings((current) => ({
                        ...current,
                        defaults: {
                          ...current.defaults,
                          replyVoice: clearPreparedReplyVoice(current.defaults.replyVoice),
                        },
                      }))
                    }
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">Voice label</span>
                <input
                  className="text-input"
                  value={replyVoiceCloneDraft.label}
                  onChange={(event) =>
                    setReplyVoiceCloneDraft((current) => ({ ...current, label: event.target.value }))
                  }
                  placeholder="Support agent voice"
                />
              </label>
              <div className="reply-voice-clone-status">
                {chatSettings.defaults.replyVoice.cloneProfileLabel ? (
                  <p className="hint">
                    Ready: {chatSettings.defaults.replyVoice.cloneProfileLabel}
                  </p>
                ) : (
                  <p className="hint">Prepare a reference clip once, cache its Qwen speaker embedding, then reuse it for faster streamed assistant replies.</p>
                )}
                {chatSettings.defaults.replyVoice.cloneReferenceText ? (
                  <p className="style-preview">{chatSettings.defaults.replyVoice.cloneReferenceText}</p>
                ) : null}
              </div>
              <label className="field field-span-full">
                <span className="field-label">Reference transcript</span>
                <textarea
                  className="text-input segment-input"
                  value={replyVoiceCloneDraft.referenceText}
                  rows={3}
                  onChange={(event) =>
                    {
                      const nextReferenceText = event.target.value
                      setReplyVoiceCloneDraft((current) => ({
                        ...current,
                        referenceText: nextReferenceText,
                        preparedProfile: null,
                      }))
                      setChatSettings((current) => ({
                        ...current,
                        defaults: {
                          ...current.defaults,
                          replyVoice: clearPreparedReplyVoice(current.defaults.replyVoice),
                        },
                      }))
                    }
                  }
                  placeholder="Leave blank to let local Qwen ASR transcribe the reference clip."
                />
              </label>
              <div className="controls-footer">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void handlePrepareReplyVoiceClone()}
                  disabled={replyVoiceCloneDraft.pending}
                >
                  {replyVoiceCloneDraft.pending ? 'Preparing…' : 'Prepare cloned voice'}
                </button>
              </div>
            </div>
          ) : (
            <div className="reply-voice-design-layout">
              <label className="field field-span-full">
                <span className="field-label">Base guidance</span>
                <textarea className="text-input segment-input" value={chatSettings.defaults.replyVoice.instruct} rows={3} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, replyVoice: { ...current.defaults.replyVoice, instruct: event.target.value } } }))} />
              </label>
              {renderStyleControls(chatSettings.defaults.replyVoice.style, (key, value) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, replyVoice: { ...current.defaults.replyVoice, style: { ...current.defaults.replyVoice.style, [key]: value } } } })), chatSettings.defaults.replyVoice.mode)}
            </div>
          )}
            </>,
            'Choose whether the assistant speaks with a preset, designed, or cloned reply voice.',
            'settings-section-wide',
          )}
        </div>
      </>
    )
  }

  function renderRunResults() {
    return (
      <>
        <div className="results-header">
          <div>
            <p className="eyebrow">Session output</p>
            <h2>Run history</h2>
          </div>
          <p className="results-count">{runs.length} runs in memory</p>
        </div>
        {renderLiveStream()}
        {runs.length ? (
          <>
            <div className="history-list">
              {runs.map((run) => (
                <button key={run.run_id} className={run.run_id === activeRun?.run_id ? 'history-item history-item-active' : 'history-item'} type="button" onClick={() => setActiveRunId(run.run_id)}>
                  <span>{run.mode}</span>
                  <span>{formatTimestamp(run.created_at)}</span>
                </button>
              ))}
            </div>
            {activeRun ? (
              <div className="run-detail">
                <div className="run-meta">
                  <span>{activeRun.model_id}</span>
                  <span>{activeRun.device}</span>
                </div>
                <div className="clips">
                  {activeRun.clips.map((clip) => (
                    <article className="clip-card" key={clip.id}>
                      <div className="clip-head">
                        <div>
                          <p className="clip-name">{clip.file_name}</p>
                          <p className="clip-copy">{clip.text}</p>
                        </div>
                        <a className="ghost-button" href={clip.audio_url} download={clip.file_name}>
                          Download
                        </a>
                      </div>
                      <div className="waveform" aria-hidden="true">
                        {buildWaveformBars(clip.id).map((height, index) => (
                          <span key={`${clip.id}-${index}`} style={{ height }} />
                        ))}
                      </div>
                      <audio className="audio-player" controls src={clip.audio_url} />
                      <dl className="clip-meta">
                        <div>
                          <dt>Language</dt>
                          <dd>{clip.language}</dd>
                        </div>
                        <div>
                          <dt>Sample rate</dt>
                          <dd>{clip.sample_rate} Hz</dd>
                        </div>
                        <div>
                          <dt>Duration</dt>
                          <dd>{clip.duration_seconds}s</dd>
                        </div>
                        <div>
                          <dt>Speaker</dt>
                          <dd>{clip.speaker ?? 'Designed'}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty-state">No generations yet. Use the controls on the left to create your first clip.</div>
        )}
      </>
    )
  }

  function renderChatResults() {
    return (
      <>
        <div className="results-header">
          <div>
            <p className="eyebrow">Conversation</p>
            <h2>Realtime voice loop</h2>
          </div>
          <p className="results-count">{conversationMessages.length} messages</p>
        </div>
        <div className="chat-status-card">
          <div>
            <p className="mode-label">State</p>
            <p className="lead">{conversationStatus}</p>
          </div>
          <div className="chat-actions">
            {!micActive ? (
              <button className="primary-button" type="button" onClick={() => void startConversation()}>
                Start conversation
              </button>
            ) : (
              <button className="ghost-button" type="button" onClick={() => void stopConversationListening()}>
                Stop listening
              </button>
            )}
            <button className="ghost-button" type="button" onClick={() => void interruptAssistant()}>
              Interrupt assistant
            </button>
          </div>
        </div>
        {liveCaption ? <div className="caption-strip">{liveCaption}</div> : null}
        <div className="chat-thread">
          {conversationMessages.length ? (
            conversationMessages.map((message) => (
              <article key={message.id} className={`chat-bubble chat-bubble-${message.role}`}>
                <p className="eyebrow">{message.role === 'user' ? 'You' : 'Assistant'}</p>
                <p className="chat-text">{message.text}</p>
              </article>
            ))
          ) : (
            <div className="empty-state">No conversation yet. Start the microphone or send a typed prompt to begin.</div>
          )}
        </div>
        <div className="chat-composer">
          <textarea className="text-input segment-input" value={typedMessage} rows={4} placeholder="Type a message for the connected LLM." onChange={(event) => setTypedMessage(event.target.value)} />
          <div className="controls-footer">
            <button className="ghost-button" type="button" onClick={() => setConversationMessages([])}>
              Clear transcript
            </button>
            <button className="primary-button" type="button" onClick={() => void sendTypedMessage(typedMessage)}>
              Send message
            </button>
          </div>
        </div>
      </>
    )
  }

  if (loading) {
    return <div className="loading-state">Loading the local Qwen lab…</div>
  }

  return (
    <>
      <main className="shell" ref={shellRef} style={shellStyle}>
      <section className="panel panel-controls">
        {workspace === 'tts' ? renderTtsControls() : renderVoiceChatControls()}
        {error ? <p className="error-banner">{error}</p> : null}
      </section>
      <button className="shell-resizer" type="button" aria-label="Resize settings sidebar" onPointerDown={startSidebarResize}>
        <span className="shell-resizer-track" aria-hidden="true" />
        <span className="shell-resizer-grip" aria-hidden="true">
          ||
        </span>
      </button>
      <section className="panel panel-results">{workspace === 'tts' ? renderRunResults() : renderChatResults()}</section>
      </main>
      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">
            <p className="toast-message">{toast.message}</p>
            <button className="toast-dismiss" type="button" aria-label="Dismiss message" onClick={() => dismissToast(toast.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

export default App
