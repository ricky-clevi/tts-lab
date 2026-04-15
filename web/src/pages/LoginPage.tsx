import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button, Input, Alert, Card, CardBody } from '../components/ui'
import { t } from '../i18n'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password')
      return
    }

    setIsLoading(true)

    try {
      await login(username, password)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.error') || 'Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-branding">
          <span className="login-logo">🎙️</span>
          <h1 className="login-title">TTS Lab</h1>
          <p className="login-subtitle">Voice generation and cloning platform</p>
        </div>

        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="login-form">
              <Input
                label={t('login.username') || 'Username'}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                required
                autoFocus
                autoComplete="username"
              />

              <div className="password-field">
                <Input
                  label={t('login.password') || 'Password'}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>

              {error && (
                <Alert variant="error" onDismiss={() => setError('')}>
                  {error}
                </Alert>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                isLoading={isLoading}
              >
                {isLoading ? 'Logging in...' : t('login.submit') || 'Login'}
              </Button>

              <p className="login-hint">
                Press <kbd>Enter</kbd> to submit
              </p>
            </form>
          </CardBody>
        </Card>

        <p className="login-footer">
          Contact your administrator for account access
        </p>
      </div>

      <style>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-4);
          background: var(--gradient-primary);
        }

        .login-container {
          width: 100%;
          max-width: 420px;
          animation: fade-in-up var(--transition-slow);
        }

        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .login-branding {
          text-align: center;
          margin-bottom: var(--space-8);
          color: var(--color-white);
        }

        .login-logo {
          font-size: 4rem;
          display: block;
          margin-bottom: var(--space-4);
          filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
        }

        .login-title {
          margin: 0 0 var(--space-2);
          font-size: var(--text-4xl);
          font-weight: var(--font-bold);
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .login-subtitle {
          margin: 0;
          font-size: var(--text-lg);
          opacity: 0.9;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .password-field {
          position: relative;
        }

        .password-toggle {
          position: absolute;
          right: var(--space-3);
          top: 38px;
          background: none;
          border: none;
          cursor: pointer;
          font-size: var(--text-lg);
          padding: var(--space-1);
          opacity: 0.6;
          transition: opacity var(--transition-fast);
        }

        .password-toggle:hover {
          opacity: 1;
        }

        .login-hint {
          text-align: center;
          font-size: var(--text-sm);
          color: var(--color-gray-500);
          margin: 0;
        }

        .login-hint kbd {
          display: inline-block;
          padding: 2px 6px;
          background: var(--color-gray-100);
          border: 1px solid var(--color-gray-300);
          border-radius: var(--radius-sm);
          font-family: var(--font-family-mono);
          font-size: var(--text-xs);
        }

        .login-footer {
          text-align: center;
          margin-top: var(--space-6);
          font-size: var(--text-sm);
          color: rgba(255, 255, 255, 0.8);
        }

        @media (max-width: 480px) {
          .login-branding {
            margin-bottom: var(--space-6);
          }

          .login-logo {
            font-size: 3rem;
          }

          .login-title {
            font-size: var(--text-3xl);
          }
        }
      `}</style>
    </div>
  )
}
