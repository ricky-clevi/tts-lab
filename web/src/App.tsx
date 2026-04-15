import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import NavBar from './components/NavBar'
import DashboardPage from './pages/DashboardPage'
import ChatPage from './pages/ChatPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import StudioPage from './pages/StudioPage'
import TtsPage from './pages/TtsPage'
import VoicesPage from './pages/VoicesPage'

export default function App() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="loading-shell">
          <div className="loading-mark">VL</div>
          <div className="loading-copy">
            <p className="loading-kicker">Voice Operations Console</p>
            <h1>Preparing TTS Lab</h1>
            <p>Loading authentication and workspace state.</p>
          </div>
          <div className="loading-indicator">
            <div className="spinner" />
            <span>Syncing session</span>
          </div>
        </div>
        <style>{`
          .app-loading {
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: var(--space-6);
            background: var(--gradient-shell);
          }

          .loading-shell {
            width: min(36rem, 100%);
            display: grid;
            gap: var(--space-5);
            padding: clamp(1.8rem, 4vw, 2.8rem);
            border-radius: var(--radius-2xl);
            border: 1px solid color-mix(in oklab, var(--color-primary-200) 35%, var(--color-line) 65%);
            background:
              radial-gradient(circle at top right, color-mix(in oklab, var(--color-primary-100) 42%, transparent), transparent 38%),
              linear-gradient(180deg, color-mix(in oklab, var(--color-surface-elevated) 94%, white 6%), color-mix(in oklab, var(--color-surface) 90%, var(--color-primary-50) 10%));
            box-shadow: var(--shadow-xl);
          }

          .loading-mark {
            width: 4rem;
            height: 4rem;
            display: grid;
            place-items: center;
            border-radius: 1.2rem;
            background: var(--gradient-primary);
            color: var(--color-white);
            font-family: var(--font-family-display);
            font-weight: var(--font-extrabold);
            letter-spacing: 0.08em;
          }

          .loading-copy {
            display: grid;
            gap: var(--space-2);
          }

          .loading-kicker {
            font-size: var(--text-xs);
            font-weight: var(--font-bold);
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: var(--color-primary-700);
          }

          .loading-copy h1 {
            font-size: clamp(2rem, 4vw, 2.75rem);
            letter-spacing: -0.04em;
          }

          .loading-copy p:last-child {
            color: var(--color-gray-600);
            line-height: var(--leading-relaxed);
          }

          .loading-indicator {
            display: inline-flex;
            align-items: center;
            gap: var(--space-3);
            width: fit-content;
            padding: var(--space-3) var(--space-4);
            border-radius: var(--radius-full);
            background: color-mix(in oklab, var(--color-surface-elevated) 72%, white 28%);
            border: 1px solid color-mix(in oklab, var(--color-line) 78%, white 22%);
            color: var(--color-gray-700);
            font-size: var(--text-sm);
            font-weight: var(--font-medium);
          }
        `}</style>
      </div>
    )
  }

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {user && <NavBar />}

      <main id="main-content">
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
    </>
  )
}
