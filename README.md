# Qwen3-TTS Local Lab

Local evaluation app for the official Qwen3-TTS 1.7B checkpoints. It runs a FastAPI backend that loads the model on demand and a Vite + React frontend for text-to-speech testing.

This project does not use Ollama. As of March 27, 2026, the official Qwen3-TTS local stack is documented through the `qwen-tts` package and Qwen's own demo/runtime, not Ollama.

## Stack

- Backend: FastAPI, Uvicorn, `qwen-tts`
- Frontend: React 19, TypeScript, Vite, Vitest
- Runtime target: local Apple Silicon Mac with `mps` preferred, CPU fallback

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

The first generation request for each mode lazily downloads and loads the matching Qwen checkpoint:

- `custom` -> `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`
- `design` -> `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`
- `clone` -> `Qwen/Qwen3-TTS-12Hz-1.7B-Base`

Generated WAV files are written to `server/generated/audio/`.

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
- Only one heavy checkpoint is kept in memory at a time. Switching tabs in the UI can trigger a model swap on the backend.
- Voice clone accepts a reference clip upload plus transcript, with an `xVectorOnlyMode` shortcut if you want to skip the transcript at lower quality.

