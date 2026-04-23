import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import './protected-route.css'
import { t } from '../i18n'
import NotFoundPage from '../pages/NotFoundPage'
import { useAuth } from './useAuth'

type ProtectedRouteProps = {
  children: ReactNode
  adminOnly?: boolean
}

export function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, token, isLoading } = useAuth()

  // Show loading spinner while checking auth
  if (isLoading) {
    return (
      <div className="auth-loading">
        <div className="spinner" />
        <p>{t('auth.checking')}</p>
      </div>
    )
  }

  // Redirect to login if not authenticated
  if (!token || !user) {
    return <Navigate to="/login" replace />
  }

  // Hide admin-only routes from non-admin users.
  if (adminOnly && user.role !== 'admin') {
    return <NotFoundPage />
  }

  return <>{children}</>
}
