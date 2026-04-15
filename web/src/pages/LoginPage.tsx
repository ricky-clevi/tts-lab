import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Alert, Button, Card, CardBody, Input } from '../components/ui'
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
      <div className="login-shell">
        <section className="login-branding">
          <span className="login-kicker">Korean Call Operations</span>
          <h1>TTS Lab</h1>
          <p className="login-lead">
            Create, test, and manage synthetic voices with the precision expected in operator-grade voice workflows.
          </p>

          <div className="login-points">
            <div>
              <strong>Voice QA</strong>
              <span>Compare synthesis outputs before deployment.</span>
            </div>
            <div>
              <strong>Library Control</strong>
              <span>Manage reusable voice profiles and IDs.</span>
            </div>
            <div>
              <strong>Realtime Testing</strong>
              <span>Validate prompts and voice behavior in live chat.</span>
            </div>
          </div>
        </section>

        <Card className="login-card">
          <CardBody>
            <div className="login-card-head">
              <span className="login-mark">VL</span>
              <div>
                <p className="login-card-kicker">Secure Access</p>
                <h2>Sign in to the workspace</h2>
              </div>
            </div>

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
                placeholder="Enter your operator ID"
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
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>

              {error && <Alert variant="error" onDismiss={() => setError('')}>{error}</Alert>}

              <Button type="submit" variant="primary" size="lg" fullWidth isLoading={isLoading}>
                {isLoading ? 'Signing in...' : t('login.submit') || 'Sign in'}
              </Button>

              <p className="login-hint">Use your assigned admin or operator account. Contact your team lead if access is missing.</p>
            </form>
          </CardBody>
        </Card>
      </div>

      <style>{`
        .login-page {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: clamp(1rem, 3vw, 2rem);
          background: var(--gradient-shell);
        }

        .login-shell {
          width: min(74rem, 100%);
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(20rem, 28rem);
          gap: clamp(1.5rem, 4vw, 3rem);
          align-items: stretch;
        }

        .login-branding {
          position: relative;
          display: grid;
          align-content: center;
          gap: var(--space-5);
          padding: clamp(2rem, 4vw, 3.5rem);
          border-radius: var(--radius-2xl);
          border: 1px solid color-mix(in oklab, var(--color-primary-200) 34%, var(--color-line) 66%);
          background:
            radial-gradient(circle at top right, color-mix(in oklab, var(--color-primary-100) 48%, transparent), transparent 36%),
            linear-gradient(180deg, color-mix(in oklab, var(--color-surface-elevated) 95%, white 5%), color-mix(in oklab, var(--color-surface) 90%, var(--color-primary-50) 10%));
          box-shadow: var(--shadow-xl);
          overflow: hidden;
        }

        .login-kicker,
        .login-card-kicker {
          display: inline-flex;
          width: fit-content;
          padding: 0.45rem 0.75rem;
          border-radius: var(--radius-full);
          background: color-mix(in oklab, var(--color-primary-100) 68%, white 32%);
          color: var(--color-primary-800);
          font-size: 0.72rem;
          font-weight: var(--font-bold);
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .login-branding h1 {
          font-size: clamp(3rem, 8vw, 5.4rem);
          letter-spacing: -0.07em;
          line-height: 0.95;
        }

        .login-lead {
          max-width: 36ch;
          color: var(--color-gray-600);
          font-size: clamp(1.05rem, 2vw, 1.3rem);
          line-height: var(--leading-relaxed);
        }

        .login-points {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--space-4);
          margin-top: var(--space-2);
        }

        .login-points div {
          display: grid;
          gap: var(--space-2);
          padding: var(--space-4);
          border-radius: var(--radius-xl);
          background: color-mix(in oklab, var(--color-surface-elevated) 76%, white 24%);
          border: 1px solid color-mix(in oklab, var(--color-line) 76%, white 24%);
        }

        .login-points strong {
          font-family: var(--font-family-display);
          font-size: var(--text-base);
          color: var(--color-gray-900);
        }

        .login-points span {
          color: var(--color-gray-600);
          font-size: var(--text-sm);
          line-height: var(--leading-relaxed);
        }

        .login-card {
          align-self: center;
        }

        .login-card-head {
          display: flex;
          align-items: center;
          gap: var(--space-4);
          margin-bottom: var(--space-6);
        }

        .login-mark {
          width: 3.5rem;
          height: 3.5rem;
          display: grid;
          place-items: center;
          border-radius: 1rem;
          background: var(--gradient-primary);
          color: var(--color-white);
          font-family: var(--font-family-display);
          font-weight: var(--font-extrabold);
          letter-spacing: 0.08em;
        }

        .login-card-head h2 {
          font-size: clamp(1.6rem, 4vw, 2.1rem);
          letter-spacing: -0.04em;
        }

        .login-form {
          display: grid;
          gap: var(--space-4);
        }

        .password-field {
          position: relative;
        }

        .password-toggle {
          position: absolute;
          right: 0.95rem;
          top: 2.45rem;
          border: none;
          background: none;
          color: var(--color-primary-700);
          font-size: var(--text-sm);
          font-weight: var(--font-bold);
        }

        .login-hint {
          color: var(--color-gray-500);
          font-size: var(--text-sm);
          line-height: var(--leading-relaxed);
        }

        @media (max-width: 960px) {
          .login-shell {
            grid-template-columns: 1fr;
          }

          .login-points {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  )
}
