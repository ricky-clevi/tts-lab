import type { CapabilitiesResponse, GenerationRun, HealthResponse, Mode, StreamRunEvent } from './types'

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

export async function fetchCapabilities() {
  return parseJson<CapabilitiesResponse>(await fetch(`${API_ROOT}/capabilities`))
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
