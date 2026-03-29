export type Mode = 'custom' | 'design' | 'clone'

export type GenerationSettings = {
  temperature?: number
  top_p?: number
  max_new_tokens?: number
  seed?: number
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

