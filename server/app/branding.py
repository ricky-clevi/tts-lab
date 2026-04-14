from __future__ import annotations

import re
from typing import Any

from .schemas import (
    AsrTranscriptionResponse,
    CapabilitiesResponse,
    ChatSettingsInput,
    ChatSettingsResponse,
    GenerationRunResponse,
    HealthResponse,
)

_QWEN_PATTERN = re.compile(r"qwen", re.IGNORECASE)
_IVY_PATTERN = re.compile(r"ivy", re.IGNORECASE)


def _match_case(replacement: str, original: str) -> str:
    if original.isupper():
        return replacement.upper()
    if original.islower():
        return replacement.lower()
    if original[:1].isupper():
        return replacement.capitalize()
    return replacement


def _replace_token(value: str | None, pattern: re.Pattern[str], replacement: str) -> str | None:
    if value is None:
        return None
    return pattern.sub(lambda match: _match_case(replacement, match.group(0)), value)


def brand_qwen_text(value: str | None) -> str | None:
    return _replace_token(value, _QWEN_PATTERN, "ivy")


def unbrand_ivy_text(value: str | None) -> str | None:
    return _replace_token(value, _IVY_PATTERN, "qwen")


def brand_health_response(response: HealthResponse) -> HealthResponse:
    payload = response.model_dump(mode="json")
    payload["active_model"] = brand_qwen_text(payload.get("active_model"))
    payload["runtime_backend"] = brand_qwen_text(payload.get("runtime_backend"))
    payload["active_asr_model"] = brand_qwen_text(payload.get("active_asr_model"))
    return HealthResponse.model_validate(payload)


def brand_generation_run_response(response: GenerationRunResponse) -> GenerationRunResponse:
    payload = response.model_dump(mode="json")
    payload["model_id"] = brand_qwen_text(payload.get("model_id"))
    return GenerationRunResponse.model_validate(payload)


def brand_asr_transcription_response(response: AsrTranscriptionResponse) -> AsrTranscriptionResponse:
    payload = response.model_dump(mode="json")
    payload["model_id"] = brand_qwen_text(payload.get("model_id"))
    return AsrTranscriptionResponse.model_validate(payload)


def brand_capabilities_response(response: CapabilitiesResponse) -> CapabilitiesResponse:
    payload = response.model_dump(mode="json")
    payload["runtime_backend"] = brand_qwen_text(payload.get("runtime_backend"))

    for mode in payload.get("modes", []):
        mode["label"] = brand_qwen_text(mode.get("label"))
        mode["description"] = brand_qwen_text(mode.get("description"))
        mode["checkpoint"] = brand_qwen_text(mode.get("checkpoint"))

    asr = payload.get("asr", {})
    asr["default_model"] = brand_qwen_text(asr.get("default_model"))
    for model in asr.get("models", []):
        model["id"] = brand_qwen_text(model.get("id"))
        model["label"] = brand_qwen_text(model.get("label"))
        model["description"] = brand_qwen_text(model.get("description"))
        model["checkpoint"] = brand_qwen_text(model.get("checkpoint"))

    chat = payload.get("chat", {})
    for provider in chat.get("providers", []):
        provider["label"] = brand_qwen_text(provider.get("label"))
        provider["description"] = brand_qwen_text(provider.get("description"))

    return CapabilitiesResponse.model_validate(payload)


def brand_chat_settings_response(response: ChatSettingsResponse) -> ChatSettingsResponse:
    payload = response.model_dump(mode="json")
    payload["defaults"]["asr_model"] = brand_qwen_text(payload["defaults"].get("asr_model"))
    return ChatSettingsResponse.model_validate(payload)


def unbrand_chat_settings_input(settings: ChatSettingsInput | dict[str, Any]) -> ChatSettingsInput:
    payload = settings.model_dump(mode="json") if isinstance(settings, ChatSettingsInput) else dict(settings)
    defaults = dict(payload.get("defaults") or {})
    defaults["asr_model"] = unbrand_ivy_text(defaults.get("asr_model"))
    payload["defaults"] = defaults
    return ChatSettingsInput.model_validate(payload)
