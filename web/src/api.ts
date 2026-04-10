import type {
  AsrTranscriptionResponse,
  CapabilitiesResponse,
  ChatSettingsDraft,
  ChatSettingsResponse,
  CloneVoiceProfileResponse,
  GenerationRun,
  HealthResponse,
  MetricsResponse,
  Mode,
  ProviderId,
  ProviderSettingsDraft,
  ProviderTestResponse,
  StreamRunEvent,
} from './types'

const API_ROOT = '/api'

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json()
      detail = body.detail ?? detail
    } catch {
      // Fall back to the status text when the body is not JSON.
    }
    throw new Error(detail)
  }

  return response.json() as Promise<T>
}

export async function fetchHealth() {
  return parseJson<HealthResponse>(await fetch(`${API_ROOT}/health`))
}

export async function fetchMetrics() {
  return parseJson<MetricsResponse>(await fetch(`${API_ROOT}/metrics`))
}

export async function fetchCapabilities() {
  return parseJson<CapabilitiesResponse>(await fetch(`${API_ROOT}/capabilities`))
}

export async function fetchChatSettings() {
  return parseJson<ChatSettingsResponse>(await fetch(`${API_ROOT}/settings/chat`))
}

export async function saveChatSettings(payload: ChatSettingsDraft) {
  return parseJson<ChatSettingsResponse>(
    await fetch(`${API_ROOT}/settings/chat`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
}

export async function testChatProvider(provider: ProviderId, config: ProviderSettingsDraft) {
  return parseJson<ProviderTestResponse>(
    await fetch(`${API_ROOT}/settings/chat/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, config }),
    }),
  )
}

export async function transcribeAsrFile(payload: {
  file: File
  modelId: string
  language: string
  sendToChat: boolean
}) {
  const formData = new FormData()
  formData.append('audio', payload.file)
  formData.append('model_id', payload.modelId)
  formData.append('language', payload.language)
  formData.append('send_to_chat', String(payload.sendToChat))
  return parseJson<AsrTranscriptionResponse>(
    await fetch(`${API_ROOT}/asr/transcribe`, {
      method: 'POST',
      body: formData,
    }),
  )
}

export async function createReplyVoiceCloneProfile(payload: {
  file: File
  language: string
  label: string
  referenceText: string
}) {
  const formData = new FormData()
  formData.append('audio', payload.file)
  formData.append('language', payload.language)
  formData.append('label', payload.label)
  formData.append('reference_text', payload.referenceText)
  return parseJson<CloneVoiceProfileResponse>(
    await fetch(`${API_ROOT}/chat/reply-voice/clone-profile`, {
      method: 'POST',
      body: formData,
    }),
  )
}

export async function generateRun(
  mode: Mode,
  payload:
    | {
        segments: string[]
        language: string
        speaker?: string
        instruct?: string
        generation: Record<string, number>
      }
    | FormData,
) {
  const endpoint =
    mode === 'custom'
      ? `${API_ROOT}/generate/custom`
      : mode === 'design'
        ? `${API_ROOT}/generate/design`
        : `${API_ROOT}/generate/clone`

  const init: RequestInit =
    payload instanceof FormData
      ? { method: 'POST', body: payload }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }

  return parseJson<GenerationRun>(await fetch(endpoint, init))
}

export async function* generateRunStream(
  mode: Mode,
  payload:
    | {
        segments: string[]
        language: string
        speaker?: string
        instruct?: string
        streaming_interval: number
        generation: Record<string, number>
      }
    | FormData,
) {
  const endpoint =
    mode === 'custom'
      ? `${API_ROOT}/stream/custom`
      : mode === 'design'
        ? `${API_ROOT}/stream/design`
        : `${API_ROOT}/stream/clone`

  const init: RequestInit =
    payload instanceof FormData
      ? { method: 'POST', body: payload }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }

  const response = await fetch(endpoint, init)
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json()
      detail = body.detail ?? detail
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new Error(detail)
  }

  if (!response.body) {
    throw new Error('Streaming is not available in this browser.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      buffered += decoder.decode()
      break
    }

    buffered += decoder.decode(value, { stream: true })
    let lineBreak = buffered.indexOf('\n')
    while (lineBreak >= 0) {
      const line = buffered.slice(0, lineBreak).trim()
      buffered = buffered.slice(lineBreak + 1)
      if (line) {
        yield JSON.parse(line) as StreamRunEvent
      }
      lineBreak = buffered.indexOf('\n')
    }
  }

  const trailing = buffered.trim()
  if (trailing) {
    yield JSON.parse(trailing) as StreamRunEvent
  }
}

export function createConversationSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return new WebSocket(`${protocol}//${window.location.host}${API_ROOT}/conversation/ws`)
}
