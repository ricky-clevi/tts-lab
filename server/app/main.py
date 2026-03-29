from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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

    @app.get("/api/audio/{audio_id}")
    def get_audio(audio_id: str) -> FileResponse:
        try:
            path = storage.get_path(audio_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Audio clip not found.") from exc
        return FileResponse(path, media_type="audio/wav", filename=path.name)

    return app


app = create_app()
