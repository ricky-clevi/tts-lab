from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import shutil
import subprocess
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import TypeVar
from uuid import uuid4

import numpy as np
import soundfile as sf
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect, Depends, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import ValidationError

# Load .env file for local development
load_dotenv()

from .auth import (
    get_current_user,
    require_admin,
    hash_password,
    verify_password,
    create_access_token,
    decode_token,
    validate_jwt_secret,
)
from .branding import (
    brand_asr_transcription_response,
    brand_capabilities_response,
    brand_chat_settings_response,
    brand_generation_run_response,
    brand_health_response,
    brand_qwen_text,
    unbrand_chat_settings_input,
    unbrand_ivy_text,
)
from .chat_store import ChatSettingsStore
from .constants import ASR_MODEL_IDS
from .conversation import ConversationSession
from .database import Database
from .llm import ProviderService
from .model_manager import AsrModelManager, TtsModelManager
from .schemas import (
    BaseGenerationRequest,
    ChatSettingsInput,
    ChatSettingsResponse,
    CloneVoiceProfileResponse,
    CreateUserRequest,
    CustomGenerationRequest,
    DesignGenerationRequest,
    GenerationRunResponse,
    HealthResponse,
    LoginRequest,
    MetricsResponse,
    ProviderTestRequest,
    ProviderTestResponse,
    TokenResponse,
    UserResponse,
)
from .storage import AudioStorage, VoiceProfileStorage

logger = logging.getLogger(__name__)

CLONE_PROMPT_TARGET_SECONDS = 6.0
CLONE_PROMPT_MAX_SECONDS = 8.0
CLONE_PROMPT_MIN_SECONDS = 3.0
CLONE_PROMPT_WINDOW_STEP_SECONDS = 0.25
CLONE_PROMPT_SILENCE_MARGIN_SECONDS = 0.12
OPENAI_TTS_MODEL_ID = "qwen3-tts"
OPENAI_ASR_MODEL_ID = "qwen3-asr"
T = TypeVar("T")


def parse_json_field(name: str, raw_value: str | None, default: object | None = None) -> object:
    if raw_value is None:
        return default
    try:
        return json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON payload for '{name}'.") from exc


def parse_stored_datetime(raw_value: str) -> datetime:
    normalized = raw_value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    return datetime.fromisoformat(normalized)


def encode_pcm16_base64(wav: np.ndarray) -> str:
    normalized = np.clip(np.asarray(wav, dtype=np.float32), -1.0, 1.0)
    pcm16 = (normalized * 32767.0).astype(np.int16)
    return base64.b64encode(pcm16.tobytes()).decode("ascii")


def stream_line(payload: dict[str, object]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


def encode_wav_bytes(wav: np.ndarray, sample_rate: int) -> bytes:
    buffer = io.BytesIO()
    sf.write(buffer, np.asarray(wav, dtype=np.float32), sample_rate, format="WAV")
    return buffer.getvalue()


def encode_pcm16_bytes(wav: np.ndarray) -> bytes:
    normalized = np.clip(np.asarray(wav, dtype=np.float32), -1.0, 1.0)
    return (normalized * 32767.0).astype(np.int16).tobytes()


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


def load_mono_audio(path: str) -> tuple[np.ndarray, int]:
    audio, sample_rate = sf.read(path, dtype="float32", always_2d=False)
    if isinstance(audio, np.ndarray) and audio.ndim == 2:
        audio = audio.mean(axis=1)
    return np.asarray(audio, dtype=np.float32).reshape(-1), int(sample_rate)


def trim_prompt_silence(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    samples = np.asarray(audio, dtype=np.float32).reshape(-1)
    if samples.size == 0:
        return samples

    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    threshold = max(0.006, peak * 0.08)
    voiced = np.flatnonzero(np.abs(samples) >= threshold)
    if voiced.size == 0:
        return samples

    margin = int(sample_rate * CLONE_PROMPT_SILENCE_MARGIN_SECONDS)
    start = max(0, int(voiced[0]) - margin)
    end = min(samples.shape[0], int(voiced[-1]) + margin + 1)
    return samples[start:end]


def select_clone_prompt_excerpt(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    samples = np.asarray(audio, dtype=np.float32).reshape(-1)
    if samples.size == 0 or sample_rate <= 0:
        return samples

    duration_seconds = float(samples.shape[0]) / float(sample_rate)
    if duration_seconds <= CLONE_PROMPT_MAX_SECONDS:
        return trim_prompt_silence(samples, sample_rate)

    window_size = max(
        int(sample_rate * CLONE_PROMPT_MIN_SECONDS),
        int(sample_rate * min(CLONE_PROMPT_TARGET_SECONDS, CLONE_PROMPT_MAX_SECONDS)),
    )
    window_size = min(window_size, samples.shape[0])
    step = max(1, int(sample_rate * CLONE_PROMPT_WINDOW_STEP_SECONDS))

    power = np.square(samples.astype(np.float64))
    prefix = np.concatenate([np.array([0.0], dtype=np.float64), np.cumsum(power)])

    def average_power(start: int) -> float:
        end = min(samples.shape[0], start + window_size)
        return float(prefix[end] - prefix[start]) / max(end - start, 1)

    best_start = 0
    best_score = -1.0
    last_start = max(0, samples.shape[0] - window_size)
    starts = list(range(0, last_start + 1, step))
    if starts[-1] != last_start:
        starts.append(last_start)

    for start in starts:
        score = average_power(start)
        if score > best_score:
            best_score = score
            best_start = start

    excerpt = samples[best_start : best_start + window_size]
    trimmed = trim_prompt_silence(excerpt, sample_rate)
    minimum_samples = int(sample_rate * CLONE_PROMPT_MIN_SECONDS)
    return trimmed if trimmed.shape[0] >= minimum_samples else excerpt


def prepare_clone_reference_audio(path: str) -> tuple[str, list[Path], bool]:
    audio, sample_rate = load_mono_audio(path)
    duration_seconds = float(audio.shape[0]) / float(sample_rate) if sample_rate else 0.0
    if duration_seconds <= CLONE_PROMPT_MAX_SECONDS:
        return path, [], False

    excerpt = select_clone_prompt_excerpt(audio, sample_rate)
    with NamedTemporaryFile(delete=False, suffix=".wav") as clipped_file:
        excerpt_path = Path(clipped_file.name)
    sf.write(excerpt_path, excerpt, sample_rate)
    return str(excerpt_path), [excerpt_path], True


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
        model_id=asr.model_ids.get("default", ASR_MODEL_IDS["default"]),
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


async def persist_upload_to_tempfile(upload: UploadFile, fallback_name: str) -> str:
    suffix = Path(upload.filename or fallback_name).suffix or Path(fallback_name).suffix or ".wav"
    with NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        temp_file.write(await upload.read())
        return temp_file.name


def cleanup_temp_paths(*paths: str | Path | None) -> None:
    for path in paths:
        if path is None:
            continue
        Path(path).unlink(missing_ok=True)


def run_or_http_error(operation: Callable[[], T]) -> T:
    try:
        return operation()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def build_generation_run_response(
    *,
    mode: str,
    model_id: str,
    device: str,
    clips: list,
) -> GenerationRunResponse:
    return brand_generation_run_response(
        GenerationRunResponse(
            run_id=uuid4().hex,
            mode=mode,  # type: ignore[arg-type]
            model_id=model_id,
            device=device,
            created_at=datetime.now(timezone.utc),
            clips=clips,
        )
    )


def create_app(
    tts_manager: TtsModelManager | None = None,
    asr_manager: AsrModelManager | None = None,
    audio_storage: AudioStorage | None = None,
    voice_profile_storage: VoiceProfileStorage | None = None,
    settings_store: ChatSettingsStore | None = None,
    provider_service: ProviderService | None = None,
    model_manager: TtsModelManager | None = None,
) -> FastAPI:
    # Validate JWT secret before starting
    validate_jwt_secret()

    root = Path(__file__).resolve().parent.parent
    frontend_dist = root.parent / "web" / "dist"
    storage = audio_storage or AudioStorage(root / "generated" / "audio")
    voice_profiles = voice_profile_storage or VoiceProfileStorage(root / "generated" / "voice_profiles")
    tts = tts_manager or model_manager or TtsModelManager()
    asr = asr_manager or AsrModelManager()
    settings = settings_store or ChatSettingsStore(root / "generated" / "settings" / "chat.json")
    providers = provider_service or ProviderService()

    # Initialize database
    db_path = root / "generated" / "tts_lab.db"
    db = Database(db_path)

    # Seed admin user if no admin exists
    admin_username = os.getenv("ADMIN_USERNAME", "admin")
    admin_password = os.getenv("ADMIN_PASSWORD", "")
    if not admin_password:
        raise RuntimeError(
            "ADMIN_PASSWORD environment variable is required on first deployment. "
            "Please set it in your .env file."
        )
    admin_password_hashed = hash_password(admin_password)
    db.seed_admin(admin_username, admin_password_hashed)

    # Migrate orphaned voice profiles (from disk to DB)
    db.migrate_orphaned_profiles(
        admin_user_id=db.get_user_by_username(admin_username)["id"],
        voice_profiles_dir=root / "generated" / "voice_profiles"
    )

    app = FastAPI(title="Ivy Voice Lab", version="0.2.0")
    app.state.tts_manager = tts
    app.state.asr_manager = asr
    app.state.audio_storage = storage
    app.state.voice_profile_storage = voice_profiles
    app.state.settings_store = settings
    app.state.provider_service = providers
    app.state.db = db

    # Configure CORS
    allowed_origins = os.getenv("ALLOWED_ORIGINS", "").split(",")
    allowed_origins = [origin.strip() for origin in allowed_origins if origin.strip()]

    if allowed_origins:
        # Use configured origins if provided
        cors_config = {
            "allow_origins": allowed_origins,
            "allow_credentials": True,
            "allow_methods": ["*"],
            "allow_headers": ["*"],
        }
    else:
        # Fall back to localhost regex for local development
        cors_config = {
            "allow_origin_regex": r"http://(localhost|127\.0\.0\.1)(:\d+)?",
            "allow_credentials": True,
            "allow_methods": ["*"],
            "allow_headers": ["*"],
        }

    app.add_middleware(CORSMiddleware, **cors_config)

    # ============ Auth Endpoints ============

    @app.post("/api/auth/login", response_model=TokenResponse)
    def login(request: LoginRequest) -> TokenResponse:
        """Authenticate a user and return a JWT token."""
        user = db.get_user_by_username(request.username)
        if not user or not verify_password(request.password, user["hashed_password"]):
            # Use same message for both user-not-found and wrong-password to avoid enumeration
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )
        if not user["is_active"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is disabled",
            )

        token = create_access_token(
            user_id=user["id"],
            username=user["username"],
            role=user["role"],
        )
        return TokenResponse(
            access_token=token,
            token_type="bearer",
            user_id=user["id"],
            username=user["username"],
            role=user["role"],
        )

    @app.get("/api/auth/me", response_model=UserResponse)
    def get_current_user_info(current_user: dict = Depends(get_current_user)) -> UserResponse:
        """Get the current authenticated user's information."""
        user = db.get_user_by_id(current_user["sub"])
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )
        return UserResponse(
            id=user["id"],
            username=user["username"],
            role=user["role"],
            created_at=user["created_at"],
            is_active=bool(user["is_active"]),
        )

    # ============ Admin User Management Endpoints ============

    @app.get("/api/admin/users", response_model=list[UserResponse])
    def list_all_users(current_user: dict = Depends(require_admin)) -> list[UserResponse]:
        """List all users (admin only)."""
        users = db.list_users()
        return [
            UserResponse(
                id=u["id"],
                username=u["username"],
                role=u["role"],
                created_at=u["created_at"],
                is_active=bool(u["is_active"]),
            )
            for u in users
        ]

    @app.post("/api/admin/users", response_model=dict)
    def create_new_user(
        request: CreateUserRequest,
        current_user: dict = Depends(require_admin),
    ) -> dict:
        """Create a new user (admin only). Returns the user and generated password."""
        try:
            user = db.create_user(
                username=request.username,
                hashed_password=hash_password(request.password),
                role=request.role,
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(e),
            )

        return {
            "user": UserResponse(
                id=user["id"],
                username=user["username"],
                role=user["role"],
                created_at=user["created_at"],
                is_active=user["is_active"],
            ),
            "password": request.password,  # One-time visible, must be copied by admin
        }

    @app.delete("/api/admin/users/{user_id}")
    def delete_existing_user(
        user_id: str,
        current_user: dict = Depends(require_admin),
    ) -> dict:
        """Delete a user (admin only)."""
        # Prevent deleting yourself
        if user_id == current_user["sub"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete your own account",
            )

        # Prevent deleting the last admin
        users = db.list_users()
        admin_count = sum(1 for u in users if u["role"] == "admin")
        if admin_count <= 1:
            user_to_delete = db.get_user_by_id(user_id)
            if user_to_delete and user_to_delete["role"] == "admin":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot delete the last admin user",
                )

        db.delete_user(user_id)
        return {"status": "deleted"}

    # ============ Voice Management Endpoints ============

    @app.get("/api/voices", response_model=list[CloneVoiceProfileResponse])
    def list_user_voices(current_user: dict = Depends(get_current_user)) -> list[CloneVoiceProfileResponse]:
        """List all voice profiles for the current user."""
        profiles = db.list_profiles_for_user(current_user["sub"])
        return [
            CloneVoiceProfileResponse(
                id=p["id"],
                label=p["label"],
                language=p["language"],
                reference_text=p["reference_text"],
                audio_file_name=p["audio_file_name"],
                audio_path=p["audio_path"],
                speaker_embedding_path=p["speaker_embedding_path"],
                created_at=parse_stored_datetime(p["created_at"]),
                user_id=p["user_id"],
            )
            for p in profiles
        ]

    @app.delete("/api/voices/{profile_id}")
    def delete_user_voice(
        profile_id: str,
        current_user: dict = Depends(get_current_user),
    ) -> dict:
        """Delete a voice profile (must be owned by current user)."""
        profile = db.get_profile_by_id(profile_id)
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Voice profile not found",
            )

        # Check ownership
        if profile["user_id"] != current_user["sub"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only delete your own voice profiles",
            )

        # Delete the profile and associated files
        db.delete_profile(profile_id)
        voice_profiles_dir = root / "generated" / "voice_profiles"
        for suffix in [".json", ".wav", ".speaker.npz"]:
            file_path = voice_profiles_dir / f"{profile_id}{suffix}"
            if file_path.exists():
                try:
                    file_path.unlink()
                except Exception as e:
                    logger.warning(f"Failed to delete {file_path}: {e}")

        return {"status": "deleted"}

    @app.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        response = HealthResponse(
            status="ok",
            active_mode=tts.active_mode,
            active_model=tts.active_model_id,
            selected_device=tts.selected_device,
            runtime_backend=tts.runtime_backend,
            runtime_platform=tts.runtime_platform,
            runtime_dtype=tts.runtime_dtype,
            runtime_attention=tts.runtime_attention,
            active_asr_model=asr.active_model_id,
            selected_asr_device=asr.selected_device,
        )
        return brand_health_response(response)

    @app.get("/v1/models")
    def openai_models() -> dict[str, object]:
        now = int(datetime.now(timezone.utc).timestamp())
        return {
            "object": "list",
            "data": [
                {
                    "id": OPENAI_TTS_MODEL_ID,
                    "object": "model",
                    "created": now,
                    "owned_by": "ivy",
                },
                {
                    "id": OPENAI_ASR_MODEL_ID,
                    "object": "model",
                    "created": now,
                    "owned_by": "ivy",
                },
            ],
        }

    @app.post("/v1/audio/speech")
    def openai_audio_speech(payload: dict[str, object]) -> Response:
        model = str(payload.get("model", "")).strip()
        text = str(payload.get("input", "")).strip()
        voice = str(payload.get("voice", "Ryan")).strip() or "Ryan"
        response_format = str(payload.get("response_format", "wav")).strip().lower() or "wav"
        instructions = str(payload.get("instructions", "")).strip() or None

        if model != OPENAI_TTS_MODEL_ID:
            raise HTTPException(status_code=400, detail=f"Unsupported model '{model}'.")
        if not text:
            raise HTTPException(status_code=400, detail="Input text is required.")
        if response_format not in {"wav", "pcm"}:
            raise HTTPException(
                status_code=400,
                detail="Unsupported response_format. Use 'wav' or 'pcm'.",
            )

        try:
            wavs, sample_rate = tts.generate_custom(
                CustomGenerationRequest(
                    segments=[text],
                    language="Auto",
                    speaker=voice,
                    instruct=instructions,
                )
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        wav = wavs[0]
        if response_format == "pcm":
            return Response(content=encode_pcm16_bytes(wav), media_type="audio/pcm")
        return Response(content=encode_wav_bytes(wav, sample_rate), media_type="audio/wav")

    @app.post("/v1/audio/transcriptions")
    async def openai_audio_transcriptions(
        file: UploadFile = File(...),
        model: str = Form(...),
        language: str = Form("Auto"),
    ) -> dict[str, object]:
        if model.strip() != OPENAI_ASR_MODEL_ID:
            raise HTTPException(status_code=400, detail=f"Unsupported model '{model}'.")

        temp_path = await persist_upload_to_tempfile(file, "audio.wav")
        cleanup_paths: list[Path] = []
        try:
            prepared_path, cleanup_paths = prepare_audio_upload(temp_path)
            transcription = run_or_http_error(
                lambda: asr.transcribe_file(
                    file_path=prepared_path,
                    model_id=asr.model_ids.get("default", ASR_MODEL_IDS["default"]),
                    language=language,
                    send_to_chat=False,
                )
            )
        finally:
            cleanup_temp_paths(temp_path, *cleanup_paths)

        return {
            "text": transcription.text,
            "language": transcription.language,
            "model": OPENAI_ASR_MODEL_ID,
        }

    @app.get("/api/metrics", response_model=MetricsResponse)
    def metrics() -> MetricsResponse:
        from .metrics import collect_metrics

        return MetricsResponse(**collect_metrics())

    @app.get("/api/capabilities")
    def capabilities():
        return brand_capabilities_response(tts.capabilities())

    @app.get("/api/settings/chat", response_model=ChatSettingsResponse)
    def get_chat_settings() -> ChatSettingsResponse:
        return brand_chat_settings_response(settings.redact(settings.load()))

    @app.put("/api/settings/chat", response_model=ChatSettingsResponse)
    def put_chat_settings(payload: ChatSettingsInput) -> ChatSettingsResponse:
        normalized_payload = unbrand_chat_settings_input(payload)
        saved = settings.save(settings.merge_preserving_secrets(normalized_payload))
        return brand_chat_settings_response(settings.redact(saved))

    @app.post("/api/settings/chat/test", response_model=ProviderTestResponse)
    async def test_chat_settings(payload: ProviderTestRequest) -> ProviderTestResponse:
        if not payload.config.api_key:
            saved = settings.load()
            saved_provider = getattr(saved, payload.provider, None)
            if saved_provider and saved_provider.api_key:
                payload.config.api_key = saved_provider.api_key
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
        temp_path = await persist_upload_to_tempfile(audio, "audio.wav")
        cleanup_paths: list[Path] = []
        try:
            prepared_path, cleanup_paths = prepare_audio_upload(temp_path)
            response = run_or_http_error(
                lambda: asr.transcribe_file(
                    file_path=prepared_path,
                    model_id=unbrand_ivy_text(model_id) or model_id,
                    language=language,
                    send_to_chat=send_to_chat,
                )
            )
            return brand_asr_transcription_response(response)
        finally:
            cleanup_temp_paths(temp_path, *cleanup_paths)

    @app.post("/api/chat/reply-voice/clone-profile", response_model=CloneVoiceProfileResponse)
    async def create_clone_voice_profile(
        audio: UploadFile = File(...),
        language: str = Form("Auto"),
        label: str | None = Form(None),
        reference_text: str | None = Form(None),
    ) -> CloneVoiceProfileResponse:
        temp_path = await persist_upload_to_tempfile(audio, "reference.wav")
        cleanup_paths: list[Path] = []
        try:
            prepared_path, cleanup_paths = prepare_audio_upload(temp_path)
            prompt_path, prompt_cleanup_paths, prompt_excerpted = prepare_clone_reference_audio(
                prepared_path
            )
            cleanup_paths.extend(prompt_cleanup_paths)
            resolved_reference_text = resolve_clone_reference_text(
                asr=asr,
                ref_audio_path=prompt_path,
                provided_ref_text=None if prompt_excerpted else reference_text,
                language=language,
                x_vector_only_mode=False,
            )
            speaker_embedding, ref_codes = run_or_http_error(
                lambda: tts.prepare_clone_conditioning_assets(
                    ref_audio_path=prompt_path
                )
            )
            return voice_profiles.save_profile(
                source_path=prompt_path,
                source_name=f"{Path(audio.filename or 'reference').stem}{Path(prompt_path).suffix}",
                language=language,
                reference_text=resolved_reference_text or "",
                label=label,
                speaker_embedding=speaker_embedding,
                ref_codes=ref_codes,
            )
        finally:
            cleanup_temp_paths(temp_path, *cleanup_paths)

    @app.post("/api/generate/custom", response_model=GenerationRunResponse)
    def generate_custom(payload: CustomGenerationRequest) -> GenerationRunResponse:
        wavs, sample_rate = run_or_http_error(lambda: tts.generate_custom(payload))

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
        return build_generation_run_response(
            mode="custom",
            model_id=tts.model_ids["custom"],
            device=tts.selected_device,
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
                                    "model_id": brand_qwen_text(tts.model_ids[mode]),
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

                run = brand_generation_run_response(
                    GenerationRunResponse(
                    run_id=run_id,
                    mode=mode,  # type: ignore[arg-type]
                    model_id=tts.model_ids[mode],
                    device=tts.selected_device,
                    created_at=created_at,
                    clips=clips,
                    )
                )
                yield stream_line({"type": "run_complete", "run": run.model_dump(mode="json")})
            except ValueError as exc:
                yield stream_line({"type": "error", "detail": str(exc)})
            except RuntimeError as exc:
                yield stream_line({"type": "error", "detail": str(exc)})
            except Exception as exc:
                logger.exception("Unhandled streaming generation error for mode=%s run_id=%s", mode, run_id)
                yield stream_line({"type": "error", "detail": str(exc)})

        return StreamingResponse(event_stream(), media_type="application/x-ndjson")

    @app.post("/api/generate/design", response_model=GenerationRunResponse)
    def generate_design(payload: DesignGenerationRequest) -> GenerationRunResponse:
        wavs, sample_rate = run_or_http_error(lambda: tts.generate_design(payload))

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
        return build_generation_run_response(
            mode="design",
            model_id=tts.model_ids["design"],
            device=tts.selected_device,
            clips=clips,
        )

    @app.post("/api/stream/custom")
    def stream_custom(payload: CustomGenerationRequest) -> StreamingResponse:
        run_id = uuid4().hex
        created_at = datetime.now(timezone.utc)
        stream_iter = run_or_http_error(lambda: tts.stream_custom(payload))

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
        stream_iter = run_or_http_error(lambda: tts.stream_design(payload))

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
        temp_path = await persist_upload_to_tempfile(ref_audio, "reference.wav")
        cleanup_paths: list[Path] = []
        try:
            prepared_path, cleanup_paths = prepare_audio_upload(temp_path)
            prompt_path, prompt_cleanup_paths, prompt_excerpted = prepare_clone_reference_audio(
                prepared_path
            )
            cleanup_paths.extend(prompt_cleanup_paths)
            resolved_ref_text = resolve_clone_reference_text(
                asr=asr,
                ref_audio_path=prompt_path,
                provided_ref_text=None if prompt_excerpted else ref_text,
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
            wavs, sample_rate = run_or_http_error(
                lambda: tts.generate_clone(
                    payload=payload,
                    ref_audio_path=prompt_path,
                    ref_text=resolved_ref_text,
                    x_vector_only_mode=x_vector_only_mode,
                )
            )
        finally:
            cleanup_temp_paths(temp_path, *cleanup_paths)

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
        return build_generation_run_response(
            mode="clone",
            model_id=tts.model_ids["clone"],
            device=tts.selected_device,
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

        temp_path = await persist_upload_to_tempfile(ref_audio, "reference.wav")
        cleanup_paths: list[Path] = []
        run_id = uuid4().hex
        created_at = datetime.now(timezone.utc)

        try:
            prepared_path, cleanup_paths = prepare_audio_upload(temp_path)
            prompt_path, prompt_cleanup_paths, prompt_excerpted = prepare_clone_reference_audio(
                prepared_path
            )
            cleanup_paths.extend(prompt_cleanup_paths)
            resolved_ref_text = resolve_clone_reference_text(
                asr=asr,
                ref_audio_path=prompt_path,
                provided_ref_text=None if prompt_excerpted else ref_text,
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
            stream_iter = run_or_http_error(
                lambda: tts.stream_clone(
                    payload=payload,
                    ref_audio_path=prompt_path,
                    ref_text=resolved_ref_text,
                    x_vector_only_mode=x_vector_only_mode,
                )
            )
        except HTTPException:
            cleanup_temp_paths(temp_path, *cleanup_paths)
            raise

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
                cleanup_temp_paths(temp_path, *cleanup_paths)

        response.body_iterator = wrapped_iter()
        return response

    @app.websocket("/api/conversation/ws")
    async def conversation_ws(websocket: WebSocket) -> None:
        # Extract and validate JWT token from query parameter
        token = websocket.query_params.get("token", "")
        try:
            if not token:
                await websocket.close(code=4001, reason="Missing authentication token")
                return
            current_user = decode_token(token)
        except HTTPException as e:
            await websocket.close(code=4001, reason="Invalid authentication token")
            return

        await websocket.accept()
        session = ConversationSession(
            websocket=websocket,
            tts_manager=tts,
            asr_manager=asr,
            audio_storage=storage,
            settings_store=settings,
            provider_service=providers,
        )
        # Store the authenticated user in session state
        session.user_id = current_user["sub"]
        session.username = current_user["username"]
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
                            "settings": brand_chat_settings_response(
                                settings.redact(session.settings)
                            ).model_dump(mode="json"),
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
        except Exception as exc:
            logger.exception("Unhandled conversation websocket error")
            try:
                await session.send({"type": "error", "detail": str(exc)})
            except Exception:
                pass
        finally:
            try:
                await session.close()
            except Exception:
                logger.exception("Conversation session cleanup failed")

    @app.get("/api/audio/{audio_id}")
    def get_audio(audio_id: str) -> FileResponse:
        try:
            path = storage.get_path(audio_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Audio clip not found.") from exc
        return FileResponse(path, media_type="audio/wav", filename=path.name)

    if frontend_dist.exists():

        def spa_index_response() -> FileResponse:
            return FileResponse(
                frontend_dist / "index.html",
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
            )

        @app.get("/", include_in_schema=False)
        def serve_frontend_index() -> FileResponse:
            return spa_index_response()

        @app.get("/{full_path:path}", include_in_schema=False)
        def serve_frontend_asset(full_path: str) -> FileResponse:
            if full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="Not found.")

            requested = (frontend_dist / full_path).resolve()
            if requested.is_file() and requested.is_relative_to(frontend_dist.resolve()):
                return FileResponse(requested)

            # Missing file-like paths should 404 instead of falling back to index.html.
            # This prevents browsers from treating HTML as fonts, scripts, or styles.
            if "." in Path(full_path).name:
                raise HTTPException(status_code=404, detail="Asset not found.")

            return spa_index_response()

    return app


app = create_app()
