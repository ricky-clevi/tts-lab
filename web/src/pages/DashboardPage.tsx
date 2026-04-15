import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchHealth, fetchVoices } from '../api'
import { useAuth } from '../auth/AuthContext'
import { Alert, Badge, Card, CardBody, Skeleton, SkeletonText } from '../components/ui'
import { t } from '../i18n'
import type { CloneVoiceProfileResponse, HealthResponse } from '../types'

const QUICK_ACTIONS = [
  {
    mark: 'TTS',
    title: 'Synthesis',
    description: 'Generate production-ready speech from approved text segments.',
    href: '/tts',
  },
  {
    mark: 'LIB',
    title: 'Voice Library',
    description: 'Review reusable voice IDs, references, and playback samples.',
    href: '/voices',
  },
  {
    mark: 'LIVE',
    title: 'Realtime QA',
    description: 'Test prompt behavior and reply speech in a live conversation loop.',
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
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const activeModel = health?.active_model?.split('/').pop() ?? 'Not loaded'
  const backend = health?.runtime_backend ?? 'Unknown'

  return (
    <div className="page dashboard-page">
      <div className="page-container">
        <section className="dashboard-hero">
          <div className="hero-copy">
            <p className="hero-kicker">Voice Operations Overview</p>
            <h1>
              {t('dashboard.welcome') || 'Welcome'}, {user?.username}
            </h1>
            <p className="hero-description">
              Monitor runtime health, move quickly between synthesis tasks, and keep voice assets ready for Korean call-center workflows.
            </p>
            <div className="hero-pills">
              <span>Trustworthy</span>
              <span>Operational</span>
              <span>Precise</span>
            </div>
          </div>

          <div className="hero-side">
            <div className="hero-status-card">
              <p>Runtime Health</p>
              <strong>{health ? 'Online' : loading ? 'Checking' : 'Unavailable'}</strong>
              <span>{health?.selected_device ?? 'Waiting for device status'}</span>
            </div>
            {isAdmin && (
              <Link to="/studio" className="hero-admin-link">
                <Badge variant="admin">Admin</Badge>
                <span>Open Admin Studio</span>
              </Link>
            )}
          </div>
        </section>

        {error && <Alert variant="error" onDismiss={() => setError('')}>{error}</Alert>}

        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Primary Workflows</p>
              <h2>Move directly into the next task.</h2>
            </div>
          </div>
          <div className="quick-actions-grid">
            {QUICK_ACTIONS.map((action) => (
              <Link to={action.href} key={action.href} className="quick-action-card">
                <Card hoverable>
                  <CardBody>
                    <span className="action-mark">{action.mark}</span>
                    <div className="action-copy">
                      <h3>{action.title}</h3>
                      <p>{action.description}</p>
                    </div>
                    <span className="action-arrow">Open</span>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <p className="section-kicker">System Snapshot</p>
              <h2>Current runtime and asset status.</h2>
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
                    <span className="stat-label">Voice Profiles</span>
                    <strong className="stat-value">{voices.length}</strong>
                    <p className="stat-note">Profiles available for cloning, playback, and API reuse.</p>
                    <Link to="/voices" className="stat-link">
                      Review library
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
                    <span className="stat-label">Runtime Backend</span>
                    <strong className="stat-value stat-value-compact">{health ? backend : 'Offline'}</strong>
                    <div className="stat-details">
                      <div>
                        <span>Model</span>
                        <strong>{activeModel}</strong>
                      </div>
                      <div>
                        <span>Device</span>
                        <strong>{health?.selected_device ?? 'Unavailable'}</strong>
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
                <p className="section-kicker">Recent Assets</p>
                <h2>Latest voice profiles.</h2>
              </div>
              <Link to="/voices" className="section-link">
                View full library
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
                      <h2>Create your first production voice.</h2>
                      <p>Start with clone mode in TTS Studio, upload a short clean sample, then save the resulting profile into your shared library.</p>
                    </div>
                    <div className="getting-started-steps">
                      <span>Open TTS Studio</span>
                      <span>Choose Clone</span>
                      <span>Save profile</span>
                    </div>
                    <Link to="/tts" className="btn btn-primary">
                      Start in TTS Studio
                    </Link>
                  </div>
                </CardBody>
              </Card>
            </section>
          )
        )}
      </div>

      <style>{`
        .dashboard-page .page-container { max-width: 1180px; }
        .dashboard-hero {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(16rem, 22rem);
          gap: var(--space-6);
          margin-bottom: var(--space-8);
          padding: clamp(1.7rem, 4vw, 2.6rem);
          border-radius: var(--radius-2xl);
          border: 1px solid color-mix(in oklab, var(--color-primary-200) 38%, var(--color-line) 62%);
          background:
            radial-gradient(circle at top right, color-mix(in oklab, var(--color-primary-100) 48%, transparent), transparent 36%),
            linear-gradient(180deg, color-mix(in oklab, var(--color-surface-elevated) 95%, white 5%), color-mix(in oklab, var(--color-surface) 88%, var(--color-primary-50) 12%));
          box-shadow: var(--shadow-xl);
        }
        .hero-copy { display: grid; gap: var(--space-4); }
        .hero-kicker, .section-kicker {
          color: var(--color-primary-700);
          font-size: var(--text-xs);
          font-weight: var(--font-bold);
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .hero-description {
          max-width: 56ch;
          color: var(--color-gray-600);
          font-size: var(--text-lg);
          line-height: var(--leading-relaxed);
        }
        .hero-pills, .getting-started-steps { display: flex; gap: var(--space-3); flex-wrap: wrap; }
        .hero-pills span, .getting-started-steps span {
          display: inline-flex;
          align-items: center;
          padding: 0.5rem 0.8rem;
          border-radius: var(--radius-full);
          background: color-mix(in oklab, var(--color-surface-elevated) 76%, white 24%);
          border: 1px solid color-mix(in oklab, var(--color-line) 76%, white 24%);
          color: var(--color-gray-700);
          font-size: var(--text-sm);
          font-weight: var(--font-medium);
        }
        .hero-side { display: grid; gap: var(--space-4); align-content: start; }
        .hero-status-card {
          display: grid;
          gap: var(--space-2);
          padding: var(--space-5);
          border-radius: var(--radius-xl);
          background: color-mix(in oklab, var(--color-surface-elevated) 78%, white 22%);
          border: 1px solid color-mix(in oklab, var(--color-line) 76%, white 24%);
        }
        .hero-status-card p, .hero-status-card span { color: var(--color-gray-500); }
        .hero-status-card strong {
          font-family: var(--font-family-display);
          font-size: clamp(1.6rem, 4vw, 2.2rem);
          letter-spacing: -0.04em;
          color: var(--color-gray-900);
        }
        .hero-admin-link {
          display: inline-flex;
          align-items: center;
          gap: var(--space-3);
          width: fit-content;
          padding: var(--space-3) var(--space-4);
          border-radius: var(--radius-full);
          background: color-mix(in oklab, var(--color-surface-elevated) 78%, white 22%);
          border: 1px solid color-mix(in oklab, var(--color-line) 76%, white 24%);
          color: var(--color-gray-800);
        }
        .dashboard-section { margin-bottom: var(--space-8); }
        .section-heading {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: var(--space-4);
          margin-bottom: var(--space-4);
        }
        .section-heading h2 { font-size: clamp(1.5rem, 3vw, 2.1rem); letter-spacing: -0.04em; }
        .section-link, .stat-link { color: var(--color-primary-700); font-size: var(--text-sm); font-weight: var(--font-bold); }
        .quick-actions-grid, .stats-grid, .voices-preview-grid { display: grid; gap: var(--space-4); }
        .quick-actions-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .voices-preview-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .quick-action-card { color: inherit; }
        .quick-action-card .card-body { display: grid; gap: var(--space-4); }
        .action-mark, .voice-mark, .getting-started-mark {
          width: fit-content;
          display: inline-grid;
          place-items: center;
          padding: 0.55rem 0.8rem;
          border-radius: 0.95rem;
          background: color-mix(in oklab, var(--color-primary-100) 70%, white 30%);
          color: var(--color-primary-800);
          font-family: var(--font-family-display);
          font-size: 0.72rem;
          font-weight: var(--font-extrabold);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .action-copy { display: grid; gap: var(--space-2); }
        .action-copy h3, .voice-preview h3 { font-size: var(--text-xl); letter-spacing: -0.03em; }
        .action-copy p, .voice-preview p, .stat-note, .getting-started-copy p {
          color: var(--color-gray-600);
          line-height: var(--leading-relaxed);
        }
        .action-arrow { color: var(--color-primary-700); font-size: var(--text-sm); font-weight: var(--font-bold); text-transform: uppercase; letter-spacing: 0.08em; }
        .stat-loading { display: grid; gap: var(--space-3); }
        .stat-card { display: grid; gap: var(--space-3); }
        .stat-label {
          color: var(--color-gray-500);
          font-size: var(--text-xs);
          font-weight: var(--font-bold);
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .stat-value {
          font-family: var(--font-family-display);
          font-size: clamp(2.6rem, 6vw, 4rem);
          font-weight: var(--font-extrabold);
          letter-spacing: -0.07em;
          color: var(--color-gray-900);
        }
        .stat-value-compact { font-size: clamp(1.8rem, 4vw, 2.8rem); }
        .stat-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
        .stat-details div {
          display: grid;
          gap: 0.35rem;
          padding: var(--space-3);
          border-radius: var(--radius-lg);
          background: color-mix(in oklab, var(--color-surface) 84%, white 16%);
          border: 1px solid color-mix(in oklab, var(--color-line) 76%, white 24%);
        }
        .stat-details span { color: var(--color-gray-500); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.1em; }
        .stat-details strong { color: var(--color-gray-800); font-size: var(--text-sm); }
        .voice-preview { display: grid; gap: var(--space-3); }
        .voice-preview-top { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
        .getting-started { display: grid; gap: var(--space-5); align-items: start; }
        .getting-started-copy { display: grid; gap: var(--space-2); max-width: 48ch; }
        .getting-started-copy h2 { font-size: clamp(1.6rem, 3vw, 2.2rem); letter-spacing: -0.04em; }
        @media (max-width: 1024px) {
          .dashboard-hero, .quick-actions-grid, .stats-grid, .voices-preview-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  )
}
