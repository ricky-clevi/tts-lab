export type Workspace = 'tts' | 'chat'
export type Mode = 'custom' | 'design' | 'clone'
export type ProviderId = 'openai_compatible' | 'gemini' | 'anthropic'
export type ReplyVoiceMode = 'custom' | 'design' | 'clone'

export type GenerationSettings = {
  temperature?: number
  top_p?: number
  max_new_tokens?: number
  seed?: number
}

export type StreamSettings = {
  enabled: boolean
  autoplay: boolean
  streamingInterval: string
}

export type Speaker = {
  id: string
  name: string
  description: string
  native_language: string
}

export type AsrModelCapability = {
  id: string
  label: string
  description: string
  checkpoint: string
}

export type ProviderCapability = {
  id: ProviderId
  label: string
  description: string
  base_url_configurable: boolean
  native: boolean
}

export type HealthResponse = {
  status: 'ok'
  active_mode: Mode | null
  active_model: string | null
  selected_device: string
  runtime_backend?: string | null
  runtime_platform?: string | null
  runtime_dtype?: string | null
  runtime_attention?: string | null
  active_asr_model: string | null
  selected_asr_device: string | null
}

export type MetricsResponse = {
  cpu_percent: number
  ram_used_bytes: number
  ram_total_bytes: number
  ram_percent: number
  gpu_backend: string
  gpu_device: string | null
  gpu_name: string | null
  gpu_used_bytes: number
  gpu_total_bytes: number
  gpu_reserved_bytes: number
  gpu_peak_bytes: number
  gpu_utilization_percent: number | null
  gpu_temperature_c: number | null
  mlx_gpu_active_bytes: number
  mlx_gpu_peak_bytes: number
  mlx_gpu_cache_bytes: number
}

export type CapabilitiesResponse = {
  active_mode: Mode | null
  selected_device: string
  runtime_backend?: string | null
  runtime_platform?: string | null
  runtime_dtype?: string | null
  runtime_attention?: string | null
  languages: string[]
  speakers: Speaker[]
  generation_knobs: Record<string, Record<string, number | null>>
  modes: Array<{
    id: Mode
    label: string
    description: string
    checkpoint: string
  }>
  asr: {
    default_model: string
    models: AsrModelCapability[]
  }
  chat: {
    providers: ProviderCapability[]
    reply_chunking: 'sentence'
    voice_modes: ReplyVoiceMode[]
  }
  conversation: {
    mode: 'turn_based_hands_free'
    input_audio_format: string
    input_sample_rate: number
    websocket_path: string
  }
}

export type AudioClip = {
  id: string
  audio_url: string
  file_name: string
  segment_index: number
  text: string
  language: string
  sample_rate: number
  duration_seconds: number
  speaker?: string | null
  instruct?: string | null
  x_vector_only_mode?: boolean | null
}

export type GenerationRun = {
  run_id: string
  mode: Mode
  model_id: string
  device: string
  created_at: string
  clips: AudioClip[]
}

export type StreamRunEvent =
  | {
      type: 'run_start'
      run: GenerationRun
    }
  | {
      type: 'segment_start'
      segment_index: number
      text: string
      sample_rate: number
    }
  | {
      type: 'audio_chunk'
      segment_index: number
      chunk_index: number
      sample_rate: number
      duration_seconds: number
      pcm16_base64: string
      is_final_chunk: boolean
    }
  | {
      type: 'segment_complete'
      segment_index: number
      clip: AudioClip
    }
  | {
      type: 'run_complete'
      run: GenerationRun
    }
  | {
      type: 'error'
      detail: string
    }

export type ProviderSettingsResponse = {
  base_url: string | null
  model: string
  api_mode: 'responses' | 'chat_completions' | null
  has_api_key: boolean
  masked_api_key: string | null
}

export type StyleControlsApi = {
  mood: string
  emotion_intensity: string
  pace: string
  energy: string
  expressiveness: string
}

export type ReplyVoiceSettingsApi = {
  mode: ReplyVoiceMode
  runtime_mode?: 'quality' | 'balanced'
  language: string
  speaker: string
  instruct: string
  block_max_sentences?: number
  block_max_chars?: number
  block_hold_ms?: number
  warmup_on_connect?: boolean
  emit_perf_metrics?: boolean
  style: StyleControlsApi
  clone_profile_id: string | null
  clone_profile_label: string | null
  clone_audio_path: string | null
  clone_reference_text: string | null
  clone_embedding_path: string | null
}

export type ChatDefaultsApi = {
  active_provider: ProviderId
  system_prompt: string
  temperature: number
  max_output_tokens: number
  asr_model: string
  asr_language: string
  silence_timeout_ms: number
  max_turn_seconds: number
  live_captions: boolean
  reply_voice: ReplyVoiceSettingsApi
}

export type ChatSettingsResponse = {
  defaults: ChatDefaultsApi
  openai_compatible: ProviderSettingsResponse
  gemini: ProviderSettingsResponse
  anthropic: ProviderSettingsResponse
}

export type ProviderSettingsDraft = {
  base_url: string
  api_key: string
  model: string
  api_mode?: 'responses' | 'chat_completions' | null
  has_api_key?: boolean
  masked_api_key?: string | null
}

export type ChatSettingsDraft = {
  defaults: ChatDefaultsApi
  openai_compatible: ProviderSettingsDraft
  gemini: ProviderSettingsDraft
  anthropic: ProviderSettingsDraft
}

export type ProviderTestResponse = {
  success: boolean
  provider: ProviderId
  resolved_model: string | null
  latency_ms: number | null
  streaming_supported: boolean
  api_mode: 'responses' | 'chat_completions' | null
  error: string | null
}

export type AsrTranscriptionResponse = {
  text: string
  language: string | null
  duration_seconds: number
  model_id: string
  segments: Array<{
    text: string
    start: number
    end: number
  }>
  send_to_chat: boolean
}

export type CloneVoiceProfileResponse = {
  id: string
  label: string
  language: string
  reference_text: string
  audio_file_name: string
  audio_path: string
  speaker_embedding_path: string | null
  created_at: string
}

export type ConversationStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

export type ConversationServerEvent =
  | {
      type: 'session.ready'
      settings: ChatSettingsResponse
    }
  | {
      type: 'asr.partial'
      text: string
      language: string | null
      duration_seconds: number
    }
  | {
      type: 'asr.final'
      text: string
      language: string | null
      duration_seconds: number
    }
  | {
      type: 'llm.status'
      phase: ConversationStatus
    }
  | {
      type: 'llm.delta'
      delta: string
      text: string
    }
  | {
      type: 'llm.sentence'
      text: string
    }
  | {
      type: 'tts.segment_start'
      segment_index: number
      text: string
    }
  | {
      type: 'tts.audio_chunk'
      segment_index: number
      sample_rate: number
      duration_seconds: number
      pcm16_base64: string
      is_final_chunk: boolean
    }
  | {
      type: 'tts.segment_complete'
      segment_index: number
      clip: AudioClip
    }
  | {
      type: 'assistant.complete'
      text: string
    }
  | {
      type: 'error'
      detail: string
    }
  | {
      type: 'perf.metric'
      name: string
      value_ms: number
      segment_index?: number
      meta?: Record<string, unknown>
    }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  state?: 'draft' | 'final'
}
