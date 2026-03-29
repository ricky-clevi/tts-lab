import type { CapabilitiesResponse, GenerationRun, HealthResponse, Mode } from './types'

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

