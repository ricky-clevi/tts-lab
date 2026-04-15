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
  },
  {
    mark: 'LIB',
    titleKey: 'dashboard.quickActions.voices.title',
    descriptionKey: 'dashboard.quickActions.voices.description',
    href: '/voices',
  },
  {
    mark: 'LIVE',
    titleKey: 'dashboard.quickActions.chat.title',
    descriptionKey: 'dashboard.quickActions.chat.description',
    href: '/chat',
  },
]

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
            <div className="hero-pills">
              <span>{t('dashboard.hero.pill.trustworthy')}</span>
              <span>{t('dashboard.hero.pill.operational')}</span>
              <span>{t('dashboard.hero.pill.precise')}</span>
            </div>
          </div>

            <div className="hero-side">
            <div className="hero-status-card">
              <p>{t('dashboard.runtime.health')}</p>
              <strong>{health ? t('dashboard.runtime.online') : loading ? t('dashboard.runtime.checking') : t('dashboard.runtime.unavailable')}</strong>
              <span>{health?.selected_device ?? t('dashboard.runtime.waiting')}</span>
            </div>
            {isAdmin && (
              <Link to="/studio" className="hero-admin-link">
                <Badge variant="admin">{t('dashboard.admin.badge')}</Badge>
                <span>{t('dashboard.admin.openStudio')}</span>
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
                    <span className="action-mark">{action.mark}</span>
                    <div className="action-copy">
                      <h3>{t(action.titleKey)}</h3>
                      <p>{t(action.descriptionKey)}</p>
                    </div>
                    <span className="action-arrow">{t('dashboard.quickActions.open')}</span>
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
                  <div className="stat-card">
                    <span className="stat-label">{t('dashboard.stats.voiceProfiles.label')}</span>
                    <strong className="stat-value">{voices.length}</strong>
                    <p className="stat-note">{t('dashboard.stats.voiceProfiles.note')}</p>
                    <Link to="/voices" className="stat-link">
                      {t('dashboard.stats.voiceProfiles.link')}
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
                  <div className="stat-card">
                    <span className="stat-label">{t('dashboard.stats.runtime.label')}</span>
                    <strong className="stat-value stat-value-compact">{health ? backend : t('dashboard.runtime.offline')}</strong>
                    <div className="stat-details">
                      <div>
                        <span>{t('dashboard.stats.runtime.model')}</span>
                        <strong>{activeModel}</strong>
                      </div>
                      <div>
                        <span>{t('dashboard.stats.runtime.device')}</span>
                        <strong>{health?.selected_device ?? t('dashboard.runtime.unavailable')}</strong>
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
              </Link>
            </div>
            <div className="voices-preview-grid">
              {voices.slice(0, 4).map((voice) => (
                <Card key={voice.id} hoverable>
                  <CardBody>
                    <div className="voice-preview">
                      <div className="voice-preview-top">
                        <span className="voice-mark">{voice.language.toUpperCase()}</span>
                        <Badge variant="info">{new Date(voice.created_at).toLocaleDateString()}</Badge>
                      </div>
                      <h3>{voice.label}</h3>
                      <p>{voice.reference_text.substring(0, 110)}{voice.reference_text.length > 110 ? '...' : ''}</p>
                      <code>{voice.id}</code>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          </section>
        ) : (
          !loading && (
            <section className="dashboard-section">
              <Card>
                <CardBody>
                  <div className="getting-started">
                    <span className="getting-started-mark">01</span>
                    <div className="getting-started-copy">
                      <h2>{t('dashboard.gettingStarted.title')}</h2>
                      <p>{t('dashboard.gettingStarted.description')}</p>
                    </div>
                    <div className="getting-started-steps">
                      <span>{t('dashboard.gettingStarted.step1')}</span>
                      <span>{t('dashboard.gettingStarted.step2')}</span>
                      <span>{t('dashboard.gettingStarted.step3')}</span>
                    </div>
                    <Link to="/tts" className="btn btn-primary">
                      {t('dashboard.gettingStarted.action')}
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
