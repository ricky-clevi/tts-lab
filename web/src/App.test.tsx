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
}

const health = {
  status: 'ok',
  active_mode: null,
  active_model: null,
  selected_device: 'cpu',
}

function mockFetchSequence(overrides?: Partial<Record<string, Response>>) {
  vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = String(input)

    if (url.endsWith('/api/capabilities')) {
      return Promise.resolve(new Response(JSON.stringify(capabilities)))
    }

    if (url.endsWith('/api/health')) {
      return Promise.resolve(new Response(JSON.stringify(health)))
    }

    if (url.endsWith('/api/generate/custom')) {
      if (overrides?.custom) {
        return Promise.resolve(overrides.custom)
      }

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

test('switches tabs and reveals mode-specific controls', async () => {
  mockFetchSequence()
  render(<App />)

  await screen.findByText('Ryan')
  await userEvent.click(screen.getByRole('button', { name: /voice design/i }))

  expect(screen.getByLabelText(/voice persona/i)).toBeInTheDocument()
  expect(screen.queryByLabelText(/speaker/i)).not.toBeInTheDocument()
})

test('adds and removes segments', async () => {
  mockFetchSequence()
  render(<App />)

  await screen.findByText('Ryan')
  await userEvent.click(screen.getByRole('button', { name: /add segment/i }))
  expect(screen.getAllByLabelText(/text segment/i)).toHaveLength(2)

  await userEvent.click(screen.getAllByRole('button', { name: /remove segment/i })[1])
  expect(screen.getAllByLabelText(/text segment/i)).toHaveLength(1)
})

test('renders generated clips and history after a successful run', async () => {
  mockFetchSequence()
  const { container } = render(<App />)

  await screen.findByText('Ryan')
  await userEvent.clear(screen.getByLabelText(/text segment 1/i))
  await userEvent.type(screen.getByLabelText(/text segment 1/i), 'Hello world')
  await userEvent.click(screen.getByRole('button', { name: /generate audio/i }))

  expect(await screen.findByText('Run history')).toBeInTheDocument()
  expect(await screen.findByText('clip-1.wav')).toBeInTheDocument()
  expect(container.querySelector('audio')).not.toBeNull()
})

test('sends structured style controls as part of the instruction prompt', async () => {
  let customRequestBody = ''
  vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = String(input)

    if (url.endsWith('/api/capabilities')) {
      return Promise.resolve(new Response(JSON.stringify(capabilities)))
    }

    if (url.endsWith('/api/health')) {
      return Promise.resolve(new Response(JSON.stringify(health)))
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

  await screen.findByText('Ryan')
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

test('renders backend errors clearly', async () => {
  mockFetchSequence({
    custom: new Response(JSON.stringify({ detail: 'Model failed to load.' }), { status: 500 }),
  })
  render(<App />)

  await screen.findByText('Ryan')
  await userEvent.click(screen.getByRole('button', { name: /generate audio/i }))

  await waitFor(() => {
    expect(screen.getByText('Model failed to load.')).toBeInTheDocument()
  })
})
