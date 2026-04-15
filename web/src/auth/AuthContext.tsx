import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { loginApi } from '../api'

export type AuthUser = {
  id: string
  username: string
  role: 'admin' | 'user'
}

type AuthContextValue = {
  user: AuthUser | null
  token: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  isAdmin: boolean
  isLoading: boolean
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // On mount, restore session from localStorage
  useEffect(() => {
    const storedToken = localStorage.getItem('tts-lab-token')
    if (storedToken) {
      try {
        // Decode JWT payload (basic base64 decode, no validation - validation is server-side)
        const parts = storedToken.split('.')
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]))
          setUser({
            id: payload.sub,
            username: payload.username,
            role: payload.role,
          })
          setToken(storedToken)
        }
      } catch (e) {
        // Invalid token, clear it
        localStorage.removeItem('tts-lab-token')
      }
    }
    setIsLoading(false)
  }, [])

  const login = async (username: string, password: string) => {
    const response = await loginApi(username, password)
    setToken(response.access_token)
    setUser({
      id: response.user_id,
      username: response.username,
      role: response.role,
    })
    localStorage.setItem('tts-lab-token', response.access_token)
  }

  const logout = () => {
    setUser(null)
    setToken(null)
    localStorage.removeItem('tts-lab-token')
  }

  const value: AuthContextValue = {
    user,
    token,
    login,
    logout,
    isAdmin: user?.role === 'admin' || false,
    isLoading,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
