import { useEffect, useState } from 'react'
import { createReplyVoiceCloneProfile, fetchCapabilities, generateRun } from '../api'
import '../styles/pages/tts.css'
import { Alert, Badge, Button, Card, CardBody, CardHeader, Input, LoadingState, Select, Textarea, useToast } from '../components/ui'
import { t } from '../i18n'
import { formatAppDateTime, formatAppTime, formatLanguageLabel, normalizeLanguageValue } from '../lib/formatters'
import type { AudioClip, CapabilitiesResponse, GenerationRun, Mode } from '../types'

type GenerationSettings = {
  temperature: number
  top_p: number
  max_new_tokens: number
}

const DEFAULT_SETTINGS: GenerationSettings = {
  temperature: 0.7,
  top_p: 0.9,
  max_new_tokens: 2048,
}

const MODE_META: Record<Mode, { mark: string; titleKey: string; summaryKey: string }> = {
  custom: { mark: 'BASE', titleKey: 'tts.mode.custom.title', summaryKey: 'tts.mode.custom.summary' },
  design: { mark: 'STYLE', titleKey: 'tts.mode.design.title', summaryKey: 'tts.mode.design.summary' },
  clone: { mark: 'CLONE', titleKey: 'tts.mode.clone.title', summaryKey: 'tts.mode.clone.summary' },
}

export default function TtsPage() {
  const { success, error: showError } = useToast()
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null)
  const [isLoadingCaps, setIsLoadingCaps] = useState(true)
  const [mode, setMode] = useState<Mode>('custom')
  const [segments, setSegments] = useState<string[]>([''])
  const [language, setLanguage] = useState('en')
  const [speaker, setSpeaker] = useState('')
  const [voicePersona, setVoicePersona] = useState('')
  const [referenceFile, setReferenceFile] = useState<File | null>(null)
  const [referenceText, setReferenceText] = useState('')
  const [cloneLabel, setCloneLabel] = useState('')
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_SETTINGS)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const [runs, setRuns] = useState<GenerationRun[]>([])
  const [selectedRun, setSelectedRun] = useState<GenerationRun | null>(null)

  useEffect(() => {
    async function loadCapabilities() {
      try {
        const caps = await fetchCapabilities()
        setCapabilities(caps)
        if (caps.speakers.length > 0) setSpeaker(caps.speakers[0].id)
        if (caps.languages.length > 0) setLanguage(caps.languages[0])
      } catch {
        showError(t('tts.error.loadCapabilities'))
      } finally {
        setIsLoadingCaps(false)
      }
    }

    loadCapabilities()
  }, [showError])

  const languageOptions =
    capabilities?.languages.map((entry) => ({
      value: entry,
      label: formatLanguageLabel(entry),
    })) || []

  const handleSegmentChange = (index: number, value: string) => {
    setSegments((prev) => prev.map((segment, currentIndex) => (currentIndex === index ? value : segment)))
  }

  const handleGenerate = async () => {
    const validSegments = segments.filter((segment) => segment.trim())
    if (validSegments.length === 0) {
      showError(t('tts.error.missingSegment'))
      return
    }

    if (mode === 'clone' && !referenceFile) {
      showError(t('tts.error.missingReferenceAudio'))
      return
    }

    setIsGenerating(true)
    setGenerationError('')

    try {
      let result: GenerationRun
      if (mode === 'clone') {
        const formData = new FormData()
        formData.append('audio', referenceFile!)
        formData.append('language', language)
        formData.append('segments', JSON.stringify(validSegments))
        formData.append('reference_text', referenceText)
        formData.append('generation', JSON.stringify(settings))
        result = await generateRun(mode, formData)
      } else {
        result = await generateRun(mode, {
          segments: validSegments,
          language,
          speaker: mode === 'custom' ? speaker : undefined,
          instruct: mode === 'design' ? voicePersona : undefined,
          generation: settings,
        })
      }

      setRuns((prev) => [result, ...prev])
      setSelectedRun(result)
      success(t('tts.toast.generated'))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('error.generationFailed')
      setGenerationError(message)
      showError(message)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSaveCloneProfile = async () => {
    if (!referenceFile || !cloneLabel.trim()) {
      showError(t('tts.error.cloneProfileMissingFields'))
      return
    }

    try {
      const profile = await createReplyVoiceCloneProfile({
        file: referenceFile,
        language,
        label: cloneLabel,
        referenceText,
      })
      success(t('tts.toast.profileSaved', { label: profile.label }))
    } catch (err) {
      showError(err instanceof Error ? err.message : t('tts.error.saveProfile'))
    }
  }

  const getModeDescription = (value: Mode) => capabilities?.modes.find((entry) => entry.id === value)?.description || t(MODE_META[value].summaryKey)

  if (isLoadingCaps) {
    return (
      <div className="page">
        <div className="page-container">
          <LoadingState message={t('tts.loadingCapabilities')} />
        </div>
      </div>
    )
  }

  return (
    <div className="page tts-page">
      <div className="page-container">
        <div className="page-header">
          <div className="tts-header">
            <div>
              <p className="tts-kicker">{t('tts.workspace.kicker')}</p>
              <h1>{t('workspace.tts')}</h1>
              <p className="page-description">{t('tts.lead')}</p>
            </div>
            <div className="tts-header-pills">
              <span>{capabilities?.selected_device ?? t('tts.deviceUnavailable')}</span>
              <span>{capabilities?.runtime_backend ?? t('tts.backendUnknown')}</span>
            </div>
          </div>
        </div>

        <div className="tts-layout">
          <div className="tts-controls">
            <Card>
              <CardBody>
                <div className="section-head">
                  <div>
                    <p className="panel-kicker">{t('tts.voiceMode')}</p>
                    <h2>{t(MODE_META[mode].titleKey)}</h2>
                  </div>
                  <span className="mode-mark">{MODE_META[mode].mark}</span>
                </div>
                <div className="mode-tabs" role="tablist" aria-label={t('tts.voiceMode')}>
                  {(Object.keys(MODE_META) as Mode[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={mode === value}
                      className={`mode-tab ${mode === value ? 'mode-tab-active' : ''}`}
                      onClick={() => setMode(value)}
                    >
                      <span className="mode-tab-mark">{MODE_META[value].mark}</span>
                      <strong>{t(`mode.${value}`)}</strong>
                      <span>{t(MODE_META[value].summaryKey)}</span>
                    </button>
                  ))}
                </div>
                <p className="mode-description">{getModeDescription(mode)}</p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><h3>{t('tts.voiceControls')}</h3></CardHeader>
              <CardBody>
                {mode === 'custom' && (
                  <div className="form-stack">
                    <Select label={t('field.language')} value={language} onChange={(e) => setLanguage(e.target.value)} options={languageOptions} />
                    <Select
                      label={t('field.speaker')}
                      value={speaker}
                      onChange={(e) => setSpeaker(e.target.value)}
                      options={capabilities?.speakers.map((entry) => ({ value: entry.id, label: `${entry.name} - ${entry.description}` })) || []}
                    />
                  </div>
                )}

                {mode === 'design' && (
                  <div className="form-stack">
                    <Select label={t('field.language')} value={language} onChange={(e) => setLanguage(e.target.value)} options={languageOptions} />
                    <Textarea
                      label={t('field.voicePersona')}
                      value={voicePersona}
                      onChange={(e) => setVoicePersona(e.target.value)}
                      placeholder={t('tts.personaPlaceholder')}
                      hint={t('tts.personaHint')}
                    />
                  </div>
                )}

                {mode === 'clone' && (
                  <div className="form-stack">
                    <Select
                      label={t('field.language')}
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      options={languageOptions.map((entry) => ({ ...entry, label: normalizeLanguageValue(entry.value) === 'auto' ? t('tts.autoRecommended') : entry.label }))}
                      hint={t('hint.cloneLanguageAuto')}
                    />
                    <div className="form-group">
                      <label className="form-label">{t('field.referenceAudio')}</label>
                      <div className="file-upload-area">
                        <input type="file" accept="audio/*" onChange={(e) => setReferenceFile(e.target.files?.[0] || null)} className="file-input" />
                        {referenceFile ? (
                          <div className="file-selected">
                            <div>
                              <strong>{referenceFile.name}</strong>
                              <p>{t('tts.referenceLoaded')}</p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => setReferenceFile(null)}>{t('button.removeSegment')}</Button>
                          </div>
                        ) : (
                          <div className="file-placeholder">
                            <strong>{t('tts.referencePlaceholderTitle')}</strong>
                            <p>{t('tts.referencePlaceholderDescription')}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <Textarea
                      label={t('field.referenceTranscript')}
                      value={referenceText}
                      onChange={(e) => setReferenceText(e.target.value)}
                      placeholder={t('placeholder.referenceTranscript')}
                      hint={t('hint.cloneTranscriptBlank')}
                    />
                    <Input label={t('field.voiceLabel')} value={cloneLabel} onChange={(e) => setCloneLabel(e.target.value)} placeholder={t('placeholder.voiceLabel')} />
                    <Button variant="secondary" onClick={handleSaveCloneProfile} disabled={!referenceFile || !cloneLabel.trim()}>
                      {t('tts.saveVoiceProfile')}
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h3>{t('tts.textSegments')}</h3>
              </CardHeader>
              <CardBody>
                <div className="segments-list">
                  {segments.map((segment, index) => (
                    <div key={index} className="segment-item">
                      {segments.length > 1 && (
                        <div className="segment-header">
                          <span className="segment-number">{index + 1}</span>
                          <Button variant="ghost" size="sm" onClick={() => setSegments((prev) => prev.filter((_, currentIndex) => currentIndex !== index))} className="remove-segment-btn">
                            {t('button.removeSegment')}
                          </Button>
                        </div>
                      )}
                      <Textarea
                        value={segment}
                        onChange={(e) => handleSegmentChange(index, e.target.value)}
                        placeholder={t('placeholder.pasteText')}
                      />
                    </div>
                  ))}
                  <button type="button" className="add-segment-btn" onClick={() => setSegments((prev) => [...prev, ''])}>
                    + {t('button.addSegment')}
                  </button>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <button
                  type="button"
                  className="advanced-toggle"
                  onClick={() => setShowAdvanced((value) => !value)}
                  aria-expanded={showAdvanced}
                  aria-controls="advanced-settings-panel"
                >
                  <div>
                    <p className="panel-kicker">{t('tts.generationControls')}</p>
                    <h3>{t('tts.advancedSettings')}</h3>
                  </div>
                  <span className="toggle-icon">{showAdvanced ? t('common.hide') : t('common.show')}</span>
                </button>
                <div
                  id="advanced-settings-panel"
                  className="advanced-settings-wrapper"
                  data-expanded={showAdvanced}
                >
                  <div className="advanced-settings-inner">
                    <div className="advanced-settings">
                      <Input label={t('field.temperature')} type="number" step="0.1" min="0" max="2" value={settings.temperature} onChange={(e) => setSettings((prev) => ({ ...prev, temperature: Number.parseFloat(e.target.value) || 0 }))} />
                      <Input label={t('generation.topP')} type="number" step="0.1" min="0" max="1" value={settings.top_p} onChange={(e) => setSettings((prev) => ({ ...prev, top_p: Number.parseFloat(e.target.value) || 0 }))} />
                      <Input label={t('generation.maxNewTokens')} type="number" min="256" max="8192" value={settings.max_new_tokens} onChange={(e) => setSettings((prev) => ({ ...prev, max_new_tokens: Number.parseInt(e.target.value, 10) || 0 }))} />
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>

            {generationError && <Alert variant="error" onDismiss={() => setGenerationError('')}>{generationError}</Alert>}

            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleGenerate}
              isLoading={isGenerating}
              disabled={isGenerating || segments.every((segment) => !segment.trim())}
              className="generate-btn"
              data-loading={isGenerating}
            >
              {isGenerating ? t('button.generating') : t('button.generateAudio')}
            </Button>
          </div>

          <div className="tts-results">
            <Card>
              <CardHeader className="results-header">
                <div>
                  <p className="panel-kicker">{t('tts.outputReview')}</p>
                  <h3>{t('tts.generatedResults')}</h3>
                </div>
                {runs.length > 0 && <Badge variant="primary">{t('tts.runsBadge', { count: runs.length })}</Badge>}
              </CardHeader>
              <CardBody>
                {runs.length === 0 ? (
                  <div className="empty-results">
                    <span className="empty-mark">AUDIO</span>
                    <h3>{t('tts.emptyResults.title')}</h3>
                    <p>{t('tts.emptyResults.description')}</p>
                  </div>
                ) : (
                  <>
                    {runs.length > 1 && (
                      <div className="run-history">
                        <label className="form-label">{t('results.runHistory')}</label>
                        <div className="history-list">
                          {runs.map((run) => (
                            <button key={run.run_id} className={`history-item ${selectedRun?.run_id === run.run_id ? 'history-item-active' : ''}`} onClick={() => setSelectedRun(run)}>
                              <strong>{t(`mode.${run.mode}`)}</strong>
                              <span>{formatAppTime(run.created_at)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedRun && (
                      <div className="run-details">
                        <div className="run-meta">
                          <Badge variant="primary">{t(`mode.${selectedRun.mode}`)}</Badge>
                          <span>{selectedRun.device}</span>
                          <span>{formatAppDateTime(selectedRun.created_at)}</span>
                        </div>
                        <div className="clips-list">
                          {selectedRun.clips.map((clip, index) => <ClipCard key={clip.id} clip={clip} index={index} />)}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

function ClipCard({ clip, index }: { clip: AudioClip; index: number }) {
  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = clip.audio_url
    link.download = clip.file_name
    link.click()
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : t('unit.secondsShort', { value: secs })
  }

  return (
    <div className="clip-card">
      <div className="clip-header">
        <div>
          <p className="clip-kicker">{t('results.segment', { index: index + 1 })}</p>
          <strong>{formatDuration(clip.duration_seconds)}</strong>
        </div>
        <Badge variant="info">{formatLanguageLabel(clip.language)}</Badge>
      </div>
      <p className="clip-text">{clip.text}</p>
      <div className="clip-audio-wrapper">
        <audio src={clip.audio_url} controls className="clip-audio" />
      </div>
      <div className="clip-meta">
        <span>{t('tts.sampleRateMeta', { sampleRate: clip.sample_rate })}</span>
        {clip.speaker && <span>{t('tts.speakerMeta', { speaker: clip.speaker })}</span>}
      </div>
      <div className="clip-actions">
        <Button variant="secondary" size="sm" onClick={handleDownload}>
          {t('tts.downloadClip')}
        </Button>
      </div>
    </div>
  )
}
