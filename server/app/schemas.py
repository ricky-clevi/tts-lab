from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


Mode = Literal["custom", "design", "clone"]


class GenerationSettings(BaseModel):
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    max_new_tokens: int | None = Field(default=None, ge=64, le=8192)
    seed: int | None = Field(default=None, ge=0, le=2147483647)

    def to_generate_kwargs(self) -> dict[str, float | int]:
        values = self.model_dump(exclude_none=True)
        return values


class BaseGenerationRequest(BaseModel):
    segments: list[str] = Field(min_length=1)
    language: str = "Auto"
    generation: GenerationSettings = Field(default_factory=GenerationSettings)

    @field_validator("segments")
    @classmethod
    def validate_segments(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values if value.strip()]
        if not cleaned:
            raise ValueError("Provide at least one non-empty text segment.")
        return cleaned

    @field_validator("language")
    @classmethod
    def validate_language(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Language must not be empty.")
        return cleaned


class CustomGenerationRequest(BaseGenerationRequest):
    speaker: str
    instruct: str | None = None

    @field_validator("speaker")
    @classmethod
    def validate_speaker(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Speaker must not be empty.")
        return cleaned


class DesignGenerationRequest(BaseGenerationRequest):
    instruct: str

    @field_validator("instruct")
    @classmethod
    def validate_instruction(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Voice design instruction must not be empty.")
        return cleaned


class HealthResponse(BaseModel):
    status: Literal["ok"]
    active_mode: Mode | None = None
    active_model: str | None = None
    selected_device: str


class SpeakerResponse(BaseModel):
    id: str
    name: str
    description: str
    native_language: str


class ModeCapabilityResponse(BaseModel):
    id: Mode
    label: str
    description: str
    checkpoint: str


class CapabilitiesResponse(BaseModel):
    active_mode: Mode | None = None
    selected_device: str
    languages: list[str]
    speakers: list[SpeakerResponse]
    generation_knobs: dict[str, dict[str, float | int | None]]
    modes: list[ModeCapabilityResponse]


class AudioClipResponse(BaseModel):
    id: str
    audio_url: str
    file_name: str
    segment_index: int
    text: str
    language: str
    sample_rate: int
    duration_seconds: float
    speaker: str | None = None
    instruct: str | None = None
    x_vector_only_mode: bool | None = None


class GenerationRunResponse(BaseModel):
    run_id: str
    mode: Mode
    model_id: str
    device: str
    created_at: datetime
    clips: list[AudioClipResponse]

