# Qwen3 Voice Lab

FastAPI + React application for local Qwen speech workflows:

- text to speech with preset voices
- voice design from natural-language prompts
- voice cloning from a reference clip
- local ASR transcription
- realtime voice chat with external LLM providers

The repository now supports two runtime backends behind the same API:

- `mlx` for Apple Silicon development
- `qwen` for Ubuntu/Linux with NVIDIA CUDA GPUs

Saved chat settings are normalized to the active runtime so an older MLX settings file can be carried onto Linux without leaving stale ASR model IDs behind.

## Stack

- Backend: FastAPI, Uvicorn, `httpx`, `psutil`
- Frontend: React 19, TypeScript, Vite, Vitest
- Speech backends:
  - macOS Apple Silicon: `mlx-audio`
  - Linux + NVIDIA: `qwen-tts`, `qwen-asr`, PyTorch CUDA

## Key Runtime Files

- [server/app/runtime.py](/c:/Users/ricky/dastur/tts-lab/server/app/runtime.py)
  Backend selection, device resolution, dtype selection, model ID overrides.
- [server/app/model_manager.py](/c:/Users/ricky/dastur/tts-lab/server/app/model_manager.py)
  Unified MLX and Qwen/CUDA TTS + ASR runtime layer.
- [server/app/metrics.py](/c:/Users/ricky/dastur/tts-lab/server/app/metrics.py)
  CPU/RAM metrics plus CUDA or MLX GPU metrics.
- [docs/linux-nvidia-migration-plan.md](/c:/Users/ricky/dastur/tts-lab/docs/linux-nvidia-migration-plan.md)
  Migration assessment, implementation plan, and Ubuntu validation checklist.

## Python Dependencies

Base dependencies:

```bash
python -m pip install -r server/requirements.txt
```

Apple Silicon MLX:

```bash
python -m pip install -r server/requirements.macos-mlx.txt
```

Linux + NVIDIA:

```bash
python -m pip install --index-url https://download.pytorch.org/whl/cu128 torch torchvision torchaudio
python -m pip install -r server/requirements.linux-nvidia.txt
```

For the frontend build, use a current Node runtime. On Ubuntu 22.04, prefer Node 22.x rather than the older distro default packages.

## Runtime Environment Variables

Copy `.env.example` if you want an explicit deployment config.

Important variables:

- `QWEN_AUDIO_BACKEND=auto|mlx|qwen`
- `QWEN_AUDIO_DEVICE=auto|cpu|cuda|cuda:0`
- `QWEN_AUDIO_TORCH_DTYPE=auto|bfloat16|float16|float32`
- `QWEN_AUDIO_ATTN_IMPLEMENTATION=auto|flash_attention_2|sdpa|eager|none`
- `QWEN_TTS_CUSTOM_MODEL_ID`, `QWEN_TTS_DESIGN_MODEL_ID`, `QWEN_TTS_CLONE_MODEL_ID`
- `QWEN_ASR_DEFAULT_MODEL_ID`, `QWEN_ASR_COMPACT_MODEL_ID`

## Development

Install JavaScript dependencies:

```bash
npm install
npm --prefix web install
```

Run the stack:

```bash
npm run dev
```

Useful commands:

```bash
npm run dev:server:watch
npm run build
npm run test
npm run test:server
npm run test:web
```

The root npm scripts now assume the correct Python interpreter is already on `PATH`, which works for Linux virtualenv activation and avoids hardcoded local paths.

## Ubuntu + NVIDIA Bootstrap

Repository helper scripts:

```bash
./scripts/bootstrap_linux_nvidia.sh
./scripts/run_linux_server.sh
```

When `web/dist` exists, the FastAPI server now serves the built frontend directly. That makes single-service deployment on Ubuntu possible without requiring a separate Vite process in production.

Systemd example:

- [deploy/systemd/qwen3-tts-lab.service](/c:/Users/ricky/dastur/tts-lab/deploy/systemd/qwen3-tts-lab.service)

## API

- `GET /api/health`
- `GET /api/metrics`
- `GET /api/capabilities`
- `POST /api/generate/{mode}`
- `POST /api/stream/{mode}`
- `GET /api/settings/chat`
- `PUT /api/settings/chat`
- `POST /api/settings/chat/test`
- `POST /api/asr/transcribe`
- `WebSocket /api/conversation/ws`

## Notes

- Generated WAV files are written to `server/generated/audio/`.
- Saved chat settings are written to `server/generated/settings/chat.json`.
- Clone voice profiles are stored under `server/generated/voice_profiles/`.
- MLX clone embedding caches remain supported on macOS.
- Linux/NVIDIA clone replay works from the saved reference audio path and transcript, even when no MLX-style embedding cache exists.
