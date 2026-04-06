import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import App from './App'

const capabilities = {
  active_mode: null,
  selected_device: 'cpu',
  languages: ['Auto', 'English', 'Korean'],
  speakers: [
    {
      id: 'Ryan',
      name: 'Ryan',
      description: 'Dynamic male voice with strong rhythmic drive.',
      native_language: 'English',
    },
    {
      id: 'Sohee',
      name: 'Sohee',
      description: 'Warm Korean female voice with rich emotion.',
      native_language: 'Korean',
    },
  ],
  generation_knobs: {
    temperature: { default: 0.7, min: 0, max: 2 },
    top_p: { default: 0.9, min: 0, max: 1 },
    max_new_tokens: { default: 2048, min: 64, max: 8192 },
    seed: { default: null, min: 0, max: 2147483647 },
  },
  modes: [
    { id: 'custom', label: 'Custom Voice', description: 'Preset voices', checkpoint: 'custom-model' },
    { id: 'design', label: 'Voice Design', description: 'Prompt a voice', checkpoint: 'design-model' },
    { id: 'clone', label: 'Voice Clone', description: 'Upload reference', checkpoint: 'clone-model' },
  ],
  asr: {
    default_model: 'mlx-community/Qwen3-ASR-1.7B-8bit',
    models: [
      {
        id: 'mlx-community/Qwen3-ASR-1.7B-8bit',
        label: 'Qwen3-ASR 1.7B',
        description: 'Primary model',
        checkpoint: 'mlx-community/Qwen3-ASR-1.7B-8bit',
      },
    ],
  },
  chat: {
    providers: [
      { id: 'openai_compatible', label: 'OpenAI-compatible', description: 'OpenAI style', base_url_configurable: true, native: false },
      { id: 'gemini', label: 'Gemini', description: 'Gemini native', base_url_configurable: true, native: true },
      { id: 'anthropic', label: 'Anthropic', description: 'Anthropic native', base_url_configurable: true, native: true },
    ],
    reply_chunking: 'sentence',
    voice_modes: ['custom', 'design', 'clone'],
  },
  conversation: {
    mode: 'turn_based_hands_free',
    input_audio_format: 'pcm16',
    input_sample_rate: 16000,
    websocket_path: '/api/conversation/ws',
  },
}

const health = {
  status: 'ok',
  active_mode: null,
  active_model: null,
  selected_device: 'cpu',
  active_asr_model: null,
  selected_asr_device: 'cpu',
}

const chatSettings = {
  defaults: {
    active_provider: 'openai_compatible',
    system_prompt: 'You are a concise, helpful voice assistant.',
    temperature: 0.7,
    max_output_tokens: 512,
    asr_model: 'mlx-community/Qwen3-ASR-1.7B-8bit',
    asr_language: 'Auto',
    silence_timeout_ms: 1200,
    max_turn_seconds: 45,
    live_captions: true,
    reply_voice: {
      mode: 'custom',
      language: 'English',
      speaker: 'Ryan',
      instruct: '',
      clone_profile_id: null,
      clone_profile_label: null,
      clone_audio_path: null,
      clone_reference_text: null,
      style: {
        mood: 'neutral',
        emotion_intensity: 'restrained',
        pace: 'steady',
        energy: 'balanced',
        expressiveness: 'controlled',
      },
    },
  },
  openai_compatible: {
    base_url: 'https://example.com/v1',
    model: 'gpt-test',
    api_mode: 'responses',
    has_api_key: true,
    masked_api_key: 'sk-...1234',
  },
  gemini: { base_url: 'https://gemini.example', model: 'gemini-test', api_mode: null, has_api_key: false, masked_api_key: null },
  anthropic: { base_url: 'https://anthropic.example', model: 'claude-test', api_mode: null, has_api_key: false, masked_api_key: null },
}

function mockFetchSequence() {
  vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = String(input)

    if (url.endsWith('/api/capabilities')) {
      return Promise.resolve(new Response(JSON.stringify(capabilities)))
    }

    if (url.endsWith('/api/health')) {
      return Promise.resolve(new Response(JSON.stringify(health)))
    }

    if (url.endsWith('/api/settings/chat')) {
      if (init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify(chatSettings)))
      }
      return Promise.resolve(new Response(JSON.stringify(chatSettings)))
    }

    if (url.endsWith('/api/settings/chat/test')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            provider: 'openai_compatible',
            resolved_model: 'gpt-test',
            latency_ms: 18,
            streaming_supported: true,
            api_mode: 'responses',
            error: null,
          }),
        ),
      )
    }

    if (url.endsWith('/api/generate/custom')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            run_id: 'run-custom',
            mode: 'custom',
            model_id: 'custom-model',
            device: 'cpu',
            created_at: '2026-03-27T14:00:00Z',
            clips: [
              {
                id: 'clip-1',
                audio_url: '/api/audio/clip-1',
                file_name: 'clip-1.wav',
                segment_index: 0,
                text: 'Hello world',
                language: 'English',
                sample_rate: 16000,
                duration_seconds: 1.0,
                speaker: 'Ryan',
                instruct: '',
              },
            ],
          }),
        ),
      )
    }

    if (url.endsWith('/api/generate/design')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            run_id: 'run-design',
            mode: 'design',
            model_id: 'design-model',
            device: 'cpu',
            created_at: '2026-03-27T14:00:00Z',
            clips: [],
          }),
        ),
      )
    }

    if (url.endsWith('/api/generate/clone')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            run_id: 'run-clone',
            mode: 'clone',
            model_id: 'clone-model',
            device: 'cpu',
            created_at: '2026-03-27T14:00:00Z',
            clips: [],
          }),
        ),
      )
    }

    return Promise.resolve(new Response('{}', { status: 404 }))
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('switches to voice chat and shows provider controls', async () => {
  mockFetchSequence()
  render(<App />)

  await screen.findByText('Qwen3-TTS Lab')
  await userEvent.click(screen.getByRole('button', { name: /voice chat/i }))

  expect(screen.getByRole('heading', { name: 'Voice Chat' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument()
  expect(screen.getByLabelText(/system prompt/i)).toBeInTheDocument()
})

test('adds and removes segments in the tts lab', async () => {
  mockFetchSequence()
  render(<App />)

  await screen.findByText('Qwen3-TTS Lab')
  await userEvent.click(screen.getByRole('button', { name: /add segment/i }))
  expect(screen.getAllByLabelText(/text segment/i)).toHaveLength(2)

  await userEvent.click(screen.getAllByRole('button', { name: /remove segment/i })[1])
  expect(screen.getAllByLabelText(/text segment/i)).toHaveLength(1)
})

test('renders generated clips and history after a successful run', async () => {
  mockFetchSequence()
  const { container } = render(<App />)

  await screen.findByText('Qwen3-TTS Lab')
  await userEvent.clear(screen.getByLabelText(/text segment 1/i))
  await userEvent.type(screen.getByLabelText(/text segment 1/i), 'Hello world')
  await userEvent.click(screen.getByRole('button', { name: /generate audio/i }))

  expect(await screen.findByText('Run history')).toBeInTheDocument()
  expect(await screen.findByText('clip-1.wav')).toBeInTheDocument()
  expect(container.querySelector('audio')).not.toBeNull()
})

test('sends structured style controls as part of the tts instruction prompt', async () => {
  let customRequestBody = ''
  vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = String(input)

    if (url.endsWith('/api/capabilities')) {
      return Promise.resolve(new Response(JSON.stringify(capabilities)))
    }
    if (url.endsWith('/api/health')) {
      return Promise.resolve(new Response(JSON.stringify(health)))
    }
    if (url.endsWith('/api/settings/chat')) {
      return Promise.resolve(new Response(JSON.stringify(chatSettings)))
    }
    if (url.endsWith('/api/generate/custom')) {
      customRequestBody = String(init?.body ?? '')
      return Promise.resolve(
        new Response(
          JSON.stringify({
            run_id: 'run-custom',
            mode: 'custom',
            model_id: 'custom-model',
            device: 'cpu',
            created_at: '2026-03-27T14:00:00Z',
            clips: [],
          }),
        ),
      )
    }
    return Promise.resolve(new Response('{}', { status: 404 }))
  })

  render(<App />)

  await screen.findByText('Qwen3-TTS Lab')
  await userEvent.selectOptions(screen.getByLabelText(/mood/i), 'calm')
  await userEvent.type(screen.getByLabelText(/additional instruction/i), 'Keep the delivery broadcast-clean.')
  await userEvent.type(screen.getByLabelText(/text segment 1/i), 'Style control payload test.')
  await userEvent.click(screen.getByRole('button', { name: /generate audio/i }))

  await waitFor(() => {
    expect(customRequestBody).toContain('Sound calm, relaxed, and emotionally steady.')
    expect(customRequestBody).toContain('Avoid exaggerated sadness, trembling, sobbing, or a crying delivery')
    expect(customRequestBody).toContain('Keep the delivery broadcast-clean.')
  })
})

test('tests the selected provider from the voice chat workspace', async () => {
  mockFetchSequence()
  render(<App />)

  await screen.findByText('Qwen3-TTS Lab')
  await userEvent.click(screen.getByRole('button', { name: /voice chat/i }))
  await userEvent.click(screen.getByRole('button', { name: /test connection/i }))

  expect(await screen.findByText(/connection ok in 18 ms/i)).toBeInTheDocument()
})

test('syncs the conversation provider when a provider tab is selected', async () => {
  mockFetchSequence()
  render(<App />)

  await screen.findByText('Qwen3-TTS Lab')
  await userEvent.click(screen.getByRole('button', { name: /voice chat/i }))
  await userEvent.click(screen.getByRole('button', { name: 'Gemini' }))

  expect(screen.getByLabelText(/active provider/i)).toHaveValue('gemini')
})

test('shows clone reply voice controls in voice chat', async () => {
  mockFetchSequence()
  render(<App />)

  await screen.findByText('Qwen3-TTS Lab')
  await userEvent.click(screen.getByRole('button', { name: /voice chat/i }))
  await userEvent.selectOptions(screen.getByLabelText(/voice mode/i), 'clone')

  expect(screen.getByRole('button', { name: /prepare cloned voice/i })).toBeInTheDocument()
  expect(
    screen.getByPlaceholderText(/leave blank to let local qwen asr transcribe the reference clip/i),
  ).toBeInTheDocument()
})

test('saves raw reply voice guidance without reserializing composed style text', async () => {
  let savedPayload = ''
  vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = String(input)

    if (url.endsWith('/api/capabilities')) {
      return Promise.resolve(new Response(JSON.stringify(capabilities)))
    }
    if (url.endsWith('/api/health')) {
      return Promise.resolve(new Response(JSON.stringify(health)))
    }
    if (url.endsWith('/api/settings/chat')) {
      if (init?.method === 'PUT') {
        savedPayload = String(init.body ?? '')
      }
      return Promise.resolve(new Response(JSON.stringify(chatSettings)))
    }
    return Promise.resolve(new Response('{}', { status: 404 }))
  })

  render(<App />)

  await screen.findByText('Qwen3-TTS Lab')
  await userEvent.click(screen.getByRole('button', { name: /voice chat/i }))
  await userEvent.clear(screen.getByLabelText(/base guidance/i))
  await userEvent.type(screen.getByLabelText(/base guidance/i), 'Keep the reply grounded and unhurried.')
  await userEvent.click(screen.getByRole('button', { name: /save settings/i }))

  await waitFor(() => {
    expect(savedPayload).toContain('"instruct":"Keep the reply grounded and unhurried."')
    expect(savedPayload).not.toContain('Additional guidance: Keep the reply grounded and unhurried.')
    expect(savedPayload).not.toContain('Preserve the core identity of the selected preset speaker.')
  })
})

test('shows provider test failures without clearing the form', async () => {
  vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = String(input)

    if (url.endsWith('/api/capabilities')) {
      return Promise.resolve(new Response(JSON.stringify(capabilities)))
    }
    if (url.endsWith('/api/health')) {
      return Promise.resolve(new Response(JSON.stringify(health)))
    }
    if (url.endsWith('/api/settings/chat')) {
      return Promise.resolve(new Response(JSON.stringify(chatSettings)))
    }
    if (url.endsWith('/api/settings/chat/test')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: false,
            provider: 'openai_compatible',
            resolved_model: null,
            latency_ms: 22,
            streaming_supported: false,
            api_mode: null,
            error: 'Provider rejected the configuration.',
          }),
        ),
      )
    }
    return Promise.resolve(new Response('{}', { status: 404 }))
  })

  render(<App />)

  await screen.findByText('Qwen3-TTS Lab')
  await userEvent.click(screen.getByRole('button', { name: /voice chat/i }))
  const providerModelInput = screen.getAllByLabelText(/model/i)[0]
  await userEvent.clear(providerModelInput)
  await userEvent.type(providerModelInput, 'bad-model')
  await userEvent.click(screen.getByRole('button', { name: /test connection/i }))

  expect(await screen.findByText('Provider rejected the configuration.')).toBeInTheDocument()
  expect(providerModelInput).toHaveValue('bad-model')
})
