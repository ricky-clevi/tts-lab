from __future__ import annotations

import asyncio
import base64
import re
import threading
from collections.abc import AsyncIterator, Iterator
from typing import Any
from uuid import uuid4

import numpy as np
from fastapi import WebSocket

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

    async def send(self, payload: dict[str, Any]) -> None:
        async with self.send_lock:
            await self.websocket.send_json(payload)

    async def on_connect(self) -> None:
        await self.send(
            {
                "type": "session.ready",
                "settings": self.settings_store.redact(self.settings).model_dump(mode="json"),
            }
        )

    def configure(self, payload: dict[str, Any]) -> None:
        settings_payload = payload.get("settings")
        if settings_payload is None:
            return
        incoming = ChatSettingsInput.model_validate(settings_payload)
        self.settings = self.settings_store.merge_preserving_secrets(incoming)
        self.messages = [{"role": "system", "content": self.settings.defaults.system_prompt}] + [
            message for message in self.messages if message["role"] != "system"
        ]

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
        sentence_queue: asyncio.Queue[str | None] = asyncio.Queue()
        tts_worker = asyncio.create_task(self._run_tts_queue(sentence_queue, self.cancel_event))

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
                ready_sentences, draft_buffer = split_complete_sentences(draft_buffer)
                for sentence in ready_sentences:
                    await self.send({"type": "llm.sentence", "text": sentence})
                    await sentence_queue.put(sentence)

            trailing = draft_buffer.strip()
            if trailing and not self.cancel_event.is_set():
                await self.send({"type": "llm.sentence", "text": trailing})
                await sentence_queue.put(trailing)
        except asyncio.CancelledError:
            self.cancel_event.set()
        except Exception as exc:
            await self.send({"type": "error", "detail": str(exc)})
        finally:
            await sentence_queue.put(None)
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
        self, sentence_queue: asyncio.Queue[str | None], cancel_event: asyncio.Event
    ) -> None:
        while True:
            sentence = await sentence_queue.get()
            if sentence is None or cancel_event.is_set():
                break

            await self.send({"type": "llm.status", "phase": "speaking"})
            segment_index = self.tts_segment_index
            self.tts_segment_index += 1

            reply_voice = self.settings.defaults.reply_voice
            if reply_voice.mode == "custom":
                request = CustomGenerationRequest(
                    segments=[sentence],
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
                    segments=[sentence],
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
                    segments=[sentence],
                    language=reply_voice.language,
                )
                if reply_voice.clone_embedding_path:
                    stream_factory = lambda: self.tts_manager.stream_clone_cached(
                        payload=request,
                        speaker_embedding_path=reply_voice.clone_embedding_path,
                    )
                else:
                    if not reply_voice.clone_audio_path or not reply_voice.clone_reference_text:
                        await self.send(
                            {
                                "type": "error",
                                "detail": "Reply voice clone is not prepared yet. Upload and prepare a cloned reply voice first.",
                            }
                        )
                        continue
                    stream_factory = lambda: self.tts_manager.stream_clone(
                        payload=request,
                        ref_audio_path=reply_voice.clone_audio_path,
                        ref_text=reply_voice.clone_reference_text,
                        x_vector_only_mode=False,
                    )

            await self.send(
                {
                    "type": "tts.segment_start",
                    "segment_index": segment_index,
                    "text": sentence,
                }
            )

            collected: list[np.ndarray] = []
            sample_rate = 0
            async for item in iterate_sync_generator(stream_factory, cancel_event):
                if cancel_event.is_set():
                    break
                wav = np.asarray(item["audio"], dtype=np.float32)
                sample_rate = int(item["sample_rate"])
                collected.append(wav)
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
                text=sentence,
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
