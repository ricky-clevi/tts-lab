from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


Mode = Literal["custom", "design", "clone"]
ProviderId = Literal["openai_compatible", "gemini", "anthropic"]
OpenAICompatMode = Literal["responses", "chat_completions"]
ReplyVoiceMode = Literal["custom", "design", "clone"]
ReplyRuntimeMode = Literal["quality", "balanced"]


class StyleControls(BaseModel):
    mood: str = "neutral"
    emotion_intensity: str = "restrained"
    pace: str = "steady"
    energy: str = "balanced"
    expressiveness: str = "controlled"


class GenerationSettings(BaseModel):
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    max_new_tokens: int | None = Field(default=None, ge=64, le=8192)
    seed: int | None = Field(default=None, ge=0, le=2147483647)

    def to_generate_kwargs(self) -> dict[str, float | int]:
        return self.model_dump(exclude_none=True)


class BaseGenerationRequest(BaseModel):
    segments: list[str] = Field(min_length=1)
    language: str = "Auto"
    streaming_interval: float = Field(default=0.32, ge=0.08, le=5.0)
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


class ProviderSettingsInput(BaseModel):
    base_url: str | None = None
    api_key: str | None = None
    model: str = ""
    api_mode: OpenAICompatMode | None = None

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("api_key")
    @classmethod
    def validate_api_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: str) -> str:
        return value.strip()


class ProviderSettingsResponse(BaseModel):
    base_url: str | None = None
    model: str = ""
    api_mode: OpenAICompatMode | None = None
    has_api_key: bool = False
    masked_api_key: str | None = None


class ReplyVoiceSettings(BaseModel):
    mode: ReplyVoiceMode = "custom"
    runtime_mode: ReplyRuntimeMode = "balanced"
    language: str = "English"
    speaker: str = "Ryan"
    instruct: str = ""
    style: StyleControls = Field(default_factory=StyleControls)
    block_max_sentences: int = Field(default=2, ge=1, le=3)
    block_max_chars: int = Field(default=180, ge=80, le=400)
    block_hold_ms: int = Field(default=220, ge=0, le=1000)
    warmup_on_connect: bool = True
    emit_perf_metrics: bool = False
    clone_profile_id: str | None = None
    clone_profile_label: str | None = None
    clone_audio_path: str | None = None
    clone_reference_text: str | None = None
    clone_embedding_path: str | None = None


class ChatDefaults(BaseModel):
    active_provider: ProviderId = "openai_compatible"
    system_prompt: str = "You are a concise, helpful voice assistant."
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_output_tokens: int = Field(default=512, ge=64, le=8192)
    asr_model: str
    asr_language: str = "Auto"
    silence_timeout_ms: int = Field(default=1200, ge=300, le=6000)
    max_turn_seconds: int = Field(default=45, ge=5, le=600)
    live_captions: bool = True
    reply_voice: ReplyVoiceSettings = Field(default_factory=ReplyVoiceSettings)


class ChatSettingsInput(BaseModel):
    defaults: ChatDefaults
    openai_compatible: ProviderSettingsInput = Field(default_factory=ProviderSettingsInput)
    gemini: ProviderSettingsInput = Field(default_factory=ProviderSettingsInput)
    anthropic: ProviderSettingsInput = Field(default_factory=ProviderSettingsInput)


class ChatSettingsResponse(BaseModel):
    defaults: ChatDefaults
    openai_compatible: ProviderSettingsResponse
    gemini: ProviderSettingsResponse
    anthropic: ProviderSettingsResponse


class ProviderTestRequest(BaseModel):
    provider: ProviderId
    config: ProviderSettingsInput


class ProviderTestResponse(BaseModel):
    success: bool
    provider: ProviderId
    resolved_model: str | None = None
    latency_ms: int | None = None
    streaming_supported: bool = False
    api_mode: OpenAICompatMode | None = None
    error: str | None = None


class AsrSegmentResponse(BaseModel):
    text: str
    start: float
    end: float


class AsrTranscriptionResponse(BaseModel):
    text: str
    language: str | None = None
    duration_seconds: float
    model_id: str
    segments: list[AsrSegmentResponse] = Field(default_factory=list)
    send_to_chat: bool = False


class HealthResponse(BaseModel):
    status: Literal["ok"]
    active_mode: Mode | None = None
    active_model: str | None = None
    selected_device: str
    runtime_backend: str | None = None
    runtime_platform: str | None = None
    runtime_dtype: str | None = None
    runtime_attention: str | None = None
    active_asr_model: str | None = None
    selected_asr_device: str | None = None


class MetricsResponse(BaseModel):
    cpu_percent: float
    ram_used_bytes: int
    ram_total_bytes: int
    ram_percent: float
    gpu_backend: str = "none"
    gpu_device: str | None = None
    gpu_name: str | None = None
    gpu_used_bytes: int = 0
    gpu_total_bytes: int = 0
    gpu_reserved_bytes: int = 0
    gpu_peak_bytes: int = 0
    gpu_utilization_percent: float | None = None
    gpu_temperature_c: float | None = None
    mlx_gpu_active_bytes: int
    mlx_gpu_peak_bytes: int
    mlx_gpu_cache_bytes: int


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


class AsrModelCapabilityResponse(BaseModel):
    id: str
    label: str
    description: str
    checkpoint: str


class ProviderCapabilityResponse(BaseModel):
    id: ProviderId
    label: str
    description: str
    base_url_configurable: bool
    native: bool


class AsrCapabilityResponse(BaseModel):
    default_model: str
    models: list[AsrModelCapabilityResponse]


class ChatCapabilityResponse(BaseModel):
    providers: list[ProviderCapabilityResponse]
    reply_chunking: Literal["sentence"]
    voice_modes: list[ReplyVoiceMode]


class ConversationCapabilityResponse(BaseModel):
    mode: Literal["turn_based_hands_free"]
    input_audio_format: str
    input_sample_rate: int
    websocket_path: str


class CapabilitiesResponse(BaseModel):
    active_mode: Mode | None = None
    selected_device: str
    runtime_backend: str | None = None
    runtime_platform: str | None = None
    runtime_dtype: str | None = None
    runtime_attention: str | None = None
    languages: list[str]
    speakers: list[SpeakerResponse]
    generation_knobs: dict[str, dict[str, float | int | None]]
    modes: list[ModeCapabilityResponse]
    asr: AsrCapabilityResponse
    chat: ChatCapabilityResponse
    conversation: ConversationCapabilityResponse


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


class CloneVoiceProfileResponse(BaseModel):
    id: str
    label: str
    language: str
    reference_text: str
    audio_file_name: str
    audio_url: str | None = None
    created_at: datetime
    user_id: str | None = None


class GenerationRunResponse(BaseModel):
    run_id: str
    mode: Mode
    model_id: str
    device: str
    created_at: datetime
    clips: list[AudioClipResponse]
    saved_voice_profile: CloneVoiceProfileResponse | None = None


# Auth schemas
class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str
    role: str


class UserResponse(BaseModel):
    id: str
    username: str
    role: str
    created_at: str
    is_active: bool


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: Literal["admin", "user"] = "user"
