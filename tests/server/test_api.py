from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from server.app.constants import GENERATION_KNOBS, LANGUAGES, MODE_DESCRIPTIONS, MODE_LABELS, MODEL_IDS, SPEAKERS
from server.app.main import create_app
from server.app.schemas import BaseGenerationRequest, CapabilitiesResponse, CustomGenerationRequest, DesignGenerationRequest, ModeCapabilityResponse, SpeakerResponse
from server.app.storage import AudioStorage


class FakeModelManager:
    def __init__(self) -> None:
        self.active_mode = None
        self.active_model_id = None
        self.selected_device = "cpu"
        self.custom_calls = 0
        self.design_calls = 0
        self.clone_calls = 0
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
        )

    def ensure_mode(self, mode: str):
        if self.active_mode and self.active_mode != mode:
            self.unload_calls += 1
        if not self.ensure_calls or self.ensure_calls[-1] != mode:
            self.ensure_calls.append(mode)
        self.active_mode = mode
        self.active_model_id = MODEL_IDS[mode]
        return object()

    def generate_custom(self, payload: CustomGenerationRequest):
        self.ensure_mode("custom")
        self.custom_calls += 1
        return [np.zeros(16000, dtype=np.float32) for _ in payload.segments], 16000

    def generate_design(self, payload: DesignGenerationRequest):
        self.ensure_mode("design")
        self.design_calls += 1
        return [np.ones(8000, dtype=np.float32) for _ in payload.segments], 16000

    def generate_clone(self, *, payload: BaseGenerationRequest, ref_audio_path: str, ref_text: str | None, x_vector_only_mode: bool):
        assert Path(ref_audio_path).exists()
        self.ensure_mode("clone")
        self.clone_calls += 1
        if not x_vector_only_mode and not ref_text:
            raise ValueError("Reference transcript is required unless x-vector only mode is enabled.")
        return [np.full(12000, 0.3, dtype=np.float32) for _ in payload.segments], 24000


@pytest.fixture
def client(tmp_path: Path):
    manager = FakeModelManager()
    storage = AudioStorage(tmp_path / "audio")
    app = create_app(model_manager=manager, audio_storage=storage)
    with TestClient(app) as test_client:
        yield test_client, manager


def test_health_and_capabilities(client):
    test_client, _manager = client
    health = test_client.get("/api/health")
    capabilities = test_client.get("/api/capabilities")

    assert health.status_code == 200
    assert capabilities.status_code == 200
    assert capabilities.json()["selected_device"] == "cpu"
    assert len(capabilities.json()["speakers"]) == 9


def test_custom_generation_persists_audio(client):
    test_client, manager = client
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


def test_invalid_custom_request_rejected(client):
    test_client, _manager = client
    response = test_client.post(
        "/api/generate/custom",
        json={"segments": ["   "], "language": "English", "speaker": "Ryan"},
    )
    assert response.status_code == 422


def test_clone_requires_transcript_without_xvector_mode(client):
    test_client, _manager = client
    response = test_client.post(
        "/api/generate/clone",
        data={"segments": '["A fresh sentence to clone."]', "language": "English"},
        files={"ref_audio": ("sample.wav", b"fake-bytes", "audio/wav")},
    )
    assert response.status_code == 400
    assert "Reference transcript" in response.json()["detail"]


def test_model_switch_and_repeat_mode_behavior(client):
    test_client, manager = client

    first = test_client.post(
        "/api/generate/custom",
        json={"segments": ["One"], "language": "English", "speaker": "Ryan"},
    )
    second = test_client.post(
        "/api/generate/custom",
        json={"segments": ["Two"], "language": "English", "speaker": "Ryan"},
    )
    third = test_client.post(
        "/api/generate/design",
        json={"segments": ["Three"], "language": "English", "instruct": "Speak in a bright, playful tone."},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 200
    assert manager.ensure_calls == ["custom", "design"]
    assert manager.unload_calls == 1
