const FALLBACK_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function createRandomToken(length = 12): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint8Array(length)
    crypto.getRandomValues(buffer)
    return Array.from(buffer, (value) => FALLBACK_ALPHABET[value % FALLBACK_ALPHABET.length]).join('')
  }

  return `${Date.now().toString(36)}-fallback`
}

export function createClientId(prefix: string): string {
  return `${prefix}-${createRandomToken()}`
}

export function createSecurePassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%'

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint8Array(length)
    crypto.getRandomValues(buffer)
    return Array.from(buffer, (value) => alphabet[value % alphabet.length]).join('')
  }

  return createRandomToken(length).slice(0, length)
}
