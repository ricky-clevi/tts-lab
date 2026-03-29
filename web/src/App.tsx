import { startTransition, useEffect, useState } from 'react'

import { fetchCapabilities, fetchHealth, generateRun } from './api'
import './App.css'
import type { AudioClip, CapabilitiesResponse, GenerationRun, HealthResponse, Mode } from './types'

type StyleControls = {
  mood: string
  emotionIntensity: string
  pace: string
  energy: string
  expressiveness: string
}

type Segment = {
  id: string
  text: string
}

type CustomFormState = {
  language: string
  speaker: string
  instruct: string
  style: StyleControls
  segments: Segment[]
  generation: {
    temperature: string
    top_p: string
    max_new_tokens: string
    seed: string
  }
}

type DesignFormState = {
  language: string
  instruct: string
  style: StyleControls
  segments: Segment[]
  generation: {
    temperature: string
    top_p: string
    max_new_tokens: string
    seed: string
  }
}

type CloneFormState = {
  language: string
  refText: string
  xVectorOnlyMode: boolean
  referenceFile: File | null
  segments: Segment[]
  generation: {
    temperature: string
    top_p: string
    max_new_tokens: string
    seed: string
  }
}

const MOOD_OPTIONS = [
  {
    id: 'neutral',
    label: 'Neutral',
    prompt: 'Keep the emotional tone neutral, composed, and matter-of-fact.',
  },
  {
    id: 'calm',
    label: 'Calm',
    prompt: 'Sound calm, relaxed, and emotionally steady.',
  },
  {
    id: 'warm',
    label: 'Warm',
    prompt: 'Sound warm, friendly, and reassuring.',
  },
  {
    id: 'happy',
    label: 'Happy',
    prompt: 'Sound lightly happy and upbeat without becoming cartoonish.',
  },
  {
    id: 'confident',
    label: 'Confident',
    prompt: 'Sound confident, assured, and articulate.',
  },
  {
    id: 'serious',
    label: 'Serious',
    prompt: 'Sound serious, focused, and professional.',
  },
  {
    id: 'empathetic',
    label: 'Empathetic',
    prompt: 'Sound empathetic and caring while staying controlled.',
  },
  {
    id: 'sad',
    label: 'Sad',
    prompt: 'Sound gently sad and reflective without audible crying.',
  },
]

const EMOTION_INTENSITY_OPTIONS = [
  {
    id: 'restrained',
    label: 'Restrained',
    prompt: 'Keep emotional expression restrained and subtle.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    prompt: 'Use moderate emotional expression with natural variation.',
  },
  {
    id: 'expressive',
    label: 'Expressive',
    prompt: 'Allow stronger emotional expression when the text supports it.',
  },
]

const PACE_OPTIONS = [
  {
    id: 'slower',
    label: 'Slower',
    prompt: 'Use a slightly slower speaking pace with clear phrasing.',
  },
  {
    id: 'steady',
    label: 'Steady',
    prompt: 'Maintain a steady, natural speaking pace.',
  },
  {
    id: 'faster',
    label: 'Faster',
    prompt: 'Use a slightly quicker pace while staying intelligible.',
  },
]

const ENERGY_OPTIONS = [
  {
    id: 'soft',
    label: 'Soft',
    prompt: 'Keep the vocal energy soft and low-pressure.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    prompt: 'Use balanced vocal energy with a natural conversational lift.',
  },
  {
    id: 'high',
    label: 'High',
    prompt: 'Use stronger vocal energy and clearer emphasis.',
  },
]

const EXPRESSIVENESS_OPTIONS = [
  {
    id: 'controlled',
    label: 'Controlled',
    prompt: 'Keep prosody controlled with limited melodrama.',
  },
  {
    id: 'natural',
    label: 'Natural',
    prompt: 'Use natural prosodic variation and human-like emphasis.',
  },
  {
    id: 'dramatic',
    label: 'Dramatic',
    prompt: 'Allow broader pitch movement and more dramatic phrasing.',
  },
]

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`
}

function makeSegment(text = ''): Segment {
  return { id: makeId(), text }
}

function makeStyleControls(): StyleControls {
  return {
    mood: 'neutral',
    emotionIntensity: 'restrained',
    pace: 'steady',
    energy: 'balanced',
    expressiveness: 'controlled',
  }
}

function compactGenerationSettings(values: Record<string, string>) {
  return Object.entries(values).reduce<Record<string, number>>((accumulator, [key, value]) => {
    if (!value.trim()) {
      return accumulator
    }

    const parsed = Number(value)
    if (!Number.isNaN(parsed)) {
      accumulator[key] = parsed
    }
    return accumulator
  }, {})
}

function formatTimestamp(isoTimestamp: string) {
  return new Date(isoTimestamp).toLocaleString()
}

function buildWaveformBars(seed: string) {
  const bars: number[] = []
  let value = 0
  for (const character of seed) {
    value += character.charCodeAt(0)
  }

  for (let index = 0; index < 28; index += 1) {
    value = (value * 1664525 + 1013904223) % 4294967296
    bars.push(18 + (value % 44))
  }
  return bars
}

function optionPrompt(
  options: Array<{ id: string; label: string; prompt: string }>,
  id: string,
) {
  return options.find((option) => option.id === id)?.prompt ?? ''
}

function composeInstruction(
  baseInstruction: string,
  style: StyleControls,
  mode: 'custom' | 'design',
) {
  const guidance = [
    mode === 'custom' ? 'Preserve the core identity of the selected preset speaker.' : '',
    optionPrompt(MOOD_OPTIONS, style.mood),
    optionPrompt(EMOTION_INTENSITY_OPTIONS, style.emotionIntensity),
    optionPrompt(PACE_OPTIONS, style.pace),
    optionPrompt(ENERGY_OPTIONS, style.energy),
    optionPrompt(EXPRESSIVENESS_OPTIONS, style.expressiveness),
  ].filter(Boolean)

  if (
    style.mood !== 'sad' &&
    (style.emotionIntensity === 'restrained' || style.expressiveness === 'controlled')
  ) {
    guidance.push(
      'Avoid exaggerated sadness, trembling, sobbing, or a crying delivery unless the text explicitly asks for it.',
    )
  }

  const customGuidance = baseInstruction.trim()
  if (customGuidance) {
    guidance.push(`Additional guidance: ${customGuidance}`)
  }

  return guidance.join(' ')
}

function App() {
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [mode, setMode] = useState<Mode>('custom')
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runs, setRuns] = useState<GenerationRun[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [customForm, setCustomForm] = useState<CustomFormState>({
    language: 'English',
    speaker: 'Ryan',
    instruct: '',
    style: makeStyleControls(),
    segments: [makeSegment()],
    generation: {
      temperature: '',
      top_p: '',
      max_new_tokens: '',
      seed: '',
    },
  })
  const [designForm, setDesignForm] = useState<DesignFormState>({
    language: 'English',
    instruct: '',
    style: makeStyleControls(),
    segments: [makeSegment()],
    generation: {
      temperature: '',
      top_p: '',
      max_new_tokens: '',
      seed: '',
    },
  })
  const [cloneForm, setCloneForm] = useState<CloneFormState>({
    language: 'English',
    refText: '',
    xVectorOnlyMode: false,
    referenceFile: null,
    segments: [makeSegment()],
    generation: {
      temperature: '',
      top_p: '',
      max_new_tokens: '',
      seed: '',
    },
  })

  useEffect(() => {
    let alive = true

    async function loadBootData() {
      try {
        const [capabilitiesResponse, healthResponse] = await Promise.all([
          fetchCapabilities(),
          fetchHealth(),
        ])

        if (!alive) {
          return
        }

        setCapabilities(capabilitiesResponse)
        setHealth(healthResponse)
        setCustomForm((current) => ({
          ...current,
          language: capabilitiesResponse.languages.includes(current.language)
            ? current.language
            : capabilitiesResponse.languages[0],
          speaker: capabilitiesResponse.speakers.some((speaker) => speaker.id === current.speaker)
            ? current.speaker
            : (capabilitiesResponse.speakers[0]?.id ?? ''),
        }))
        setDesignForm((current) => ({
          ...current,
          language: capabilitiesResponse.languages.includes(current.language)
            ? current.language
            : capabilitiesResponse.languages[0],
        }))
        setCloneForm((current) => ({
          ...current,
          language: capabilitiesResponse.languages.includes(current.language)
            ? current.language
            : capabilitiesResponse.languages[0],
        }))
      } catch (loadError) {
        if (alive) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to reach the local API.')
        }
      } finally {
        if (alive) {
          setLoading(false)
        }
      }
    }

    void loadBootData()

    return () => {
      alive = false
    }
  }, [])

  const activeRun = runs.find((run) => run.run_id === activeRunId) ?? runs[0] ?? null
  const modeMeta = capabilities?.modes.find((item) => item.id === mode)

  function updateSegments(targetMode: Mode, updater: (segments: Segment[]) => Segment[]) {
    if (targetMode === 'custom') {
      setCustomForm((current) => ({ ...current, segments: updater(current.segments) }))
      return
    }

    if (targetMode === 'design') {
      setDesignForm((current) => ({ ...current, segments: updater(current.segments) }))
      return
    }

    setCloneForm((current) => ({ ...current, segments: updater(current.segments) }))
  }

  function addSegment() {
    updateSegments(mode, (segments) => [...segments, makeSegment()])
  }

  function removeSegment(segmentId: string) {
    updateSegments(mode, (segments) => {
      if (segments.length === 1) {
        return segments
      }
      return segments.filter((segment) => segment.id !== segmentId)
    })
  }

  function updateSegment(segmentId: string, value: string) {
    updateSegments(mode, (segments) =>
      segments.map((segment) => (segment.id === segmentId ? { ...segment, text: value } : segment)),
    )
  }

  async function refreshHealth() {
    try {
      setHealth(await fetchHealth())
    } catch {
      // Ignore transient refresh failures after generation.
    }
  }

  async function handleGenerate() {
    setError(null)
    setPending(true)

    try {
      let run: GenerationRun

      if (mode === 'custom') {
        run = await generateRun('custom', {
          segments: customForm.segments.map((segment) => segment.text),
          language: customForm.language,
          speaker: customForm.speaker,
          instruct: composeInstruction(customForm.instruct, customForm.style, 'custom'),
          generation: compactGenerationSettings(customForm.generation),
        })
      } else if (mode === 'design') {
        run = await generateRun('design', {
          segments: designForm.segments.map((segment) => segment.text),
          language: designForm.language,
          instruct: composeInstruction(designForm.instruct, designForm.style, 'design'),
          generation: compactGenerationSettings(designForm.generation),
        })
      } else {
        if (!cloneForm.referenceFile) {
          throw new Error('Add a reference clip before running voice clone.')
        }

        const payload = new FormData()
        payload.append('segments', JSON.stringify(cloneForm.segments.map((segment) => segment.text)))
        payload.append('language', cloneForm.language)
        payload.append('ref_text', cloneForm.refText)
        payload.append('x_vector_only_mode', String(cloneForm.xVectorOnlyMode))
        payload.append('generation', JSON.stringify(compactGenerationSettings(cloneForm.generation)))
        payload.append('ref_audio', cloneForm.referenceFile)
        run = await generateRun('clone', payload)
      }

      startTransition(() => {
        setRuns((current) => [run, ...current])
        setActiveRunId(run.run_id)
      })
      await refreshHealth()
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Generation failed.')
    } finally {
      setPending(false)
    }
  }

  function renderSegments(segments: Segment[]) {
    return segments.map((segment, index) => (
      <div className="segment-row" key={segment.id}>
        <label className="field-label" htmlFor={segment.id}>
          Text segment {index + 1}
        </label>
        <textarea
          id={segment.id}
          className="text-input segment-input"
          value={segment.text}
          onChange={(event) => updateSegment(segment.id, event.target.value)}
          placeholder="Paste text to synthesize."
          rows={3}
        />
        <button
          className="ghost-button"
          type="button"
          onClick={() => removeSegment(segment.id)}
          disabled={segments.length === 1}
        >
          Remove segment
        </button>
      </div>
    ))
  }

  function renderGenerationControls(
    values: Record<string, string>,
    onChange: (key: string, value: string) => void,
  ) {
    return (
      <details className="advanced-panel">
        <summary>Advanced generation</summary>
        <div className="advanced-grid">
          <label className="field">
            <span className="field-label">Temperature</span>
            <input
              className="text-input"
              inputMode="decimal"
              value={values.temperature}
              onChange={(event) => onChange('temperature', event.target.value)}
              placeholder="0.7"
            />
          </label>
          <label className="field">
            <span className="field-label">Top P</span>
            <input
              className="text-input"
              inputMode="decimal"
              value={values.top_p}
              onChange={(event) => onChange('top_p', event.target.value)}
              placeholder="0.9"
            />
          </label>
          <label className="field">
            <span className="field-label">Max new tokens</span>
            <input
              className="text-input"
              inputMode="numeric"
              value={values.max_new_tokens}
              onChange={(event) => onChange('max_new_tokens', event.target.value)}
              placeholder="2048"
            />
          </label>
          <label className="field">
            <span className="field-label">Seed</span>
            <input
              className="text-input"
              inputMode="numeric"
              value={values.seed}
              onChange={(event) => onChange('seed', event.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>
      </details>
    )
  }

  function renderStyleControls(
    values: StyleControls,
    onChange: (key: keyof StyleControls, value: string) => void,
  ) {
    const stylePreview = composeInstruction('', values, mode === 'design' ? 'design' : 'custom')

    return (
      <section className="style-panel">
        <div className="style-panel-head">
          <div>
            <p className="mode-label">Performance controls</p>
            <p className="style-panel-copy">
              These settings are converted into a natural-language instruction for Qwen.
            </p>
          </div>
        </div>

        <div className="style-grid">
          <label className="field">
            <span className="field-label">Mood</span>
            <select
              className="text-input"
              value={values.mood}
              onChange={(event) => onChange('mood', event.target.value)}
            >
              {MOOD_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Emotion intensity</span>
            <select
              className="text-input"
              value={values.emotionIntensity}
              onChange={(event) => onChange('emotionIntensity', event.target.value)}
            >
              {EMOTION_INTENSITY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Pace</span>
            <select
              className="text-input"
              value={values.pace}
              onChange={(event) => onChange('pace', event.target.value)}
            >
              {PACE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Energy</span>
            <select
              className="text-input"
              value={values.energy}
              onChange={(event) => onChange('energy', event.target.value)}
            >
              {ENERGY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field style-grid-full">
            <span className="field-label">Expressiveness</span>
            <select
              className="text-input"
              value={values.expressiveness}
              onChange={(event) => onChange('expressiveness', event.target.value)}
            >
              {EXPRESSIVENESS_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="style-preview">{stylePreview}</p>
      </section>
    )
  }

  function renderClip(clip: AudioClip) {
    const waveformBars = buildWaveformBars(clip.id)

    return (
      <article className="clip-card" key={clip.id}>
        <div className="clip-head">
          <div>
            <p className="clip-name">{clip.file_name}</p>
            <p className="clip-copy">{clip.text}</p>
          </div>
          <a className="ghost-button" href={clip.audio_url} download={clip.file_name}>
            Download
          </a>
        </div>
        <div className="waveform" aria-hidden="true">
          {waveformBars.map((height, index) => (
            <span key={`${clip.id}-${index}`} style={{ height }} />
          ))}
        </div>
        <audio className="audio-player" controls src={clip.audio_url}>
          Your browser does not support the audio element.
        </audio>
        <dl className="clip-meta">
          <div>
            <dt>Language</dt>
            <dd>{clip.language}</dd>
          </div>
          <div>
            <dt>Sample rate</dt>
            <dd>{clip.sample_rate} Hz</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{clip.duration_seconds}s</dd>
          </div>
          {clip.speaker ? (
            <div>
              <dt>Speaker</dt>
              <dd>{clip.speaker}</dd>
            </div>
          ) : null}
        </dl>
      </article>
    )
  }

  if (loading) {
    return <main className="shell loading-state">Loading local Qwen3-TTS lab…</main>
  }

  return (
    <main className="shell">
      <section className="panel panel-controls">
        <header className="hero">
          <p className="eyebrow">Local speech evaluation</p>
          <h1>Qwen3-TTS Lab</h1>
          <p className="lead">
            Switch between preset voices, natural-language voice design, and voice cloning without
            leaving the same session.
          </p>
        </header>

        <div className="status-strip">
          <span>Device: {health?.selected_device ?? 'unknown'}</span>
          <span>Active mode: {health?.active_mode ?? 'idle'}</span>
        </div>

        <div className="tabs" role="tablist" aria-label="Generation modes">
          {capabilities?.modes.map((item) => (
            <button
              key={item.id}
              className={`tab ${item.id === mode ? 'tab-active' : ''}`}
              type="button"
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <section className="mode-summary">
          <p className="mode-label">{modeMeta?.label}</p>
          <p>{modeMeta?.description}</p>
          <code>{modeMeta?.checkpoint}</code>
        </section>

        <div className="editor">
          {mode === 'custom' ? (
            <>
              <label className="field">
                <span className="field-label">Language</span>
                <select
                  className="text-input"
                  value={customForm.language}
                  onChange={(event) =>
                    setCustomForm((current) => ({ ...current, language: event.target.value }))
                  }
                >
                  {capabilities?.languages.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Speaker</span>
                <select
                  className="text-input"
                  value={customForm.speaker}
                  onChange={(event) =>
                    setCustomForm((current) => ({ ...current, speaker: event.target.value }))
                  }
                >
                  {capabilities?.speakers.map((speaker) => (
                    <option key={speaker.id} value={speaker.id}>
                      {speaker.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">
                {capabilities?.speakers.find((speaker) => speaker.id === customForm.speaker)
                  ?.description ?? ''}
              </p>
              {renderStyleControls(customForm.style, (key, value) =>
                setCustomForm((current) => ({
                  ...current,
                  style: { ...current.style, [key]: value },
                }))
              )}
              <label className="field">
                <span className="field-label">Additional instruction</span>
                <textarea
                  className="text-input"
                  rows={3}
                  value={customForm.instruct}
                  onChange={(event) =>
                    setCustomForm((current) => ({ ...current, instruct: event.target.value }))
                  }
                  placeholder="Optional extra guidance beyond the mood controls."
                />
              </label>
              {renderSegments(customForm.segments)}
              {renderGenerationControls(customForm.generation, (key, value) =>
                setCustomForm((current) => ({
                  ...current,
                  generation: { ...current.generation, [key]: value },
                }))
              )}
            </>
          ) : null}

          {mode === 'design' ? (
            <>
              <label className="field">
                <span className="field-label">Language</span>
                <select
                  className="text-input"
                  value={designForm.language}
                  onChange={(event) =>
                    setDesignForm((current) => ({ ...current, language: event.target.value }))
                  }
                >
                  {capabilities?.languages.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Voice persona</span>
                <textarea
                  className="text-input"
                  rows={4}
                  value={designForm.instruct}
                  onChange={(event) =>
                    setDesignForm((current) => ({ ...current, instruct: event.target.value }))
                  }
                  placeholder="Describe the target timbre, persona, age, accent, or speaking style."
                />
              </label>
              {renderStyleControls(designForm.style, (key, value) =>
                setDesignForm((current) => ({
                  ...current,
                  style: { ...current.style, [key]: value },
                }))
              )}
              {renderSegments(designForm.segments)}
              {renderGenerationControls(designForm.generation, (key, value) =>
                setDesignForm((current) => ({
                  ...current,
                  generation: { ...current.generation, [key]: value },
                }))
              )}
            </>
          ) : null}

          {mode === 'clone' ? (
            <>
              <label className="field">
                <span className="field-label">Language</span>
                <select
                  className="text-input"
                  value={cloneForm.language}
                  onChange={(event) =>
                    setCloneForm((current) => ({ ...current, language: event.target.value }))
                  }
                >
                  {capabilities?.languages.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Reference audio</span>
                <input
                  className="text-input"
                  type="file"
                  accept="audio/*"
                  onChange={(event) =>
                    setCloneForm((current) => ({
                      ...current,
                      referenceFile: event.target.files?.[0] ?? null,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">Reference transcript</span>
                <textarea
                  className="text-input"
                  rows={3}
                  value={cloneForm.refText}
                  onChange={(event) =>
                    setCloneForm((current) => ({ ...current, refText: event.target.value }))
                  }
                  placeholder="Transcript for the uploaded reference clip."
                />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={cloneForm.xVectorOnlyMode}
                  onChange={(event) =>
                    setCloneForm((current) => ({
                      ...current,
                      xVectorOnlyMode: event.target.checked,
                    }))
                  }
                />
                <span>Use x-vector only mode</span>
              </label>
              <p className="hint">
                Clone mode follows the reference clip directly, so structured mood controls are only
                available in Custom Voice and Voice Design.
              </p>
              {renderSegments(cloneForm.segments)}
              {renderGenerationControls(cloneForm.generation, (key, value) =>
                setCloneForm((current) => ({
                  ...current,
                  generation: { ...current.generation, [key]: value },
                }))
              )}
            </>
          ) : null}
        </div>

        <div className="controls-footer">
          <button className="ghost-button" type="button" onClick={addSegment}>
            Add segment
          </button>
          <button className="primary-button" type="button" onClick={handleGenerate} disabled={pending}>
            {pending ? 'Generating…' : 'Generate audio'}
          </button>
        </div>

        {error ? <p className="error-banner">{error}</p> : null}
      </section>

      <section className="panel panel-results">
        <header className="results-header">
          <div>
            <p className="eyebrow">Session output</p>
            <h2>Run history</h2>
          </div>
          <p className="results-count">{runs.length} runs in memory</p>
        </header>

        {runs.length === 0 ? (
          <div className="empty-state">
            <p>No generations yet.</p>
            <p>Submit a run from the left panel to compare output quality here.</p>
          </div>
        ) : (
          <>
            <div className="history-list">
              {runs.map((run) => (
                <button
                  key={run.run_id}
                  className={`history-item ${activeRun?.run_id === run.run_id ? 'history-item-active' : ''}`}
                  type="button"
                  onClick={() => setActiveRunId(run.run_id)}
                >
                  <span>{run.mode}</span>
                  <span>{formatTimestamp(run.created_at)}</span>
                </button>
              ))}
            </div>

            {activeRun ? (
              <section className="run-detail">
                <div className="run-meta">
                  <div>
                    <p className="run-title">{activeRun.mode}</p>
                    <p>{activeRun.model_id}</p>
                  </div>
                  <div>
                    <p>{formatTimestamp(activeRun.created_at)}</p>
                    <p>Device: {activeRun.device}</p>
                  </div>
                </div>
                <div className="clips">{activeRun.clips.map((clip) => renderClip(clip))}</div>
              </section>
            ) : null}
          </>
        )}
      </section>
    </main>
  )
}

export default App
