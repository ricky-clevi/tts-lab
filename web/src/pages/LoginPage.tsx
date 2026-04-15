import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../styles/pages/login.css'
import { useAuth } from '../auth/useAuth'
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
      setError(t('login.error.missingFields'))
      return
    }

    setIsLoading(true)

    try {
      await login(username, password)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.error'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-shell">
        <section className="login-branding">
          <span className="login-kicker">{t('login.brand.kicker')}</span>
          <h1>{t('brand.title')}</h1>
          <p className="login-lead">{t('login.brand.lead')}</p>

          <div className="login-points">
            <div>
              <strong>{t('login.points.qa.title')}</strong>
              <span>{t('login.points.qa.description')}</span>
            </div>
            <div>
              <strong>{t('login.points.library.title')}</strong>
              <span>{t('login.points.library.description')}</span>
            </div>
            <div>
              <strong>{t('login.points.realtime.title')}</strong>
              <span>{t('login.points.realtime.description')}</span>
            </div>
          </div>
        </section>

        <Card className="login-card">
          <CardBody>
            <div className="login-card-head">
              <span className="login-mark">VL</span>
              <div>
                <p className="login-card-kicker">{t('login.card.kicker')}</p>
                <h2>{t('login.card.title')}</h2>
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
                placeholder={t('login.usernamePlaceholder')}
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
                  placeholder={t('login.passwordPlaceholder')}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? t('login.password.hide') : t('login.password.show')}
                >
                  {showPassword ? t('login.password.hide') : t('login.password.show')}
                </button>
              </div>

              {error && <Alert variant="error" onDismiss={() => setError('')}>{error}</Alert>}

              <Button type="submit" variant="primary" size="lg" fullWidth isLoading={isLoading}>
                {isLoading ? t('login.signingIn') : t('login.submit')}
              </Button>

              <p className="login-hint">{t('login.hint')}</p>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
