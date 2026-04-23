import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { ToastProvider } from './components/ui'
import { setLocale } from './i18n'

const OriginalWebSocket = globalThis.WebSocket

function createStoredToken() {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const payload = btoa(
    JSON.stringify({
      sub: 'test-user-id',
      username: 'admin',
      role: 'admin',
    }),
  )

  return `${header}.${payload}.signature`
}

function renderApp(locale: 'en' | 'ko' = 'en') {
  window.localStorage.setItem('tts-lab-token', createStoredToken())
  setLocale(locale)

  return render(
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>,
  )
}

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
      clone_embedding_path: null,
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
  globalThis.WebSocket = OriginalWebSocket
  window.localStorage.clear()
})

test('switches the visible chrome to korean', async () => {
  mockFetchSequence()
  renderApp('ko')

  await screen.findByText('아이비 보이스 랩')

  expect(screen.getByRole('link', { name: /보이스 챗.*실시간 검증/i })).toBeInTheDocument()
  expect(screen.getByText('로컬 음성 평가')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '오디오 생성' })).toBeInTheDocument()
})

test('switches to voice chat and shows provider controls', async () => {
  mockFetchSequence()
  renderApp()

  await screen.findByText('Ivy Voice Lab')
  await userEvent.click(screen.getByRole('link', { name: /chat.*realtime/i }))

  expect(screen.getByRole('heading', { name: 'Voice Chat' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument()
  expect(screen.getByLabelText(/system prompt/i)).toBeInTheDocument()
})

test('adds and removes segments in ivy voice lab', async () => {
  mockFetchSequence()
  renderApp()

  await screen.findByText('Ivy Voice Lab')
  await userEvent.click(screen.getByRole('button', { name: /add segment/i }))
  expect(screen.getAllByLabelText(/text segment/i)).toHaveLength(2)

  await userEvent.click(screen.getAllByRole('button', { name: /remove segment/i })[1])
  expect(screen.getAllByLabelText(/text segment/i)).toHaveLength(1)
})

test('renders generated clips and history after a successful run', async () => {
  mockFetchSequence()
  const { container } = renderApp()

  await screen.findByText('Ivy Voice Lab')
  await userEvent.clear(screen.getByLabelText(/text segment 1/i))
  await userEvent.type(screen.getByLabelText(/text segment 1/i), 'Hello world')
  await userEvent.click(screen.getByRole('button', { name: /generate audio/i }))

  expect(await screen.findByText('Run history')).toBeInTheDocument()
  expect(await screen.findByText('clip-1.wav')).toBeInTheDocument()
  expect(container.querySelector('audio')).not.toBeNull()
})

test('sends clone generation with backend multipart field names', async () => {
  let cloneFormData: FormData | null = null
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
    if (url.endsWith('/api/generate/clone')) {
      cloneFormData = init?.body instanceof FormData ? init.body : null
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

  window.history.pushState({}, '', '/tts')
  renderApp()

  await screen.findByText('Ivy Voice Lab')
  await userEvent.click(screen.getByRole('tab', { name: /voice clone/i }))
  await userEvent.upload(
    screen.getByLabelText(/reference audio/i),
    new File(['fake-audio'], 'voice.wav', { type: 'audio/wav' }),
  )
  await userEvent.type(screen.getByLabelText(/reference transcript/i), 'Uploaded reference transcript.')
  await userEvent.type(screen.getByPlaceholderText(/paste text to synthesize/i), 'Clone this sentence.')
  await userEvent.click(screen.getByRole('button', { name: /generate audio/i }))

  await waitFor(() => expect(cloneFormData).not.toBeNull())
  expect(cloneFormData?.get('ref_audio')).toBeInstanceOf(File)
  expect(cloneFormData?.get('audio')).toBeNull()
  expect(cloneFormData?.get('ref_text')).toBe('Uploaded reference transcript.')
  expect(cloneFormData?.get('reference_text')).toBeNull()
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

  renderApp()

  await screen.findByText('Ivy Voice Lab')
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
  renderApp()

  await screen.findByText('Ivy Voice Lab')
  await userEvent.click(screen.getByRole('link', { name: /chat.*realtime/i }))
  await userEvent.click(screen.getByRole('button', { name: /test connection/i }))

  expect(await screen.findByText(/connection ok in 18 ms/i)).toBeInTheDocument()
})

test('syncs the conversation provider when a provider tab is selected', async () => {
  mockFetchSequence()
  renderApp()

  await screen.findByText('Ivy Voice Lab')
  await userEvent.click(screen.getByRole('link', { name: /chat.*realtime/i }))
  await userEvent.click(screen.getByRole('button', { name: 'Gemini' }))

  expect(screen.getByLabelText(/active provider/i)).toHaveValue('gemini')
})

test('shows clone reply voice controls in voice chat', async () => {
  mockFetchSequence()
  renderApp()

  await screen.findByText('Ivy Voice Lab')
  await userEvent.click(screen.getByRole('link', { name: /chat.*realtime/i }))
  await userEvent.selectOptions(screen.getByLabelText(/voice mode/i), 'clone')

  expect(screen.getByRole('button', { name: /prepare cloned voice/i })).toBeInTheDocument()
  expect(
    screen.getByPlaceholderText(/leave blank to let local ivy asr transcribe the reference clip/i),
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

  renderApp()

  await screen.findByText('Ivy Voice Lab')
  await userEvent.click(screen.getByRole('link', { name: /chat.*realtime/i }))
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
  vi.spyOn(global, 'fetch').mockImplementation((input) => {
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

  renderApp()

  await screen.findByText('Ivy Voice Lab')
  await userEvent.click(screen.getByRole('link', { name: /chat.*realtime/i }))
  const providerModelInput = screen.getAllByLabelText(/model/i)[0]
  await userEvent.clear(providerModelInput)
  await userEvent.type(providerModelInput, 'bad-model')
  await userEvent.click(screen.getByRole('button', { name: /test connection/i }))

  expect(await screen.findByText('Provider rejected the configuration.')).toBeInTheDocument()
  expect(providerModelInput).toHaveValue('bad-model')
})

test('auto-prepares a cloned reply voice before sending a typed chat message', async () => {
  let clonePrepareCalls = 0

  class FakeWebSocket {
    static OPEN = 1
    readyState = FakeWebSocket.OPEN
    onopen: (() => void) | null = null
    onmessage: ((event: MessageEvent<string>) => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null
    onerror: (() => void) | null = null

    constructor() {
      queueMicrotask(() => {
        this.onopen?.()
      })
    }

    send(data: string) {
      const payload = JSON.parse(data)
      if (payload.type === 'session.configure') {
        queueMicrotask(() => {
          this.onmessage?.(
            new MessageEvent('message', {
              data: JSON.stringify({
                type: 'session.ready',
                settings: chatSettings,
              }),
            }),
          )
        })
      }
    }

    close() {
      this.onclose?.(new CloseEvent('close', { code: 1000 }))
    }
  }

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

  vi.spyOn(global, 'fetch').mockImplementation((input) => {
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
    if (url.endsWith('/api/chat/reply-voice/clone-profile')) {
      clonePrepareCalls += 1
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'clone-voice-profile',
            label: 'Support agent voice',
            language: 'Korean',
            reference_text: '안녕하세요.',
            audio_file_name: 'clone-voice-profile.wav',
            audio_path: '/tmp/clone-voice-profile.wav',
            speaker_embedding_path: '/tmp/clone-voice-profile.speaker.npy',
            created_at: '2026-04-06T10:00:00Z',
          }),
        ),
      )
    }
    return Promise.resolve(new Response('{}', { status: 404 }))
  })

  renderApp()

  await screen.findByText('Ivy Voice Lab')
  await userEvent.click(screen.getByRole('link', { name: /chat.*realtime/i }))
  await userEvent.selectOptions(screen.getByLabelText(/voice mode/i), 'clone')
  await userEvent.upload(
    screen.getByLabelText(/reference voice clip/i),
    new File(['fake-audio'], 'voice.wav', { type: 'audio/wav' }),
  )
  await userEvent.type(screen.getByPlaceholderText(/type a message for the connected llm/i), '안녕하세요')
  await userEvent.click(screen.getByRole('button', { name: /send message/i }))

  await waitFor(() => {
    expect(clonePrepareCalls).toBe(1)
  })
})
