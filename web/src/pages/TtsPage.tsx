import React, { useState, useEffect, useRef } from 'react'
import { Button, Card, CardBody, CardHeader, Input, Select, Textarea, Alert, Badge } from '../components/ui'
import { useToast } from '../components/ui/Toast'
import { fetchCapabilities, generateRun, createReplyVoiceCloneProfile } from '../api'
import { t } from '../i18n'
import type { Mode, CapabilitiesResponse, GenerationRun, AudioClip } from '../types'

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

export default function TtsPage() {
  const { success, error: showError } = useToast()

  // Capabilities
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null)
  const [isLoadingCaps, setIsLoadingCaps] = useState(true)

  // Mode and form state
  const [mode, setMode] = useState<Mode>('custom')
  const [segments, setSegments] = useState<string[]>([''])
  const [language, setLanguage] = useState('en')
  const [speaker, setSpeaker] = useState('')
  const [voicePersona, setVoicePersona] = useState('')

  // Clone mode state
  const [referenceFile, setReferenceFile] = useState<File | null>(null)
  const [referenceText, setReferenceText] = useState('')
  const [cloneLabel, setCloneLabel] = useState('')

  // Generation state
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_SETTINGS)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationError, setGenerationError] = useState('')

  // Results
  const [runs, setRuns] = useState<GenerationRun[]>([])
  const [selectedRun, setSelectedRun] = useState<GenerationRun | null>(null)

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load capabilities on mount
  useEffect(() => {
    async function loadCapabilities() {
      try {
        const caps = await fetchCapabilities()
        setCapabilities(caps)

        // Set default speaker if available
        if (caps.speakers.length > 0) {
          setSpeaker(caps.speakers[0].id)
        }

        // Set default language
        if (caps.languages.length > 0) {
          setLanguage(caps.languages[0])
        }
      } catch (err) {
        showError('Failed to load capabilities')
      } finally {
        setIsLoadingCaps(false)
      }
    }

    loadCapabilities()
  }, [])

  const handleAddSegment = () => {
    setSegments([...segments, ''])
  }

  const handleRemoveSegment = (index: number) => {
    if (segments.length > 1) {
      setSegments(segments.filter((_, i) => i !== index))
    }
  }

  const handleSegmentChange = (index: number, value: string) => {
    const newSegments = [...segments]
    newSegments[index] = value
    setSegments(newSegments)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setReferenceFile(file)
    }
  }

  const handleGenerate = async () => {
    const validSegments = segments.filter(s => s.trim())
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
        // For clone mode, use FormData
        const formData = new FormData()
        formData.append('audio', referenceFile!)
        formData.append('language', language)
        formData.append('segments', JSON.stringify(validSegments))
        formData.append('reference_text', referenceText)
        formData.append('generation', JSON.stringify(settings))

        result = await generateRun(mode, formData)
      } else {
        // For custom and design modes
        const payload = {
          segments: validSegments,
          language,
          speaker: mode === 'custom' ? speaker : undefined,
          instruct: mode === 'design' ? voicePersona : undefined,
          generation: settings,
        }

        result = await generateRun(mode, payload)
      }

      setRuns(prev => [result, ...prev])
      setSelectedRun(result)
      success('Audio generated successfully!')
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
        referenceText: referenceText,
      })
      success(`Voice profile "${profile.label}" saved successfully!`)
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to save voice profile')
    }
  }

  const getModeDescription = (m: Mode) => {
    const mode = capabilities?.modes.find(cm => cm.id === m)
    return mode?.description || ''
  }

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
          <h1>🎤 {t('workspace.tts') || 'TTS Studio'}</h1>
          <p className="page-description">
            {t('tts.lead') || 'Generate speech from text using custom voices, voice design, or voice cloning.'}
          </p>
        </div>

        <div className="tts-layout">
          {/* Left Panel - Controls */}
          <div className="tts-controls">
            {/* Mode Selection */}
            <Card>
              <CardBody>
                <h3 className="section-title">Voice Mode</h3>
                <div className="mode-tabs">
                  {(['custom', 'design', 'clone'] as Mode[]).map((m) => (
                    <button
                      key={m}
                      className={`mode-tab ${mode === m ? 'mode-tab-active' : ''}`}
                      onClick={() => setMode(m)}
                    >
                      <span className="mode-icon">
                        {m === 'custom' ? '🎭' : m === 'design' ? '✨' : '🔊'}
                      </span>
                      <span className="mode-name">
                        {t(`mode.${m}`) || m.charAt(0).toUpperCase() + m.slice(1)}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="mode-description">{getModeDescription(mode)}</p>
              </CardBody>
            </Card>

            {/* Mode-specific controls */}
            <Card>
              <CardBody>
                {mode === 'custom' && (
                  <div className="form-stack">
                    <Select
                      label={t('field.language') || 'Language'}
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      options={
                        capabilities?.languages.map(l => ({
                          value: l,
                          label: l === 'en' ? 'English' : l === 'ko' ? 'Korean' : l === 'auto' ? 'Auto' : l
                        })) || []
                      }
                    />
                    <Select
                      label={t('field.speaker') || 'Speaker'}
                      value={speaker}
                      onChange={(e) => setSpeaker(e.target.value)}
                      options={
                        capabilities?.speakers.map(s => ({
                          value: s.id,
                          label: `${s.name} - ${s.description}`
                        })) || []
                      }
                    />
                  </div>
                )}

                {mode === 'design' && (
                  <div className="form-stack">
                    <Select
                      label={t('field.language') || 'Language'}
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      options={
                        capabilities?.languages.map(l => ({
                          value: l,
                          label: l === 'en' ? 'English' : l === 'ko' ? 'Korean' : l === 'auto' ? 'Auto' : l
                        })) || []
                      }
                    />
                    <Textarea
                      label={t('field.voicePersona') || 'Voice Persona'}
                      value={voicePersona}
                      onChange={(e) => setVoicePersona(e.target.value)}
                      placeholder="Describe the voice you want: e.g., 'A warm, friendly female voice with a slight British accent'"
                      hint="Describe the voice characteristics you want to generate"
                    />
                  </div>
                )}

                {mode === 'clone' && (
                  <div className="form-stack">
                    <Select
                      label={t('field.language') || 'Language'}
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      options={
                        capabilities?.languages.map(l => ({
                          value: l,
                          label: l === 'en' ? 'English' : l === 'ko' ? 'Korean' : l === 'auto' ? 'Auto (Recommended)' : l
                        })) || []
                      }
                      hint={t('hint.cloneLanguageAuto')}
                    />

                    <div className="form-group">
                      <label className="form-label">{t('field.referenceAudio') || 'Reference Audio'}</label>
                      <div className="file-upload-area">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="audio/*"
                          onChange={handleFileChange}
                          className="file-input"
                        />
                        {referenceFile ? (
                          <div className="file-selected">
                            <span>📁 {referenceFile.name}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setReferenceFile(null)
                                if (fileInputRef.current) fileInputRef.current.value = ''
                              }}
                            >
                              Remove
                            </Button>
                          </div>
                        ) : (
                          <p className="file-hint">Upload a 3-8 second audio clip for best results</p>
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

                    <Input
                      label="Voice Label (for saving)"
                      value={cloneLabel}
                      onChange={(e) => setCloneLabel(e.target.value)}
                      placeholder={t('placeholder.voiceLabel')}
                    />

                    <Button
                      variant="secondary"
                      onClick={handleSaveCloneProfile}
                      disabled={!referenceFile || !cloneLabel.trim()}
                    >
                      Save as Voice Profile
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Text Segments */}
            <Card>
              <CardBody>
                <div className="section-header">
                  <h3 className="section-title">Text to Synthesize</h3>
                  <Button variant="ghost" size="sm" onClick={handleAddSegment}>
                    + Add Segment
                  </Button>
                </div>

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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveSegment(index)}
                          className="remove-segment-btn"
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* Advanced Settings */}
            <Card>
              <CardBody>
                <button
                  className="advanced-toggle"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  <h3 className="section-title">Advanced Settings</h3>
                  <span className="toggle-icon">{showAdvanced ? '▼' : '▶'}</span>
                </button>

                {showAdvanced && (
                  <div className="advanced-settings">
                    <Input
                      label="Temperature"
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={settings.temperature}
                      onChange={(e) => setSettings({ ...settings, temperature: parseFloat(e.target.value) })}
                      hint="Controls randomness (0 = deterministic, 2 = very random)"
                    />
                    <Input
                      label="Top P"
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={settings.top_p}
                      onChange={(e) => setSettings({ ...settings, top_p: parseFloat(e.target.value) })}
                      hint="Nucleus sampling threshold"
                    />
                    <Input
                      label="Max New Tokens"
                      type="number"
                      min="256"
                      max="8192"
                      value={settings.max_new_tokens}
                      onChange={(e) => setSettings({ ...settings, max_new_tokens: parseInt(e.target.value) })}
                      hint="Maximum length of generated audio"
                    />
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Generate Button */}
            {generationError && (
              <Alert variant="error" onDismiss={() => setGenerationError('')}>
                {generationError}
              </Alert>
            )}

            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleGenerate}
              isLoading={isGenerating}
              disabled={isGenerating || segments.every(s => !s.trim())}
            >
              {isGenerating ? t('button.generating') : t('button.generateAudio') || 'Generate Audio'}
            </Button>
          </div>

          {/* Right Panel - Results */}
          <div className="tts-results">
            <Card>
              <CardHeader>
                <h3>Results</h3>
                {runs.length > 0 && (
                  <Badge variant="primary">{runs.length} generations</Badge>
                )}
              </CardHeader>
              <CardBody>
                {runs.length === 0 ? (
                  <div className="empty-results">
                    <span className="empty-icon">🎵</span>
                    <p>No generations yet</p>
                    <p className="empty-hint">Use the controls on the left to generate your first audio clip</p>
                  </div>
                ) : (
                  <>
                    {/* Run History */}
                    {runs.length > 1 && (
                      <div className="run-history">
                        <label className="form-label">History</label>
                        <div className="history-list">
                          {runs.map((run) => (
                            <button
                              key={run.run_id}
                              className={`history-item ${selectedRun?.run_id === run.run_id ? 'history-item-active' : ''}`}
                              onClick={() => setSelectedRun(run)}
                            >
                              <span className="history-mode">{run.mode}</span>
                              <span className="history-date">
                                {new Date(run.created_at).toLocaleTimeString()}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Selected Run Details */}
                    {selectedRun && (
                      <div className="run-details">
                        <div className="run-meta">
                          <Badge variant="primary">{selectedRun.mode}</Badge>
                          <span className="run-device">{selectedRun.device}</span>
                          <span className="run-date">
                            {new Date(selectedRun.created_at).toLocaleString()}
                          </span>
                        </div>

                        <div className="clips-list">
                          {selectedRun.clips.map((clip, index) => (
                            <ClipCard key={clip.id} clip={clip} index={index} />
                          ))}
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
        .tts-page .page-container {
          max-width: 1400px;
        }

        .tts-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--space-6);
          align-items: start;
        }

        .tts-controls {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .tts-results .card {
          position: sticky;
          top: calc(var(--navbar-height) + var(--space-4));
        }

        .section-title {
          margin: 0;
          font-size: var(--text-lg);
          font-weight: var(--font-semibold);
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-4);
        }

        .form-stack {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        /* Mode Tabs */
        .mode-tabs {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--space-2);
          margin: var(--space-4) 0;
        }

        .mode-tab {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-4);
          background: var(--color-gray-50);
          border: 2px solid var(--border-color);
          border-radius: var(--radius-lg);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .mode-tab:hover {
          border-color: var(--color-primary-300);
          background: var(--color-primary-50);
        }

        .mode-tab-active {
          border-color: var(--color-primary-500);
          background: var(--color-primary-50);
        }

        .mode-icon {
          font-size: var(--text-2xl);
        }

        .mode-name {
          font-weight: var(--font-medium);
          font-size: var(--text-sm);
        }

        .mode-description {
          margin: 0;
          color: var(--color-gray-600);
          font-size: var(--text-sm);
        }

        /* File Upload */
        .file-upload-area {
          border: 2px dashed var(--border-color);
          border-radius: var(--radius-md);
          padding: var(--space-4);
          text-align: center;
        }

        .file-input {
          width: 100%;
        }

        .file-selected {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-4);
        }

        .file-hint {
          margin: var(--space-2) 0 0;
          color: var(--color-gray-500);
          font-size: var(--text-sm);
        }

        /* Segments */
        .segments-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .segment-item {
          position: relative;
        }

        .remove-segment-btn {
          position: absolute;
          top: 0;
          right: 0;
        }

        /* Advanced Settings */
        .advanced-toggle {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          padding: 0;
          background: none;
          border: none;
          cursor: pointer;
          text-align: left;
        }

        .toggle-icon {
          color: var(--color-gray-500);
          font-size: var(--text-sm);
        }

        .advanced-settings {
          margin-top: var(--space-4);
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
          padding-top: var(--space-4);
          border-top: 1px solid var(--border-color);
        }

        /* Results */
        .empty-results {
          text-align: center;
          padding: var(--space-8);
          color: var(--color-gray-500);
        }

        .empty-icon {
          font-size: 3rem;
          display: block;
          margin-bottom: var(--space-4);
        }

        .empty-hint {
          font-size: var(--text-sm);
          margin-top: var(--space-2);
        }

        .run-history {
          margin-bottom: var(--space-6);
        }

        .history-list {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
          margin-top: var(--space-2);
        }

        .history-item {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
          padding: var(--space-2) var(--space-3);
          background: var(--color-gray-50);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: all var(--transition-fast);
          text-align: left;
        }

        .history-item:hover {
          border-color: var(--color-primary-300);
        }

        .history-item-active {
          border-color: var(--color-primary-500);
          background: var(--color-primary-50);
        }

        .history-mode {
          font-weight: var(--font-medium);
          font-size: var(--text-sm);
          text-transform: capitalize;
        }

        .history-date {
          font-size: var(--text-xs);
          color: var(--color-gray-500);
        }

        .run-details {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .run-meta {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          flex-wrap: wrap;
        }

        .run-device, .run-date {
          font-size: var(--text-sm);
          color: var(--color-gray-500);
        }

        .clips-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 400px;
          gap: var(--space-4);
          color: var(--color-gray-500);
        }

        @media (max-width: 1024px) {
          .tts-layout {
            grid-template-columns: 1fr;
          }

          .tts-results .card {
            position: static;
          }
        }

        @media (max-width: 640px) {
          .mode-tabs {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  )
}

// ============ Clip Card Component ============

function ClipCard({ clip, index }: { clip: AudioClip; index: number }) {
  const audioRef = useRef<HTMLAudioElement>(null)

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
        <span className="clip-index">Segment {index + 1}</span>
        <div className="clip-badges">
          <Badge variant="info">{clip.language}</Badge>
          <span className="clip-duration">{formatDuration(clip.duration_seconds)}</span>
        </div>
      </div>

      <p className="clip-text">{clip.text}</p>

      <audio
        ref={audioRef}
        src={clip.audio_url}
        controls
        className="clip-audio"
      />

      <div className="clip-meta">
        <span>Sample Rate: {clip.sample_rate} Hz</span>
        {clip.speaker && <span>Speaker: {clip.speaker}</span>}
      </div>

      <Button variant="secondary" size="sm" onClick={handleDownload}>
        Download
      </Button>

      <style>{`
        .clip-card {
          padding: var(--space-4);
          background: var(--color-gray-50);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-lg);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .clip-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .clip-index {
          font-weight: var(--font-semibold);
        }

        .clip-badges {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }

        .clip-duration {
          font-size: var(--text-sm);
          color: var(--color-gray-500);
        }

        .clip-text {
          margin: 0;
          padding: var(--space-3);
          background: var(--color-white);
          border-radius: var(--radius-md);
          font-size: var(--text-sm);
          color: var(--color-gray-700);
          line-height: var(--leading-relaxed);
        }

        .clip-audio {
          width: 100%;
          height: 40px;
        }

        .clip-meta {
          display: flex;
          gap: var(--space-4);
          font-size: var(--text-xs);
          color: var(--color-gray-500);
        }
      `}</style>
    </div>
  )
}
