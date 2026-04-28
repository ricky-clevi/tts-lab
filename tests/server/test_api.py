from __future__ import annotations

import base64
import json
import os
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
import wave

import numpy as np
import pytest
import soundfile as sf
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
os.environ.setdefault("ADMIN_PASSWORD", "test-admin-password")
os.environ.setdefault("RUNTIME_API_KEY", "test-runtime-key")

from server.app.auth import create_access_token
from server.app.chat_store import ChatSettingsStore
from server.app.constants import (
    ASR_MODEL_IDS,
    ASR_MODELS,
    GENERATION_KNOBS,
    LANGUAGES,
    MODE_DESCRIPTIONS,
    MODE_LABELS,
    MODEL_IDS,
    PROVIDER_CAPABILITIES,
    SPEAKERS,
)
from server.app.main import (
    create_app,
    prepare_audio_upload,
    prepare_clone_reference_audio,
    should_override_reference_text,
)
from server.app.runtime import RuntimeSelection
from server.app.model_manager import TtsModelManager
from server.app.schemas import (
    AsrCapabilityResponse,
    AsrModelCapabilityResponse,
    AsrSegmentResponse,
    AsrTranscriptionResponse,
    BaseGenerationRequest,
    CapabilitiesResponse,
    ChatCapabilityResponse,
    ConversationCapabilityResponse,
    CustomGenerationRequest,
    DesignGenerationRequest,
    ModeCapabilityResponse,
    ProviderCapabilityResponse,
    ProviderTestResponse,
    SpeakerResponse,
)
from server.app.storage import AudioStorage


class FakeTtsManager:
    def __init__(self) -> None:
        self.active_mode = None
        self.active_model_id = None
        self.selected_device = "cpu"
        self.runtime_backend = "test"
        self.runtime_platform = "test"
        self.runtime_dtype = None
        self.runtime_attention = None
        self.model_ids = MODEL_IDS
        self.custom_calls = 0
        self.design_calls = 0
        self.clone_calls = 0
        self.clone_cached_calls = 0
        self.warm_clone_calls = 0
        self.prepare_clone_embedding_calls = 0
        self.ensure_calls: list[str] = []
        self.unload_calls = 0

    def capabilities(self):
        return CapabilitiesResponse(
            active_mode=self.active_mode,
            selected_device=self.selected_device,
            languages=LANGUAGES,
            speakers=[SpeakerResponse(**speaker) for speaker in SPEAKERS],
            generation_knobs=GENERATION_KNOBS,
            modes=[
                ModeCapabilityResponse(
                    id=mode,
                    label=MODE_LABELS[mode],
                    description=MODE_DESCRIPTIONS[mode],
                    checkpoint=MODEL_IDS[mode],
                )
                for mode in ("custom", "design", "clone")
            ],
            asr=AsrCapabilityResponse(
                default_model=ASR_MODEL_IDS["default"],
                models=[AsrModelCapabilityResponse(**item) for item in ASR_MODELS],
            ),
            chat=ChatCapabilityResponse(
                providers=[ProviderCapabilityResponse(**item) for item in PROVIDER_CAPABILITIES],
                reply_chunking="sentence",
                voice_modes=["custom", "design", "clone"],
            ),
            conversation=ConversationCapabilityResponse(
                mode="turn_based_hands_free",
                input_audio_format="pcm16",
                input_sample_rate=16000,
                websocket_path="/api/conversation/ws",
            ),
        )

    def ensure_mode(self, mode: str):
        if self.active_mode and self.active_mode != mode:
            self.unload_calls += 1
        if not self.ensure_calls or self.ensure_calls[-1] != mode:
            self.ensure_calls.append(mode)
        self.active_mode = mode
        self.active_model_id = MODEL_IDS[mode]
        return object()

    def resolve_clone_language(self, requested_language: str, segments: list[str], ref_text: str | None):
        del segments, ref_text
        return requested_language

    def generate_custom(self, payload: CustomGenerationRequest):
        self.ensure_mode("custom")
        self.custom_calls += 1
        return [np.zeros(16000, dtype=np.float32) for _ in payload.segments], 16000

    def stream_custom(self, payload: CustomGenerationRequest):
        self.ensure_mode("custom")
        self.custom_calls += 1
        for segment_index, segment in enumerate(payload.segments):
            yield {
                "segment_index": segment_index,
                "text": segment,
                "audio": np.full(4000, 0.1, dtype=np.float32),
                "sample_rate": 16000,
                "is_final_chunk": False,
            }
            yield {
                "segment_index": segment_index,
                "text": segment,
                "audio": np.full(6000, 0.2, dtype=np.float32),
                "sample_rate": 16000,
                "is_final_chunk": True,
            }

    def generate_design(self, payload: DesignGenerationRequest):
        self.ensure_mode("design")
        self.design_calls += 1
        return [np.ones(8000, dtype=np.float32) for _ in payload.segments], 16000

    def stream_design(self, payload: DesignGenerationRequest):
        self.ensure_mode("design")
        self.design_calls += 1
        for segment_index, segment in enumerate(payload.segments):
            yield {
                "segment_index": segment_index,
                "text": segment,
                "audio": np.ones(5000, dtype=np.float32),
                "sample_rate": 16000,
                "is_final_chunk": True,
            }

    def generate_clone(self, *, payload: BaseGenerationRequest, ref_audio_path: str, ref_text: str | None, x_vector_only_mode: bool):
        assert Path(ref_audio_path).exists()
        self.ensure_mode("clone")
        self.clone_calls += 1
        if not x_vector_only_mode and not ref_text:
            raise ValueError("Reference transcript is required unless x-vector only mode is enabled.")
        return [np.full(12000, 0.3, dtype=np.float32) for _ in payload.segments], 24000

    def stream_clone(self, *, payload: BaseGenerationRequest, ref_audio_path: str, ref_text: str | None, x_vector_only_mode: bool):
        assert Path(ref_audio_path).exists()
        self.ensure_mode("clone")
        self.clone_calls += 1
        if not x_vector_only_mode and not ref_text:
            raise ValueError("Reference transcript is required unless x-vector only mode is enabled.")
        for segment_index, segment in enumerate(payload.segments):
            yield {
                "segment_index": segment_index,
                "text": segment,
                "audio": np.full(7000, 0.3, dtype=np.float32),
                "sample_rate": 24000,
                "is_final_chunk": True,
            }

    def prepare_clone_conditioning_assets(self, *, ref_audio_path: str):
        assert Path(ref_audio_path).exists()
        self.ensure_mode("clone")
        self.prepare_clone_embedding_calls += 1
        return (
            np.asarray([[0.25, 0.5, 0.75]], dtype=np.float32),
            np.asarray([[[1, 2, 3], [4, 5, 6]]], dtype=np.int32),
        )

    def warm_clone_runtime(
        self,
        *,
        speaker_embedding_path: str | None = None,
        ref_audio_path: str | None = None,
        ref_text: str | None = None,
    ):
        del ref_text
        self.ensure_mode("clone")
        self.warm_clone_calls += 1
        if speaker_embedding_path is not None:
            assert Path(speaker_embedding_path).exists()
        if ref_audio_path is not None:
            assert Path(ref_audio_path).exists()

    def stream_clone_cached(self, *, payload: BaseGenerationRequest, speaker_embedding_path: str, ref_text: str | None):
        assert Path(speaker_embedding_path).exists()
        assert ref_text == "Uploaded sample transcript."
        self.ensure_mode("clone")
        self.clone_cached_calls += 1
        for segment_index, segment in enumerate(payload.segments):
            yield {
                "segment_index": segment_index,
                "text": segment,
                "audio": np.full(7000, 0.35, dtype=np.float32),
                "sample_rate": 24000,
                "is_final_chunk": True,
            }


class FakeAsrManager:
    def __init__(self) -> None:
        self.active_model_id = None
        self.selected_device = "cpu"
        self.model_ids = ASR_MODEL_IDS
        self.transcribe_file_calls = 0

    def transcribe_file(self, *, file_path: str, model_id: str, language: str | None, send_to_chat: bool = False):
        self.active_model_id = model_id
        self.transcribe_file_calls += 1
        assert Path(file_path).exists()
        return AsrTranscriptionResponse(
            text="Uploaded sample transcript.",
            language=language,
            duration_seconds=1.25,
            model_id=model_id,
            segments=[AsrSegmentResponse(text="Uploaded sample transcript.", start=0.0, end=1.25)],
            send_to_chat=send_to_chat,
        )

    def transcribe_array(self, *, audio: np.ndarray, source_rate: int, model_id: str, language: str | None):
        self.active_model_id = model_id
        return AsrTranscriptionResponse(
            text="Live microphone transcript.",
            language=language,
            duration_seconds=round(float(len(audio) / max(source_rate, 1)), 2),
            model_id=model_id,
            segments=[AsrSegmentResponse(text="Live microphone transcript.", start=0.0, end=0.8)],
        )


class ExplodingAsrManager(FakeAsrManager):
    def transcribe_array(self, *, audio: np.ndarray, source_rate: int, model_id: str, language: str | None):
        del audio, source_rate, model_id, language
        raise RuntimeError("The ASR model failed to transcribe the buffered audio.")


class FakeProviderService:
    async def test_provider(self, provider, config):
        if config.model == "bad-model":
            return ProviderTestResponse(
                success=False,
                provider=provider,
                resolved_model=config.model,
                latency_ms=9,
                streaming_supported=False,
                api_mode=None,
                error="Provider rejected the configuration.",
            )
        return ProviderTestResponse(
            success=True,
            provider=provider,
            resolved_model=config.model or "fake-model",
            latency_ms=12,
            streaming_supported=True,
            api_mode="responses" if provider == "openai_compatible" else None,
            error=None,
        )

    async def stream_reply(self, *, settings, messages, cancel_event):
        del messages
        assert settings.openai_compatible.api_key == "sk-saved-provider"
        for token in ("Hello", " there.", " This is streamed."):
            if cancel_event.is_set():
                break
            yield token


class FakeMarkdownProviderService(FakeProviderService):
    async def stream_reply(self, *, settings, messages, cancel_event):
        del settings, messages
        for token in (
            "### [리액트의 탄생] **리액트**는 웹 UI를 다루는 도구입니다.",
            "\n- `컴포넌트`를 중심으로 생각합니다.",
            "\n자세한 내용은 [공식 문서](https://example.com)를 보세요.",
        ):
            if cancel_event.is_set():
                break
            yield token


def make_wav_bytes() -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes((np.zeros(1600, dtype=np.int16)).tobytes())
    return buffer.getvalue()


_TEST_AUTH_TOKEN: str | None = None


def auth_token(user_id: str = "test-user", username: str = "admin", role: str = "admin") -> str:
    return create_access_token(user_id=user_id, username=username, role=role)


def auth_token_for_app(app) -> str:
    admin_user = app.state.db.get_user_by_username("admin")
    assert admin_user is not None
    return create_access_token(
        user_id=admin_user["id"],
        username=admin_user["username"],
        role=admin_user["role"],
    )


def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_TEST_AUTH_TOKEN or auth_token()}"}


def ws_path(token: str | None = None) -> str:
    return f"/api/conversation/ws?token={token or _TEST_AUTH_TOKEN or auth_token()}"


def test_collect_audio_concatenates_all_non_streaming_results():
    manager = TtsModelManager()

    wav, sample_rate = manager._collect_audio(
        [
            SimpleNamespace(audio=np.array([0.1, 0.2], dtype=np.float32), sample_rate=24000),
            SimpleNamespace(audio=np.array([0.3, 0.4, 0.5], dtype=np.float32), sample_rate=24000),
        ]
    )

    assert sample_rate == 24000
    assert wav.tolist() == pytest.approx([0.1, 0.2, 0.3, 0.4, 0.5])


def test_clone_language_mismatch_falls_back_to_auto():
    manager = TtsModelManager()

    resolved = manager.resolve_clone_language(
        "English",
        ["안녕하세요. 태아보험 이용 방법 안내드리겠습니다."],
        "안녕하세요. 태아보험 이용 방법 안내드리겠습니다.",
    )

    assert resolved == "Auto"


def test_iter_chunked_audio_splits_full_clone_audio_for_streaming():
    manager = TtsModelManager()

    events = list(
        manager._iter_chunked_audio(
            np.arange(10, dtype=np.float32),
            sample_rate=4,
            segment_index=0,
            text="hello",
            streaming_interval=0.5,
        )
    )

    assert len(events) == 5
    assert [event["audio"].tolist() for event in events] == [
        pytest.approx([0.0, 1.0]),
        pytest.approx([2.0, 3.0]),
        pytest.approx([4.0, 5.0]),
        pytest.approx([6.0, 7.0]),
        pytest.approx([8.0, 9.0]),
    ]
    assert events[-1]["is_final_chunk"] is True


def test_clone_reference_text_override_detects_target_text_pasted_as_reference():
    should_override = should_override_reference_text(
        provided_ref_text="안녕하세요. 태아보험 이용 방법 안내드리겠습니다. 정확한 보장 가능 여부와 필요 서류는 고객님이 가입하신 상품명과 특약에 따라 달라질 수 있으니 보험사명과 청구하시려는 항목을 알려주시면 더 정확하게 안내드리겠습니다.",
        target_segments=[
            "안녕하세요. 태아보험 이용 방법 안내드리겠습니다. 정확한 보장 가능 여부와 필요 서류는 고객님이 가입하신 상품명과 특약에 따라 달라질 수 있으니 보험사명과 청구하시려는 항목을 알려주시면 더 정확하게 안내드리겠습니다."
        ],
        ref_audio_duration_seconds=1.04,
    )

    assert should_override is True


def test_prepare_audio_upload_transcodes_when_original_format_is_unsupported(tmp_path: Path, monkeypatch):
    source = tmp_path / "sample.m4a"
    source.write_bytes(b"fake-m4a")
    converted = tmp_path / "sample.wav"
    converted.write_bytes(make_wav_bytes())

    calls: list[str] = []

    def fake_validate(path: str):
        calls.append(path)
        if path.endswith(".m4a"):
            raise HTTPException(status_code=400, detail="Invalid or unsupported audio file.")

    monkeypatch.setattr("server.app.main.validate_audio_upload", fake_validate)
    monkeypatch.setattr("server.app.main.transcode_audio_upload", lambda path: str(converted))

    prepared_path, cleanup_paths = prepare_audio_upload(str(source))

    assert prepared_path == str(converted)
    assert cleanup_paths == [converted]
    assert any(path.endswith(".m4a") for path in calls)
    assert any(path.endswith(".wav") for path in calls)


def test_prepare_clone_reference_audio_shortens_long_reference(tmp_path: Path):
    source = tmp_path / "long-reference.wav"
    sample_rate = 16000
    audio = np.zeros(sample_rate * 12, dtype=np.float32)
    audio[sample_rate * 7 : sample_rate * 11] = 0.4
    sf.write(source, audio, sample_rate)

    prompt_path, cleanup_paths, excerpted = prepare_clone_reference_audio(str(source))

    assert excerpted is True
    assert Path(prompt_path).exists()
    assert cleanup_paths == [Path(prompt_path)]
    duration_seconds = estimate_wav_duration_seconds(Path(prompt_path))
    assert duration_seconds <= 8.1
    assert duration_seconds >= 3.0

    for cleanup_path in cleanup_paths:
        cleanup_path.unlink(missing_ok=True)


def estimate_wav_duration_seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as wav:
        return float(wav.getnframes()) / float(wav.getframerate())


def test_chat_settings_store_defaults_follow_active_runtime(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        "server.app.chat_store.resolve_runtime_selection",
        lambda: RuntimeSelection(
            backend="qwen",
            device="cuda:0",
            device_label="cuda:0",
            torch_dtype_name="bfloat16",
            attn_implementation="flash_attention_2",
            tts_model_ids={"custom": "custom", "design": "design", "clone": "clone"},
            asr_model_ids={"default": "Qwen/Qwen3-ASR-1.7B", "compact": "Qwen/Qwen3-ASR-0.6B"},
            platform_name="linux-x86_64",
        ),
    )
    store = ChatSettingsStore(tmp_path / "settings" / "chat.json")

    settings = store.default_settings()

    assert settings.defaults.asr_model == "Qwen/Qwen3-ASR-1.7B"


def test_chat_settings_store_migrates_old_asr_model_ids_to_active_runtime(
    tmp_path: Path, monkeypatch
):
    monkeypatch.setattr(
        "server.app.chat_store.resolve_runtime_selection",
        lambda: RuntimeSelection(
            backend="qwen",
            device="cuda:0",
            device_label="cuda:0",
            torch_dtype_name="bfloat16",
            attn_implementation="flash_attention_2",
            tts_model_ids={"custom": "custom", "design": "design", "clone": "clone"},
            asr_model_ids={"default": "Qwen/Qwen3-ASR-1.7B", "compact": "Qwen/Qwen3-ASR-0.6B"},
            platform_name="linux-x86_64",
        ),
    )
    store = ChatSettingsStore(tmp_path / "settings" / "chat.json")
    legacy_settings = store.default_settings()
    legacy_settings.defaults.asr_model = ASR_MODEL_IDS["default"]
    store.save(legacy_settings)

    loaded = store.load()

    assert loaded.defaults.asr_model == "Qwen/Qwen3-ASR-1.7B"


@pytest.fixture
def client(tmp_path: Path):
    global _TEST_AUTH_TOKEN
    os.environ["RUNTIME_API_KEY"] = "test-runtime-key"
    tts_manager = FakeTtsManager()
    asr_manager = FakeAsrManager()
    storage = AudioStorage(tmp_path / "audio")
    settings_store = ChatSettingsStore(tmp_path / "settings" / "chat.json")
    initial_settings = settings_store.default_settings()
    initial_settings.openai_compatible.api_key = "sk-saved-provider"
    initial_settings.openai_compatible.model = "gpt-saved"
    settings_store.save(initial_settings)
    app = create_app(
        tts_manager=tts_manager,
        asr_manager=asr_manager,
        audio_storage=storage,
        settings_store=settings_store,
        provider_service=FakeProviderService(),
    )
    with TestClient(app) as test_client:
        admin_user = app.state.db.get_user_by_username("admin")
        assert admin_user is not None
        _TEST_AUTH_TOKEN = create_access_token(
            user_id=admin_user["id"],
            username=admin_user["username"],
            role=admin_user["role"],
        )
        test_client.headers.update(auth_headers())
        yield test_client, tts_manager, asr_manager, settings_store
    _TEST_AUTH_TOKEN = None


def test_health_and_capabilities(client):
    test_client, _tts, _asr, _settings = client
    health = test_client.get("/api/health")
    capabilities = test_client.get("/api/capabilities")

    assert health.status_code == 200
    assert capabilities.status_code == 200
    assert capabilities.json()["selected_device"] == "cpu"
    assert capabilities.json()["asr"]["default_model"] == "mlx-community/Ivy3-ASR-1.7B-8bit"
    assert capabilities.json()["chat"]["providers"][0]["id"] == "openai_compatible"


def test_deleted_user_token_is_rejected(client):
    test_client, _tts, _asr, _settings = client
    db = test_client.app.state.db
    user = db.create_user(f"revoked-user-{uuid4().hex}", "not-used", "user")
    token = create_access_token(
        user_id=user["id"],
        username=user["username"],
        role=user["role"],
    )
    db.delete_user(user["id"])

    response = test_client.get(
        "/api/capabilities",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401


def test_settings_roundtrip_and_redaction(client):
    test_client, _tts, _asr, settings_store = client
    response = test_client.put(
        "/api/settings/chat",
        json={
            "defaults": {
                "active_provider": "openai_compatible",
                "system_prompt": "Talk briefly.",
                "temperature": 0.6,
                "max_output_tokens": 300,
                "asr_model": ASR_MODEL_IDS["compact"],
                "asr_language": "English",
                "silence_timeout_ms": 900,
                "max_turn_seconds": 30,
                "live_captions": True,
                "reply_voice": {
                    "mode": "custom",
                    "language": "English",
                    "speaker": "Ryan",
                    "instruct": "Keep it measured.",
                    "style": {
                        "mood": "neutral",
                        "emotion_intensity": "restrained",
                        "pace": "steady",
                        "energy": "balanced",
                        "expressiveness": "controlled",
                    },
                },
            },
            "openai_compatible": {
                "base_url": "https://example.com/v1",
                "api_key": "sk-test-123456",
                "model": "gpt-test",
            },
            "gemini": {"base_url": "https://gemini.example", "api_key": "", "model": ""},
            "anthropic": {"base_url": "https://anthropic.example", "api_key": "", "model": ""},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["openai_compatible"]["has_api_key"] is True
    assert body["openai_compatible"]["masked_api_key"]
    assert settings_store.load().openai_compatible.api_key == "sk-test-123456"


def test_provider_test_endpoint(client):
    test_client, _tts, _asr, _settings = client
    response = test_client.post(
        "/api/settings/chat/test",
        json={
            "provider": "openai_compatible",
            "config": {
                "base_url": "https://example.com/v1",
                "api_key": "sk-test-123456",
                "model": "gpt-test",
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["success"] is True
    assert response.json()["api_mode"] == "responses"


def test_provider_test_failure_is_returned_cleanly(client):
    test_client, _tts, _asr, _settings = client
    response = test_client.post(
        "/api/settings/chat/test",
        json={
            "provider": "gemini",
            "config": {
                "base_url": "https://gemini.example",
                "api_key": "bad-key",
                "model": "bad-model",
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["success"] is False
    assert response.json()["error"] == "Provider rejected the configuration."


def test_asr_transcription_endpoint(client):
    test_client, _tts, asr_manager, _settings = client
    response = test_client.post(
        "/api/asr/transcribe",
        data={"model_id": ASR_MODEL_IDS["default"], "language": "English", "send_to_chat": "true"},
        files={"audio": ("sample.wav", make_wav_bytes(), "audio/wav")},
    )
    assert response.status_code == 200
    assert response.json()["text"] == "Uploaded sample transcript."
    assert response.json()["send_to_chat"] is True
    assert asr_manager.active_model_id == ASR_MODEL_IDS["default"]


def test_asr_invalid_media_returns_400(client):
    test_client, _tts, _asr, _settings = client
    response = test_client.post(
        "/api/asr/transcribe",
        data={"model_id": ASR_MODEL_IDS["default"], "language": "English"},
        files={"audio": ("bad.wav", b"not-a-real-audio-file", "audio/wav")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid or unsupported audio file."


def test_openai_models_lists_qwen_audio_models(client):
    test_client, _tts, _asr, _settings = client
    response = test_client.get("/v1/models", headers={"X-API-Key": "test-runtime-key"})

    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "list"
    assert [item["id"] for item in body["data"]] == ["qwen3-tts", "qwen3-asr"]


def test_openai_audio_speech_returns_wav(client):
    test_client, manager, _asr, _settings = client
    response = test_client.post(
        "/v1/audio/speech",
        headers={"X-API-Key": "test-runtime-key"},
        json={
            "model": "qwen3-tts",
            "input": "Hello from the OpenAI style TTS endpoint.",
            "voice": "Ryan",
            "response_format": "wav",
            "instructions": "Speak steadily.",
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content[:4] == b"RIFF"
    assert manager.custom_calls == 1


def test_openai_audio_speech_returns_pcm(client):
    test_client, manager, _asr, _settings = client
    response = test_client.post(
        "/v1/audio/speech",
        headers={"X-API-Key": "test-runtime-key"},
        json={
            "model": "qwen3-tts",
            "input": "Return raw PCM audio please.",
            "voice": "Ryan",
            "response_format": "pcm",
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/pcm"
    assert len(response.content) == 32000
    assert response.content == b"\x00\x00" * 16000
    assert manager.custom_calls == 1


def test_openai_audio_transcriptions_returns_openai_shape(client):
    test_client, _tts, asr_manager, _settings = client
    response = test_client.post(
        "/v1/audio/transcriptions",
        headers={"X-API-Key": "test-runtime-key"},
        data={"model": "qwen3-asr", "language": "English"},
        files={"file": ("sample.wav", make_wav_bytes(), "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "text": "Uploaded sample transcript.",
        "language": "English",
        "model": "qwen3-asr",
    }
    assert asr_manager.active_model_id == ASR_MODEL_IDS["default"]


def test_custom_generation_persists_audio(client):
    test_client, manager, _asr, _settings = client
    response = test_client.post(
        "/api/generate/custom",
        json={
            "segments": ["Testing the Ryan preset voice."],
            "language": "English",
            "speaker": "Ryan",
            "instruct": "Speak with measured confidence.",
            "generation": {"temperature": 0.6, "top_p": 0.85, "max_new_tokens": 1200},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "custom"
    assert body["clips"][0]["audio_url"].startswith("/api/audio/")
    assert manager.custom_calls == 1

    audio = test_client.get(body["clips"][0]["audio_url"])
    assert audio.status_code == 200
    assert audio.headers["content-type"] == "audio/wav"


def test_clone_generation_auto_transcribes_reference_when_text_is_missing(client):
    test_client, manager, asr_manager, _settings = client
    response = test_client.post(
        "/api/generate/clone",
        data={
            "segments": json.dumps(["Clone this sentence in the uploaded voice."]),
            "language": "English",
            "generation": json.dumps({}),
        },
        files={"ref_audio": ("reference.wav", make_wav_bytes(), "audio/wav")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "clone"
    assert body["clips"][0]["instruct"] == "Uploaded sample transcript."
    assert body["saved_voice_profile"]["id"]
    assert body["saved_voice_profile"]["label"] == "reference"
    assert body["saved_voice_profile"]["reference_text"] == "Uploaded sample transcript."
    assert manager.clone_calls == 1
    assert manager.prepare_clone_embedding_calls == 1
    assert asr_manager.transcribe_file_calls == 1


def test_clone_generation_accepts_legacy_frontend_field_names(client):
    test_client, manager, asr_manager, _settings = client
    response = test_client.post(
        "/api/generate/clone",
        data={
            "segments": json.dumps(["Clone this sentence in the uploaded voice."]),
            "language": "English",
            "generation": json.dumps({}),
            "reference_text": "Legacy reference transcript.",
        },
        files={"audio": ("reference.wav", make_wav_bytes(), "audio/wav")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "clone"
    assert body["clips"][0]["instruct"] == "Legacy reference transcript."
    assert body["saved_voice_profile"]["id"]
    assert body["saved_voice_profile"]["reference_text"] == "Legacy reference transcript."
    assert manager.clone_calls == 1
    assert manager.prepare_clone_embedding_calls == 1
    assert asr_manager.transcribe_file_calls == 0


def test_clone_generation_supports_x_vector_only_mode_without_reference_text(client):
    test_client, manager, asr_manager, _settings = client
    response = test_client.post(
        "/api/generate/clone",
        data={
            "segments": json.dumps(["Clone this sentence in the uploaded voice."]),
            "language": "English",
            "x_vector_only_mode": "true",
            "generation": json.dumps({}),
        },
        files={"ref_audio": ("reference.wav", make_wav_bytes(), "audio/wav")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["clips"][0]["x_vector_only_mode"] is True
    assert body["saved_voice_profile"]["id"]
    assert manager.clone_calls == 1
    assert manager.prepare_clone_embedding_calls == 1
    assert asr_manager.transcribe_file_calls == 0


def test_create_clone_voice_profile_auto_transcribes_reference(client):
    test_client, manager, asr_manager, _settings = client
    response = test_client.post(
        "/api/chat/reply-voice/clone-profile",
        data={"language": "English", "label": "Agent Voice"},
        files={"audio": ("reference.wav", make_wav_bytes(), "audio/wav")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["label"] == "Agent Voice"
    assert body["reference_text"] == "Uploaded sample transcript."
    assert body["audio_url"].startswith("/api/voices/")
    assert "audio_path" not in body
    assert "speaker_embedding_path" not in body
    assert asr_manager.transcribe_file_calls == 1
    assert manager.prepare_clone_embedding_calls == 1


def test_list_user_voices_accepts_utc_z_timestamps(client, monkeypatch):
    test_client, _manager, _asr_manager, _settings = client
    user = test_client.app.state.db.create_user(
        f"voice-owner-{uuid4().hex}",
        "not-used",
        "user",
    )
    token = create_access_token(
        user_id=user["id"],
        username=user["username"],
        role=user["role"],
    )
    headers = {"Authorization": f"Bearer {token}"}

    monkeypatch.setattr(
        test_client.app.state.db,
        "list_profiles_for_user",
        lambda user_id: [
            {
                "id": "voice-1",
                "user_id": user_id,
                "label": "Support Agent",
                "language": "Korean",
                "reference_text": "안녕하세요.",
                "audio_file_name": "voice-1.wav",
                "audio_path": "/tmp/voice-1.wav",
                "speaker_embedding_path": "/tmp/voice-1.speaker.npz",
                "created_at": "2026-04-10T07:56:20.268575Z",
            }
        ],
    )

    response = test_client.get("/api/voices", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body[0]["id"] == "voice-1"
    assert body[0]["user_id"] == user["id"]
    assert body[0]["created_at"].startswith("2026-04-10T07:56:20.268575")


def test_stream_custom_generation_emits_chunks_and_final_run(client):
    test_client, manager, _asr, _settings = client

    with test_client.stream(
        "POST",
        "/api/stream/custom",
        json={
            "segments": ["Streaming Ryan preset voice."],
            "language": "English",
            "speaker": "Ryan",
            "streaming_interval": 0.32,
        },
    ) as response:
        assert response.status_code == 200
        lines = [line for line in response.iter_lines() if line]

    decoded = [json.loads(line) for line in lines]
    event_types = [item["type"] for item in decoded]

    assert event_types == [
        "run_start",
        "segment_start",
        "audio_chunk",
        "audio_chunk",
        "segment_complete",
        "run_complete",
    ]
    assert decoded[2]["pcm16_base64"]
    assert decoded[3]["is_final_chunk"] is True
    assert decoded[-1]["run"]["clips"][0]["audio_url"].startswith("/api/audio/")
    assert manager.custom_calls == 1


def test_conversation_websocket_streams_text_and_tts(client):
    test_client, _tts, _asr, _settings = client

    with test_client.websocket_connect(ws_path()) as websocket:
        ready = websocket.receive_json()
        assert ready["type"] == "session.ready"
        saved_settings = ready["settings"]
        assert saved_settings["openai_compatible"]["has_api_key"] is True

        websocket.send_json({"type": "session.configure", "settings": saved_settings})
        configured = websocket.receive_json()
        assert configured["type"] == "session.ready"
        websocket.send_json({"type": "text.submit", "text": "Say hello."})

        event_types: list[str] = []
        while True:
            payload = websocket.receive_json()
            event_types.append(payload["type"])
            if payload["type"] == "assistant.complete":
                break

    assert "llm.status" in event_types
    assert "llm.delta" in event_types
    assert "llm.sentence" in event_types
    assert "tts.segment_start" in event_types
    assert "tts.audio_chunk" in event_types
    assert "tts.segment_complete" in event_types


def test_conversation_turn_commit_does_not_drop_socket_when_cancelling_speech(client):
    test_client, _tts, _asr, _settings = client

    with test_client.websocket_connect(ws_path()) as websocket:
        websocket.receive_json()
        websocket.send_json({"type": "text.submit", "text": "Say hello."})

        while True:
            payload = websocket.receive_json()
            if payload["type"] == "tts.segment_start":
                break

        pcm16 = np.zeros(4000, dtype=np.int16).tobytes()
        websocket.send_json(
            {
                "type": "audio.append",
                "pcm16_base64": base64.b64encode(pcm16).decode("ascii"),
                "sample_rate": 16000,
            }
        )
        websocket.send_json({"type": "turn.commit"})

        observed_types: list[str] = []
        while True:
            follow_up = websocket.receive_json()
            observed_types.append(follow_up["type"])
            if follow_up["type"] in {"llm.status", "asr.final", "error"}:
                break

        assert any(event_type in {"llm.status", "asr.final", "error"} for event_type in observed_types)


def test_conversation_turn_commit_returns_error_without_disconnect_on_asr_failure(tmp_path: Path):
    settings_store = ChatSettingsStore(tmp_path / "settings" / "chat.json")
    initial_settings = settings_store.default_settings()
    initial_settings.openai_compatible.api_key = "sk-saved-provider"
    initial_settings.openai_compatible.model = "gpt-saved"
    settings_store.save(initial_settings)
    app = create_app(
        tts_manager=FakeTtsManager(),
        asr_manager=ExplodingAsrManager(),
        audio_storage=AudioStorage(tmp_path / "audio"),
        settings_store=settings_store,
        provider_service=FakeProviderService(),
    )

    pcm16 = base64.b64encode((np.zeros(1600, dtype=np.int16)).tobytes()).decode("ascii")

    with TestClient(app) as test_client:
        with test_client.websocket_connect(ws_path(auth_token_for_app(app))) as websocket:
            assert websocket.receive_json()["type"] == "session.ready"
            websocket.send_json(
                {
                    "type": "audio.append",
                    "pcm16_base64": pcm16,
                    "sample_rate": 16000,
                }
            )
            websocket.send_json({"type": "turn.commit"})

            assert websocket.receive_json() == {"type": "llm.status", "phase": "transcribing"}
            error_event = websocket.receive_json()
            assert error_event["type"] == "error"
            assert error_event["detail"] == "The ASR model failed to transcribe the buffered audio."
            assert websocket.receive_json() == {"type": "llm.status", "phase": "listening"}

            websocket.send_json({"type": "session.configure", "settings": settings_store.redact(initial_settings).model_dump(mode="json")})
            assert websocket.receive_json()["type"] == "session.ready"


def test_conversation_can_speak_with_cloned_reply_voice(client, tmp_path: Path):
    test_client, manager, _asr, _settings = client
    reference_path = tmp_path / "clone-reference.wav"
    reference_path.write_bytes(make_wav_bytes())
    embedding_path = tmp_path / "clone-reference.speaker.npy"
    np.save(embedding_path, np.asarray([[0.1, 0.2, 0.3]], dtype=np.float32))
    admin_user = test_client.app.state.db.get_user_by_username("admin")
    assert admin_user is not None
    test_client.app.state.db.save_voice_profile(
        profile_id="clone-voice",
        user_id=admin_user["id"],
        label="Clone Voice",
        language="English",
        reference_text="Uploaded sample transcript.",
        audio_file_name=reference_path.name,
        audio_path=str(reference_path),
        speaker_embedding_path=str(embedding_path),
    )

    with test_client.websocket_connect(ws_path()) as websocket:
        ready = websocket.receive_json()
        settings = ready["settings"]
        settings["defaults"]["reply_voice"]["mode"] = "clone"
        settings["defaults"]["reply_voice"]["clone_profile_id"] = "clone-voice"
        settings["defaults"]["reply_voice"]["clone_profile_label"] = "Clone Voice"

        websocket.send_json({"type": "session.configure", "settings": settings})
        websocket.receive_json()
        websocket.send_json({"type": "text.submit", "text": "Use the cloned reply voice."})

        event_types: list[str] = []
        while True:
            payload = websocket.receive_json()
            event_types.append(payload["type"])
            if payload["type"] == "assistant.complete":
                break

    assert "tts.segment_start" in event_types
    assert "tts.audio_chunk" in event_types
    assert manager.ensure_calls[-1] == "clone"
    assert manager.clone_calls >= 1
    assert manager.clone_cached_calls == 0


def test_conversation_strips_markdown_before_speaking(tmp_path: Path):
    settings_store = ChatSettingsStore(tmp_path / "settings" / "chat.json")
    initial_settings = settings_store.default_settings()
    initial_settings.openai_compatible.api_key = "sk-saved-provider"
    initial_settings.openai_compatible.model = "gpt-saved"
    settings_store.save(initial_settings)

    app = create_app(
        tts_manager=FakeTtsManager(),
        asr_manager=FakeAsrManager(),
        audio_storage=AudioStorage(tmp_path / "audio"),
        settings_store=settings_store,
        provider_service=FakeMarkdownProviderService(),
    )

    with TestClient(app) as test_client:
        with test_client.websocket_connect(ws_path(auth_token_for_app(app))) as websocket:
            assert websocket.receive_json()["type"] == "session.ready"
            websocket.send_json({"type": "text.submit", "text": "Explain React."})

            spoken_sentences: list[str] = []
            spoken_blocks: list[str] = []
            while True:
                payload = websocket.receive_json()
                if payload["type"] == "llm.sentence":
                    spoken_sentences.append(payload["text"])
                if payload["type"] == "tts.segment_start":
                    spoken_blocks.append(payload["text"])
                if payload["type"] == "assistant.complete":
                    break

    assert spoken_sentences
    assert spoken_blocks
    for text in (*spoken_sentences, *spoken_blocks):
        assert "#" not in text
        assert "**" not in text
        assert "`" not in text
        assert "https://example.com" not in text
    assert any("리액트의 탄생" in text for text in spoken_blocks)
    assert any("공식 문서" in text for text in spoken_blocks)
