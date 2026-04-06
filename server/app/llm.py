from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx

from .constants import (
    DEFAULT_ANTHROPIC_BASE_URL,
    DEFAULT_GEMINI_BASE_URL,
    DEFAULT_OPENAI_BASE_URL,
)
from .schemas import (
    ChatSettingsInput,
    OpenAICompatMode,
    ProviderId,
    ProviderSettingsInput,
    ProviderTestResponse,
)


class ProviderConfigError(ValueError):
    pass


def join_url(base_url: str | None, path: str) -> str:
    base = (base_url or "").rstrip("/")
    suffix = path if path.startswith("/") else f"/{path}"
    return f"{base}{suffix}"


async def iter_sse_events(response: httpx.Response) -> AsyncIterator[dict[str, Any]]:
    event_name: str | None = None
    data_lines: list[str] = []

    async for line in response.aiter_lines():
        if line == "":
            if not data_lines:
                event_name = None
                continue
            payload = "\n".join(data_lines)
            data_lines = []
            if payload == "[DONE]":
                break
            try:
                event = json.loads(payload)
            except json.JSONDecodeError:
                event = {"raw": payload}
            if event_name and isinstance(event, dict):
                event.setdefault("event", event_name)
            yield event
            event_name = None
            continue

        if line.startswith("event:"):
            event_name = line.partition(":")[2].strip()
        elif line.startswith("data:"):
            data_lines.append(line.partition(":")[2].strip())

    if data_lines:
        payload = "\n".join(data_lines)
        if payload != "[DONE]":
            try:
                yield json.loads(payload)
            except json.JSONDecodeError:
                yield {"raw": payload}


class ProviderService:
    def __init__(self, timeout: float = 60.0) -> None:
        self.timeout = timeout

    def resolve_provider_settings(
        self, settings: ChatSettingsInput, provider: ProviderId
    ) -> ProviderSettingsInput:
        return getattr(settings, provider)

    async def test_provider(
        self, provider: ProviderId, config: ProviderSettingsInput
    ) -> ProviderTestResponse:
        started = time.perf_counter()
        try:
            self._ensure_common_config(config)

            if provider == "openai_compatible":
                resolved = await self._test_openai_compatible(config)
            elif provider == "gemini":
                resolved = await self._test_gemini(config)
            else:
                resolved = await self._test_anthropic(config)

            return ProviderTestResponse(
                success=True,
                provider=provider,
                resolved_model=config.model,
                latency_ms=int((time.perf_counter() - started) * 1000),
                streaming_supported=True,
                api_mode=resolved,
            )
        except Exception as exc:
            return ProviderTestResponse(
                success=False,
                provider=provider,
                resolved_model=config.model or None,
                latency_ms=int((time.perf_counter() - started) * 1000),
                streaming_supported=False,
                error=str(exc),
            )

    async def stream_reply(
        self,
        *,
        settings: ChatSettingsInput,
        messages: list[dict[str, str]],
        cancel_event,
    ) -> AsyncIterator[str]:
        provider = settings.defaults.active_provider
        config = self.resolve_provider_settings(settings, provider)
        self._ensure_common_config(config)

        if provider == "openai_compatible":
            async for delta in self._stream_openai_compatible(settings, messages, cancel_event):
                yield delta
            return

        if provider == "gemini":
            async for delta in self._stream_gemini(settings, messages, cancel_event):
                yield delta
            return

        async for delta in self._stream_anthropic(settings, messages, cancel_event):
            yield delta

    def _ensure_common_config(self, config: ProviderSettingsInput) -> None:
        if not config.model:
            raise ProviderConfigError("Model name is required.")
        if not config.api_key:
            raise ProviderConfigError("API key is required.")

    @asynccontextmanager
    async def _client(self) -> AsyncIterator[httpx.AsyncClient]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            yield client

    async def _test_openai_compatible(
        self, config: ProviderSettingsInput
    ) -> OpenAICompatMode:
        base_url = config.base_url or DEFAULT_OPENAI_BASE_URL
        async with self._client() as client:
            response = await client.post(
                join_url(base_url, "/responses"),
                headers={"Authorization": f"Bearer {config.api_key}"},
                json={"model": config.model, "input": "Reply with OK only.", "max_output_tokens": 8},
            )
            if response.is_success:
                return "responses"

            fallback = await client.post(
                join_url(base_url, "/chat/completions"),
                headers={"Authorization": f"Bearer {config.api_key}"},
                json={
                    "model": config.model,
                    "messages": [{"role": "user", "content": "Reply with OK only."}],
                    "max_tokens": 8,
                },
            )
            if fallback.is_success:
                return "chat_completions"

        detail = self._response_error(response)
        fallback_detail = self._response_error(fallback)
        raise ProviderConfigError(f"OpenAI-compatible test failed. {detail} {fallback_detail}".strip())

    async def _stream_openai_compatible(
        self,
        settings: ChatSettingsInput,
        messages: list[dict[str, str]],
        cancel_event,
    ) -> AsyncIterator[str]:
        config = settings.openai_compatible
        base_url = config.base_url or DEFAULT_OPENAI_BASE_URL
        api_mode = config.api_mode or "responses"
        headers = {"Authorization": f"Bearer {config.api_key}"}

        async with self._client() as client:
            if api_mode == "responses":
                payload = {
                    "model": config.model,
                    "input": self._messages_to_openai_responses(messages),
                    "temperature": settings.defaults.temperature,
                    "max_output_tokens": settings.defaults.max_output_tokens,
                    "stream": True,
                }
                async with client.stream(
                    "POST",
                    join_url(base_url, "/responses"),
                    headers=headers,
                    json=payload,
                ) as response:
                    if not response.is_success:
                        raise ProviderConfigError(self._response_error(response))
                    async for event in iter_sse_events(response):
                        if cancel_event.is_set():
                            break
                        delta = event.get("delta")
                        if event.get("type") == "response.output_text.delta" and isinstance(delta, str):
                            yield delta
            else:
                payload = {
                    "model": config.model,
                    "messages": messages,
                    "temperature": settings.defaults.temperature,
                    "max_tokens": settings.defaults.max_output_tokens,
                    "stream": True,
                }
                async with client.stream(
                    "POST",
                    join_url(base_url, "/chat/completions"),
                    headers=headers,
                    json=payload,
                ) as response:
                    if not response.is_success:
                        raise ProviderConfigError(self._response_error(response))
                    async for event in iter_sse_events(response):
                        if cancel_event.is_set():
                            break
                        choices = event.get("choices", [])
                        if not choices:
                            continue
                        delta = choices[0].get("delta", {})
                        content = delta.get("content")
                        if isinstance(content, str):
                            yield content

    async def _test_gemini(self, config: ProviderSettingsInput) -> OpenAICompatMode | None:
        base_url = config.base_url or DEFAULT_GEMINI_BASE_URL
        async with self._client() as client:
            response = await client.post(
                join_url(base_url, f"/v1beta/models/{config.model}:generateContent"),
                headers={"x-goog-api-key": config.api_key, "Content-Type": "application/json"},
                json={"contents": [{"role": "user", "parts": [{"text": "Reply with OK only."}]}]},
            )
            if not response.is_success:
                raise ProviderConfigError(self._response_error(response))
        return None

    async def _stream_gemini(
        self,
        settings: ChatSettingsInput,
        messages: list[dict[str, str]],
        cancel_event,
    ) -> AsyncIterator[str]:
        config = settings.gemini
        base_url = config.base_url or DEFAULT_GEMINI_BASE_URL
        payload = {
            "contents": self._messages_to_gemini_contents(messages),
            "generationConfig": {
                "temperature": settings.defaults.temperature,
                "maxOutputTokens": settings.defaults.max_output_tokens,
            },
        }
        system_message = next((message["content"] for message in messages if message["role"] == "system"), "")
        if system_message:
            payload["systemInstruction"] = {"parts": [{"text": system_message}]}

        async with self._client() as client:
            async with client.stream(
                "POST",
                join_url(base_url, f"/v1beta/models/{config.model}:streamGenerateContent?alt=sse"),
                headers={"x-goog-api-key": config.api_key, "Content-Type": "application/json"},
                json=payload,
            ) as response:
                if not response.is_success:
                    raise ProviderConfigError(self._response_error(response))
                async for event in iter_sse_events(response):
                    if cancel_event.is_set():
                        break
                    for candidate in event.get("candidates", []):
                        for part in candidate.get("content", {}).get("parts", []):
                            text = part.get("text")
                            if isinstance(text, str) and text:
                                yield text

    async def _test_anthropic(
        self, config: ProviderSettingsInput
    ) -> OpenAICompatMode | None:
        base_url = config.base_url or DEFAULT_ANTHROPIC_BASE_URL
        async with self._client() as client:
            response = await client.post(
                join_url(base_url, "/v1/messages"),
                headers={
                    "x-api-key": config.api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": config.model,
                    "max_tokens": 8,
                    "messages": [{"role": "user", "content": "Reply with OK only."}],
                },
            )
            if not response.is_success:
                raise ProviderConfigError(self._response_error(response))
        return None

    async def _stream_anthropic(
        self,
        settings: ChatSettingsInput,
        messages: list[dict[str, str]],
        cancel_event,
    ) -> AsyncIterator[str]:
        config = settings.anthropic
        base_url = config.base_url or DEFAULT_ANTHROPIC_BASE_URL
        system_prompt = next(
            (message["content"] for message in messages if message["role"] == "system"), ""
        )
        payload = {
            "model": config.model,
            "max_tokens": settings.defaults.max_output_tokens,
            "temperature": settings.defaults.temperature,
            "stream": True,
            "messages": [
                {"role": "assistant" if message["role"] == "assistant" else "user", "content": message["content"]}
                for message in messages
                if message["role"] != "system"
            ],
        }
        if system_prompt:
            payload["system"] = system_prompt

        async with self._client() as client:
            async with client.stream(
                "POST",
                join_url(base_url, "/v1/messages"),
                headers={
                    "x-api-key": config.api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json=payload,
            ) as response:
                if not response.is_success:
                    raise ProviderConfigError(self._response_error(response))
                async for event in iter_sse_events(response):
                    if cancel_event.is_set():
                        break
                    if event.get("type") == "content_block_delta":
                        text = event.get("delta", {}).get("text")
                        if isinstance(text, str):
                            yield text

    def _messages_to_openai_responses(self, messages: list[dict[str, str]]) -> list[dict[str, Any]]:
        formatted: list[dict[str, Any]] = []
        for message in messages:
            formatted.append(
                {
                    "role": message["role"],
                    "content": [{"type": "input_text", "text": message["content"]}],
                }
            )
        return formatted

    def _messages_to_gemini_contents(self, messages: list[dict[str, str]]) -> list[dict[str, Any]]:
        contents: list[dict[str, Any]] = []
        for message in messages:
            if message["role"] == "system":
                continue
            role = "model" if message["role"] == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": message["content"]}]})
        return contents

    def _response_error(self, response: httpx.Response) -> str:
        try:
            payload = response.json()
        except Exception:
            return f"{response.status_code} {response.text}".strip()

        if isinstance(payload, dict):
            if isinstance(payload.get("error"), dict):
                message = payload["error"].get("message")
                if message:
                    return f"{response.status_code} {message}"
            if payload.get("error"):
                return f"{response.status_code} {payload['error']}"
            if payload.get("message"):
                return f"{response.status_code} {payload['message']}"

        return f"{response.status_code} {response.text}".strip()
