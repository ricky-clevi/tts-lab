import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { fetchHealth, fetchVoices } from '../api'
import { Card, CardBody, Badge, Skeleton, SkeletonText, Alert } from '../components/ui'
import { t } from '../i18n'
import type { HealthResponse, CloneVoiceProfileResponse } from '../types'

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

  const quickActions = [
    {
      icon: '🎤',
      title: t('nav.tts') || 'TTS Studio',
      description: 'Generate speech from text with custom voices',
      href: '/tts',
      color: 'var(--color-primary-500)',
    },
    {
      icon: '🎵',
      title: t('nav.voices') || 'Voice Library',
      description: 'Manage your custom and cloned voices',
      href: '/voices',
      color: 'var(--color-success-500)',
    },
    {
      icon: '💬',
      title: t('nav.chat') || 'Voice Chat',
      description: 'Real-time conversation with voice I/O',
      href: '/chat',
      color: 'var(--color-info-500)',
    },
  ]

  return (
    <div className="page dashboard-page">
      <div className="page-container">
        {/* Welcome Section */}
        <div className="welcome-section">
          <div className="welcome-content">
            <span className="welcome-wave">👋</span>
            <div>
              <h1>{t('dashboard.welcome') || 'Welcome'}, {user?.username}!</h1>
              <p className="welcome-subtitle">
                Your personal Text-to-Speech studio. Create custom voices, clone voices, and manage your voice library.
              </p>
            </div>
          </div>
          {isAdmin && (
            <Link to="/studio" className="admin-link">
              <Badge variant="admin">Admin</Badge>
              <span>Go to Admin Studio</span>
            </Link>
          )}
        </div>

        {error && (
          <Alert variant="error" onDismiss={() => setError('')}>
            {error}
          </Alert>
        )}

        {/* Quick Actions */}
        <section className="dashboard-section">
          <h2 className="section-title">Quick Actions</h2>
          <div className="quick-actions-grid">
            {quickActions.map((action) => (
              <Link to={action.href} key={action.href} className="quick-action-card">
                <Card hoverable>
                  <CardBody>
                    <span className="action-icon" style={{ background: `${action.color}15` }}>
                      {action.icon}
                    </span>
                    <h3 className="action-title">{action.title}</h3>
                    <p className="action-description">{action.description}</p>
                    <span className="action-arrow">→</span>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        {/* Stats Grid */}
        <div className="stats-grid">
          {/* Voice Count */}
          <Card>
            <CardBody>
              {loading ? (
                <div className="stat-loading">
                  <Skeleton height={48} width={80} />
                  <SkeletonText lines={1} />
                </div>
              ) : (
                <div className="stat-content">
                  <span className="stat-icon">🎵</span>
                  <div className="stat-data">
                    <span className="stat-value">{voices.length}</span>
                    <span className="stat-label">Voice Profiles</span>
                  </div>
                  <Link to="/voices" className="stat-link">View all →</Link>
                </div>
              )}
            </CardBody>
          </Card>

          {/* System Status */}
          <Card>
            <CardBody>
              {loading ? (
                <div className="stat-loading">
                  <Skeleton height={48} width={80} />
                  <SkeletonText lines={2} />
                </div>
              ) : health ? (
                <div className="stat-content">
                  <span className="stat-icon">⚙️</span>
                  <div className="stat-data">
                    <span className="stat-value status-ok">Online</span>
                    <span className="stat-label">{health.selected_device}</span>
                  </div>
                  <div className="system-details">
                    {health.active_model && (
                      <div className="detail-row">
                        <span className="detail-label">Model:</span>
                        <span className="detail-value">{health.active_model.split('/').pop()}</span>
                      </div>
                    )}
                    {health.runtime_backend && (
                      <div className="detail-row">
                        <span className="detail-label">Backend:</span>
                        <span className="detail-value">{health.runtime_backend}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="stat-content">
                  <span className="stat-icon">⚠️</span>
                  <div className="stat-data">
                    <span className="stat-value status-error">Offline</span>
                    <span className="stat-label">System unavailable</span>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Recent Voices */}
        {voices.length > 0 && (
          <section className="dashboard-section">
            <div className="section-header">
              <h2 className="section-title">Recent Voices</h2>
              <Link to="/voices" className="section-link">View all →</Link>
            </div>
            <div className="voices-preview-grid">
              {voices.slice(0, 4).map((voice) => (
                <Card key={voice.id} hoverable>
                  <CardBody>
                    <div className="voice-preview">
                      <div className="voice-preview-header">
                        <span className="voice-preview-icon">🔊</span>
                        <Badge variant="info">{voice.language}</Badge>
                      </div>
                      <h4 className="voice-preview-name">{voice.label}</h4>
                      <p className="voice-preview-text">
                        {voice.reference_text.substring(0, 80)}
                        {voice.reference_text.length > 80 ? '...' : ''}
                      </p>
                      <span className="voice-preview-date">
                        {new Date(voice.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Getting Started (for users with no voices) */}
        {!loading && voices.length === 0 && (
          <section className="dashboard-section">
            <Card>
              <CardBody>
                <div className="getting-started">
                  <span className="getting-started-icon">🚀</span>
                  <h3>Get Started</h3>
                  <p>Create your first voice profile to unlock the full potential of TTS Lab.</p>
                  <div className="getting-started-steps">
                    <div className="step">
                      <span className="step-number">1</span>
                      <span>Go to TTS Studio</span>
                    </div>
                    <div className="step">
                      <span className="step-number">2</span>
                      <span>Select "Clone" mode</span>
                    </div>
                    <div className="step">
                      <span className="step-number">3</span>
                      <span>Upload a reference audio</span>
                    </div>
                  </div>
                  <Link to="/tts" className="btn btn-primary">
                    Create Your First Voice
                  </Link>
                </div>
              </CardBody>
            </Card>
          </section>
        )}
      </div>

      <style>{`
        .dashboard-page .page-container {
          max-width: 1100px;
        }

        .welcome-section {
          background: var(--gradient-primary);
          color: var(--color-white);
          padding: var(--space-8);
          border-radius: var(--radius-xl);
          margin-bottom: var(--space-8);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: var(--space-4);
        }

        .welcome-content {
          display: flex;
          align-items: center;
          gap: var(--space-4);
        }

        .welcome-wave {
          font-size: 3rem;
        }

        .welcome-section h1 {
          margin: 0;
          font-size: var(--text-2xl);
          color: var(--color-white);
        }

        .welcome-subtitle {
          margin: var(--space-2) 0 0;
          opacity: 0.9;
          max-width: 500px;
        }

        .admin-link {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-3) var(--space-4);
          background: rgba(255, 255, 255, 0.15);
          border-radius: var(--radius-md);
          color: var(--color-white);
          text-decoration: none;
          transition: background var(--transition-fast);
        }

        .admin-link:hover {
          background: rgba(255, 255, 255, 0.25);
        }

        .dashboard-section {
          margin-bottom: var(--space-8);
        }

        .section-title {
          margin: 0 0 var(--space-4);
          font-size: var(--text-xl);
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-4);
        }

        .section-link {
          color: var(--color-primary-600);
          font-weight: var(--font-medium);
        }

        .quick-actions-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--space-4);
        }

        .quick-action-card {
          text-decoration: none;
          color: inherit;
        }

        .quick-action-card .card-body {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          position: relative;
        }

        .action-icon {
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-lg);
          font-size: var(--text-2xl);
        }

        .action-title {
          margin: 0;
          font-size: var(--text-lg);
          font-weight: var(--font-semibold);
        }

        .action-description {
          margin: 0;
          font-size: var(--text-sm);
          color: var(--color-gray-600);
          flex: 1;
        }

        .action-arrow {
          position: absolute;
          top: var(--space-4);
          right: var(--space-4);
          font-size: var(--text-xl);
          color: var(--color-gray-400);
          transition: transform var(--transition-fast);
        }

        .quick-action-card:hover .action-arrow {
          transform: translateX(4px);
          color: var(--color-primary-500);
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: var(--space-4);
          margin-bottom: var(--space-8);
        }

        .stat-loading {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .stat-content {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .stat-icon {
          font-size: var(--text-3xl);
        }

        .stat-data {
          display: flex;
          flex-direction: column;
        }

        .stat-value {
          font-size: var(--text-3xl);
          font-weight: var(--font-bold);
          color: var(--color-gray-900);
        }

        .stat-value.status-ok {
          color: var(--color-success-600);
        }

        .stat-value.status-error {
          color: var(--color-error-600);
        }

        .stat-label {
          font-size: var(--text-sm);
          color: var(--color-gray-500);
        }

        .stat-link {
          font-size: var(--text-sm);
          color: var(--color-primary-600);
          font-weight: var(--font-medium);
        }

        .system-details {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
          margin-top: var(--space-2);
          padding-top: var(--space-3);
          border-top: 1px solid var(--border-color);
        }

        .detail-row {
          display: flex;
          gap: var(--space-2);
          font-size: var(--text-sm);
        }

        .detail-label {
          color: var(--color-gray-500);
        }

        .detail-value {
          color: var(--color-gray-700);
          font-weight: var(--font-medium);
        }

        .voices-preview-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: var(--space-4);
        }

        .voice-preview {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .voice-preview-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .voice-preview-icon {
          font-size: var(--text-2xl);
        }

        .voice-preview-name {
          margin: 0;
          font-size: var(--text-base);
          font-weight: var(--font-semibold);
        }

        .voice-preview-text {
          margin: 0;
          font-size: var(--text-sm);
          color: var(--color-gray-600);
          line-height: var(--leading-relaxed);
        }

        .voice-preview-date {
          font-size: var(--text-xs);
          color: var(--color-gray-400);
        }

        .getting-started {
          text-align: center;
          padding: var(--space-8);
        }

        .getting-started-icon {
          font-size: 4rem;
          display: block;
          margin-bottom: var(--space-4);
        }

        .getting-started h3 {
          margin: 0 0 var(--space-2);
        }

        .getting-started p {
          margin: 0 0 var(--space-6);
          color: var(--color-gray-600);
        }

        .getting-started-steps {
          display: flex;
          justify-content: center;
          gap: var(--space-6);
          margin-bottom: var(--space-6);
        }

        .step {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-size: var(--text-sm);
          color: var(--color-gray-600);
        }

        .step-number {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-primary-100);
          color: var(--color-primary-700);
          border-radius: var(--radius-full);
          font-weight: var(--font-bold);
          font-size: var(--text-xs);
        }

        @media (max-width: 1024px) {
          .voices-preview-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 768px) {
          .welcome-section {
            padding: var(--space-6);
            flex-direction: column;
            align-items: flex-start;
          }

          .welcome-content {
            flex-direction: column;
            align-items: flex-start;
          }

          .quick-actions-grid {
            grid-template-columns: 1fr;
          }

          .stats-grid {
            grid-template-columns: 1fr;
          }

          .voices-preview-grid {
            grid-template-columns: 1fr;
          }

          .getting-started-steps {
            flex-direction: column;
            align-items: center;
          }
        }
      `}</style>
    </div>
  )
}
