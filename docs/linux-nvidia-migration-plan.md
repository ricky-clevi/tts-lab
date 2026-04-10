# Linux + NVIDIA Migration Plan

## Current Assessment

The codebase started as an Apple Silicon MLX application.

Observed platform coupling before the migration work:

- `server/app/model_manager.py` loaded TTS and ASR exclusively through `mlx-audio`.
- `server/app/metrics.py` exposed only MLX Metal memory counters.
- `README.md` and `server/requirements.txt` described only the MLX runtime path.
- Root `package.json` assumed a fixed local virtualenv path for Python execution.
- Reply-voice warmup, clone caching, and health/capabilities responses did not describe runtime backend selection.

The frontend and API surface were already otherwise portable: FastAPI, Vite, WebSocket chat flow, on-disk audio storage, and ffmpeg-based transcoding were not fundamentally macOS-specific.

## Target Architecture

The repository now targets two inference backends behind one application API:

- `mlx`: Apple Silicon fallback and backward-compatible local development path.
- `qwen`: Linux/Ubuntu path using the official `qwen-tts` and `qwen-asr` CUDA runtime.

Runtime selection is environment-driven:

- `QWEN_AUDIO_BACKEND=auto|mlx|qwen`
- `QWEN_AUDIO_DEVICE=auto|cpu|cuda|cuda:0|...`
- `QWEN_AUDIO_TORCH_DTYPE=auto|bfloat16|float16|float32`
- `QWEN_AUDIO_ATTN_IMPLEMENTATION=auto|flash_attention_2|sdpa|eager|none`

The application keeps the same public API and UI, so migration work concentrates in the backend runtime layer and deployment assets.

## Detailed Conversion Plan

1. Runtime abstraction
- Separate logical model modes (`custom`, `design`, `clone`, `default`, `compact`) from backend-specific checkpoint IDs.
- Detect MLX vs Qwen/CUDA at runtime instead of hard-importing MLX everywhere.
- Expose runtime backend, platform, dtype, and attention backend through health/capabilities responses.

2. TTS conversion
- Keep existing MLX generation and cached-clone behavior.
- Add a Qwen/CUDA implementation using `Qwen3TTSModel.from_pretrained(...)`.
- Use official Qwen methods for custom voice, voice design, and voice clone generation.
- Preserve streaming API compatibility by chunking final CUDA-generated audio into the same NDJSON/WebSocket event format used by the frontend.

3. ASR conversion
- Keep MLX ASR path for Apple Silicon.
- Add a Qwen/CUDA implementation using `Qwen3ASRModel.from_pretrained(...)`.
- Normalize file and buffered-array transcription responses back into the existing API schema.

4. Clone reply-voice support
- Keep MLX cached embedding persistence.
- For Qwen/CUDA, rebuild clone prompts from stored reference audio and transcript instead of depending on MLX-only embedding files.
- Warm the clone runtime on socket connect using the stored reference audio plus transcript.

5. Metrics and observability
- Preserve CPU/RAM reporting.
- Add CUDA metrics using `torch.cuda` plus `nvidia-smi` when available.
- Keep MLX metrics fields for backward compatibility while adding generic GPU fields for the frontend.

6. Dependency and script cleanup
- Split server requirements into base, MLX, and Linux/NVIDIA variants.
- Remove hardcoded virtualenv paths from npm scripts.
- Add Ubuntu/NVIDIA bootstrap and run scripts.
- Add a sample systemd unit and environment file template.
- Ensure persisted settings migrate ASR model IDs to the active runtime backend.

7. Production serving
- Serve the built React app from FastAPI when `web/dist` is present so deployment can run as a single service.

8. Deployment validation
- Validate the backend starts on Ubuntu with CUDA.
- Validate TTS custom/design/clone paths.
- Validate ASR file and live-buffer transcription.
- Validate WebSocket conversation loop and clone warmup.
- Validate GPU metrics on the target NVIDIA card.

## Implemented Changes

Completed in this repository:

- Added `server/app/runtime.py` for backend selection, device resolution, dtype selection, and model ID overrides.
- Reworked `server/app/model_manager.py` so TTS and ASR run on either MLX or Qwen/CUDA without changing the API surface.
- Extended clone warmup so Linux/NVIDIA can prebuild clone prompts from stored reference audio plus transcript.
- Added chat-settings normalization so copied MLX settings files do not keep stale ASR model IDs on Linux.
- Generalized metrics in `server/app/metrics.py` to report CUDA memory/use when available.
- Extended health/capabilities/metrics schemas with runtime metadata and generic GPU fields.
- Updated the frontend metrics types and UI to display CUDA GPU telemetry.
- Added production frontend serving from FastAPI when `web/dist` exists.
- Replaced hardcoded Python interpreter paths in root npm scripts.
- Split server dependency files into:
  - `server/requirements.txt`
  - `server/requirements.macos-mlx.txt`
  - `server/requirements.linux-nvidia.txt`
- Added:
  - `scripts/bootstrap_linux_nvidia.sh`
  - `scripts/run_linux_server.sh`
  - `deploy/systemd/qwen3-tts-lab.service`
  - `.env.example`

## Remaining Validation On The Ubuntu Host

This still needs to be executed on the actual Ubuntu + NVIDIA machine because the current workspace does not provide CUDA, the target GPU, or the required Python packages:

1. Install drivers/CUDA and confirm `nvidia-smi`.
2. Run `scripts/bootstrap_linux_nvidia.sh`.
3. Export or copy `.env.example` to `.env` and keep `QWEN_AUDIO_BACKEND=auto`.
4. Start the server with `scripts/run_linux_server.sh`.
5. Verify:
   - `GET /api/health` reports `runtime_backend=qwen` and `selected_device=cuda:*`.
   - `GET /api/metrics` reports `gpu_backend=cuda`.
   - TTS works for custom, design, and clone modes.
   - ASR file upload works.
   - WebSocket voice chat works.
   - Clone reply-voice warmup succeeds.

## Expected Risks

- Qwen package APIs may evolve; the Linux backend should be validated against the exact package versions installed on the target host.
- Native CUDA streaming behavior is currently normalized through chunked response emission to keep the frontend protocol stable.
- `flash-attn` installation depends on the CUDA/toolchain state of the target host and may need to stay optional.
