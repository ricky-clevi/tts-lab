import React, { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { fetchHealth, fetchVoices } from '../api'
import type { HealthResponse, CloneVoiceProfileResponse } from '../types'
import { t } from '../i18n'

export default function DashboardPage() {
  const { user } = useAuth()
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

  return (
    <div className="dashboard-page">
      <div className="dashboard-container">
        <div className="welcome-section">
          <h1>{t('dashboard.welcome') || 'Welcome'}, {user?.username}!</h1>
          <p>
            Your personal Text-to-Speech studio. Create custom voices, clone voices, and manage your
            voice library.
          </p>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="dashboard-grid">
          <div className="card">
            <div className="card-header">
              <h2>📚 {t('nav.voices') || 'Voices'}</h2>
            </div>
            <div className="card-content">
              {loading ? (
                <p>Loading...</p>
              ) : (
                <>
                  <p className="stat">{voices.length} voices</p>
                  <p className="description">Your custom and cloned voices</p>
                  <a href="/voices" className="card-link">
                    View Library →
                  </a>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2>🎤 {t('nav.tts') || 'TTS Studio'}</h2>
            </div>
            <div className="card-content">
              <p className="description">Generate speech from text with custom voices</p>
              <a href="/tts" className="card-link">
                Create Audio →
              </a>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2>💬 {t('nav.chat') || 'Voice Chat'}</h2>
            </div>
            <div className="card-content">
              <p className="description">Real-time conversation with voice I/O</p>
              <a href="/chat" className="card-link">
                Start Chat →
              </a>
            </div>
          </div>

          {health && (
            <div className="card">
              <div className="card-header">
                <h2>⚙️ System Status</h2>
              </div>
              <div className="card-content">
                <p className="status-item">
                  <span className="status-label">Device:</span> {health.selected_device}
                </p>
                {health.active_model && (
                  <p className="status-item">
                    <span className="status-label">Model:</span> {health.active_model}
                  </p>
                )}
                {health.runtime_backend && (
                  <p className="status-item">
                    <span className="status-label">Backend:</span> {health.runtime_backend}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .dashboard-page {
          background: #f5f5f5;
          min-height: 100vh;
          padding: 2rem 1rem;
        }

        .dashboard-container {
          max-width: 1200px;
          margin: 0 auto;
        }

        .welcome-section {
          background: white;
          padding: 2rem;
          border-radius: 8px;
          margin-bottom: 2rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .welcome-section h1 {
          margin: 0 0 0.5rem;
          color: #333;
          font-size: 2rem;
        }

        .welcome-section p {
          margin: 0;
          color: #666;
          font-size: 1.05rem;
        }

        .error-banner {
          background: #ffebee;
          color: #d32f2f;
          padding: 1rem;
          border-radius: 4px;
          margin-bottom: 2rem;
          border-left: 4px solid #d32f2f;
        }

        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1.5rem;
        }

        .card {
          background: white;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          transition: transform 0.2s, box-shadow 0.2s;
          display: flex;
          flex-direction: column;
        }

        .card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
        }

        .card-header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 1.5rem;
          padding-bottom: 1rem;
        }

        .card-header h2 {
          margin: 0;
          font-size: 1.3rem;
        }

        .card-content {
          padding: 1.5rem;
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .card-content p {
          margin: 0 0 1rem;
          color: #666;
          font-size: 0.95rem;
        }

        .stat {
          font-size: 2rem;
          font-weight: 700;
          color: #667eea;
          margin-bottom: 0.25rem !important;
        }

        .description {
          color: #999;
          font-size: 0.9rem !important;
          flex: 1;
        }

        .status-item {
          display: flex;
          gap: 1rem;
          font-size: 0.9rem !important;
          margin: 0.5rem 0 !important;
        }

        .status-label {
          font-weight: 600;
          color: #555;
          min-width: 60px;
        }

        .card-link {
          color: #667eea;
          text-decoration: none;
          font-weight: 600;
          transition: color 0.2s;
          margin-top: auto;
        }

        .card-link:hover {
          color: #764ba2;
        }

        @media (max-width: 768px) {
          .dashboard-page {
            padding: 1rem;
          }

          .welcome-section {
            padding: 1.5rem;
          }

          .welcome-section h1 {
            font-size: 1.5rem;
          }

          .card-header h2 {
            font-size: 1.1rem;
          }
        }
      `}</style>
    </div>
  )
}
