import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteVoice, fetchVoices } from '../api'
import { Alert, Badge, Button, Card, CardBody, ConfirmModal, EmptyState, Input, Select, Skeleton } from '../components/ui'
import { useToast } from '../components/ui/Toast'
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

  useEffect(() => {
    loadVoices()
  }, [])

  const loadVoices = async () => {
    try {
      setLoading(true)
      setError('')
      setVoices(await fetchVoices())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voices')
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
    success('Voice ID copied to clipboard')
    setTimeout(() => setCopiedId(''), 2000)
  }

  const handleDeleteConfirm = async () => {
    if (!voiceToDelete) return

    try {
      setIsDeleting(true)
      await deleteVoice(voiceToDelete.id)
      setVoices((prev) => prev.filter((voice) => voice.id !== voiceToDelete.id))
      success(`Voice "${voiceToDelete.label}" deleted successfully`)
      setDeleteModalOpen(false)
      setVoiceToDelete(null)
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete voice')
    } finally {
      setIsDeleting(false)
    }
  }

  const hasActiveFilters = searchQuery || languageFilter !== 'all' || sortBy !== 'newest'

  return (
    <div className="page voices-page">
      <div className="page-container">
        <div className="page-header">
          <div className="header-content">
            <p className="voices-kicker">Asset Library</p>
            <h1>{t('voices.title') || 'Voice Library'}</h1>
            <p className="page-description">Your custom and cloned voice profiles. Use voice IDs to integrate with the on-prem TTS API.</p>
          </div>
          <Link to="/tts" className="btn btn-primary">
            Create New Voice
          </Link>
        </div>

        {error && <Alert variant="error" onDismiss={() => setError('')}>{error}</Alert>}

        <Card className="filters-card">
          <CardBody>
            <div className="filters-row">
              <div className="search-field">
                <Input placeholder="Search voices..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} leftIcon="ID" />
              </div>
              <Select
                value={languageFilter}
                onChange={(e) => setLanguageFilter(e.target.value)}
                options={[{ value: 'all', label: 'All Languages' }, ...languages.map((entry) => ({ value: entry, label: entry === 'en' ? 'English' : entry === 'ko' ? 'Korean' : entry }))]}
              />
              <Select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                options={[
                  { value: 'newest', label: 'Newest First' },
                  { value: 'oldest', label: 'Oldest First' },
                  { value: 'name-asc', label: 'Name (A-Z)' },
                  { value: 'name-desc', label: 'Name (Z-A)' },
                ]}
              />
              <div className="view-toggle">
                <button className={`view-btn ${viewMode === 'grid' ? 'view-btn-active' : ''}`} onClick={() => setViewMode('grid')} aria-label="Grid view">
                  Cards
                </button>
                <button className={`view-btn ${viewMode === 'list' ? 'view-btn-active' : ''}`} onClick={() => setViewMode('list')} aria-label="List view">
                  List
                </button>
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={() => { setSearchQuery(''); setLanguageFilter('all'); setSortBy('newest') }}>
                  Clear Filters
                </Button>
              )}
            </div>

            <div className="results-count">
              {loading ? <Skeleton width={120} height={16} /> : <span>{filteredVoices.length} of {voices.length} voices{hasActiveFilters && ' (filtered)'}</span>}
            </div>
          </CardBody>
        </Card>

        {loading ? (
          <div className={`voices-${viewMode}`}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Card key={index}>
                <CardBody>
                  <Skeleton height={200} />
                </CardBody>
              </Card>
            ))}
          </div>
        ) : filteredVoices.length === 0 ? (
          <Card>
            <CardBody>
              {voices.length === 0 ? (
                <EmptyState icon="LIB" title={t('voices.empty') || 'No voices yet'} description="Create your first voice by going to the TTS Studio and cloning a voice." action={{ label: 'Go to TTS Studio', href: '/tts' }} />
              ) : (
                <EmptyState icon="?" title="No results found" description={`No voices match "${searchQuery}". Try adjusting your search or filters.`} action={{ label: 'Clear Filters', onClick: () => { setSearchQuery(''); setLanguageFilter('all'); setSortBy('newest') } }} />
              )}
            </CardBody>
          </Card>
        ) : (
          <div className={`voices-${viewMode}`}>
            {filteredVoices.map((voice) => (
              <VoiceCard key={voice.id} voice={voice} viewMode={viewMode} copiedId={copiedId} onCopyId={handleCopyId} onDelete={(selectedVoice) => { setVoiceToDelete(selectedVoice); setDeleteModalOpen(true) }} />
            ))}
          </div>
        )}

        <ConfirmModal
          isOpen={deleteModalOpen}
          onClose={() => { setDeleteModalOpen(false); setVoiceToDelete(null) }}
          onConfirm={handleDeleteConfirm}
          title="Delete Voice Profile"
          message={`Are you sure you want to delete "${voiceToDelete?.label}"? This action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          variant="danger"
          isLoading={isDeleting}
        />
      </div>

      <style>{`
        .voices-kicker {
          color: var(--color-primary-700);
          font-size: var(--text-xs);
          font-weight: var(--font-bold);
          letter-spacing: 0.16em;
          text-transform: uppercase;
          margin-bottom: var(--space-2);
        }
        .voices-page .page-header { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: var(--space-4); }
        .header-content { flex: 1; }
        .filters-card { margin-bottom: var(--space-6); }
        .filters-row { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: flex-end; }
        .search-field { flex: 1; min-width: 220px; }
        .filters-row .form-group { margin: 0; }
        .view-toggle {
          display: flex;
          padding: 0.25rem;
          border: 1px solid color-mix(in oklab, var(--color-line) 78%, white 22%);
          border-radius: var(--radius-full);
          background: color-mix(in oklab, var(--color-surface) 82%, white 18%);
        }
        .view-btn {
          min-width: 4.8rem;
          padding: var(--space-2) var(--space-4);
          background: transparent;
          border: none;
          border-radius: var(--radius-full);
          color: var(--color-gray-500);
          font-size: var(--text-sm);
          font-weight: var(--font-bold);
        }
        .view-btn-active { background: var(--color-white); color: var(--color-primary-700); box-shadow: var(--shadow-sm); }
        .results-count { margin-top: var(--space-3); font-size: var(--text-sm); color: var(--color-gray-500); }
        .voices-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: var(--space-4); }
        .voices-list { display: flex; flex-direction: column; gap: var(--space-3); }
        @media (max-width: 768px) {
          .voices-page .page-header, .filters-row { flex-direction: column; }
          .search-field { width: 100%; }
          .voices-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  )
}

interface VoiceCardProps {
  voice: CloneVoiceProfileResponse
  viewMode: ViewMode
  copiedId: string
  onCopyId: (id: string) => void
  onDelete: (voice: CloneVoiceProfileResponse) => void
}

function VoiceCard({ voice, viewMode, copiedId, onCopyId, onDelete }: VoiceCardProps) {
  const isGrid = viewMode === 'grid'

  return (
    <Card hoverable className={`voice-card voice-card-${viewMode}`}>
      <CardBody>
        <div className="voice-card-content">
          <div className="voice-header">
            <div className="voice-info">
              <h3 className="voice-name">{voice.label}</h3>
              <Badge variant="info">{voice.language === 'en' ? 'English' : voice.language === 'ko' ? 'Korean' : voice.language}</Badge>
            </div>
            <span className="voice-date">{new Date(voice.created_at).toLocaleDateString()}</span>
          </div>

          {isGrid && <p className="voice-text">{voice.reference_text.substring(0, 120)}{voice.reference_text.length > 120 ? '...' : ''}</p>}

          <div className="voice-id-section">
            <span className="voice-id-label">Voice ID</span>
            <div className="voice-id-row">
              <code className="voice-id-value">{voice.id}</code>
              <Button variant={copiedId === voice.id ? 'primary' : 'secondary'} size="sm" onClick={() => onCopyId(voice.id)}>
                {copiedId === voice.id ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="voice-id-hint">{t('voices.usageHint') || 'Use this Voice ID in the voice field when calling the TTS API'}</p>
          </div>

          {isGrid && voice.audio_path && (
            <audio controls className="voice-audio">
              <source src={voice.audio_path} type="audio/wav" />
            </audio>
          )}

          <div className="voice-actions">
            <Button variant="danger" size="sm" onClick={() => onDelete(voice)}>Delete</Button>
          </div>
        </div>
      </CardBody>

      <style>{`
        .voice-card-grid .voice-card-content { display: flex; flex-direction: column; gap: var(--space-4); }
        .voice-card-list .voice-card-content { display: flex; align-items: center; gap: var(--space-6); }
        .voice-card-list .voice-info { min-width: 150px; }
        .voice-card-list .voice-id-section { flex: 1; }
        .voice-header { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3); }
        .voice-info { display: flex; flex-direction: column; gap: var(--space-2); }
        .voice-name { margin: 0; font-size: var(--text-lg); font-weight: var(--font-semibold); }
        .voice-date { font-size: var(--text-sm); color: var(--color-gray-400); white-space: nowrap; }
        .voice-text {
          margin: 0;
          font-size: var(--text-sm);
          color: var(--color-gray-600);
          line-height: var(--leading-relaxed);
          background: color-mix(in oklab, var(--color-surface) 84%, white 16%);
          padding: var(--space-3);
          border-radius: var(--radius-md);
        }
        .voice-id-section {
          padding: var(--space-3);
          background: color-mix(in oklab, var(--color-surface) 84%, white 16%);
          border: 1px solid color-mix(in oklab, var(--color-line) 78%, white 22%);
          border-radius: var(--radius-md);
        }
        .voice-id-label {
          display: block;
          font-size: var(--text-xs);
          font-weight: var(--font-bold);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--color-gray-500);
          margin-bottom: var(--space-2);
        }
        .voice-id-row { display: flex; gap: var(--space-2); align-items: center; }
        .voice-id-value {
          flex: 1;
          padding: var(--space-2);
          background: var(--color-white);
          border-radius: var(--radius-sm);
          font-size: var(--text-sm);
          color: var(--color-gray-700);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .voice-id-hint { margin: var(--space-2) 0 0; font-size: var(--text-xs); color: var(--color-gray-500); }
        .voice-audio { width: 100%; height: 36px; }
        .voice-actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
        .voice-card-list .voice-actions { flex-shrink: 0; }
      `}</style>
    </Card>
  )
}
