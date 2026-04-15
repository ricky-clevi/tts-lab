import { useEffect, useState } from 'react'
import { createReplyVoiceCloneProfile, fetchCapabilities, generateRun } from '../api'
import { Alert, Badge, Button, Card, CardBody, CardHeader, Input, Select, Textarea } from '../components/ui'
import { useToast } from '../components/ui/Toast'
import { t } from '../i18n'
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

const MODE_META: Record<Mode, { mark: string; title: string; summary: string }> = {
  custom: { mark: 'BASE', title: 'Preset Speaker', summary: 'Use an available speaker profile for direct synthesis.' },
  design: { mark: 'STYLE', title: 'Voice Design', summary: 'Describe tone and character to shape the voice dynamically.' },
  clone: { mark: 'CLONE', title: 'Reference Clone', summary: 'Upload a short sample and build a reusable operator voice.' },
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
        showError('Failed to load capabilities')
      } finally {
        setIsLoadingCaps(false)
      }
    }

    loadCapabilities()
  }, [showError])

  const languageOptions =
    capabilities?.languages.map((entry) => ({
      value: entry,
      label: entry === 'en' ? 'English' : entry === 'ko' ? 'Korean' : entry === 'auto' ? 'Auto' : entry,
    })) || []

  const handleSegmentChange = (index: number, value: string) => {
    setSegments((prev) => prev.map((segment, currentIndex) => (currentIndex === index ? value : segment)))
  }

  const handleGenerate = async () => {
    const validSegments = segments.filter((segment) => segment.trim())
    if (validSegments.length === 0) {
      showError('Please enter at least one text segment')
      return
    }

    if (mode === 'clone' && !referenceFile) {
      showError('Please upload a reference audio file for voice cloning')
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
      success('Audio generated successfully')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed'
      setGenerationError(message)
      showError(message)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSaveCloneProfile = async () => {
    if (!referenceFile || !cloneLabel.trim()) {
      showError('Please provide a reference audio and label for the voice profile')
      return
    }

    try {
      const profile = await createReplyVoiceCloneProfile({
        file: referenceFile,
        language,
        label: cloneLabel,
        referenceText,
      })
      success(`Voice profile "${profile.label}" saved successfully`)
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to save voice profile')
    }
  }

  const getModeDescription = (value: Mode) => capabilities?.modes.find((entry) => entry.id === value)?.description || MODE_META[value].summary

  if (isLoadingCaps) {
    return (
      <div className="page">
        <div className="page-container">
          <div className="loading-state">
            <div className="spinner" />
            <p>Loading TTS capabilities...</p>
          </div>
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
              <p className="tts-kicker">Synthesis Workspace</p>
              <h1>{t('workspace.tts') || 'TTS Studio'}</h1>
              <p className="page-description">
                {t('tts.lead') || 'Generate speech from text using custom voices, voice design, or voice cloning.'}
              </p>
            </div>
            <div className="tts-header-pills">
              <span>{capabilities?.selected_device ?? 'Device unavailable'}</span>
              <span>{capabilities?.runtime_backend ?? 'Unknown backend'}</span>
            </div>
          </div>
        </div>

        <div className="tts-layout">
          <div className="tts-controls">
            <Card>
              <CardBody>
                <div className="section-head">
                  <div>
                    <p className="panel-kicker">Voice Mode</p>
                    <h2>{MODE_META[mode].title}</h2>
                  </div>
                  <span className="mode-mark">{MODE_META[mode].mark}</span>
                </div>
                <div className="mode-tabs">
                  {(Object.keys(MODE_META) as Mode[]).map((value) => (
                    <button key={value} className={`mode-tab ${mode === value ? 'mode-tab-active' : ''}`} onClick={() => setMode(value)}>
                      <span className="mode-tab-mark">{MODE_META[value].mark}</span>
                      <strong>{t(`mode.${value}`) || MODE_META[value].title}</strong>
                      <span>{MODE_META[value].summary}</span>
                    </button>
                  ))}
                </div>
                <p className="mode-description">{getModeDescription(mode)}</p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><h3>Voice Controls</h3></CardHeader>
              <CardBody>
                {mode === 'custom' && (
                  <div className="form-stack">
                    <Select label={t('field.language') || 'Language'} value={language} onChange={(e) => setLanguage(e.target.value)} options={languageOptions} />
                    <Select
                      label={t('field.speaker') || 'Speaker'}
                      value={speaker}
                      onChange={(e) => setSpeaker(e.target.value)}
                      options={capabilities?.speakers.map((entry) => ({ value: entry.id, label: `${entry.name} - ${entry.description}` })) || []}
                    />
                  </div>
                )}

                {mode === 'design' && (
                  <div className="form-stack">
                    <Select label={t('field.language') || 'Language'} value={language} onChange={(e) => setLanguage(e.target.value)} options={languageOptions} />
                    <Textarea
                      label={t('field.voicePersona') || 'Voice Persona'}
                      value={voicePersona}
                      onChange={(e) => setVoicePersona(e.target.value)}
                      placeholder="Example: calm, reassuring female voice with steady pace for appointment reminders"
                      hint="Use concise operator-facing guidance rather than long prose."
                    />
                  </div>
                )}

                {mode === 'clone' && (
                  <div className="form-stack">
                    <Select
                      label={t('field.language') || 'Language'}
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      options={languageOptions.map((entry) => ({ ...entry, label: entry.value === 'auto' ? 'Auto (recommended)' : entry.label }))}
                      hint={t('hint.cloneLanguageAuto')}
                    />
                    <div className="form-group">
                      <label className="form-label">{t('field.referenceAudio') || 'Reference Audio'}</label>
                      <div className="file-upload-area">
                        <input type="file" accept="audio/*" onChange={(e) => setReferenceFile(e.target.files?.[0] || null)} className="file-input" />
                        {referenceFile ? (
                          <div className="file-selected">
                            <div>
                              <strong>{referenceFile.name}</strong>
                              <p>Reference clip loaded</p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => setReferenceFile(null)}>Remove</Button>
                          </div>
                        ) : (
                          <div className="file-placeholder">
                            <strong>Upload a clean 3-8 second sample</strong>
                            <p>Use a single speaker and minimal background noise.</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <Textarea
                      label={t('field.referenceTranscript') || 'Reference Transcript'}
                      value={referenceText}
                      onChange={(e) => setReferenceText(e.target.value)}
                      placeholder={t('placeholder.referenceTranscript')}
                      hint={t('hint.cloneTranscriptBlank')}
                    />
                    <Input label="Voice Label" value={cloneLabel} onChange={(e) => setCloneLabel(e.target.value)} placeholder={t('placeholder.voiceLabel') || 'Korean outbound female v1'} />
                    <Button variant="secondary" onClick={handleSaveCloneProfile} disabled={!referenceFile || !cloneLabel.trim()}>
                      Save voice profile
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <div className="section-head-inline">
                  <h3>Text Segments</h3>
                  <Button variant="ghost" size="sm" onClick={() => setSegments((prev) => [...prev, ''])}>Add segment</Button>
                </div>
              </CardHeader>
              <CardBody>
                <div className="segments-list">
                  {segments.map((segment, index) => (
                    <div key={index} className="segment-item">
                      <Textarea
                        label={segments.length > 1 ? `Segment ${index + 1}` : undefined}
                        value={segment}
                        onChange={(e) => handleSegmentChange(index, e.target.value)}
                        placeholder={t('placeholder.pasteText') || 'Enter text to synthesize...'}
                      />
                      {segments.length > 1 && (
                        <Button variant="ghost" size="sm" onClick={() => setSegments((prev) => prev.filter((_, currentIndex) => currentIndex !== index))} className="remove-segment-btn">
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <button className="advanced-toggle" onClick={() => setShowAdvanced((value) => !value)}>
                  <div>
                    <p className="panel-kicker">Generation Controls</p>
                    <h3>Advanced settings</h3>
                  </div>
                  <span className="toggle-icon">{showAdvanced ? 'Hide' : 'Show'}</span>
                </button>
                {showAdvanced && (
                  <div className="advanced-settings">
                    <Input label="Temperature" type="number" step="0.1" min="0" max="2" value={settings.temperature} onChange={(e) => setSettings((prev) => ({ ...prev, temperature: Number.parseFloat(e.target.value) || 0 }))} />
                    <Input label="Top P" type="number" step="0.1" min="0" max="1" value={settings.top_p} onChange={(e) => setSettings((prev) => ({ ...prev, top_p: Number.parseFloat(e.target.value) || 0 }))} />
                    <Input label="Max New Tokens" type="number" min="256" max="8192" value={settings.max_new_tokens} onChange={(e) => setSettings((prev) => ({ ...prev, max_new_tokens: Number.parseInt(e.target.value, 10) || 0 }))} />
                  </div>
                )}
              </CardBody>
            </Card>

            {generationError && <Alert variant="error" onDismiss={() => setGenerationError('')}>{generationError}</Alert>}

            <Button variant="primary" size="lg" fullWidth onClick={handleGenerate} isLoading={isGenerating} disabled={isGenerating || segments.every((segment) => !segment.trim())}>
              {isGenerating ? t('button.generating') || 'Generating...' : t('button.generateAudio') || 'Generate Audio'}
            </Button>
          </div>

          <div className="tts-results">
            <Card>
              <CardHeader className="results-header">
                <div>
                  <p className="panel-kicker">Output Review</p>
                  <h3>Generated results</h3>
                </div>
                {runs.length > 0 && <Badge variant="primary">{runs.length} runs</Badge>}
              </CardHeader>
              <CardBody>
                {runs.length === 0 ? (
                  <div className="empty-results">
                    <span className="empty-mark">AUDIO</span>
                    <h3>No generations yet</h3>
                    <p>Use the controls on the left to create your first synthesis run.</p>
                  </div>
                ) : (
                  <>
                    {runs.length > 1 && (
                      <div className="run-history">
                        <label className="form-label">Run History</label>
                        <div className="history-list">
                          {runs.map((run) => (
                            <button key={run.run_id} className={`history-item ${selectedRun?.run_id === run.run_id ? 'history-item-active' : ''}`} onClick={() => setSelectedRun(run)}>
                              <strong>{run.mode}</strong>
                              <span>{new Date(run.created_at).toLocaleTimeString()}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedRun && (
                      <div className="run-details">
                        <div className="run-meta">
                          <Badge variant="primary">{selectedRun.mode}</Badge>
                          <span>{selectedRun.device}</span>
                          <span>{new Date(selectedRun.created_at).toLocaleString()}</span>
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

      <style>{`
        .tts-page .page-container { max-width: 1400px; }
        .tts-header { display: flex; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
        .tts-kicker, .panel-kicker {
          color: var(--color-primary-700);
          font-size: var(--text-xs);
          font-weight: var(--font-bold);
          letter-spacing: 0.16em;
          text-transform: uppercase;
          margin-bottom: var(--space-2);
        }
        .tts-header-pills { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: start; }
        .tts-header-pills span {
          display: inline-flex;
          padding: 0.55rem 0.85rem;
          border-radius: var(--radius-full);
          background: color-mix(in oklab, var(--color-surface-elevated) 78%, white 22%);
          border: 1px solid color-mix(in oklab, var(--color-line) 76%, white 24%);
          color: var(--color-gray-700);
          font-size: var(--text-sm);
          font-weight: var(--font-medium);
        }
        .tts-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(22rem, 0.9fr); gap: var(--space-6); align-items: start; }
        .tts-controls { display: grid; gap: var(--space-4); }
        .tts-results .card { position: sticky; top: calc(var(--navbar-height) + var(--space-4)); }
        .section-head, .section-head-inline, .results-header { display: flex; justify-content: space-between; align-items: start; gap: var(--space-3); }
        .mode-mark, .mode-tab-mark, .empty-mark {
          display: inline-grid;
          place-items: center;
          width: fit-content;
          padding: 0.4rem 0.7rem;
          border-radius: var(--radius-full);
          background: color-mix(in oklab, var(--color-primary-100) 70%, white 30%);
          color: var(--color-primary-800);
          font-size: 0.7rem;
          font-weight: var(--font-extrabold);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .mode-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); margin: var(--space-5) 0 var(--space-4); }
        .mode-tab {
          display: grid;
          gap: var(--space-2);
          padding: var(--space-4);
          text-align: left;
          border: 1px solid color-mix(in oklab, var(--color-line) 78%, white 22%);
          border-radius: var(--radius-xl);
          background: color-mix(in oklab, var(--color-surface) 84%, white 16%);
        }
        .mode-tab strong { font-family: var(--font-family-display); font-size: var(--text-base); color: var(--color-gray-900); }
        .mode-tab span:last-child, .mode-description, .file-placeholder p, .empty-results p { color: var(--color-gray-600); font-size: var(--text-sm); line-height: var(--leading-relaxed); }
        .mode-tab-active { border-color: var(--color-primary-400); background: color-mix(in oklab, var(--color-primary-50) 44%, white 56%); box-shadow: var(--shadow-sm); }
        .form-stack, .segments-list, .run-details, .clips-list { display: grid; gap: var(--space-4); }
        .file-upload-area {
          display: grid;
          gap: var(--space-3);
          padding: var(--space-4);
          border-radius: var(--radius-xl);
          border: 1px dashed color-mix(in oklab, var(--color-primary-300) 56%, var(--color-line) 44%);
          background: color-mix(in oklab, var(--color-primary-50) 26%, white 74%);
        }
        .file-selected, .file-placeholder { display: flex; justify-content: space-between; gap: var(--space-3); align-items: center; }
        .segment-item { position: relative; }
        .remove-segment-btn { position: absolute; top: 0; right: 0; }
        .advanced-toggle { width: 100%; display: flex; justify-content: space-between; align-items: center; text-align: left; border: none; background: none; padding: 0; }
        .toggle-icon { color: var(--color-primary-700); font-size: var(--text-sm); font-weight: var(--font-bold); }
        .advanced-settings { display: grid; gap: var(--space-4); margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid color-mix(in oklab, var(--color-line) 78%, white 22%); }
        .empty-results { display: grid; justify-items: start; gap: var(--space-3); padding: var(--space-4) 0; }
        .run-history { margin-bottom: var(--space-5); }
        .history-list { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
        .history-item {
          display: grid;
          gap: 0.15rem;
          padding: var(--space-3);
          border-radius: var(--radius-lg);
          border: 1px solid color-mix(in oklab, var(--color-line) 78%, white 22%);
          background: color-mix(in oklab, var(--color-surface) 84%, white 16%);
          text-align: left;
        }
        .history-item strong { text-transform: capitalize; }
        .history-item span, .run-meta span { color: var(--color-gray-500); font-size: var(--text-sm); }
        .history-item-active { border-color: var(--color-primary-400); background: color-mix(in oklab, var(--color-primary-50) 42%, white 58%); }
        .run-meta { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
        .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 400px;
          gap: var(--space-4);
          color: var(--color-gray-500);
        }
        @media (max-width: 1100px) {
          .tts-layout { grid-template-columns: 1fr; }
          .tts-results .card { position: static; }
        }
        @media (max-width: 780px) {
          .mode-tabs { grid-template-columns: 1fr; }
        }
      `}</style>
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
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`
  }

  return (
    <div className="clip-card">
      <div className="clip-header">
        <div>
          <p className="clip-kicker">Segment {index + 1}</p>
          <strong>{formatDuration(clip.duration_seconds)}</strong>
        </div>
        <Badge variant="info">{clip.language}</Badge>
      </div>
      <p className="clip-text">{clip.text}</p>
      <audio src={clip.audio_url} controls className="clip-audio" />
      <div className="clip-meta">
        <span>Sample rate {clip.sample_rate} Hz</span>
        {clip.speaker && <span>Speaker {clip.speaker}</span>}
      </div>
      <Button variant="secondary" size="sm" onClick={handleDownload}>
        Download clip
      </Button>
      <style>{`
        .clip-card {
          display: grid;
          gap: var(--space-3);
          padding: var(--space-4);
          border-radius: var(--radius-xl);
          background: color-mix(in oklab, var(--color-surface) 84%, white 16%);
          border: 1px solid color-mix(in oklab, var(--color-line) 78%, white 22%);
        }
        .clip-header { display: flex; justify-content: space-between; gap: var(--space-3); align-items: start; }
        .clip-kicker {
          color: var(--color-gray-500);
          font-size: var(--text-xs);
          font-weight: var(--font-bold);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 0.25rem;
        }
        .clip-header strong { font-family: var(--font-family-display); font-size: var(--text-lg); color: var(--color-gray-900); }
        .clip-text {
          padding: var(--space-3);
          border-radius: var(--radius-lg);
          background: var(--color-white);
          border: 1px solid color-mix(in oklab, var(--color-line) 76%, white 24%);
          color: var(--color-gray-700);
          line-height: var(--leading-relaxed);
        }
        .clip-audio { width: 100%; height: 40px; }
        .clip-meta { display: flex; gap: var(--space-3); flex-wrap: wrap; color: var(--color-gray-500); font-size: var(--text-xs); }
      `}</style>
    </div>
  )
}
