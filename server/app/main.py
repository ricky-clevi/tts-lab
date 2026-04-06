from __future__ import annotations

import base64
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import uuid4

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import ValidationError

from .chat_store import ChatSettingsStore
from .constants import ASR_MODEL_IDS, MODEL_IDS
from .conversation import ConversationSession
from .llm import ProviderService
from .model_manager import AsrModelManager, TtsModelManager
from .schemas import (
    BaseGenerationRequest,
    ChatSettingsInput,
    ChatSettingsResponse,
    CloneVoiceProfileResponse,
    CustomGenerationRequest,
    DesignGenerationRequest,
    GenerationRunResponse,
    HealthResponse,
    ProviderTestRequest,
    ProviderTestResponse,
)
from .storage import AudioStorage, VoiceProfileStorage


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


def validate_audio_upload(path: str) -> None:
    try:
        sf.info(path)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="Invalid or unsupported audio file.",
        ) from exc


def transcode_audio_upload(path: str) -> str | None:
    source = Path(path)
    if source.suffix.lower() not in {".m4a", ".mp4", ".aac", ".mp3", ".webm", ".ogg"}:
        return None

    with NamedTemporaryFile(delete=False, suffix=".wav") as converted:
        converted_path = converted.name

    commands: list[list[str]] = []
    ffmpeg_path = shutil.which("ffmpeg")
    afconvert_path = shutil.which("afconvert")

    if ffmpeg_path:
        commands.append(
            [
                ffmpeg_path,
                "-y",
                "-i",
                str(source),
                "-vn",
                "-acodec",
                "pcm_s16le",
                "-ac",
                "1",
                converted_path,
            ]
        )
    if afconvert_path:
        commands.append(
            [
                afconvert_path,
                "-f",
                "WAVE",
                "-d",
                "LEI16",
                str(source),
                converted_path,
            ]
        )

    for command in commands:
        try:
            subprocess.run(
                command,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return converted_path
        except Exception:
            continue

    Path(converted_path).unlink(missing_ok=True)
    return None


def prepare_audio_upload(path: str) -> tuple[str, list[Path]]:
    try:
        validate_audio_upload(path)
        return path, []
    except HTTPException as original_exc:
        converted_path = transcode_audio_upload(path)
        if converted_path is None:
            raise original_exc
        try:
            validate_audio_upload(converted_path)
            return converted_path, [Path(converted_path)]
        except HTTPException:
            Path(converted_path).unlink(missing_ok=True)
            raise original_exc


def estimate_reference_audio_duration(path: str) -> float:
    info = sf.info(path)
    if not info.samplerate:
        return 0.0
    return float(info.frames) / float(info.samplerate)


def normalize_clone_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def should_override_reference_text(
    *,
    provided_ref_text: str | None,
    target_segments: list[str],
    ref_audio_duration_seconds: float,
) -> bool:
    cleaned = normalize_clone_text(provided_ref_text or "")
    if not cleaned:
        return False

    target_text = normalize_clone_text("\n".join(target_segments))
    if target_text and cleaned == target_text:
        return True

    text_length = len(cleaned)
    if ref_audio_duration_seconds <= 0:
        return False

    chars_per_second = text_length / ref_audio_duration_seconds
    if text_length >= 120 and chars_per_second > 18:
        return True

    if text_length >= 240 and ref_audio_duration_seconds < 12:
        return True

    return False


def resolve_clone_reference_text(
    *,
    asr: AsrModelManager,
    ref_audio_path: str,
    provided_ref_text: str | None,
    language: str,
    x_vector_only_mode: bool,
    target_segments: list[str] | None = None,
) -> str | None:
    cleaned = (provided_ref_text or "").strip()
    if cleaned and not should_override_reference_text(
        provided_ref_text=cleaned,
        target_segments=target_segments or [],
        ref_audio_duration_seconds=estimate_reference_audio_duration(ref_audio_path),
    ):
        return cleaned

    if x_vector_only_mode:
        return None

    transcript = asr.transcribe_file(
        file_path=ref_audio_path,
        model_id=ASR_MODEL_IDS["default"],
        language=language,
        send_to_chat=False,
    )
    resolved = transcript.text.strip()
    if not resolved:
        raise HTTPException(
            status_code=400,
            detail="Reference transcript is required. Auto-transcription of the reference clip returned no text.",
        )
    return resolved


def create_app(
    tts_manager: TtsModelManager | None = None,
    asr_manager: AsrModelManager | None = None,
    audio_storage: AudioStorage | None = None,
    voice_profile_storage: VoiceProfileStorage | None = None,
    settings_store: ChatSettingsStore | None = None,
    provider_service: ProviderService | None = None,
    model_manager: TtsModelManager | None = None,
) -> FastAPI:
    root = Path(__file__).resolve().parent.parent
    storage = audio_storage or AudioStorage(root / "generated" / "audio")
    voice_profiles = voice_profile_storage or VoiceProfileStorage(root / "generated" / "voice_profiles")
    tts = tts_manager or model_manager or TtsModelManager()
    asr = asr_manager or AsrModelManager()
    settings = settings_store or ChatSettingsStore(root / "generated" / "settings" / "chat.json")
    providers = provider_service or ProviderService()

    app = FastAPI(title="Qwen3 Local Voice Lab", version="0.2.0")
    app.state.tts_manager = tts
    app.state.asr_manager = asr
    app.state.audio_storage = storage
    app.state.voice_profile_storage = voice_profiles
    app.state.settings_store = settings
    app.state.provider_service = providers

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
            active_mode=tts.active_mode,
            active_model=tts.active_model_id,
            selected_device=tts.selected_device,
            active_asr_model=asr.active_model_id,
            selected_asr_device=asr.selected_device,
        )

    @app.get("/api/capabilities")
    def capabilities():
        return tts.capabilities()

    @app.get("/api/settings/chat", response_model=ChatSettingsResponse)
    def get_chat_settings() -> ChatSettingsResponse:
        return settings.redact(settings.load())

    @app.put("/api/settings/chat", response_model=ChatSettingsResponse)
    def put_chat_settings(payload: ChatSettingsInput) -> ChatSettingsResponse:
        saved = settings.save(settings.merge_preserving_secrets(payload))
        return settings.redact(saved)

    @app.post("/api/settings/chat/test", response_model=ProviderTestResponse)
    async def test_chat_settings(payload: ProviderTestRequest) -> ProviderTestResponse:
        result = await providers.test_provider(payload.provider, payload.config)
        if result.success and payload.provider == "openai_compatible" and result.api_mode:
            current = settings.load()
            current.openai_compatible.api_mode = result.api_mode
            settings.save(current)
        return result

    @app.post("/api/asr/transcribe")
    async def transcribe_audio(
        audio: UploadFile = File(...),
        model_id: str = Form(...),
        language: str = Form("Auto"),
        send_to_chat: bool = Form(False),
    ):
        suffix = Path(audio.filename or "audio.wav").suffix or ".wav"
        with NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(await audio.read())
            temp_path = temp_file.name

        cleanup_paths: list[Path] = []
        try:
            prepared_path, cleanup_paths = prepare_audio_upload(temp_path)
            return asr.transcribe_file(
                file_path=prepared_path,
                model_id=model_id,
                language=language,
                send_to_chat=send_to_chat,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        finally:
            Path(temp_path).unlink(missing_ok=True)
            for cleanup_path in cleanup_paths:
                cleanup_path.unlink(missing_ok=True)

    @app.post("/api/chat/reply-voice/clone-profile", response_model=CloneVoiceProfileResponse)
    async def create_clone_voice_profile(
        audio: UploadFile = File(...),
        language: str = Form("Auto"),
        label: str | None = Form(None),
        reference_text: str | None = Form(None),
    ) -> CloneVoiceProfileResponse:
        suffix = Path(audio.filename or "reference.wav").suffix or ".wav"
        with NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(await audio.read())
            temp_path = temp_file.name

        cleanup_paths: list[Path] = []
        try:
            prepared_path, cleanup_paths = prepare_audio_upload(temp_path)
            resolved_reference_text = resolve_clone_reference_text(
                asr=asr,
                ref_audio_path=prepared_path,
                provided_ref_text=reference_text,
                language=language,
                x_vector_only_mode=False,
            )
            return voice_profiles.save_profile(
                source_path=prepared_path,
                source_name=f"{Path(audio.filename or 'reference').stem}{Path(prepared_path).suffix}",
                language=language,
                reference_text=resolved_reference_text or "",
                label=label,
            )
        finally:
            Path(temp_path).unlink(missing_ok=True)
            for cleanup_path in cleanup_paths:
                cleanup_path.unlink(missing_ok=True)

    @app.post("/api/generate/custom", response_model=GenerationRunResponse)
    def generate_custom(payload: CustomGenerationRequest) -> GenerationRunResponse:
        try:
            wavs, sample_rate = tts.generate_custom(payload)
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
            device=tts.selected_device,
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
                                    "device": tts.selected_device,
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
                            "duration_seconds": round(float(len(wav) / sample_rate), 3)
                            if sample_rate
                            else 0.0,
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
                    mode=mode,  # type: ignore[arg-type]
                    model_id=MODEL_IDS[mode],
                    device=tts.selected_device,
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
            wavs, sample_rate = tts.generate_design(payload)
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
            device=tts.selected_device,
            created_at=datetime.now(timezone.utc),
            clips=clips,
        )

    @app.post("/api/stream/custom")
    def stream_custom(payload: CustomGenerationRequest) -> StreamingResponse:
        run_id = uuid4().hex
        created_at = datetime.now(timezone.utc)

        try:
            stream_iter = tts.stream_custom(payload)
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
            stream_iter = tts.stream_design(payload)
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

        cleanup_paths: list[Path] = []
        try:
            prepared_path, cleanup_paths = prepare_audio_upload(temp_path)
            resolved_ref_text = resolve_clone_reference_text(
                asr=asr,
                ref_audio_path=prepared_path,
                provided_ref_text=ref_text,
                language=language,
                x_vector_only_mode=x_vector_only_mode,
                target_segments=payload.segments,
            )
            resolved_language = tts.resolve_clone_language(
                payload.language,
                payload.segments,
                resolved_ref_text,
            )
            payload = payload.model_copy(update={"language": resolved_language})
            wavs, sample_rate = tts.generate_clone(
                payload=payload,
                ref_audio_path=prepared_path,
                ref_text=resolved_ref_text,
                x_vector_only_mode=x_vector_only_mode,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        finally:
            Path(temp_path).unlink(missing_ok=True)
            for cleanup_path in cleanup_paths:
                cleanup_path.unlink(missing_ok=True)

        clips = [
            storage.save_clip(
                wav=wav,
                sample_rate=sample_rate,
                segment_index=index,
                text=segment,
                language=payload.language,
                instruct=resolved_ref_text,
                x_vector_only_mode=x_vector_only_mode,
            )
            for index, (segment, wav) in enumerate(zip(payload.segments, wavs, strict=True))
        ]
        return GenerationRunResponse(
            run_id=uuid4().hex,
            mode="clone",
            model_id=MODEL_IDS["clone"],
            device=tts.selected_device,
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

        cleanup_paths: list[Path] = []
        run_id = uuid4().hex
        created_at = datetime.now(timezone.utc)

        try:
            prepared_path, cleanup_paths = prepare_audio_upload(temp_path)
            resolved_ref_text = resolve_clone_reference_text(
                asr=asr,
                ref_audio_path=prepared_path,
                provided_ref_text=ref_text,
                language=language,
                x_vector_only_mode=x_vector_only_mode,
                target_segments=payload.segments,
            )
            resolved_language = tts.resolve_clone_language(
                payload.language,
                payload.segments,
                resolved_ref_text,
            )
            payload = payload.model_copy(update={"language": resolved_language})
            stream_iter = tts.stream_clone(
                payload=payload,
                ref_audio_path=prepared_path,
                ref_text=resolved_ref_text,
                x_vector_only_mode=x_vector_only_mode,
            )
        except ValueError as exc:
            Path(temp_path).unlink(missing_ok=True)
            for cleanup_path in cleanup_paths:
                cleanup_path.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            Path(temp_path).unlink(missing_ok=True)
            for cleanup_path in cleanup_paths:
                cleanup_path.unlink(missing_ok=True)
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
                instruct=resolved_ref_text,
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
                for cleanup_path in cleanup_paths:
                    cleanup_path.unlink(missing_ok=True)

        response.body_iterator = wrapped_iter()
        return response

    @app.websocket("/api/conversation/ws")
    async def conversation_ws(websocket: WebSocket) -> None:
        await websocket.accept()
        session = ConversationSession(
            websocket=websocket,
            tts_manager=tts,
            asr_manager=asr,
            audio_storage=storage,
            settings_store=settings,
            provider_service=providers,
        )
        await session.on_connect()

        try:
            while True:
                payload = await websocket.receive_json()
                event_type = payload.get("type")

                if event_type == "session.configure":
                    session.configure(payload)
                    await session.send(
                        {
                            "type": "session.ready",
                            "settings": settings.redact(session.settings).model_dump(mode="json"),
                        }
                    )
                elif event_type == "audio.append":
                    await session.append_audio(payload)
                elif event_type == "turn.commit":
                    await session.commit_audio_turn()
                elif event_type == "text.submit":
                    await session.submit_text(str(payload.get("text", "")))
                elif event_type == "assistant.stop":
                    await session.stop_assistant()
                elif event_type == "session.close":
                    break
                else:
                    await session.send({"type": "error", "detail": f"Unknown event '{event_type}'."})
        except WebSocketDisconnect:
            pass
        finally:
            await session.close()

    @app.get("/api/audio/{audio_id}")
    def get_audio(audio_id: str) -> FileResponse:
        try:
            path = storage.get_path(audio_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Audio clip not found.") from exc
        return FileResponse(path, media_type="audio/wav", filename=path.name)

    return app


app = create_app()
