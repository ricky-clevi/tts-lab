export type Mode = 'custom' | 'design' | 'clone'

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

export type HealthResponse = {
  status: 'ok'
  active_mode: Mode | null
  active_model: string | null
  selected_device: string
}

export type CapabilitiesResponse = {
  active_mode: Mode | null
  selected_device: string
  languages: string[]
  speakers: Speaker[]
  generation_knobs: Record<string, Record<string, number | null>>
  modes: Array<{
    id: Mode
    label: string
    description: string
    checkpoint: string
  }>
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
