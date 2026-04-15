import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

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
        <p>Checking authentication...</p>
        <style>{`
          .auth-loading {
            min-height: calc(100vh - var(--navbar-height, 64px));
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: var(--space-4);
            color: var(--color-gray-500);
          }
        `}</style>
      </div>
    )
  }

  // Redirect to login if not authenticated
  if (!token || !user) {
    return <Navigate to="/login" replace />
  }

  // Redirect to home if user tries to access admin-only route without admin role
  if (adminOnly && user.role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
