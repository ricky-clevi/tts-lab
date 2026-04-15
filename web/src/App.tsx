import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import NavBar from './components/NavBar'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import TtsPage from './pages/TtsPage'
import VoicesPage from './pages/VoicesPage'
import ChatPage from './pages/ChatPage'
import StudioPage from './pages/StudioPage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  const { user, isLoading } = useAuth()

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="loading-content">
          <span className="loading-icon">🎙️</span>
          <div className="spinner" />
          <p>Loading TTS Lab...</p>
        </div>
        <style>{`
          .app-loading {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--color-gray-50);
          }
          .loading-content {
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: var(--space-4);
          }
          .loading-icon {
            font-size: 3rem;
          }
          .loading-content p {
            color: var(--color-gray-600);
          }
        `}</style>
      </div>
    )
  }

  return (
    <>
      {/* Skip Link for Accessibility */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Navigation - only show when logged in */}
      {user && <NavBar />}

      {/* Main Content */}
      <main id="main-content">
        <Routes>
          {/* Public Routes */}
          <Route
            path="/login"
            element={user ? <Navigate to="/" replace /> : <LoginPage />}
          />

          {/* Protected Routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tts"
            element={
              <ProtectedRoute>
                <TtsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/voices"
            element={
              <ProtectedRoute>
                <VoicesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            }
          />

          {/* Admin Routes */}
          <Route
            path="/studio"
            element={
              <ProtectedRoute adminOnly>
                <StudioPage />
              </ProtectedRoute>
            }
          />

          {/* 404 */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </>
  )
}
