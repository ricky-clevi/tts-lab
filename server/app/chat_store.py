from __future__ import annotations

import json
from pathlib import Path

from .branding import brand_chat_settings_response, brand_qwen_text, unbrand_ivy_text
from .constants import (
    DEFAULT_ANTHROPIC_BASE_URL,
    DEFAULT_GEMINI_BASE_URL,
    DEFAULT_OPENAI_BASE_URL,
)
from .runtime import DEFAULT_ASR_MODEL_IDS, resolve_runtime_selection
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
        self.runtime = resolve_runtime_selection()

    def default_settings(self) -> ChatSettingsInput:
        return ChatSettingsInput(
            defaults=ChatDefaults(asr_model=self.runtime.asr_model_ids["default"]),
            openai_compatible=ProviderSettingsInput(base_url=DEFAULT_OPENAI_BASE_URL),
            gemini=ProviderSettingsInput(base_url=DEFAULT_GEMINI_BASE_URL),
            anthropic=ProviderSettingsInput(base_url=DEFAULT_ANTHROPIC_BASE_URL),
        )

    def _normalize_runtime_models(self, settings: ChatSettingsInput) -> ChatSettingsInput:
        alias_to_slot: dict[str, str] = {}
        for backend_defaults in DEFAULT_ASR_MODEL_IDS.values():
            for slot, model_id in backend_defaults.items():
                alias_to_slot[model_id] = slot
                branded_model_id = brand_qwen_text(model_id)
                if branded_model_id:
                    alias_to_slot[branded_model_id] = slot

        current_model_id = unbrand_ivy_text(settings.defaults.asr_model) or settings.defaults.asr_model
        slot = alias_to_slot.get(current_model_id)
        if slot is None:
            if current_model_id not in self.runtime.asr_model_ids.values():
                settings.defaults.asr_model = self.runtime.asr_model_ids["default"]
            else:
                settings.defaults.asr_model = current_model_id
            return settings

        settings.defaults.asr_model = self.runtime.asr_model_ids.get(slot, self.runtime.asr_model_ids["default"])
        return settings

    def load(self) -> ChatSettingsInput:
        if not self.path.exists():
            return self.default_settings()

        payload = json.loads(self.path.read_text(encoding="utf-8"))
        settings = ChatSettingsInput.model_validate(payload)
        return self._normalize_runtime_models(settings)

    def save(self, settings: ChatSettingsInput) -> ChatSettingsInput:
        settings = self._normalize_runtime_models(settings)
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
        defaults = settings.defaults.model_copy(deep=True)
        defaults.reply_voice.clone_audio_path = None
        defaults.reply_voice.clone_embedding_path = None
        response = ChatSettingsResponse(
            defaults=defaults,
            openai_compatible=self._redact_provider(settings.openai_compatible),
            gemini=self._redact_provider(settings.gemini),
            anthropic=self._redact_provider(settings.anthropic),
        )
        return brand_chat_settings_response(response)

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
