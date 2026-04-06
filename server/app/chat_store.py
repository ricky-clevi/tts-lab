from __future__ import annotations

import json
from pathlib import Path

from .constants import (
    ASR_MODEL_IDS,
    DEFAULT_ANTHROPIC_BASE_URL,
    DEFAULT_GEMINI_BASE_URL,
    DEFAULT_OPENAI_BASE_URL,
)
from .schemas import (
    ChatDefaults,
    ChatSettingsInput,
    ChatSettingsResponse,
    OpenAICompatMode,
    ProviderSettingsInput,
    ProviderSettingsResponse,
)


def mask_secret(secret: str | None) -> str | None:
    if not secret:
        return None
    if len(secret) <= 8:
        return "*" * len(secret)
    return f"{secret[:3]}...{secret[-4:]}"


class ChatSettingsStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def default_settings(self) -> ChatSettingsInput:
        return ChatSettingsInput(
            defaults=ChatDefaults(asr_model=ASR_MODEL_IDS["default"]),
            openai_compatible=ProviderSettingsInput(base_url=DEFAULT_OPENAI_BASE_URL),
            gemini=ProviderSettingsInput(base_url=DEFAULT_GEMINI_BASE_URL),
            anthropic=ProviderSettingsInput(base_url=DEFAULT_ANTHROPIC_BASE_URL),
        )

    def load(self) -> ChatSettingsInput:
        if not self.path.exists():
            return self.default_settings()

        payload = json.loads(self.path.read_text(encoding="utf-8"))
        return ChatSettingsInput.model_validate(payload)

    def save(self, settings: ChatSettingsInput) -> ChatSettingsInput:
        self.path.write_text(
            json.dumps(settings.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return settings

    def merge_preserving_secrets(self, incoming: ChatSettingsInput) -> ChatSettingsInput:
        existing = self.load()
        for provider_name in ("openai_compatible", "gemini", "anthropic"):
            incoming_provider = getattr(incoming, provider_name)
            existing_provider = getattr(existing, provider_name)
            if not incoming_provider.api_key and existing_provider.api_key:
                incoming_provider.api_key = existing_provider.api_key
            if incoming_provider.base_url is None and existing_provider.base_url:
                incoming_provider.base_url = existing_provider.base_url
            if not incoming_provider.model and existing_provider.model:
                incoming_provider.model = existing_provider.model
            if incoming_provider.api_mode is None and existing_provider.api_mode:
                incoming_provider.api_mode = existing_provider.api_mode
        return incoming

    def redact(self, settings: ChatSettingsInput) -> ChatSettingsResponse:
        return ChatSettingsResponse(
            defaults=settings.defaults,
            openai_compatible=self._redact_provider(settings.openai_compatible),
            gemini=self._redact_provider(settings.gemini),
            anthropic=self._redact_provider(settings.anthropic),
        )

    def _redact_provider(self, settings: ProviderSettingsInput) -> ProviderSettingsResponse:
        return ProviderSettingsResponse(
            base_url=settings.base_url,
            model=settings.model,
            api_mode=settings.api_mode,
            has_api_key=bool(settings.api_key),
            masked_api_key=mask_secret(settings.api_key),
        )

    def update_openai_api_mode(
        self, settings: ChatSettingsInput, api_mode: OpenAICompatMode
    ) -> ChatSettingsInput:
        settings.openai_compatible.api_mode = api_mode
        self.save(settings)
        return settings
