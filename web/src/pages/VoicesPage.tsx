import React, { useEffect, useState } from 'react'
import { fetchVoices, deleteVoice } from '../api'
import type { CloneVoiceProfileResponse } from '../types'

export default function VoicesPage() {
  const [voices, setVoices] = useState<CloneVoiceProfileResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const [deletingId, setDeletingId] = useState('')

  useEffect(() => {
    loadVoices()
  }, [])

  const loadVoices = async () => {
    try {
      setLoading(true)
      setError('')
      const data = await fetchVoices()
      setVoices(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voices')
    } finally {
      setLoading(false)
    }
  }

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id)
    setCopiedId(id)
    setTimeout(() => setCopiedId(''), 2000)
  }

  const handleDeleteVoice = async (id: string) => {
    if (!confirm('Are you sure you want to delete this voice profile?')) {
      return
    }

    try {
      setDeletingId(id)
      await deleteVoice(id)
      setVoices(voices.filter((v) => v.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete voice')
    } finally {
      setDeletingId('')
    }
  }

  return (
    <div className="voices-page">
      <div className="voices-container">
        <div className="page-header">
          <h1>🎵 Voice Library</h1>
          <p>Your custom and cloned voice profiles</p>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <div className="loading">Loading voices...</div>
        ) : voices.length === 0 ? (
          <div className="empty-state">
            <h2>No voices yet</h2>
            <p>Create your first voice by going to the TTS Studio and cloning a voice.</p>
            <a href="/tts" className="button-primary">
              Go to TTS Studio
            </a>
          </div>
        ) : (
          <div className="voices-grid">
            {voices.map((voice) => (
              <div key={voice.id} className="voice-card">
                <div className="voice-header">
                  <h3>{voice.label}</h3>
                  <span className="badge">{voice.language}</span>
                </div>

                <div className="voice-details">
                  <p className="reference-text">
                    <strong>Reference:</strong> {voice.reference_text.substring(0, 100)}
                    {voice.reference_text.length > 100 ? '...' : ''}
                  </p>
                  <p className="created-date">
                    Created: {new Date(voice.created_at).toLocaleDateString()}
                  </p>
                </div>

                <div className="voice-id-section">
                  <label>Voice ID:</label>
                  <div className="id-input-group">
                    <input type="text" value={voice.id} readOnly className="id-input" />
                    <button
                      onClick={() => handleCopyId(voice.id)}
                      className="copy-button"
                      title="Copy to clipboard"
                    >
                      {copiedId === voice.id ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="id-hint">
                    Use this ID in the voice field when calling the TTS API from your on-prem platform.
                  </p>
                </div>

                <audio controls className="voice-preview">
                  <source src={voice.audio_path} type="audio/wav" />
                  Your browser does not support the audio element.
                </audio>

                <button
                  onClick={() => handleDeleteVoice(voice.id)}
                  disabled={deletingId === voice.id}
                  className="delete-button"
                >
                  {deletingId === voice.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .voices-page {
          background: #f5f5f5;
          min-height: 100vh;
          padding: 2rem 1rem;
        }

        .voices-container {
          max-width: 1200px;
          margin: 0 auto;
        }

        .page-header {
          background: white;
          padding: 2rem;
          border-radius: 8px;
          margin-bottom: 2rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .page-header h1 {
          margin: 0 0 0.5rem;
          color: #333;
          font-size: 2rem;
        }

        .page-header p {
          margin: 0;
          color: #666;
        }

        .error-banner {
          background: #ffebee;
          color: #d32f2f;
          padding: 1rem;
          border-radius: 4px;
          margin-bottom: 2rem;
          border-left: 4px solid #d32f2f;
        }

        .loading {
          text-align: center;
          padding: 3rem;
          color: #666;
          font-size: 1.1rem;
        }

        .empty-state {
          background: white;
          padding: 3rem;
          border-radius: 8px;
          text-align: center;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .empty-state h2 {
          color: #333;
          margin-top: 0;
        }

        .empty-state p {
          color: #666;
          margin-bottom: 2rem;
        }

        .button-primary {
          display: inline-block;
          padding: 0.75rem 1.5rem;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          text-decoration: none;
          border-radius: 4px;
          font-weight: 600;
          transition: transform 0.2s;
        }

        .button-primary:hover {
          transform: translateY(-2px);
        }

        .voices-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 1.5rem;
        }

        .voice-card {
          background: white;
          border-radius: 8px;
          padding: 1.5rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          transition: transform 0.2s, box-shadow 0.2s;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .voice-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
        }

        .voice-header {
          display: flex;
          justify-content: space-between;
          align-items: start;
          gap: 1rem;
        }

        .voice-header h3 {
          margin: 0;
          color: #333;
          font-size: 1.3rem;
        }

        .badge {
          background: #667eea;
          color: white;
          padding: 0.25rem 0.75rem;
          border-radius: 12px;
          font-size: 0.85rem;
          white-space: nowrap;
        }

        .voice-details p {
          margin: 0.5rem 0;
          color: #666;
          font-size: 0.9rem;
        }

        .reference-text {
          background: #f5f5f5;
          padding: 0.75rem;
          border-radius: 4px;
          line-height: 1.4;
        }

        .created-date {
          font-size: 0.85rem;
          color: #999;
        }

        .voice-id-section {
          margin: 1rem 0;
          padding: 1rem;
          background: #f9f9f9;
          border: 1px solid #e0e0e0;
          border-radius: 4px;
        }

        .voice-id-section label {
          display: block;
          font-weight: 600;
          color: #555;
          margin-bottom: 0.5rem;
          font-size: 0.9rem;
        }

        .id-input-group {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }

        .id-input {
          flex: 1;
          padding: 0.5rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-family: 'Courier New', monospace;
          font-size: 0.85rem;
          background: white;
        }

        .copy-button {
          padding: 0.5rem 1rem;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 4px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.2s;
        }

        .copy-button:hover {
          background: #764ba2;
        }

        .id-hint {
          font-size: 0.8rem;
          color: #999;
          margin: 0;
          font-style: italic;
        }

        .voice-preview {
          width: 100%;
          height: 30px;
          border-radius: 4px;
        }

        .delete-button {
          padding: 0.75rem;
          background: #ffebee;
          color: #d32f2f;
          border: 1px solid #d32f2f;
          border-radius: 4px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }

        .delete-button:hover:not(:disabled) {
          background: #ffcdd2;
        }

        .delete-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        @media (max-width: 768px) {
          .voices-page {
            padding: 1rem;
          }

          .voices-grid {
            grid-template-columns: 1fr;
          }

          .page-header h1 {
            font-size: 1.5rem;
          }
        }
      `}</style>
    </div>
  )
}
