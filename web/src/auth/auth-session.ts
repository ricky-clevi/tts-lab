import type { AuthUser } from './auth-context'

const AUTH_TOKEN_STORAGE_KEY = 'tts-lab-token'

type StoredAuthState = {
  user: AuthUser | null
  token: string | null
}

function parseStoredUser(token: string): AuthUser | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return null
    }

    const payload = JSON.parse(atob(parts[1])) as Partial<AuthUser> & { sub?: string }
    if (!payload.sub || !payload.username || (payload.role !== 'admin' && payload.role !== 'user')) {
      return null
    }

    return {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
    }
  } catch {
    return null
  }
}

export function readStoredAuthState(): StoredAuthState {
  const storedToken = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
  if (!storedToken) {
    return { user: null, token: null }
  }

  const user = parseStoredUser(storedToken)
  if (!user) {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
    return { user: null, token: null }
  }

  return { user, token: storedToken }
}

export function storeAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
}

export function clearStoredAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
}
