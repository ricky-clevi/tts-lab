import { useMemo, useState, type ReactNode } from 'react'
import { loginApi } from '../api'
import { AuthContext } from './auth-context'
import { clearStoredAuthToken, readStoredAuthState, storeAuthToken } from './auth-session'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(() => readStoredAuthState())

  const login = async (username: string, password: string) => {
    const response = await loginApi(username, password)
    const nextSession = {
      token: response.access_token,
      user: {
        id: response.user_id,
        username: response.username,
        role: response.role,
      },
    }

    setSession(nextSession)
    storeAuthToken(response.access_token)
  }

  const logout = () => {
    setSession({ user: null, token: null })
    clearStoredAuthToken()
  }

  const value = useMemo(
    () => ({
      user: session.user,
      token: session.token,
      login,
      logout,
      isAdmin: session.user?.role === 'admin' || false,
      isLoading: false,
    }),
    [session]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
