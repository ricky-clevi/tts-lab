import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchHealth, fetchVoices } from '../api'
import '../styles/pages/dashboard.css'
import { useAuth } from '../auth/useAuth'
import { Alert, Badge, Card, CardBody, Skeleton, SkeletonText } from '../components/ui'
import { t } from '../i18n'
import type { CloneVoiceProfileResponse, HealthResponse } from '../types'

const QUICK_ACTIONS = [
  {
    mark: 'TTS',
    titleKey: 'dashboard.quickActions.tts.title',
    descriptionKey: 'dashboard.quickActions.tts.description',
    href: '/tts',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
    ),
  },
  {
    mark: 'LIB',
    titleKey: 'dashboard.quickActions.voices.title',
    descriptionKey: 'dashboard.quickActions.voices.description',
    href: '/voices',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    mark: 'LIVE',
    titleKey: 'dashboard.quickActions.chat.title',
    descriptionKey: 'dashboard.quickActions.chat.description',
    href: '/chat',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" x2="12" y1="19" y2="22" />
      </svg>
    ),
  },
]

function StatusPip({ status }: { status: 'online' | 'checking' | 'offline' }) {
  return (
    <span className={`status-pip status-pip-${status}`} aria-hidden="true">
      <span className="status-pip-core" />
      {status === 'online' && <span className="status-pip-ring" />}
    </span>
  )
}

function WaveformPreview() {
  return (
    <div className="waveform-preview" aria-hidden="true">
      {Array.from({ length: 24 }).map((_, i) => (
        <span
          key={i}
          className="waveform-bar"
          style={{ '--bar-index': i } as React.CSSProperties}
        />
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const { user, isAdmin } = useAuth()
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [voices, setVoices] = useState<CloneVoiceProfileResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        setError('')
        const [healthData, voicesData] = await Promise.all([fetchHealth(), fetchVoices()])
        setHealth(healthData)
        setVoices(voicesData)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('dashboard.error.loadData'))
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const activeModel = health?.active_model?.split('/').pop() ?? t('dashboard.runtime.notLoaded')
  const backend = health?.runtime_backend ?? t('dashboard.runtime.unknown')
  const healthStatus = health ? 'online' : loading ? 'checking' : 'offline'
  const heroSignals = [
    {
      label: t('dashboard.stats.voiceProfiles.label'),
      value: loading ? '--' : String(voices.length),
    },
    {
      label: t('dashboard.stats.runtime.label'),
      value: loading ? t('dashboard.runtime.checking') : health ? t('dashboard.runtime.online') : t('dashboard.runtime.unavailable'),
    },
    {
      label: t('dashboard.stats.runtime.model'),
      value: activeModel,
    },
  ]

  return (
    <div className="page dashboard-page">
      <div className="page-container">
        <section className="dashboard-hero">
          <div className="hero-copy">
            <p className="hero-kicker">{t('dashboard.hero.kicker')}</p>
            <h1>
              {t('dashboard.welcome')}, {user?.username}
            </h1>
            <p className="hero-description">
              {t('dashboard.hero.description')}
            </p>
            <div className="hero-signals" aria-label={t('dashboard.hero.kicker')}>
              {heroSignals.map((signal) => (
                <div className="hero-signal" key={signal.label}>
                  <span className="hero-signal-label">{signal.label}</span>
                  <strong className="hero-signal-value">{signal.value}</strong>
                </div>
              ))}
            </div>
            <div className="hero-pills">
              <span>{t('dashboard.hero.pill.trustworthy')}</span>
              <span>{t('dashboard.hero.pill.operational')}</span>
              <span>{t('dashboard.hero.pill.precise')}</span>
            </div>
          </div>

          <div className="hero-side">
            <div className="hero-status-card" data-status={healthStatus}>
              <div className="status-header">
                <StatusPip status={healthStatus} />
                <span className="status-label">{t('dashboard.runtime.health')}</span>
              </div>
              <strong className="status-value">
                {health ? t('dashboard.runtime.online') : loading ? t('dashboard.runtime.checking') : t('dashboard.runtime.unavailable')}
              </strong>
              <div className="status-details">
                <div className="status-detail-row">
                  <span className="status-detail-label">{t('dashboard.stats.runtime.device')}</span>
                  <span className="status-detail-value">{health?.selected_device ?? t('dashboard.runtime.waiting')}</span>
                </div>
                {health && (
                  <div className="status-detail-row">
                    <span className="status-detail-label">{t('dashboard.stats.runtime.model')}</span>
                    <span className="status-detail-value">{activeModel}</span>
                  </div>
                )}
              </div>
              <div className="status-indicators">
                <span className={`indicator ${health ? 'indicator-active' : ''}`} title="API" />
                <span className={`indicator ${health?.active_model ? 'indicator-active' : ''}`} title="Model" />
                <span className={`indicator ${health?.selected_device ? 'indicator-active' : ''}`} title="Device" />
              </div>
            </div>
            {isAdmin && (
              <Link to="/studio" className="hero-admin-link">
                <Badge variant="admin">{t('dashboard.admin.badge')}</Badge>
                <span>{t('dashboard.admin.openStudio')}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="admin-arrow">
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </Link>
            )}
          </div>
        </section>

        {error && <Alert variant="error" onDismiss={() => setError('')}>{error}</Alert>}

        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <p className="section-kicker">{t('dashboard.section.primary.kicker')}</p>
              <h2>{t('dashboard.section.primary.title')}</h2>
            </div>
          </div>
          <div className="quick-actions-grid">
            {QUICK_ACTIONS.map((action) => (
              <Link to={action.href} key={action.href} className="quick-action-card">
                <Card hoverable>
                  <CardBody>
                    <div className="action-header">
                      <span className="action-icon">{action.icon}</span>
                      <span className="action-mark">{action.mark}</span>
                    </div>
                    <div className="action-copy">
                      <h3>{t(action.titleKey)}</h3>
                      <p>{t(action.descriptionKey)}</p>
                    </div>
                    <span className="action-arrow">
                      {t('dashboard.quickActions.open')}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </svg>
                    </span>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <p className="section-kicker">{t('dashboard.section.system.kicker')}</p>
              <h2>{t('dashboard.section.system.title')}</h2>
            </div>
          </div>

          <div className="stats-grid">
            <Card>
              <CardBody>
                {loading ? (
                  <div className="stat-loading">
                    <Skeleton height={52} width={110} />
                    <SkeletonText lines={2} />
                  </div>
                ) : (
                  <div className="stat-card stat-card-voices">
                    <div className="stat-header">
                      <span className="stat-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                      </span>
                      <span className="stat-label">{t('dashboard.stats.voiceProfiles.label')}</span>
                    </div>
                    <div className="stat-value-row">
                      <strong className="stat-value">{voices.length}</strong>
                      <span className="stat-unit">{voices.length === 1 ? 'profile' : 'profiles'}</span>
                    </div>
                    <p className="stat-note">{t('dashboard.stats.voiceProfiles.note')}</p>
                    <Link to="/voices" className="stat-link">
                      {t('dashboard.stats.voiceProfiles.link')}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </svg>
                    </Link>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                {loading ? (
                  <div className="stat-loading">
                    <Skeleton height={52} width={110} />
                    <SkeletonText lines={3} />
                  </div>
                ) : (
                  <div className="stat-card stat-card-runtime">
                    <div className="stat-header">
                      <span className="stat-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect width="18" height="18" x="3" y="3" rx="2" />
                          <path d="M7 7h.01" />
                          <path d="M17 7h.01" />
                          <path d="M7 17h.01" />
                          <path d="M17 17h.01" />
                        </svg>
                      </span>
                      <span className="stat-label">{t('dashboard.stats.runtime.label')}</span>
                      <StatusPip status={health ? 'online' : 'offline'} />
                    </div>
                    <strong className="stat-value stat-value-compact">{health ? backend : t('dashboard.runtime.offline')}</strong>
                    <div className="stat-details">
                      <div className="stat-detail-item">
                        <span className="stat-detail-label">{t('dashboard.stats.runtime.model')}</span>
                        <strong className="stat-detail-value">{activeModel}</strong>
                      </div>
                      <div className="stat-detail-item">
                        <span className="stat-detail-label">{t('dashboard.stats.runtime.device')}</span>
                        <strong className="stat-detail-value">{health?.selected_device ?? t('dashboard.runtime.unavailable')}</strong>
                      </div>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        </section>

        {voices.length > 0 ? (
          <section className="dashboard-section">
            <div className="section-heading">
              <div>
                <p className="section-kicker">{t('dashboard.section.recent.kicker')}</p>
                <h2>{t('dashboard.section.recent.title')}</h2>
              </div>
              <Link to="/voices" className="section-link">
                {t('dashboard.section.recent.link')}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </Link>
            </div>
            <div className="voices-preview-grid">
              {voices.slice(0, 4).map((voice) => (
                <Link to={`/voices?id=${voice.id}`} key={voice.id} className="voice-preview-link">
                  <Card hoverable>
                    <CardBody>
                      <div className="voice-preview">
                        <div className="voice-preview-top">
                          <span className="voice-mark">{voice.language.toUpperCase()}</span>
                          <Badge variant="info">{new Date(voice.created_at).toLocaleDateString()}</Badge>
                        </div>
                        <h3>{voice.label}</h3>
                        <WaveformPreview />
                        <p className="voice-preview-text">{voice.reference_text.substring(0, 80)}{voice.reference_text.length > 80 ? '...' : ''}</p>
                        <div className="voice-preview-footer">
                          <code className="voice-id">{voice.id.substring(0, 8)}...</code>
                          <span className="voice-preview-action">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M5 12h14" />
                              <path d="m12 5 7 7-7 7" />
                            </svg>
                          </span>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ) : (
          !loading && (
            <section className="dashboard-section">
              <Card>
                <CardBody>
                  <div className="getting-started">
                    <div className="getting-started-header">
                      <span className="getting-started-mark">01</span>
                      <div className="getting-started-badge">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2v4" />
                          <path d="m16.2 7.8 2.9-2.9" />
                          <path d="M18 12h4" />
                          <path d="m16.2 16.2 2.9 2.9" />
                          <path d="M12 18v4" />
                          <path d="m4.9 19.1 2.9-2.9" />
                          <path d="M2 12h4" />
                          <path d="m4.9 4.9 2.9 2.9" />
                        </svg>
                        Quick start
                      </div>
                    </div>
                    <div className="getting-started-copy">
                      <h2>{t('dashboard.gettingStarted.title')}</h2>
                      <p>{t('dashboard.gettingStarted.description')}</p>
                    </div>
                    <ol className="getting-started-steps">
                      <li>
                        <span className="step-number">1</span>
                        <span>{t('dashboard.gettingStarted.step1')}</span>
                      </li>
                      <li>
                        <span className="step-number">2</span>
                        <span>{t('dashboard.gettingStarted.step2')}</span>
                      </li>
                      <li>
                        <span className="step-number">3</span>
                        <span>{t('dashboard.gettingStarted.step3')}</span>
                      </li>
                    </ol>
                    <Link to="/tts" className="btn btn-primary getting-started-action">
                      {t('dashboard.gettingStarted.action')}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </svg>
                    </Link>
                  </div>
                </CardBody>
              </Card>
            </section>
          )
        )}
      </div>
    </div>
  )
}
