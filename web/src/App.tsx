import { Navigate, Route, Routes } from 'react-router-dom'
import './styles/app-shell.css'
import { useAuth } from './auth/useAuth'
import { ProtectedRoute } from './auth/ProtectedRoute'
import NavBar from './components/NavBar'
import DashboardPage from './pages/DashboardPage'
import ChatPage from './pages/ChatPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import StudioPage from './pages/StudioPage'
import TtsPage from './pages/TtsPage'
import VoicesPage from './pages/VoicesPage'
import { t } from './i18n'

export default function App() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="loading-shell">
          <div className="loading-mark">VL</div>
          <div className="loading-copy">
            <p className="loading-kicker">{t('app.loading.kicker')}</p>
            <h1>{t('app.loading.title')}</h1>
            <p>{t('app.loading.description')}</p>
          </div>
          <div className="loading-indicator">
            <div className="spinner" />
            <span>{t('app.loading.sync')}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`app-shell ${user ? 'app-shell-authenticated' : 'app-shell-public'}`}>
      <a href="#main-content" className="skip-link">
        {t('app.skipToMain')}
      </a>

      {user && (
        <div className="app-shell-header">
          <NavBar />
        </div>
      )}

      <main id="main-content" className="app-main">
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
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
          <Route
            path="/studio"
            element={
              <ProtectedRoute adminOnly>
                <StudioPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  )
}
