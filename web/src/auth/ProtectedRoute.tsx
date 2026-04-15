import React, { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

type ProtectedRouteProps = {
  children: ReactNode
  adminOnly?: boolean
}

export function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, token, isLoading } = useAuth()

  if (isLoading) {
    return <div className="loading">Loading...</div>
  }

  if (!token || !user) {
    return <Navigate to="/login" replace />
  }

  if (adminOnly && user.role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
