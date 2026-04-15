import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteVoice, fetchVoices } from '../api'
import '../styles/pages/voices.css'
import { Alert, Badge, Button, Card, CardBody, ConfirmModal, EmptyState, Input, Select, Skeleton, useToast } from '../components/ui'
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
      setVoices((prev) => prev.filter((voice) => voice.id !== voiceToDelete.id))
      success(t('voices.toast.deleted', { label: voiceToDelete.label }))
      setDeleteModalOpen(false)
      setVoiceToDelete(null)
    } catch (err) {
      showError(err instanceof Error ? err.message : t('voices.error.delete'))
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
            <p className="voices-kicker">{t('voices.kicker')}</p>
            <h1>{t('voices.title')}</h1>
            <p className="page-description">{t('voices.description')}</p>
          </div>
          <Link to="/tts" className="btn btn-primary">
            {t('voices.create')}
          </Link>
        </div>

        {error && <Alert variant="error" onDismiss={() => setError('')}>{error}</Alert>}

        <Card className="filters-card">
          <CardBody>
            <div className="filters-row">
              <div className="search-field">
                <Input placeholder={t('voices.searchPlaceholder')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} leftIcon="ID" />
              </div>
              <Select
                value={languageFilter}
                onChange={(e) => setLanguageFilter(e.target.value)}
                options={[{ value: 'all', label: t('voices.filter.allLanguages') }, ...languages.map((entry) => ({ value: entry, label: entry === 'en' ? t('language.english') : entry === 'ko' ? t('language.korean') : entry }))]}
              />
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
              <div className="view-toggle">
                <button className={`view-btn ${viewMode === 'grid' ? 'view-btn-active' : ''}`} onClick={() => setViewMode('grid')} aria-label={t('voices.view.grid')}>
                  {t('voices.view.cards')}
                </button>
                <button className={`view-btn ${viewMode === 'list' ? 'view-btn-active' : ''}`} onClick={() => setViewMode('list')} aria-label={t('voices.view.list')}>
                  {t('voices.view.listLabel')}
                </button>
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={() => { setSearchQuery(''); setLanguageFilter('all'); setSortBy('newest') }}>
                  {t('voices.filter.clear')}
                </Button>
              )}
            </div>

            <div className="results-count">
              {loading ? <Skeleton width={120} height={16} /> : <span>{t('voices.results.count', { shown: filteredVoices.length, total: voices.length })}{hasActiveFilters ? ` ${t('voices.results.filtered')}` : ''}</span>}
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
                <EmptyState icon="LIB" title={t('voices.empty')} description={t('voices.emptyDescription')} action={{ label: t('voices.emptyAction'), href: '/tts' }} />
              ) : (
                <EmptyState icon="?" title={t('voices.noResults.title')} description={t('voices.noResults.description', { query: searchQuery })} action={{ label: t('voices.filter.clear'), onClick: () => { setSearchQuery(''); setLanguageFilter('all'); setSortBy('newest') } }} />
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
              <Badge variant="info">{voice.language === 'en' ? t('language.english') : voice.language === 'ko' ? t('language.korean') : voice.language}</Badge>
            </div>
            <span className="voice-date">{new Date(voice.created_at).toLocaleDateString()}</span>
          </div>

          {isGrid && <p className="voice-text">{voice.reference_text.substring(0, 120)}{voice.reference_text.length > 120 ? '...' : ''}</p>}

          <div className="voice-id-section">
            <span className="voice-id-label">{t('voices.voiceId')}</span>
            <div className="voice-id-row">
              <code className="voice-id-value">{voice.id}</code>
              <Button variant={copiedId === voice.id ? 'primary' : 'secondary'} size="sm" onClick={() => onCopyId(voice.id)}>
                {copiedId === voice.id ? t('voices.copied') : t('voices.copyId')}
              </Button>
            </div>
            <p className="voice-id-hint">{t('voices.usageHint')}</p>

          </div>

          {isGrid && voice.audio_path && (
            <audio controls className="voice-audio">
              <source src={voice.audio_path} type="audio/wav" />
            </audio>
          )}

          <div className="voice-actions">
            <Button variant="danger" size="sm" onClick={() => onDelete(voice)}>{t('voices.delete.confirm')}</Button>
          </div>
        </div>
      </CardBody>

    </Card>
  )
}
