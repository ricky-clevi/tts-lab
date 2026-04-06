# Qwen3 Voice Lab

Local evaluation app for the official Qwen3 speech models. It runs a FastAPI backend that loads Qwen3-TTS and Qwen3-ASR on demand, plus a Vite + React frontend for text-to-speech testing and local voice-chat loops with configurable LLM providers.

This project does not use Ollama. As of March 27, 2026, the official Qwen3-TTS local stack is documented through the `qwen-tts` package and Qwen's own demo/runtime, not Ollama.

## Stack

- Backend: FastAPI, Uvicorn, `mlx-audio`, `httpx`
- Frontend: React 19, TypeScript, Vite, Vitest
- Runtime target: local Apple Silicon Mac with MLX preferred, CPU fallback

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

## Commands

```bash
npm run dev
npm run build
npm run test
npm run test:server
npm run test:web
```

## Notes

- `GET /api/capabilities` exposes the supported languages, preset speakers, and generation knobs shown in the UI.
- Voice Chat uses local Qwen ASR for transcription, your configured LLM provider for text generation, and local Qwen TTS for streamed reply speech.
- Provider settings support OpenAI-compatible base URLs plus native Gemini and Anthropic tabs.
- Only one heavy TTS checkpoint is kept in memory at a time. ASR is managed independently so transcription and speech playback can coexist in one session.
- Voice clone accepts a reference clip upload plus transcript, with an `xVectorOnlyMode` shortcut if you want to skip the transcript at lower quality.
