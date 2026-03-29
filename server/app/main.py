from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import uuid4

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import ValidationError

from .constants import MODEL_IDS
from .model_manager import ModelManager
from .schemas import BaseGenerationRequest, CapabilitiesResponse, CustomGenerationRequest, DesignGenerationRequest, GenerationRunResponse, HealthResponse
from .storage import AudioStorage


def parse_json_field(name: str, raw_value: str | None, default: object | None = None) -> object:
    if raw_value is None:
        return default
    try:
        return json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON payload for '{name}'.") from exc


def encode_pcm16_base64(wav: np.ndarray) -> str:
    normalized = np.clip(np.asarray(wav, dtype=np.float32), -1.0, 1.0)
    pcm16 = (normalized * 32767.0).astype(np.int16)
    return base64.b64encode(pcm16.tobytes()).decode("ascii")


def stream_line(payload: dict[str, object]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


def create_app(model_manager: ModelManager | None = None, audio_storage: AudioStorage | None = None) -> FastAPI:
    root = Path(__file__).resolve().parent.parent
    storage = audio_storage or AudioStorage(root / "generated" / "audio")
    manager = model_manager or ModelManager()

    app = FastAPI(title="Qwen3-TTS Local Lab", version="0.1.0")
    app.state.model_manager = manager
    app.state.audio_storage = storage

    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            active_mode=manager.active_mode,
            active_model=manager.active_model_id,
            selected_device=manager.selected_device,
        )

    @app.get("/api/capabilities", response_model=CapabilitiesResponse)
    def capabilities() -> CapabilitiesResponse:
        return manager.capabilities()

    @app.post("/api/generate/custom", response_model=GenerationRunResponse)
    def generate_custom(payload: CustomGenerationRequest) -> GenerationRunResponse:
        try:
            wavs, sample_rate = manager.generate_custom(payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        clips = [
            storage.save_clip(
                wav=wav,
                sample_rate=sample_rate,
                segment_index=index,
                text=segment,
                language=payload.language,
                speaker=payload.speaker,
                instruct=payload.instruct,
            )
            for index, (segment, wav) in enumerate(zip(payload.segments, wavs, strict=True))
        ]
        return GenerationRunResponse(
            run_id=uuid4().hex,
            mode="custom",
            model_id=MODEL_IDS["custom"],
            device=manager.selected_device,
            created_at=datetime.now(timezone.utc),
            clips=clips,
        )

    def build_streaming_response(
        *,
        mode: str,
        run_id: str,
        created_at: datetime,
        stream_iter,
        clip_factory,
    ) -> StreamingResponse:
        def event_stream():
            clips = []
            active_segments: dict[int, list[np.ndarray]] = {}
            chunk_counts: dict[int, int] = {}
            run_started = False

            try:
                for item in stream_iter:
                    segment_index = int(item["segment_index"])
                    text = str(item["text"])
                    wav = np.asarray(item["audio"], dtype=np.float32)
                    sample_rate = int(item["sample_rate"])
                    is_final_chunk = bool(item["is_final_chunk"])

                    if not run_started:
                        run_started = True
                        yield stream_line(
                            {
                                "type": "run_start",
                                "run": {
                                    "run_id": run_id,
                                    "mode": mode,
                                    "model_id": MODEL_IDS[mode],
                                    "device": manager.selected_device,
                                    "created_at": created_at.isoformat(),
                                    "clips": [],
                                },
                            }
                        )

                    if segment_index not in active_segments:
                        active_segments[segment_index] = []
                        chunk_counts[segment_index] = 0
                        yield stream_line(
                            {
                                "type": "segment_start",
                                "segment_index": segment_index,
                                "text": text,
                                "sample_rate": sample_rate,
                            }
                        )

                    active_segments[segment_index].append(wav)
                    chunk_counts[segment_index] += 1
                    yield stream_line(
                        {
                            "type": "audio_chunk",
                            "segment_index": segment_index,
                            "chunk_index": chunk_counts[segment_index] - 1,
                            "sample_rate": sample_rate,
                            "duration_seconds": round(float(len(wav) / sample_rate), 3) if sample_rate else 0.0,
                            "pcm16_base64": encode_pcm16_base64(wav),
                            "is_final_chunk": is_final_chunk,
                        }
                    )

                    if is_final_chunk:
                        final_wav = np.concatenate(active_segments.pop(segment_index), axis=0)
                        clip = clip_factory(
                            wav=final_wav,
                            sample_rate=sample_rate,
                            segment_index=segment_index,
                            text=text,
                        )
                        clips.append(clip)
                        yield stream_line(
                            {
                                "type": "segment_complete",
                                "segment_index": segment_index,
                                "clip": clip.model_dump(mode="json"),
                            }
                        )

                run = GenerationRunResponse(
                    run_id=run_id,
                    mode=mode,
                    model_id=MODEL_IDS[mode],
                    device=manager.selected_device,
                    created_at=created_at,
                    clips=clips,
                )
                yield stream_line({"type": "run_complete", "run": run.model_dump(mode="json")})
            except ValueError as exc:
                yield stream_line({"type": "error", "detail": str(exc)})
            except RuntimeError as exc:
                yield stream_line({"type": "error", "detail": str(exc)})

        return StreamingResponse(event_stream(), media_type="application/x-ndjson")

    @app.post("/api/generate/design", response_model=GenerationRunResponse)
    def generate_design(payload: DesignGenerationRequest) -> GenerationRunResponse:
        try:
            wavs, sample_rate = manager.generate_design(payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        clips = [
            storage.save_clip(
                wav=wav,
                sample_rate=sample_rate,
                segment_index=index,
                text=segment,
                language=payload.language,
                instruct=payload.instruct,
            )
            for index, (segment, wav) in enumerate(zip(payload.segments, wavs, strict=True))
        ]
        return GenerationRunResponse(
            run_id=uuid4().hex,
            mode="design",
            model_id=MODEL_IDS["design"],
            device=manager.selected_device,
            created_at=datetime.now(timezone.utc),
            clips=clips,
        )

    @app.post("/api/stream/custom")
    def stream_custom(payload: CustomGenerationRequest) -> StreamingResponse:
        run_id = uuid4().hex
        created_at = datetime.now(timezone.utc)

        try:
            stream_iter = manager.stream_custom(payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        return build_streaming_response(
            mode="custom",
            run_id=run_id,
            created_at=created_at,
            stream_iter=stream_iter,
            clip_factory=lambda *, wav, sample_rate, segment_index, text: storage.save_clip(
                wav=wav,
                sample_rate=sample_rate,
                segment_index=segment_index,
                text=text,
                language=payload.language,
                speaker=payload.speaker,
                instruct=payload.instruct,
            ),
        )

    @app.post("/api/stream/design")
    def stream_design(payload: DesignGenerationRequest) -> StreamingResponse:
        run_id = uuid4().hex
        created_at = datetime.now(timezone.utc)

        try:
            stream_iter = manager.stream_design(payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        return build_streaming_response(
            mode="design",
            run_id=run_id,
            created_at=created_at,
            stream_iter=stream_iter,
            clip_factory=lambda *, wav, sample_rate, segment_index, text: storage.save_clip(
                wav=wav,
                sample_rate=sample_rate,
                segment_index=segment_index,
                text=text,
                language=payload.language,
                instruct=payload.instruct,
            ),
        )

    @app.post("/api/generate/clone", response_model=GenerationRunResponse)
    async def generate_clone(
        segments: str = Form(...),
        language: str = Form("Auto"),
        generation: str | None = Form(None),
        ref_text: str | None = Form(None),
        x_vector_only_mode: bool = Form(False),
        ref_audio: UploadFile = File(...),
    ) -> GenerationRunResponse:
        try:
            payload = BaseGenerationRequest(
                segments=parse_json_field("segments", segments),
                language=language,
                generation=parse_json_field("generation", generation, {}),
            )
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors()) from exc
        suffix = Path(ref_audio.filename or "reference.wav").suffix or ".wav"
        with NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(await ref_audio.read())
            temp_path = temp_file.name

        try:
            wavs, sample_rate = manager.generate_clone(
                payload=payload,
                ref_audio_path=temp_path,
                ref_text=ref_text,
                x_vector_only_mode=x_vector_only_mode,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        finally:
            Path(temp_path).unlink(missing_ok=True)

        clips = [
            storage.save_clip(
                wav=wav,
                sample_rate=sample_rate,
                segment_index=index,
                text=segment,
                language=payload.language,
                instruct=ref_text,
                x_vector_only_mode=x_vector_only_mode,
            )
            for index, (segment, wav) in enumerate(zip(payload.segments, wavs, strict=True))
        ]
        return GenerationRunResponse(
            run_id=uuid4().hex,
            mode="clone",
            model_id=MODEL_IDS["clone"],
            device=manager.selected_device,
            created_at=datetime.now(timezone.utc),
            clips=clips,
        )

    @app.post("/api/stream/clone")
    async def stream_clone(
        segments: str = Form(...),
        language: str = Form("Auto"),
        generation: str | None = Form(None),
        streaming_interval: float = Form(0.32),
        ref_text: str | None = Form(None),
        x_vector_only_mode: bool = Form(False),
        ref_audio: UploadFile = File(...),
    ) -> StreamingResponse:
        try:
            payload = BaseGenerationRequest(
                segments=parse_json_field("segments", segments),
                language=language,
                generation=parse_json_field("generation", generation, {}),
                streaming_interval=streaming_interval,
            )
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors()) from exc

        suffix = Path(ref_audio.filename or "reference.wav").suffix or ".wav"
        with NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(await ref_audio.read())
            temp_path = temp_file.name

        run_id = uuid4().hex
        created_at = datetime.now(timezone.utc)

        try:
            stream_iter = manager.stream_clone(
                payload=payload,
                ref_audio_path=temp_path,
                ref_text=ref_text,
                x_vector_only_mode=x_vector_only_mode,
            )
        except ValueError as exc:
            Path(temp_path).unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            Path(temp_path).unlink(missing_ok=True)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        response = build_streaming_response(
            mode="clone",
            run_id=run_id,
            created_at=created_at,
            stream_iter=stream_iter,
            clip_factory=lambda *, wav, sample_rate, segment_index, text: storage.save_clip(
                wav=wav,
                sample_rate=sample_rate,
                segment_index=segment_index,
                text=text,
                language=payload.language,
                instruct=ref_text,
                x_vector_only_mode=x_vector_only_mode,
            ),
        )
        original_iter = response.body_iterator

        async def wrapped_iter():
            try:
                async for chunk in original_iter:
                    yield chunk
            finally:
                Path(temp_path).unlink(missing_ok=True)

        response.body_iterator = wrapped_iter()
        return response

    @app.get("/api/audio/{audio_id}")
    def get_audio(audio_id: str) -> FileResponse:
        try:
            path = storage.get_path(audio_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Audio clip not found.") from exc
        return FileResponse(path, media_type="audio/wav", filename=path.name)

    return app


app = create_app()
