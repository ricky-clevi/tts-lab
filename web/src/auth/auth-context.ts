import { createContext } from 'react'

export type AuthUser = {
  id: string
  username: string
  role: 'admin' | 'user'
}

export type AuthContextValue = {
  user: AuthUser | null
  token: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  isAdmin: boolean
  isLoading: boolean
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)
