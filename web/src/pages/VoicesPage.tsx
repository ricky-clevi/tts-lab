import { useEffect, useMemo, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { deleteVoice, fetchVoices } from '../api'
import '../styles/pages/voices.css'
import { Alert, Badge, Button, Card, CardBody, ConfirmModal, Input, Select, Skeleton, useToast } from '../components/ui'
import { t } from '../i18n'
import type { CloneVoiceProfileResponse } from '../types'

type SortOption = 'newest' | 'oldest' | 'name-asc' | 'name-desc'
type ViewMode = 'grid' | 'list'

export default function VoicesPage() {
  const { success, error: showError } = useToast()
  const [voices, setVoices] = useState<CloneVoiceProfileResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [languageFilter, setLanguageFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [voiceToDelete, setVoiceToDelete] = useState<CloneVoiceProfileResponse | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [copiedId, setCopiedId] = useState('')
  const [deleteConfirmation, setDeleteConfirmation] = useState<string | null>(null)

  useEffect(() => {
    loadVoices()
  }, [])

  const loadVoices = async () => {
    try {
      setLoading(true)
      setError('')
      setVoices(await fetchVoices())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('voices.error.load'))
    } finally {
      setLoading(false)
    }
  }

  const languages = useMemo(() => [...new Set(voices.map((voice) => voice.language))].sort(), [voices])

  const filteredVoices = useMemo(() => {
    let result = [...voices]

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter((voice) => voice.label.toLowerCase().includes(query) || voice.reference_text.toLowerCase().includes(query) || voice.id.toLowerCase().includes(query))
    }

    if (languageFilter !== 'all') {
      result = result.filter((voice) => voice.language === languageFilter)
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        case 'oldest':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        case 'name-asc':
          return a.label.localeCompare(b.label)
        case 'name-desc':
          return b.label.localeCompare(a.label)
        default:
          return 0
      }
    })

    return result
  }, [voices, searchQuery, languageFilter, sortBy])

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id)
    setCopiedId(id)
    success(t('voices.toast.copied'))
    setTimeout(() => setCopiedId(''), 2000)
  }

  const handleDeleteConfirm = async () => {
    if (!voiceToDelete) return

    try {
      setIsDeleting(true)
      await deleteVoice(voiceToDelete.id)
      setDeleteConfirmation(voiceToDelete.id)
      setVoices((prev) => prev.filter((voice) => voice.id !== voiceToDelete.id))
      success(t('voices.toast.deleted', { label: voiceToDelete.label }))
      setDeleteModalOpen(false)
      setVoiceToDelete(null)
      setTimeout(() => setDeleteConfirmation(null), 300)
    } catch (err) {
      showError(err instanceof Error ? err.message : t('voices.error.delete'))
    } finally {
      setIsDeleting(false)
    }
  }

  const hasActiveFilters = searchQuery || languageFilter !== 'all' || sortBy !== 'newest'

  const clearFilters = () => {
    setSearchQuery('')
    setLanguageFilter('all')
    setSortBy('newest')
  }

  return (
    <div className="page voices-page">
      <div className="page-container">
        <div className="page-header">
          <div className="header-content">
            <p className="voices-kicker">{t('voices.kicker')}</p>
            <h1>{t('voices.title')}</h1>
            <p className="page-description">{t('voices.description')}</p>
          </div>
          <Link to="/tts" className="btn btn-primary">
            {t('voices.create')}
          </Link>
        </div>

        {error && <Alert variant="error" onDismiss={() => setError('')}>{error}</Alert>}

        <div className="toolbar">
          <div className="toolbar-section toolbar-section--search">
            <Input
              placeholder={t('voices.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon="ID"
            />
          </div>

          <div className="toolbar-section toolbar-section--filters">
            <div className="toolbar-group">
              <span className="toolbar-label">{t('voices.filter.label')}</span>
              <Select
                value={languageFilter}
                onChange={(e) => setLanguageFilter(e.target.value)}
                options={[{ value: 'all', label: t('voices.filter.allLanguages') }, ...languages.map((entry) => ({ value: entry, label: entry === 'en' ? t('language.english') : entry === 'ko' ? t('language.korean') : entry }))]}
              />
            </div>

            <div className="toolbar-group">
              <span className="toolbar-label">{t('voices.sort.label')}</span>
              <Select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                options={[
                  { value: 'newest', label: t('voices.sort.newest') },
                  { value: 'oldest', label: t('voices.sort.oldest') },
                  { value: 'name-asc', label: t('voices.sort.nameAsc') },
                  { value: 'name-desc', label: t('voices.sort.nameDesc') },
                ]}
              />
            </div>
          </div>

          <div className="toolbar-section toolbar-section--view">
            <div className="view-toggle" role="group" aria-label={t('voices.view.label')}>
              <button
                className={`view-btn ${viewMode === 'grid' ? 'view-btn--active' : ''}`}
                onClick={() => setViewMode('grid')}
                aria-label={t('voices.view.grid')}
                aria-pressed={viewMode === 'grid'}
              >
                <svg className="view-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                  <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                  <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                  <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
                <span className="view-label">{t('voices.view.cards')}</span>
              </button>
              <button
                className={`view-btn ${viewMode === 'list' ? 'view-btn--active' : ''}`}
                onClick={() => setViewMode('list')}
                aria-label={t('voices.view.list')}
                aria-pressed={viewMode === 'list'}
              >
                <svg className="view-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="1" y="2" width="14" height="2" rx="0.5" fill="currentColor"/>
                  <rect x="1" y="7" width="14" height="2" rx="0.5" fill="currentColor"/>
                  <rect x="1" y="12" width="14" height="2" rx="0.5" fill="currentColor"/>
                </svg>
                <span className="view-label">{t('voices.view.listLabel')}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="results-bar">
          <div className="results-count">
            {loading ? (
              <Skeleton width={120} height={16} />
            ) : (
              <span>
                <strong>{filteredVoices.length}</strong> {t('voices.results.of')} <strong>{voices.length}</strong> {t('voices.results.voices')}
                {hasActiveFilters && <span className="results-filtered"> {t('voices.results.filtered')}</span>}
              </span>
            )}
          </div>
          {hasActiveFilters && (
            <button className="clear-filters-btn" onClick={clearFilters}>
              <svg className="clear-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              {t('voices.filter.clear')}
            </button>
          )}
        </div>

        {loading ? (
          <div className={`voices-${viewMode}`}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Card key={index} className={`voice-card voice-card--skeleton voice-card--${viewMode}`}>
                <CardBody>
                  <Skeleton height={viewMode === 'grid' ? 200 : 64} />
                </CardBody>
              </Card>
            ))}
          </div>
        ) : filteredVoices.length === 0 ? (
          <Card className="empty-card">
            <CardBody>
              {voices.length === 0 ? (
                <div className="empty-state-container">
                  <div className="empty-state-icon-wrapper">
                    <svg className="empty-state-svg" viewBox="0 0 48 48" fill="none" aria-hidden="true">
                      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2"/>
                      <path d="M24 14v10M24 28v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <h3 className="empty-state-title">{t('voices.empty')}</h3>
                  <p className="empty-state-description">{t('voices.emptyDescription')}</p>
                  <div className="empty-state-steps">
                    <div className="empty-step">
                      <span className="empty-step-number">1</span>
                      <span className="empty-step-text">{t('voices.empty.step1')}</span>
                    </div>
                    <div className="empty-step">
                      <span className="empty-step-number">2</span>
                      <span className="empty-step-text">{t('voices.empty.step2')}</span>
                    </div>
                    <div className="empty-step">
                      <span className="empty-step-number">3</span>
                      <span className="empty-step-text">{t('voices.empty.step3')}</span>
                    </div>
                  </div>
                  <Link to="/tts" className="btn btn-primary">
                    {t('voices.emptyAction')}
                  </Link>
                </div>
              ) : (
                <div className="no-results-container">
                  <div className="no-results-icon-wrapper">
                    <svg className="no-results-svg" viewBox="0 0 48 48" fill="none" aria-hidden="true">
                      <circle cx="20" cy="20" r="12" stroke="currentColor" strokeWidth="2"/>
                      <path d="M29 29l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      <path d="M16 20h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <h3 className="no-results-title">{t('voices.noResults.title')}</h3>
                  <p className="no-results-description">
                    {searchQuery ? t('voices.noResults.description', { query: searchQuery }) : t('voices.noResults.noMatch')}
                  </p>
                  <div className="no-results-suggestions">
                    <p className="suggestions-label">{t('voices.noResults.suggestions')}</p>
                    <ul className="suggestions-list">
                      <li>{t('voices.noResults.suggestion1')}</li>
                      <li>{t('voices.noResults.suggestion2')}</li>
                      <li>{t('voices.noResults.suggestion3')}</li>
                    </ul>
                  </div>
                  <Button variant="secondary" onClick={clearFilters}>
                    {t('voices.filter.clear')}
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        ) : (
          <>
            {viewMode === 'list' && (
              <div className="list-header">
                <span className="list-header-cell list-header-cell--name">{t('voices.column.name')}</span>
                <span className="list-header-cell list-header-cell--language">{t('voices.column.language')}</span>
                <span className="list-header-cell list-header-cell--id">{t('voices.column.id')}</span>
                <span className="list-header-cell list-header-cell--date">{t('voices.column.created')}</span>
                <span className="list-header-cell list-header-cell--actions">{t('voices.column.actions')}</span>
              </div>
            )}
            <div className={`voices-${viewMode}`}>
              {filteredVoices.map((voice) => (
                <VoiceCard
                  key={voice.id}
                  voice={voice}
                  viewMode={viewMode}
                  copiedId={copiedId}
                  onCopyId={handleCopyId}
                  onDelete={(selectedVoice) => { setVoiceToDelete(selectedVoice); setDeleteModalOpen(true) }}
                  isDeleting={deleteConfirmation === voice.id}
                />
              ))}
            </div>
          </>
        )}

        <ConfirmModal
          isOpen={deleteModalOpen}
          onClose={() => { setDeleteModalOpen(false); setVoiceToDelete(null) }}
          onConfirm={handleDeleteConfirm}
          title={t('voices.delete.title')}
          message={t('voices.delete.message', { label: voiceToDelete?.label ?? '' })}
          confirmText={t('voices.delete.confirm')}
          cancelText={t('modal.cancel')}
          variant="danger"
          isLoading={isDeleting}
        />
      </div>
    </div>
  )
}

interface VoiceCardProps {
  voice: CloneVoiceProfileResponse
  viewMode: ViewMode
  copiedId: string
  onCopyId: (id: string) => void
  onDelete: (voice: CloneVoiceProfileResponse) => void
  isDeleting?: boolean
}

function VoiceCard({ voice, viewMode, copiedId, onCopyId, onDelete, isDeleting }: VoiceCardProps) {
  const isGrid = viewMode === 'grid'
  const isCopied = copiedId === voice.id
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [audioProgress, setAudioProgress] = useState(0)

  const handlePlayPause = () => {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }

  const handleTimeUpdate = () => {
    if (!audioRef.current) return
    const progress = (audioRef.current.currentTime / audioRef.current.duration) * 100
    setAudioProgress(progress)
  }

  const handleAudioEnded = () => {
    setIsPlaying(false)
    setAudioProgress(0)
  }

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickPosition = (e.clientX - rect.left) / rect.width
    audioRef.current.currentTime = clickPosition * audioRef.current.duration
  }

  if (isGrid) {
    return (
      <Card
        hoverable
        className={`voice-card voice-card--grid ${isDeleting ? 'voice-card--deleting' : ''}`}
      >
        <CardBody>
          <div className="voice-card-content">
            <div className="voice-header">
              <div className="voice-info">
                <h3 className="voice-name">{voice.label}</h3>
                <div className="voice-meta">
                  <Badge variant="info">
                    {voice.language === 'en' ? t('language.english') : voice.language === 'ko' ? t('language.korean') : voice.language}
                  </Badge>
                  <span className="voice-date">
                    <svg className="date-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <rect x="2" y="3" width="12" height="11" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M2 6h12M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    {new Date(voice.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="voice-text-section">
              <span className="voice-text-label">{t('voices.referenceText')}</span>
              <p className="voice-text">
                {voice.reference_text.substring(0, 120)}{voice.reference_text.length > 120 ? '...' : ''}
              </p>
            </div>

            <div className="voice-id-section">
              <div className="voice-id-header">
                <span className="voice-id-label">{t('voices.voiceId')}</span>
                <button
                  className={`copy-btn ${isCopied ? 'copy-btn--copied' : ''}`}
                  onClick={() => onCopyId(voice.id)}
                  aria-label={isCopied ? t('voices.copied') : t('voices.copyId')}
                >
                  {isCopied ? (
                    <svg className="copy-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    <svg className="copy-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <rect x="5" y="5" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M3 11V3a1 1 0 011-1h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  )}
                  <span className="copy-text">{isCopied ? t('voices.copied') : t('voices.copyId')}</span>
                </button>
              </div>
              <code className="voice-id-value">{voice.id}</code>
              <p className="voice-id-hint">{t('voices.usageHint')}</p>
            </div>

            {voice.audio_path && (
              <div className="audio-player">
                <audio
                  ref={audioRef}
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={handleAudioEnded}
                  onPause={() => setIsPlaying(false)}
                  onPlay={() => setIsPlaying(true)}
                >
                  <source src={voice.audio_path} type="audio/wav" />
                </audio>
                <button
                  className={`audio-play-btn ${isPlaying ? 'audio-play-btn--playing' : ''}`}
                  onClick={handlePlayPause}
                  aria-label={isPlaying ? t('voices.audio.pause') : t('voices.audio.play')}
                >
                  {isPlaying ? (
                    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <rect x="3" y="2" width="4" height="12" rx="1"/>
                      <rect x="9" y="2" width="4" height="12" rx="1"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M4 2.5v11l9-5.5-9-5.5z"/>
                    </svg>
                  )}
                </button>
                <div className="audio-progress" onClick={handleProgressClick}>
                  <div className="audio-progress-bar" style={{ width: `${audioProgress}%` }} />
                </div>
                <span className="audio-label">{t('voices.audio.preview')}</span>
              </div>
            )}

            <div className="voice-actions">
              <button
                className="delete-btn"
                onClick={() => onDelete(voice)}
                aria-label={t('voices.delete.confirm')}
              >
                <svg className="delete-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M13 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M6 7v4M10 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                {t('voices.delete.confirm')}
              </button>
            </div>
          </div>
        </CardBody>
      </Card>
    )
  }

  // List view
  return (
    <div className={`voice-row ${isDeleting ? 'voice-row--deleting' : ''}`}>
      <div className="voice-row-cell voice-row-cell--name">
        <span className="voice-name-list">{voice.label}</span>
      </div>
      <div className="voice-row-cell voice-row-cell--language">
        <Badge variant="info" className="badge-compact">
          {voice.language === 'en' ? t('language.english') : voice.language === 'ko' ? t('language.korean') : voice.language}
        </Badge>
      </div>
      <div className="voice-row-cell voice-row-cell--id">
        <div className="id-cell">
          <code className="voice-id-compact">{voice.id}</code>
          <button
            className={`copy-btn-compact ${isCopied ? 'copy-btn-compact--copied' : ''}`}
            onClick={() => onCopyId(voice.id)}
            aria-label={isCopied ? t('voices.copied') : t('voices.copyId')}
          >
            {isCopied ? (
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="5" y="5" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M3 11V3a1 1 0 011-1h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            )}
          </button>
        </div>
      </div>
      <div className="voice-row-cell voice-row-cell--date">
        <span className="date-compact">{new Date(voice.created_at).toLocaleDateString()}</span>
      </div>
      <div className="voice-row-cell voice-row-cell--actions">
        {voice.audio_path && (
          <button
            className={`action-btn action-btn--play ${isPlaying ? 'action-btn--playing' : ''}`}
            onClick={handlePlayPause}
            aria-label={isPlaying ? t('voices.audio.pause') : t('voices.audio.play')}
          >
            <audio
              ref={audioRef}
              onEnded={handleAudioEnded}
              onPause={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
            >
              <source src={voice.audio_path} type="audio/wav" />
            </audio>
            {isPlaying ? (
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <rect x="3" y="2" width="4" height="12" rx="1"/>
                <rect x="9" y="2" width="4" height="12" rx="1"/>
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M4 2.5v11l9-5.5-9-5.5z"/>
              </svg>
            )}
          </button>
        )}
        <button
          className="action-btn action-btn--delete"
          onClick={() => onDelete(voice)}
          aria-label={t('voices.delete.confirm')}
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M13 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M6 7v4M10 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
