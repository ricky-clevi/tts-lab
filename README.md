# Qwen3 Voice Lab

Local evaluation app for the official Qwen3 speech models. It runs a FastAPI backend that loads Qwen3-TTS and Qwen3-ASR on demand, plus a Vite + React frontend for text-to-speech testing and local voice-chat loops with configurable LLM providers.

This project does not use Ollama. As of March 27, 2026, the official Qwen3-TTS local stack is documented through the `qwen-tts` package and Qwen's own demo/runtime, not Ollama.

## Stack

- Backend: FastAPI, Uvicorn, `mlx-audio`, `httpx`, `psutil`
- Frontend: React 19, TypeScript, Vite, Vitest
- Runtime target: local Apple Silicon Mac with MLX preferred, CPU fallback

## Features

- **TTS Lab** with three voice modes: Custom Voice (preset speakers), Voice Design (natural-language voice description), and Voice Clone (reference audio upload)
- **Realtime Voice Chat** loop: local Qwen ASR transcription, configurable LLM provider (OpenAI-compatible, Gemini, Anthropic), and streamed TTS reply speech
- **Markdown rendering** in chat messages with bold, italic, lists, and code blocks
- **Echo suppression**: microphone input is automatically muted while TTS audio is playing to prevent feedback loops
- **Real-time system metrics**: live CPU, RAM, and MLX GPU memory usage displayed in the UI
- **Collapsible latency metrics** panel showing TTS/LLM timing breakdowns per conversation turn
- **Performance controls** for voice style: mood, emotion intensity, pace, energy, and expressiveness
- **Streaming TTS** with live audio playback from buffered chunks
- **Independent panel scrolling**: left controls and right results panels scroll separately

## Setup

Python 3.11 works in this repo; Qwen recommends an isolated environment.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r server/requirements.txt
```

Install the JavaScript dependencies:

```bash
npm install
npm --prefix web install
```

## Development

Start both services:

```bash
npm run dev
```

For a backend code watcher during development, use:

```bash
npm run dev:server:watch
```

That runs:

- FastAPI on `http://127.0.0.1:8001`
- Vite on `http://127.0.0.1:5173`

The first request for each speech mode lazily downloads and loads the matching checkpoint:

- `custom` -> `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`
- `design` -> `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`
- `clone` -> `Qwen/Qwen3-TTS-12Hz-1.7B-Base`
- `asr-default` -> `Qwen/Qwen3-ASR-1.7B`
- `asr-compact` -> `Qwen/Qwen3-ASR-0.6B`

Generated WAV files are written to `server/generated/audio/`.
Saved chat/provider settings are written to `server/generated/settings/chat.json`.

## API Endpoints

- `GET /api/health` - Device, active model, and ASR status
- `GET /api/metrics` - Real-time CPU, RAM, and MLX GPU memory usage
- `GET /api/capabilities` - Supported languages, preset speakers, and generation knobs
- `POST /api/generate/{mode}` - Generate TTS audio (custom, design, or clone)
- `POST /api/stream/{mode}` - Streaming TTS generation (ndjson)
- `GET /api/settings/chat` - Load voice chat settings
- `PUT /api/settings/chat` - Save voice chat settings
- `POST /api/settings/chat/test` - Test LLM provider connection (uses saved API key if field is empty)
- `POST /api/asr/transcribe` - Transcribe an uploaded audio file
- `WebSocket /api/conversation/ws` - Real-time voice chat session

## Commands

```bash
npm run dev
npm run build
npm run test
npm run test:server
npm run test:web
```

## Notes

- Voice Chat uses local Qwen ASR for transcription, your configured LLM provider for text generation, and local Qwen TTS for streamed reply speech.
- Provider settings support OpenAI-compatible base URLs plus native Gemini and Anthropic tabs.
- Only one heavy TTS checkpoint is kept in memory at a time. ASR is managed independently so transcription and speech playback can coexist in one session.
- `npm run dev` starts the backend without Uvicorn reload so generated audio/settings files do not restart the Python process during testing.
- Voice clone accepts a reference clip upload plus transcript, with an `xVectorOnlyMode` shortcut if you want to skip the transcript at lower quality.
- Markdown in LLM responses is stripped before passing text to TTS to ensure clean speech synthesis.
- The system metrics bar shows CPU and RAM as percentages, and MLX GPU memory as a percentage of total unified memory (hover for detailed breakdown).
