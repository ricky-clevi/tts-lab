from __future__ import annotations

import asyncio
import base64
import re
import threading
import time
from collections.abc import AsyncIterator, Iterator
from typing import Any
from uuid import uuid4

import numpy as np
from fastapi import WebSocket

from .branding import brand_chat_settings_response, unbrand_chat_settings_input
from .chat_store import ChatSettingsStore
from .constants import CONVERSATION_SAMPLE_RATE, PARTIAL_TRANSCRIPTION_MIN_SECONDS
from .llm import ProviderService
from .model_manager import AsrModelManager, TtsModelManager
from .schemas import (
    BaseGenerationRequest,
    ChatSettingsInput,
    CustomGenerationRequest,
    DesignGenerationRequest,
)
from .style import compose_instruction
from .storage import AudioStorage

SENTINEL = object()
SENTENCE_PATTERN = re.compile(r"(.+?(?:[.!?](?=\s|$)|\n\n))", re.DOTALL)
MARKDOWN_FENCE_PATTERN = re.compile(r"```[\s\S]*?```", re.DOTALL)
MARKDOWN_INLINE_CODE_PATTERN = re.compile(r"`{1,3}([^`]+?)`{1,3}")
MARKDOWN_LINK_PATTERN = re.compile(r"!\[([^\]]*)\]\(([^)]*)\)|\[([^\]]+)\]\(([^)]*)\)")
MARKDOWN_EMPHASIS_PATTERNS = (
    re.compile(r"(?<!\*)\*\*([^*]+?)\*\*(?!\*)"),
    re.compile(r"(?<!_)__([^_]+?)__(?!_)"),
    re.compile(r"(?<!\*)\*([^*\n]+?)\*(?!\*)"),
    re.compile(r"(?<!_)_([^_\n]+?)_(?!_)"),
)
MARKDOWN_LIST_PREFIX_PATTERN = re.compile(r"^\s{0,3}(?:[-+*]|\d+[.)])\s+")
MARKDOWN_HEADING_PREFIX_PATTERN = re.compile(r"^\s{0,3}#{1,6}\s*")
MARKDOWN_BLOCKQUOTE_PREFIX_PATTERN = re.compile(r"^\s{0,3}>\s?")
MARKDOWN_HRULE_PATTERN = re.compile(r"(?<!\w)(?:-{3,}|[*_]{3,})(?!\w)")
MARKDOWN_BRACKET_PATTERN = re.compile(r"\[([^\[\]]+)\]")
MARKDOWN_ESCAPE_PATTERN = re.compile(r"\\([`*_{}\[\]()#+\-.!])")


def decode_pcm16_base64(payload: str) -> np.ndarray:
    raw = base64.b64decode(payload.encode("ascii"))
    pcm = np.frombuffer(raw, dtype=np.int16)
    return (pcm.astype(np.float32) / 32768.0).reshape(-1)


async def iterate_sync_generator(
    generator_factory,
    cancel_event: asyncio.Event,
) -> AsyncIterator[dict[str, Any]]:
    queue: asyncio.Queue[object] = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def producer() -> None:
        try:
            for item in generator_factory():
                if cancel_event.is_set():
                    break
                asyncio.run_coroutine_threadsafe(queue.put(item), loop).result()
        except Exception as exc:  # pragma: no cover - exercised via runtime failures
            asyncio.run_coroutine_threadsafe(queue.put(exc), loop).result()
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(SENTINEL), loop).result()

    thread = threading.Thread(target=producer, daemon=True)
    thread.start()

    while True:
        item = await queue.get()
        if item is SENTINEL:
            break
        if isinstance(item, Exception):
            raise item
        yield item  # type: ignore[misc]


def split_complete_sentences(buffer: str) -> tuple[list[str], str]:
    ready: list[str] = []
    remaining = buffer

    while True:
        match = SENTENCE_PATTERN.match(remaining.lstrip())
        if not match:
            break
        sentence = match.group(1).strip()
        if sentence:
            ready.append(sentence)
        remaining = remaining.lstrip()[match.end() :].lstrip()

    return ready, remaining


def strip_markdown_for_speech(text: str) -> str:
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not cleaned:
        return ""

    cleaned = MARKDOWN_FENCE_PATTERN.sub("\n\n", cleaned)
    cleaned = MARKDOWN_HRULE_PATTERN.sub(". ", cleaned)

    def replace_link(match: re.Match[str]) -> str:
        image_alt = match.group(1)
        link_label = match.group(3)
        return (image_alt or link_label or "").strip()

    cleaned = MARKDOWN_LINK_PATTERN.sub(replace_link, cleaned)
    cleaned = MARKDOWN_INLINE_CODE_PATTERN.sub(r"\1", cleaned)
    for pattern in MARKDOWN_EMPHASIS_PATTERNS:
        cleaned = pattern.sub(r"\1", cleaned)
    cleaned = MARKDOWN_ESCAPE_PATTERN.sub(r"\1", cleaned)
    cleaned = MARKDOWN_BRACKET_PATTERN.sub(r"\1", cleaned)

    normalized_lines: list[str] = []
    for raw_line in cleaned.splitlines():
        line = raw_line.strip()
        if not line:
            normalized_lines.append("")
            continue
        line = MARKDOWN_HEADING_PREFIX_PATTERN.sub("", line)
        line = MARKDOWN_BLOCKQUOTE_PREFIX_PATTERN.sub("", line)
        line = MARKDOWN_LIST_PREFIX_PATTERN.sub("", line)
        line = line.strip(" -*#>")
        if line:
            normalized_lines.append(line)

    cleaned = "\n".join(normalized_lines)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"\s+([,.;!?])", r"\1", cleaned)
    return cleaned.strip()


class ConversationSession:
    def __init__(
        self,
        *,
        websocket: WebSocket,
        tts_manager: TtsModelManager,
        asr_manager: AsrModelManager,
        audio_storage: AudioStorage,
        settings_store: ChatSettingsStore,
        provider_service: ProviderService,
    ) -> None:
        self.websocket = websocket
        self.tts_manager = tts_manager
        self.asr_manager = asr_manager
        self.audio_storage = audio_storage
        self.settings_store = settings_store
        self.provider_service = provider_service
        self.send_lock = asyncio.Lock()
        self.settings = settings_store.load()
        self.messages: list[dict[str, str]] = [
            {"role": "system", "content": self.settings.defaults.system_prompt}
        ]
        self.audio_chunks: list[np.ndarray] = []
        self.audio_sample_rate = CONVERSATION_SAMPLE_RATE
        self.partial_task: asyncio.Task[None] | None = None
        self.assistant_task: asyncio.Task[None] | None = None
        self.cancel_event = asyncio.Event()
        self.last_partial_text = ""
        self.last_partial_buffer_seconds = 0.0
        self.tts_segment_index = 0
        self.clone_warmup_task: asyncio.Task[None] | None = None

    async def send(self, payload: dict[str, Any]) -> None:
        async with self.send_lock:
            await self.websocket.send_json(payload)

    async def on_connect(self) -> None:
        await self.send(
            {
                "type": "session.ready",
                "settings": brand_chat_settings_response(
                    self.settings_store.redact(self.settings)
                ).model_dump(mode="json"),
            }
        )
        self._schedule_clone_warmup()

    def configure(self, payload: dict[str, Any]) -> None:
        settings_payload = payload.get("settings")
        if settings_payload is None:
            return
        incoming = unbrand_chat_settings_input(ChatSettingsInput.model_validate(settings_payload))
        self.settings = self.settings_store.merge_preserving_secrets(incoming)
        self.messages = [{"role": "system", "content": self.settings.defaults.system_prompt}] + [
            message for message in self.messages if message["role"] != "system"
        ]
        self._schedule_clone_warmup()

    async def append_audio(self, payload: dict[str, Any]) -> None:
        if self.assistant_task and not self.assistant_task.done():
            return

        pcm16_base64 = str(payload.get("pcm16_base64", ""))
        if not pcm16_base64:
            return

        sample_rate = int(payload.get("sample_rate") or CONVERSATION_SAMPLE_RATE)
        chunk = decode_pcm16_base64(pcm16_base64)
        if chunk.size == 0:
            return

        self.audio_sample_rate = sample_rate
        self.audio_chunks.append(chunk)

        if not self.settings.defaults.live_captions:
            return

        buffered_seconds = self.current_buffer_seconds
        if buffered_seconds < PARTIAL_TRANSCRIPTION_MIN_SECONDS:
            return
        if buffered_seconds - self.last_partial_buffer_seconds < 0.7:
            return
        if self.partial_task and not self.partial_task.done():
            return

        snapshot = self.snapshot_audio()
        self.last_partial_buffer_seconds = buffered_seconds
        self.partial_task = asyncio.create_task(self._emit_partial_transcript(snapshot))

    async def commit_audio_turn(self) -> None:
        await self.stop_assistant(send_status=False)
        snapshot = self.snapshot_audio()
        if snapshot.size == 0:
            return

        if self.partial_task and not self.partial_task.done():
            self.partial_task.cancel()
            self.partial_task = None

        self.audio_chunks = []
        self.last_partial_text = ""
        self.last_partial_buffer_seconds = 0.0
        await self.send({"type": "llm.status", "phase": "transcribing"})

        try:
            result = await asyncio.to_thread(
                self.asr_manager.transcribe_array,
                audio=snapshot,
                source_rate=self.audio_sample_rate,
                model_id=self.settings.defaults.asr_model,
                language=self.settings.defaults.asr_language,
            )
        except Exception as exc:
            await self.send({"type": "error", "detail": str(exc)})
            await self.send({"type": "llm.status", "phase": "listening"})
            return
        if not result.text:
            await self.send({"type": "error", "detail": "The ASR model returned no transcript."})
            await self.send({"type": "llm.status", "phase": "listening"})
            return

        self.messages.append({"role": "user", "content": result.text})
        await self.send(
            {
                "type": "asr.final",
                "text": result.text,
                "language": result.language,
                "duration_seconds": result.duration_seconds,
            }
        )
        self.assistant_task = asyncio.create_task(self._run_assistant())

    async def submit_text(self, text: str) -> None:
        cleaned = text.strip()
        if not cleaned:
            return
        await self.stop_assistant(send_status=False)
        self.messages.append({"role": "user", "content": cleaned})
        self.assistant_task = asyncio.create_task(self._run_assistant())

    async def stop_assistant(self, *, send_status: bool = True) -> None:
        self.cancel_event.set()
        task = self.assistant_task
        self.assistant_task = None
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        self.cancel_event = asyncio.Event()
        if send_status:
            await self.send({"type": "llm.status", "phase": "listening"})

    async def close(self) -> None:
        await self.stop_assistant(send_status=False)
        if self.partial_task and not self.partial_task.done():
            self.partial_task.cancel()
            try:
                await self.partial_task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        if self.clone_warmup_task and not self.clone_warmup_task.done():
            self.clone_warmup_task.cancel()
            try:
                await self.clone_warmup_task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass

    async def _send_perf_metric(
        self,
        *,
        name: str,
        value_ms: float,
        segment_index: int | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        if not self.settings.defaults.reply_voice.emit_perf_metrics:
            return

        payload: dict[str, Any] = {
            "type": "perf.metric",
            "name": name,
            "value_ms": round(float(value_ms), 2),
        }
        if segment_index is not None:
            payload["segment_index"] = int(segment_index)
        if meta:
            payload["meta"] = meta
        await self.send(payload)

    def _schedule_clone_warmup(self) -> None:
        reply_voice = self.settings.defaults.reply_voice
        if (
            reply_voice.mode != "clone"
            or not reply_voice.warmup_on_connect
            or not reply_voice.clone_audio_path
            or not reply_voice.clone_reference_text
        ):
            return
        if self.clone_warmup_task and not self.clone_warmup_task.done():
            return
        self.clone_warmup_task = asyncio.create_task(self._warmup_clone_reply_voice())

    async def _warmup_clone_reply_voice(self) -> None:
        reply_voice = self.settings.defaults.reply_voice
        if not reply_voice.clone_audio_path and not reply_voice.clone_embedding_path:
            return
        started_at = time.monotonic()
        try:
            await asyncio.to_thread(
                self.tts_manager.warm_clone_runtime,
                speaker_embedding_path=reply_voice.clone_embedding_path,
                ref_audio_path=reply_voice.clone_audio_path,
                ref_text=reply_voice.clone_reference_text,
            )
            await self._send_perf_metric(
                name="clone_warmup_ms",
                value_ms=(time.monotonic() - started_at) * 1000.0,
            )
        except Exception:
            # Warmup is opportunistic; failures should not block chat.
            return

    @property
    def current_buffer_seconds(self) -> float:
        if not self.audio_chunks:
            return 0.0
        total_samples = sum(chunk.shape[0] for chunk in self.audio_chunks)
        return total_samples / max(self.audio_sample_rate, 1)

    def snapshot_audio(self) -> np.ndarray:
        if not self.audio_chunks:
            return np.zeros(0, dtype=np.float32)
        return np.concatenate(self.audio_chunks).astype(np.float32)

    async def _emit_partial_transcript(self, snapshot: np.ndarray) -> None:
        try:
            result = await asyncio.to_thread(
                self.asr_manager.transcribe_array,
                audio=snapshot,
                source_rate=self.audio_sample_rate,
                model_id=self.settings.defaults.asr_model,
                language=self.settings.defaults.asr_language,
            )
        except Exception as exc:
            await self.send({"type": "error", "detail": str(exc)})
            return

        if result.text and result.text != self.last_partial_text:
            self.last_partial_text = result.text
            await self.send(
                {
                    "type": "asr.partial",
                    "text": result.text,
                    "language": result.language,
                    "duration_seconds": result.duration_seconds,
                }
            )

    async def _run_assistant(self) -> None:
        self.cancel_event = asyncio.Event()
        await self.send({"type": "llm.status", "phase": "thinking"})
        assistant_text = ""
        draft_buffer = ""
        block_queue: asyncio.Queue[str | None] = asyncio.Queue()
        tts_worker = asyncio.create_task(self._run_tts_queue(block_queue, self.cancel_event))
        run_started_at = time.monotonic()
        first_delta_sent = False
        first_block_queued = False

        reply_voice = self.settings.defaults.reply_voice
        max_sentences = max(1, int(reply_voice.block_max_sentences))
        max_chars = max(80, int(reply_voice.block_max_chars))
        hold_seconds = max(0.0, float(reply_voice.block_hold_ms) / 1000.0)
        if reply_voice.runtime_mode == "quality":
            max_sentences = 1
            hold_seconds = 0.0
        pending_sentences: list[str] = []
        hold_flush_task: asyncio.Task[None] | None = None

        def pop_block(force: bool) -> str | None:
            if not pending_sentences:
                return None
            if not force:
                joined = " ".join(pending_sentences[:max_sentences]).strip()
                if len(pending_sentences) < max_sentences and len(joined) < max_chars:
                    return None

            chosen: list[str] = []
            chars = 0
            while pending_sentences and len(chosen) < max_sentences:
                candidate = pending_sentences[0].strip()
                if not candidate:
                    pending_sentences.pop(0)
                    continue
                projected = chars + len(candidate) + (1 if chosen else 0)
                if chosen and projected > max_chars:
                    break
                pending_sentences.pop(0)
                chosen.append(candidate)
                chars = projected

            if not chosen and pending_sentences:
                chosen.append(pending_sentences.pop(0).strip())
            block = " ".join(part for part in chosen if part).strip()
            return block or None

        async def push_block(block: str) -> None:
            nonlocal first_block_queued
            await block_queue.put(block)
            if not first_block_queued:
                first_block_queued = True
                await self._send_perf_metric(
                    name="llm_first_block_queued_ms",
                    value_ms=(time.monotonic() - run_started_at) * 1000.0,
                )

        async def flush_blocks(force: bool) -> None:
            while True:
                block = pop_block(force=force)
                if not block:
                    break
                await push_block(block)

        async def hold_flush() -> None:
            try:
                await asyncio.sleep(hold_seconds)
            except asyncio.CancelledError:
                return
            if self.cancel_event.is_set():
                return
            block = pop_block(force=True)
            if block:
                await push_block(block)

        try:
            async for delta in self.provider_service.stream_reply(
                settings=self.settings,
                messages=self.messages,
                cancel_event=self.cancel_event,
            ):
                if self.cancel_event.is_set():
                    break
                assistant_text += delta
                draft_buffer += delta
                await self.send({"type": "llm.delta", "delta": delta, "text": assistant_text})
                if not first_delta_sent:
                    first_delta_sent = True
                    await self._send_perf_metric(
                        name="llm_first_delta_ms",
                        value_ms=(time.monotonic() - run_started_at) * 1000.0,
                    )
                ready_sentences, draft_buffer = split_complete_sentences(draft_buffer)
                for sentence in ready_sentences:
                    speech_sentence = strip_markdown_for_speech(sentence)
                    if not speech_sentence:
                        continue
                    await self.send({"type": "llm.sentence", "text": speech_sentence})
                    pending_sentences.append(speech_sentence)
                    await flush_blocks(force=False)
                    if pending_sentences and hold_seconds > 0:
                        if hold_flush_task and not hold_flush_task.done():
                            hold_flush_task.cancel()
                        hold_flush_task = asyncio.create_task(hold_flush())
                    elif pending_sentences:
                        await flush_blocks(force=True)

            trailing = draft_buffer.strip()
            if trailing and not self.cancel_event.is_set():
                speech_trailing = strip_markdown_for_speech(trailing)
                if speech_trailing:
                    await self.send({"type": "llm.sentence", "text": speech_trailing})
                    pending_sentences.append(speech_trailing)
        except asyncio.CancelledError:
            self.cancel_event.set()
        except Exception as exc:
            await self.send({"type": "error", "detail": str(exc)})
        finally:
            if hold_flush_task and not hold_flush_task.done():
                hold_flush_task.cancel()
                try:
                    await hold_flush_task
                except asyncio.CancelledError:
                    pass
            await flush_blocks(force=True)
            await block_queue.put(None)
            try:
                await tts_worker
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                await self.send({"type": "error", "detail": str(exc)})

        if assistant_text and not self.cancel_event.is_set():
            self.messages.append({"role": "assistant", "content": assistant_text})
            await self.send({"type": "assistant.complete", "text": assistant_text})
        await self.send({"type": "llm.status", "phase": "listening"})

    async def _run_tts_queue(
        self, block_queue: asyncio.Queue[str | None], cancel_event: asyncio.Event
    ) -> None:
        first_chunk_reported = False
        while True:
            block = await block_queue.get()
            if block is None or cancel_event.is_set():
                break
            block = strip_markdown_for_speech(block)
            if not block:
                continue

            await self.send({"type": "llm.status", "phase": "speaking"})
            segment_index = self.tts_segment_index
            self.tts_segment_index += 1
            segment_started_at = time.monotonic()

            reply_voice = self.settings.defaults.reply_voice
            if reply_voice.mode == "custom":
                request = CustomGenerationRequest(
                    segments=[block],
                    language=reply_voice.language,
                    speaker=reply_voice.speaker,
                    instruct=compose_instruction(
                        reply_voice.instruct,
                        reply_voice.style,
                        reply_voice.mode,
                    )
                    or None,
                )
                stream_factory = lambda: self.tts_manager.stream_custom(request)
            elif reply_voice.mode == "design":
                request = DesignGenerationRequest(
                    segments=[block],
                    language=reply_voice.language,
                    instruct=compose_instruction(
                        reply_voice.instruct or "Speak clearly and naturally.",
                        reply_voice.style,
                        reply_voice.mode,
                    ),
                )
                stream_factory = lambda: self.tts_manager.stream_design(request)
            else:
                request = BaseGenerationRequest(
                    segments=[block],
                    language=reply_voice.language,
                )
                # Use the prepared reference clip directly for realtime clone
                # replies so identity/prosody stay closer to the target voice.
                # The clone profile builder now shortens long uploads into a
                # compact prompt clip, which keeps this path practical.
                if reply_voice.clone_audio_path and reply_voice.clone_reference_text:
                    stream_factory = lambda: self.tts_manager.stream_clone(
                        payload=request,
                        ref_audio_path=reply_voice.clone_audio_path,
                        ref_text=reply_voice.clone_reference_text,
                        x_vector_only_mode=False,
                    )
                elif reply_voice.clone_embedding_path and reply_voice.clone_reference_text:
                    stream_factory = lambda: self.tts_manager.stream_clone_cached(
                        payload=request,
                        speaker_embedding_path=reply_voice.clone_embedding_path,
                        ref_text=reply_voice.clone_reference_text,
                    )
                else:
                    await self.send(
                        {
                            "type": "error",
                            "detail": "Reply voice clone is not prepared yet. Upload and prepare a cloned reply voice first.",
                        }
                    )
                    continue

            await self.send(
                {
                    "type": "tts.segment_start",
                    "segment_index": segment_index,
                    "text": block,
                }
            )

            collected: list[np.ndarray] = []
            sample_rate = 0
            chunk_count = 0
            async for item in iterate_sync_generator(stream_factory, cancel_event):
                if cancel_event.is_set():
                    break
                wav = np.asarray(item["audio"], dtype=np.float32)
                sample_rate = int(item["sample_rate"])
                collected.append(wav)
                chunk_count += 1
                if not first_chunk_reported:
                    first_chunk_reported = True
                    await self._send_perf_metric(
                        name="tts_first_chunk_ms",
                        value_ms=(time.monotonic() - segment_started_at) * 1000.0,
                        segment_index=segment_index,
                    )
                await self.send(
                    {
                        "type": "tts.audio_chunk",
                        "segment_index": segment_index,
                        "sample_rate": sample_rate,
                        "duration_seconds": round(float(len(wav) / sample_rate), 3)
                        if sample_rate
                        else 0.0,
                        "pcm16_base64": self._encode_pcm16_base64(wav),
                        "is_final_chunk": bool(item["is_final_chunk"]),
                    }
                )

            if cancel_event.is_set() or not collected:
                continue

            clip = self.audio_storage.save_clip(
                wav=np.concatenate(collected),
                sample_rate=sample_rate,
                segment_index=segment_index,
                text=block,
                language=reply_voice.language,
                speaker=reply_voice.speaker
                if reply_voice.mode == "custom"
                else reply_voice.clone_profile_label if reply_voice.mode == "clone" else None,
                instruct=reply_voice.clone_reference_text
                if reply_voice.mode == "clone"
                else compose_instruction(
                    reply_voice.instruct,
                    reply_voice.style,
                    reply_voice.mode,
                )
                or None,
            )
            await self._send_perf_metric(
                name="tts_segment_total_ms",
                value_ms=(time.monotonic() - segment_started_at) * 1000.0,
                segment_index=segment_index,
                meta={"chunk_count": chunk_count},
            )
            await self.send(
                {
                    "type": "tts.segment_complete",
                    "segment_index": segment_index,
                    "clip": clip.model_dump(mode="json"),
                }
            )

    def _encode_pcm16_base64(self, wav: np.ndarray) -> str:
        normalized = np.clip(np.asarray(wav, dtype=np.float32), -1.0, 1.0)
        pcm16 = (normalized * 32767.0).astype(np.int16)
        return base64.b64encode(pcm16.tobytes()).decode("ascii")
