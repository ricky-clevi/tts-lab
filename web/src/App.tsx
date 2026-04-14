import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import { AudioCapture } from './audioCapture'
import {
  createReplyVoiceCloneProfile,
  fetchMetrics,
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
import { detectLocale, persistLocale, translate, type Locale } from './i18n'
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
  MetricsResponse,
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
      runtimeMode: 'quality' | 'balanced'
      language: string
      speaker: string
      instruct: string
      blockMaxSentences: string
      blockMaxChars: string
      blockHoldMs: string
      warmupOnConnect: boolean
      emitPerfMetrics: boolean
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

type PerfMetric = {
  id: string
  name: string
  valueMs: number
  segmentIndex?: number
}

type SettingsSectionId = 'provider' | 'conversation' | 'asr' | 'replyVoice'
type TranslationFunction = (key: string, variables?: Record<string, number | string>) => string

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

function formatTimestamp(isoTimestamp: string, locale: Locale) {
  return new Date(isoTimestamp).toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US')
}

function brandQwenText(value: string | null | undefined) {
  return (value ?? '').replace(/qwen/gi, (match) => {
    if (match === match.toUpperCase()) return 'IVY'
    if (match === match.toLowerCase()) return 'ivy'
    return 'Ivy'
  })
}

const LANGUAGE_KEY_BY_VALUE: Record<string, string> = {
  Auto: 'language.auto',
  English: 'language.english',
  Korean: 'language.korean',
}

const PROVIDER_KEY_BY_ID: Record<ProviderId, string> = {
  openai_compatible: 'provider.openai_compatible',
  gemini: 'provider.gemini',
  anthropic: 'provider.anthropic',
}

const MODE_KEY_BY_ID: Record<Mode, string> = {
  custom: 'mode.custom',
  design: 'mode.design',
  clone: 'mode.clone',
}

const REPLY_VOICE_MODE_KEY_BY_ID: Record<'custom' | 'design' | 'clone', string> = {
  custom: 'mode.reply.custom',
  design: 'mode.reply.design',
  clone: 'mode.reply.clone',
}

const CONVERSATION_PHASE_KEY_BY_ID: Record<ConversationStatus, string> = {
  idle: 'conversationPhase.idle',
  listening: 'conversationPhase.listening',
  transcribing: 'conversationPhase.transcribing',
  thinking: 'conversationPhase.thinking',
  speaking: 'conversationPhase.speaking',
}

const LIVE_STATUS_KEY_BY_ID: Record<LiveStreamState['status'], string> = {
  idle: 'live.state.idle',
  streaming: 'live.state.streaming',
  complete: 'live.state.complete',
  error: 'live.state.error',
}

function translateLanguageName(language: string, t: TranslationFunction) {
  const key = LANGUAGE_KEY_BY_VALUE[language]
  return key ? t(key) : language
}

function translateProviderName(provider: ProviderId, fallback: string, t: TranslationFunction) {
  const key = PROVIDER_KEY_BY_ID[provider]
  const translated = t(key)
  return translated === key ? fallback : translated
}

function translateModeName(mode: Mode, fallback: string, t: TranslationFunction) {
  const key = MODE_KEY_BY_ID[mode]
  const translated = t(key)
  return translated === key ? fallback : translated
}

function translateModeDescription(mode: Mode, fallback: string, t: TranslationFunction) {
  const key = `mode.description.${mode}`
  const translated = t(key)
  return translated === key ? fallback : translated
}

function translateReplyVoiceMode(mode: 'custom' | 'design' | 'clone', t: TranslationFunction) {
  return t(REPLY_VOICE_MODE_KEY_BY_ID[mode])
}

function translateConversationStatusText(status: ConversationStatus, t: TranslationFunction) {
  return t(CONVERSATION_PHASE_KEY_BY_ID[status])
}

function translateLiveStatusText(status: LiveStreamState['status'], t: TranslationFunction) {
  return t(LIVE_STATUS_KEY_BY_ID[status])
}

function translatePerfMetricName(name: string, t: TranslationFunction) {
  const key = `metric.perf.${name}`
  const translated = t(key)
  return translated === key ? name : translated
}

function composeLocalizedInstruction(
  t: TranslationFunction,
  baseInstruction: string,
  style: StyleControls,
  mode: 'custom' | 'design',
) {
  const guidance = [
    mode === 'custom' ? t('style.prompt.preservePreset') : '',
    t(`style.prompt.mood.${style.mood}`),
    t(`style.prompt.emotionIntensity.${style.emotionIntensity}`),
    t(`style.prompt.pace.${style.pace}`),
    t(`style.prompt.energy.${style.energy}`),
    t(`style.prompt.expressiveness.${style.expressiveness}`),
  ].filter(Boolean)

  if (
    style.mood !== 'sad' &&
    (style.emotionIntensity === 'restrained' || style.expressiveness === 'controlled')
  ) {
    guidance.push(t('style.prompt.avoidSadness'))
  }

  const customGuidance = baseInstruction.trim()
  if (customGuidance) {
    guidance.push(t('style.prompt.additionalGuidance', { text: customGuidance }))
  }

  return guidance.join(' ')
}

function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')

  // inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  // bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // unordered list items (lines starting with * or -)
  html = html.replace(/^[\*\-]\s+(.+)$/gm, '<li>$1</li>')
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')

  // line breaks (double newline = paragraph break, single = <br>)
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim()
      if (!trimmed || trimmed.startsWith('<pre>') || trimmed.startsWith('<ul>')) return trimmed
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`
    })
    .filter(Boolean)
    .join('')

  return html
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
        runtimeMode: response.defaults.reply_voice.runtime_mode ?? 'balanced',
        language: response.defaults.reply_voice.language,
        speaker: response.defaults.reply_voice.speaker,
        instruct: response.defaults.reply_voice.instruct,
        blockMaxSentences: String(response.defaults.reply_voice.block_max_sentences ?? 2),
        blockMaxChars: String(response.defaults.reply_voice.block_max_chars ?? 180),
        blockHoldMs: String(response.defaults.reply_voice.block_hold_ms ?? 220),
        warmupOnConnect: response.defaults.reply_voice.warmup_on_connect ?? true,
        emitPerfMetrics: response.defaults.reply_voice.emit_perf_metrics ?? false,
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
        runtime_mode: form.defaults.replyVoice.runtimeMode,
        language: form.defaults.replyVoice.language,
        speaker: form.defaults.replyVoice.speaker,
        instruct: form.defaults.replyVoice.instruct,
        block_max_sentences: Number(form.defaults.replyVoice.blockMaxSentences) || 2,
        block_max_chars: Number(form.defaults.replyVoice.blockMaxChars) || 180,
        block_hold_ms: Number(form.defaults.replyVoice.blockHoldMs) || 220,
        warmup_on_connect: form.defaults.replyVoice.warmupOnConnect,
        emit_perf_metrics: form.defaults.replyVoice.emitPerfMetrics,
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
      systemPrompt: translate(detectLocale(), 'defaults.systemPrompt'),
      temperature: '0.7',
      maxOutputTokens: '512',
      asrModel: defaultAsrModel,
      asrLanguage: 'Auto',
      silenceTimeoutMs: '1200',
      maxTurnSeconds: '45',
      liveCaptions: true,
      replyVoice: {
        mode: 'custom',
        runtimeMode: 'balanced',
        language: 'English',
        speaker: 'Ryan',
        instruct: '',
        blockMaxSentences: '2',
        blockMaxChars: '180',
        blockHoldMs: '220',
        warmupOnConnect: true,
        emitPerfMetrics: false,
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / 1024 ** 2
  return `${mb.toFixed(0)} MB`
}

function SystemMetrics({ t }: { t: TranslationFunction }) {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let alive = true

    async function poll() {
      try {
        const data = await fetchMetrics()
        if (alive) setMetrics(data)
      } catch {
        // swallow transient fetch failures
      }
    }

    void poll()
    intervalRef.current = setInterval(() => void poll(), 2000)

    return () => {
      alive = false
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  if (!metrics) return null

  const gpuBytes = metrics.gpu_used_bytes > 0 ? metrics.gpu_used_bytes : metrics.mlx_gpu_active_bytes
  const gpuTotalBytes =
    metrics.gpu_total_bytes > 0 ? metrics.gpu_total_bytes : metrics.ram_total_bytes
  const gpuDetail = metrics.gpu_backend === 'cuda'
    ? t('metric.cudaTitle', {
        device: metrics.gpu_name ?? metrics.gpu_device ?? 'CUDA',
        used: formatBytes(metrics.gpu_used_bytes),
        total: formatBytes(metrics.gpu_total_bytes),
        reserved: formatBytes(metrics.gpu_reserved_bytes),
        peak: formatBytes(metrics.gpu_peak_bytes),
        utilPart:
          metrics.gpu_utilization_percent !== null
            ? t('metric.cudaUtilPart', { value: metrics.gpu_utilization_percent.toFixed(0) })
            : '',
        tempPart:
          metrics.gpu_temperature_c !== null
            ? t('metric.cudaTempPart', { value: metrics.gpu_temperature_c.toFixed(0) })
            : '',
      })
    : t('metric.mlxTitle', {
        active: formatBytes(metrics.mlx_gpu_active_bytes),
        peak: formatBytes(metrics.mlx_gpu_peak_bytes),
        cache: formatBytes(metrics.mlx_gpu_cache_bytes),
      })

  return (
    <div className="system-metrics">
      <span title={t('metric.cpuTitle')}>
        {t('metric.cpu')} {metrics.cpu_percent.toFixed(0)}%
      </span>
      <span title={t('metric.ramTitle', { used: formatBytes(metrics.ram_used_bytes), total: formatBytes(metrics.ram_total_bytes) })}>
        {t('metric.ram')} {metrics.ram_percent.toFixed(0)}%
      </span>
      {gpuBytes > 0 ? (
        <span title={gpuDetail}>
          {t('metric.gpu')} {(gpuBytes / gpuTotalBytes * 100).toFixed(0)}%
        </span>
      ) : null}
    </div>
  )
}

function App() {
  const [locale, setLocale] = useState<Locale>(() => detectLocale())
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
  const [customForm, setCustomForm] = useState<CustomFormState>(() => ({
    language: locale === 'ko' ? 'Korean' : 'English',
    speaker: 'Ryan',
    instruct: '',
    style: makeStyleControls(),
    segments: [makeSegment()],
    generation: { temperature: '', top_p: '', max_new_tokens: '', seed: '' },
  }))
  const [designForm, setDesignForm] = useState<DesignFormState>(() => ({
    language: locale === 'ko' ? 'Korean' : 'English',
    instruct: '',
    style: makeStyleControls(),
    segments: [makeSegment()],
    generation: { temperature: '', top_p: '', max_new_tokens: '', seed: '' },
  }))
  const [cloneForm, setCloneForm] = useState<CloneFormState>(() => ({
    language: 'Auto',
    refText: '',
    xVectorOnlyMode: false,
    referenceFile: null,
    segments: [makeSegment()],
    generation: { temperature: '', top_p: '', max_new_tokens: '', seed: '' },
  }))
  const [streamSettings, setStreamSettings] = useState<StreamSettings>({
    enabled: false,
    autoplay: true,
    streamingInterval: '0.32',
  })
  const [liveStream, setLiveStream] = useState<LiveStreamState>(makeLiveStreamState())
  const [conversationStatus, setConversationStatus] = useState<ConversationStatus>('idle')
  const [conversationMessages, setConversationMessages] = useState<ChatMessage[]>([])
  const [liveCaption, setLiveCaption] = useState('')
  const [perfMetrics, setPerfMetrics] = useState<PerfMetric[]>([])
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
  const t = useMemo<TranslationFunction>(
    () => (key, variables) => translate(locale, key, variables),
    [locale],
  )

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
    persistLocale(locale)
  }, [locale])

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
          setError(loadError instanceof Error ? loadError.message : t('error.unreachableApi'))
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
        reject(new Error(t('error.connectConversation')))
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
        settleFailure(t('error.openConversationSocket'))
      }

      socket.onclose = (event) => {
        if (!settled) {
          settleFailure(
            event.code === 1006
              ? t('error.socketClosedBeforeConnected')
              : t('error.socketClosedBeforeConnectedWithCode', { code: event.code }),
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
              ? t('error.socketDropped')
              : t('error.socketClosedUnexpectedlyWithCode', { code: event.code }),
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
      throw new Error(t('error.chooseReferenceVoiceClip'))
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
          runtimeMode: 'quality',
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
    pushToast(
      'success',
      auto
        ? t('toast.clonePreparedAuto', { label: profile.label })
        : t('toast.clonePrepared', { label: profile.label }),
    )
    return nextSettings
  }

  async function ensureReplyVoiceReady() {
    if (chatSettings.defaults.replyVoice.mode !== 'clone') {
      return chatSettings
    }

    if (
      chatSettings.defaults.replyVoice.cloneAudioPath &&
      chatSettings.defaults.replyVoice.cloneReferenceText
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
        pushToast('success', t('toast.voiceChatConnected'))
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
      if (event.phase === 'listening' && captureRef.current) {
        const player = chatPlayerRef.current
        if (player && player.isPlaying) {
          player.onPlaybackEnd = () => {
            player.onPlaybackEnd = null
            listeningEnabledRef.current = true
            speechDetectedRef.current = false
            silenceStartedAtRef.current = null
            speechStartedAtRef.current = null
          }
        } else {
          listeningEnabledRef.current = true
          speechDetectedRef.current = false
          silenceStartedAtRef.current = null
          speechStartedAtRef.current = null
        }
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

    if (event.type === 'perf.metric') {
      setPerfMetrics((current) => {
        const metric: PerfMetric = {
          id: makeId(),
          name: event.name,
          valueMs: event.value_ms,
          segmentIndex: event.segment_index,
        }
        return [metric, ...current].slice(0, 8)
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
      message: t('live.message.waitingFirstChunk'),
    })

    const autoplay = streamSettings.autoplay
    let completedRun: GenerationRun | null = null

    if (autoplay) {
      await startLivePlayback()
      setLiveStream((current) => ({
        ...current,
        message: t('live.message.openingOutput'),
      }))
    }

    const applyEvent = async (event: StreamRunEvent) => {
      if (event.type === 'run_start') {
        setLiveStream((current) => ({ ...current, run: event.run, message: t('live.message.generating') }))
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
          message: t('live.message.streamingSegment', { index: event.segment_index + 1 }),
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
          message: t('live.message.segmentReady', { index: event.segment_index + 1 }),
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
          message: t('live.message.finished'),
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
        throw new Error(t('error.addReferenceClip'))
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
          throw new Error(t('error.addReferenceClip'))
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
      setError(runError instanceof Error ? runError.message : t('error.generationFailed'))
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
      pushToast('success', t('toast.settingsSaved'))
      const socket = socketRef.current
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'session.configure', settings: serializeSettings(mappedSettings) }))
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('error.saveSettingsFailed'))
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
      pushToast(
        result.success ? 'success' : 'error',
        result.success
          ? t('toast.providerConnectionOk', { latency: result.latency_ms ?? 0 })
          : result.error ?? t('error.providerTestFailed'),
      )
    } catch (testError) {
      pushToast('error', testError instanceof Error ? testError.message : t('error.providerTestFailed'))
    }
  }

  async function startConversation() {
    try {
      const effectiveSettings = await ensureReplyVoiceReady()
      const socket = await ensureConversationSocket(effectiveSettings)
      if (micActive) {
        return
      }

      setPerfMetrics([])
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
        conversationError instanceof Error ? conversationError.message : t('error.startMicrophoneFailed'),
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
      pushToast('error', submitError instanceof Error ? submitError.message : t('error.sendMessageFailed'))
    }
  }

  async function handleFileTranscription() {
    if (!fileUpload) {
      pushToast('error', t('error.chooseAudioFile'))
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
      pushToast('success', t('toast.transcriptionFinished'))
      if (fileSendToChat && transcript.text) {
        await sendTypedMessage(transcript.text)
      }
    } catch (transcriptionError) {
      pushToast(
        'error',
        transcriptionError instanceof Error ? transcriptionError.message : t('error.transcribeFileFailed'),
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
        cloneError instanceof Error ? cloneError.message : t('error.prepareClonedReplyVoiceFailed'),
      )
    }
  }

  function renderSegments(segments: Segment[]) {
    return segments.map((segment, index) => (
      <div className="segment-row" key={segment.id}>
        <label className="field-label" htmlFor={segment.id}>
          {t('field.textSegment', { index: index + 1 })}
        </label>
        <textarea
          id={segment.id}
          className="text-input segment-input"
          value={segment.text}
          onChange={(event) => updateSegment(segment.id, event.target.value)}
          placeholder={t('placeholder.pasteText')}
          rows={3}
        />
        <button className="ghost-button" type="button" onClick={() => removeSegment(segment.id)} disabled={segments.length === 1}>
          {t('button.removeSegment')}
        </button>
      </div>
    ))
  }

  function renderGenerationControls(values: Record<string, string>, onChange: (key: string, value: string) => void) {
    return (
      <details className="advanced-panel">
        <summary>{t('generation.advanced')}</summary>
        <div className="advanced-grid">
          {[
            ['temperature', t('field.temperature'), '0.7', 'decimal'],
            ['top_p', t('generation.topP'), '0.9', 'decimal'],
            ['max_new_tokens', t('generation.maxNewTokens'), '2048', 'numeric'],
            ['seed', t('generation.seed'), t('generation.seedPlaceholder'), 'numeric'],
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
    const stylePreview = composeLocalizedInstruction(t, '', values, styleMode)

    return (
      <section className="style-panel">
        <div className="style-panel-head">
          <div>
            <p className="mode-label">{t('style.title')}</p>
            <p className="style-panel-copy">
              {t('style.copy')}
            </p>
          </div>
        </div>
        <div className="style-grid">
          {[
            { key: 'mood', label: t('style.category.mood'), options: MOOD_OPTIONS },
            { key: 'emotionIntensity', label: t('style.category.emotionIntensity'), options: EMOTION_INTENSITY_OPTIONS },
            { key: 'pace', label: t('style.category.pace'), options: PACE_OPTIONS },
            { key: 'energy', label: t('style.category.energy'), options: ENERGY_OPTIONS },
            { key: 'expressiveness', label: t('style.category.expressiveness'), options: EXPRESSIVENESS_OPTIONS },
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
                    {t(`style.option.${key}.${option.id}`)}
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
            <p className="mode-label">{t('stream.title')}</p>
            <p className="style-panel-copy">{t('stream.copy')}</p>
          </div>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={streamSettings.enabled}
            onChange={(event) => setStreamSettings((current) => ({ ...current, enabled: event.target.checked }))}
          />
          <span>{t('stream.enable')}</span>
        </label>
        {streamSettings.enabled ? (
          <div className="style-grid">
            <label className="field">
              <span className="field-label">{t('field.chunkIntervalSeconds')}</span>
              <input
                className="text-input"
                inputMode="decimal"
                value={streamSettings.streamingInterval}
                onChange={(event) => setStreamSettings((current) => ({ ...current, streamingInterval: event.target.value }))}
                placeholder={t('placeholder.chunkInterval')}
              />
            </label>
            <label className="toggle stream-toggle">
              <input
                type="checkbox"
                checked={streamSettings.autoplay}
                onChange={(event) => setStreamSettings((current) => ({ ...current, autoplay: event.target.checked }))}
              />
              <span>{t('stream.autoplay')}</span>
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
            <p className="eyebrow">{t('live.eyebrow')}</p>
            <p className="run-title">
              {liveStream.mode
                ? t('live.modeStream', { mode: translateModeName(liveStream.mode, liveStream.mode, t) })
                : t('live.streamingGeneration')}
            </p>
            <p className="clip-copy">{liveStream.message}</p>
          </div>
          <div className="live-stream-actions">
            {!streamSettings.autoplay && liveStream.status === 'streaming' ? (
              <button className="ghost-button" type="button" onClick={() => void startLivePlayback()}>
                {liveStream.playbackStarted ? t('button.playbackRunning') : t('button.startPlayback')}
              </button>
            ) : null}
            {liveStream.playbackStarted ? (
              <button className="ghost-button" type="button" onClick={() => void stopLivePlayback()}>
                {t('button.stopPlayback')}
              </button>
            ) : null}
          </div>
        </div>
        <dl className="clip-meta">
          <div>
            <dt>{t('live.status')}</dt>
            <dd>{translateLiveStatusText(liveStream.status, t)}</dd>
          </div>
          <div>
            <dt>{t('live.chunks')}</dt>
            <dd>{liveStream.chunksReceived}</dd>
          </div>
          <div>
            <dt>{t('live.buffered')}</dt>
            <dd>{t('unit.secondsShort', { value: liveStream.bufferedSeconds })}</dd>
          </div>
          <div>
            <dt>{t('live.mode')}</dt>
            <dd>{liveStream.mode ? translateModeName(liveStream.mode, liveStream.mode, t) : t('status.na')}</dd>
          </div>
        </dl>
      </section>
    )
  }

  function renderTtsControls() {
    return (
      <>
        <div className="hero">
          <p className="eyebrow">{t('tts.eyebrow')}</p>
          <h1>{t('app.title')}</h1>
          <p className="lead">{t('tts.lead')}</p>
        </div>

        <div className="status-strip">
          <span>{t('status.device')}: {health?.selected_device ?? t('status.na')}</span>
          <span>{t('status.activeMode')}: {health?.active_mode ? translateModeName(health.active_mode, health.active_mode, t) : t('status.idle')}</span>
        </div>
        <SystemMetrics t={t} />

        <div className="workspace-tabs">
          <button className={workspace === 'tts' ? 'tab tab-active' : 'tab'} type="button" onClick={() => setWorkspace('tts')}>
            {t('workspace.tts')}
          </button>
          <button className={workspace === 'chat' ? 'tab tab-active' : 'tab'} type="button" onClick={() => setWorkspace('chat')}>
            {t('workspace.chat')}
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
              {translateModeName(item.id, item.label, t)}
            </button>
          ))}
        </div>

        <section className="mode-summary">
          <p className="mode-label">{modeMeta ? translateModeName(modeMeta.id, modeMeta.label, t) : ''}</p>
          <p className="lead">{modeMeta ? translateModeDescription(modeMeta.id, modeMeta.description, t) : ''}</p>
          <p className="hint">{brandQwenText(modeMeta?.checkpoint)}</p>
        </section>

        <section className="editor">
          {mode === 'custom' ? (
            <>
              <label className="field">
                <span className="field-label">{t('field.language')}</span>
                <select className="text-input" value={customForm.language} onChange={(event) => setCustomForm((current) => ({ ...current, language: event.target.value }))}>
                  {capabilities?.languages.map((language) => (
                    <option key={language} value={language}>
                      {translateLanguageName(language, t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">{t('field.speaker')}</span>
                <select className="text-input" value={customForm.speaker} onChange={(event) => setCustomForm((current) => ({ ...current, speaker: event.target.value }))}>
                  {capabilities?.speakers.map((speaker) => (
                    <option key={speaker.id} value={speaker.id}>
                      {speaker.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">{t('field.additionalInstruction')}</span>
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
                <span className="field-label">{t('field.language')}</span>
                <select className="text-input" value={designForm.language} onChange={(event) => setDesignForm((current) => ({ ...current, language: event.target.value }))}>
                  {capabilities?.languages.map((language) => (
                    <option key={language} value={language}>
                      {translateLanguageName(language, t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">{t('field.voicePersona')}</span>
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
                <span className="field-label">{t('field.language')}</span>
                <select className="text-input" value={cloneForm.language} onChange={(event) => setCloneForm((current) => ({ ...current, language: event.target.value }))}>
                  {capabilities?.languages.map((language) => (
                    <option key={language} value={language}>
                      {translateLanguageName(language, t)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">{t('hint.cloneLanguageAuto')}</p>
              <label className="field">
                <span className="field-label">{t('field.referenceAudio')}</span>
                <input className="text-input" type="file" accept="audio/*" onChange={(event) => setCloneForm((current) => ({ ...current, referenceFile: event.target.files?.[0] ?? null }))} />
              </label>
              <label className="field">
                <span className="field-label">{t('field.referenceTranscript')}</span>
                <textarea className="text-input segment-input" value={cloneForm.refText} onChange={(event) => setCloneForm((current) => ({ ...current, refText: event.target.value }))} rows={3} />
              </label>
              <p className="hint">{t('hint.cloneTranscriptMatch')}</p>
              <p className="hint">{t('hint.cloneTranscriptBlank')}</p>
              <label className="toggle">
                <input type="checkbox" checked={cloneForm.xVectorOnlyMode} onChange={(event) => setCloneForm((current) => ({ ...current, xVectorOnlyMode: event.target.checked }))} />
                <span>{t('toggle.xVectorOnly')}</span>
              </label>
              <p className="hint">{t('hint.cloneXVector')}</p>
              {renderSegments(cloneForm.segments)}
              {renderGenerationControls(cloneForm.generation, (key, value) => setCloneForm((current) => ({ ...current, generation: { ...current.generation, [key]: value } })))}
            </>
          ) : null}

          {renderStreamControls()}

          <div className="controls-footer">
            <button className="ghost-button" type="button" onClick={addSegment}>
              {t('button.addSegment')}
            </button>
            <button className="primary-button" type="button" onClick={() => void handleGenerate()} disabled={pending}>
              {pending ? t('button.generating') : t('button.generateAudio')}
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
              {translateProviderName(provider, provider, t)}
            </button>
          ))}
        </div>
        <div className="responsive-field-grid">
          <label className="field">
            <span className="field-label">{t('field.baseUrl')}</span>
            <input
              className="text-input"
              value={currentProviderConfig.baseUrl}
              onChange={(event) =>
                setProviderConfig(providerTab, (current) => ({ ...current, baseUrl: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span className="field-label">{t('field.apiKey')}</span>
            <input
              className="text-input"
              type="password"
              value={currentProviderConfig.apiKey}
              onChange={(event) =>
                setProviderConfig(providerTab, (current) => ({ ...current, apiKey: event.target.value }))
              }
              placeholder={currentProviderConfig.hasApiKey ? currentProviderConfig.maskedApiKey ?? t('placeholder.apiKeySaved') : t('placeholder.apiKeyEnter')}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('field.model')}</span>
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
          <p className="hint">{t('hint.detectedApiMode', { mode: currentProviderConfig.apiMode })}</p>
        ) : null}
        <div className="controls-footer">
          <button className="ghost-button" type="button" onClick={() => void handleProviderTest()}>
            {t('button.testConnection')}
          </button>
          <button className="primary-button" type="button" onClick={() => void handleSaveSettings()}>
            {t('button.saveSettings')}
          </button>
        </div>
      </>
    )
  }

  function renderVoiceChatControls() {
    return (
      <>
        <div className="hero">
          <p className="eyebrow">{t('voiceChat.eyebrow')}</p>
          <h1>{t('voiceChat.title')}</h1>
          <p className="lead">{t('voiceChat.lead')}</p>
        </div>
        <div className="status-strip">
          <span>{t('status.asr')}: {brandQwenText((health?.active_asr_model ?? chatSettings.defaults.asrModel) || t('status.idle'))}</span>
          <span>{t('status.phase')}: {translateConversationStatusText(conversationStatus, t)}</span>
        </div>
        <SystemMetrics t={t} />
        <div className="workspace-tabs">
          <button className={workspace === 'tts' ? 'tab tab-active' : 'tab'} type="button" onClick={() => setWorkspace('tts')}>
            {t('workspace.tts')}
          </button>
          <button className={workspace === 'chat' ? 'tab tab-active' : 'tab'} type="button" onClick={() => setWorkspace('chat')}>
            {t('workspace.chat')}
          </button>
        </div>
        <div className="settings-board">
          {renderSettingsSection(
            'provider',
            t('section.provider'),
            renderProviderPanel(),
            t('section.provider.copy'),
            'settings-section-compact',
          )}
          {renderSettingsSection(
            'conversation',
            t('section.conversation'),
            <>
              <div className="responsive-field-grid">
                <label className="field">
                  <span className="field-label">{t('field.activeProvider')}</span>
                  <select className="text-input" value={chatSettings.defaults.activeProvider} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, activeProvider: event.target.value as ProviderId } }))}>
                    {capabilities?.chat.providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {translateProviderName(provider.id, provider.label, t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field field-span-full">
                  <span className="field-label">{t('field.systemPrompt')}</span>
                  <textarea className="text-input segment-input" value={chatSettings.defaults.systemPrompt} rows={4} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, systemPrompt: event.target.value } }))} />
                </label>
              </div>
              <div className="responsive-field-grid">
                <label className="field">
                  <span className="field-label">{t('field.temperature')}</span>
                  <input className="text-input" inputMode="decimal" value={chatSettings.defaults.temperature} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, temperature: event.target.value } }))} />
                </label>
                <label className="field">
                  <span className="field-label">{t('field.maxOutputTokens')}</span>
                  <input className="text-input" inputMode="numeric" value={chatSettings.defaults.maxOutputTokens} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, maxOutputTokens: event.target.value } }))} />
                </label>
              </div>
              <p className="hint">{t('hint.replyChunking')}</p>
            </>,
            t('section.conversation.copy'),
            'settings-section-compact',
          )}
          {renderSettingsSection(
            'asr',
            t('section.asr'),
            <>
              <div className="responsive-field-grid">
                <label className="field">
                  <span className="field-label">{t('field.model')}</span>
                  <select className="text-input" value={chatSettings.defaults.asrModel} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, asrModel: event.target.value } }))}>
                    {capabilities?.asr.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">{t('field.language')}</span>
                  <select className="text-input" value={chatSettings.defaults.asrLanguage} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, asrLanguage: event.target.value } }))}>
                    {capabilities?.languages.map((language) => (
                      <option key={language} value={language}>
                        {translateLanguageName(language, t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">{t('field.silenceTimeoutMs')}</span>
                  <input className="text-input" inputMode="numeric" value={chatSettings.defaults.silenceTimeoutMs} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, silenceTimeoutMs: event.target.value } }))} />
                </label>
                <label className="field">
                  <span className="field-label">{t('field.maxTurnSeconds')}</span>
                  <input className="text-input" inputMode="numeric" value={chatSettings.defaults.maxTurnSeconds} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, maxTurnSeconds: event.target.value } }))} />
                </label>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={chatSettings.defaults.liveCaptions} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, liveCaptions: event.target.checked } }))} />
                <span>{t('toggle.liveCaptions')}</span>
              </label>
              <div className="upload-card">
                <label className="field">
                  <span className="field-label">{t('field.uploadAudio')}</span>
                  <input className="text-input" type="file" accept="audio/*" onChange={(event) => setFileUpload(event.target.files?.[0] ?? null)} />
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={fileSendToChat} onChange={(event) => setFileSendToChat(event.target.checked)} />
                  <span>{t('toggle.sendTranscript')}</span>
                </label>
                <button className="ghost-button" type="button" onClick={() => void handleFileTranscription()}>
                  {t('button.transcribeFile')}
                </button>
                {fileTranscript ? <p className="style-preview">{fileTranscript.text}</p> : null}
              </div>
            </>,
            t('section.asr.copy'),
            'settings-section-compact',
          )}
          {renderSettingsSection(
            'replyVoice',
            t('section.replyVoice'),
            <>
              <div className="responsive-field-grid">
                <label className="field">
                  <span className="field-label">{t('field.voiceMode')}</span>
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
                    <option value="custom">{translateReplyVoiceMode('custom', t)}</option>
                    <option value="design">{translateReplyVoiceMode('design', t)}</option>
                    <option value="clone">{translateReplyVoiceMode('clone', t)}</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">{t('field.language')}</span>
                  <select className="text-input" value={chatSettings.defaults.replyVoice.language} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, replyVoice: { ...current.defaults.replyVoice, language: event.target.value } } }))}>
                    {capabilities?.languages.map((language) => (
                      <option key={language} value={language}>
                        {translateLanguageName(language, t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">{t('field.runtimeMode')}</span>
                  <select
                    className="text-input"
                    value={chatSettings.defaults.replyVoice.runtimeMode}
                    onChange={(event) =>
                      setChatSettings((current) => ({
                        ...current,
                        defaults: {
                          ...current.defaults,
                          replyVoice: {
                            ...current.defaults.replyVoice,
                            runtimeMode: event.target.value as 'quality' | 'balanced',
                          },
                        },
                      }))
                    }
                  >
                    <option value="quality">{t('runtimeMode.quality')}</option>
                    <option value="balanced">{t('runtimeMode.balanced')}</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">{t('field.maxSentencesPerBlock')}</span>
                  <input className="text-input" inputMode="numeric" value={chatSettings.defaults.replyVoice.blockMaxSentences} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, replyVoice: { ...current.defaults.replyVoice, blockMaxSentences: event.target.value } } }))} />
                </label>
                <label className="field">
                  <span className="field-label">{t('field.maxCharsPerBlock')}</span>
                  <input className="text-input" inputMode="numeric" value={chatSettings.defaults.replyVoice.blockMaxChars} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, replyVoice: { ...current.defaults.replyVoice, blockMaxChars: event.target.value } } }))} />
                </label>
                <label className="field">
                  <span className="field-label">{t('field.blockHoldMs')}</span>
                  <input className="text-input" inputMode="numeric" value={chatSettings.defaults.replyVoice.blockHoldMs} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, replyVoice: { ...current.defaults.replyVoice, blockHoldMs: event.target.value } } }))} />
                </label>
                {chatSettings.defaults.replyVoice.mode === 'custom' ? (
                  <label className="field">
                    <span className="field-label">{t('field.speaker')}</span>
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
              <div className="responsive-field-grid">
                <label className="toggle">
                  <input type="checkbox" checked={chatSettings.defaults.replyVoice.warmupOnConnect} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, replyVoice: { ...current.defaults.replyVoice, warmupOnConnect: event.target.checked } } }))} />
                  <span>{t('toggle.warmupOnConnect')}</span>
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={chatSettings.defaults.replyVoice.emitPerfMetrics} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, replyVoice: { ...current.defaults.replyVoice, emitPerfMetrics: event.target.checked } } }))} />
                  <span>{t('toggle.showLatencyMetrics')}</span>
                </label>
              </div>
              {chatSettings.defaults.replyVoice.mode === 'clone' ? (
                <div className="upload-card reply-voice-clone-grid">
                  <label className="field field-span-full">
                    <span className="field-label">{t('field.referenceVoiceClip')}</span>
                    <input
                      className="text-input"
                      type="file"
                      accept="audio/*"
                      onChange={(event) => {
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
                      }}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">{t('field.voiceLabel')}</span>
                    <input
                      className="text-input"
                      value={replyVoiceCloneDraft.label}
                      onChange={(event) =>
                        setReplyVoiceCloneDraft((current) => ({ ...current, label: event.target.value }))
                      }
                      placeholder={t('placeholder.voiceLabel')}
                    />
                  </label>
                  <div className="reply-voice-clone-status">
                    {chatSettings.defaults.replyVoice.cloneProfileLabel ? (
                      <p className="hint">{t('hint.replyCloneReady', { label: chatSettings.defaults.replyVoice.cloneProfileLabel })}</p>
                    ) : (
                      <p className="hint">{t('hint.replyClonePrepare')}</p>
                    )}
                    {chatSettings.defaults.replyVoice.cloneReferenceText ? (
                      <p className="style-preview">{chatSettings.defaults.replyVoice.cloneReferenceText}</p>
                    ) : null}
                  </div>
                  <label className="field field-span-full">
                    <span className="field-label">{t('field.referenceTranscript')}</span>
                    <textarea
                      className="text-input segment-input"
                      value={replyVoiceCloneDraft.referenceText}
                      rows={3}
                      onChange={(event) => {
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
                      }}
                      placeholder={t('placeholder.referenceTranscript')}
                    />
                  </label>
                  <div className="controls-footer">
                    <button className="primary-button" type="button" onClick={() => void handlePrepareReplyVoiceClone()} disabled={replyVoiceCloneDraft.pending}>
                      {replyVoiceCloneDraft.pending ? t('button.preparing') : t('button.prepareClonedVoice')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="reply-voice-design-layout">
                  <label className="field field-span-full">
                    <span className="field-label">{t('field.baseGuidance')}</span>
                    <textarea className="text-input segment-input" value={chatSettings.defaults.replyVoice.instruct} rows={3} onChange={(event) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, replyVoice: { ...current.defaults.replyVoice, instruct: event.target.value } } }))} />
                  </label>
                  {renderStyleControls(chatSettings.defaults.replyVoice.style, (key, value) => setChatSettings((current) => ({ ...current, defaults: { ...current.defaults, replyVoice: { ...current.defaults.replyVoice, style: { ...current.defaults.replyVoice.style, [key]: value } } } })), chatSettings.defaults.replyVoice.mode)}
                </div>
              )}
            </>,
            t('section.replyVoice.copy'),
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
            <p className="eyebrow">{t('results.sessionOutput')}</p>
            <h2>{t('results.runHistory')}</h2>
          </div>
          <p className="results-count">{t('results.runCount', { count: runs.length })}</p>
        </div>
        {renderLiveStream()}
        {runs.length ? (
          <>
            <div className="history-list">
              {runs.map((run) => (
                <button key={run.run_id} className={run.run_id === activeRun?.run_id ? 'history-item history-item-active' : 'history-item'} type="button" onClick={() => setActiveRunId(run.run_id)}>
                  <span>{translateModeName(run.mode, run.mode, t)}</span>
                  <span>{formatTimestamp(run.created_at, locale)}</span>
                </button>
              ))}
            </div>
            {activeRun ? (
              <div className="run-detail">
                <div className="run-meta">
                  <span>{brandQwenText(activeRun.model_id)}</span>
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
                          {t('button.download')}
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
                          <dt>{t('field.language')}</dt>
                          <dd>{translateLanguageName(clip.language, t)}</dd>
                        </div>
                        <div>
                          <dt>{t('field.sampleRate')}</dt>
                          <dd>{t('unit.hertz', { value: clip.sample_rate })}</dd>
                        </div>
                        <div>
                          <dt>{t('field.duration')}</dt>
                          <dd>{t('unit.secondsShort', { value: clip.duration_seconds })}</dd>
                        </div>
                        <div>
                          <dt>{t('field.speaker')}</dt>
                          <dd>{clip.speaker ?? t('speaker.designed')}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty-state">{t('results.noRuns')}</div>
        )}
      </>
    )
  }

  function renderChatResults() {
    return (
      <>
        <div className="results-header">
          <div>
            <p className="eyebrow">{t('results.conversation')}</p>
            <h2>{t('results.realtimeVoiceLoop')}</h2>
          </div>
          <p className="results-count">{t('results.messageCount', { count: conversationMessages.length })}</p>
        </div>
        <div className="chat-status-card">
          <div>
            <p className="mode-label">{t('status.state')}</p>
            <p className="lead">{translateConversationStatusText(conversationStatus, t)}</p>
          </div>
          <div className="chat-actions">
            {!micActive ? (
              <button className="primary-button" type="button" onClick={() => void startConversation()}>
                {t('button.startConversation')}
              </button>
            ) : (
              <button className="ghost-button" type="button" onClick={() => void stopConversationListening()}>
                {t('button.stopListening')}
              </button>
            )}
            <button className="ghost-button" type="button" onClick={() => void interruptAssistant()}>
              {t('button.interruptAssistant')}
            </button>
          </div>
        </div>
        <SystemMetrics t={t} />
        {liveCaption ? <div className="caption-strip">{liveCaption}</div> : null}
        {perfMetrics.length ? (
          <details className="perf-card">
            <summary className="mode-label">{t('results.latencyMetrics', { count: perfMetrics.length })}</summary>
            <div className="perf-grid">
              {perfMetrics.map((metric) => (
                <div className="perf-item" key={metric.id}>
                  <p className="eyebrow">{translatePerfMetricName(metric.name, t)}</p>
                  <p className="lead">{metric.valueMs.toFixed(1)} ms</p>
                  {metric.segmentIndex !== undefined ? (
                    <p className="hint">{t('results.segment', { index: metric.segmentIndex + 1 })}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
        <div className="chat-thread">
          {conversationMessages.length ? (
            conversationMessages.map((message) => (
              <article key={message.id} className={`chat-bubble chat-bubble-${message.role}`}>
                <p className="eyebrow">{message.role === 'user' ? t('chatRole.user') : t('chatRole.assistant')}</p>
                <div className="chat-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }} />
              </article>
            ))
          ) : (
            <div className="empty-state">{t('results.noConversation')}</div>
          )}
        </div>
        <div className="chat-composer">
          <textarea className="text-input segment-input" value={typedMessage} rows={4} placeholder={t('placeholder.typedMessage')} onChange={(event) => setTypedMessage(event.target.value)} />
          <div className="controls-footer">
            <button className="ghost-button" type="button" onClick={() => setConversationMessages([])}>
              {t('button.clearTranscript')}
            </button>
            <button className="primary-button" type="button" onClick={() => void sendTypedMessage(typedMessage)}>
              {t('button.sendMessage')}
            </button>
          </div>
        </div>
      </>
    )
  }

  if (loading) {
    return <div className="loading-state">{t('app.loading')}</div>
  }

  return (
    <>
      <main className="shell" ref={shellRef} style={shellStyle}>
        <section className="panel panel-controls">
          <div className="panel-topbar">
            <div className="locale-switcher" role="group" aria-label={t('languageSwitcher.label')}>
              <button className={locale === 'en' ? 'locale-button locale-button-active' : 'locale-button'} type="button" onClick={() => setLocale('en')}>
                {t('languageSwitcher.en')}
              </button>
              <button className={locale === 'ko' ? 'locale-button locale-button-active' : 'locale-button'} type="button" onClick={() => setLocale('ko')}>
                {t('languageSwitcher.ko')}
              </button>
            </div>
          </div>
          {workspace === 'tts' ? renderTtsControls() : renderVoiceChatControls()}
          {error ? <p className="error-banner">{error}</p> : null}
        </section>
        <button className="shell-resizer" type="button" aria-label={t('button.resizeSidebar')} onPointerDown={startSidebarResize}>
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
            <button className="toast-dismiss" type="button" aria-label={t('button.dismissMessage')} onClick={() => dismissToast(toast.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

export default App
