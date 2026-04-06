from __future__ import annotations

import gc
import threading
from collections.abc import Iterator
import re
from pathlib import Path
from typing import Any

import numpy as np

from .constants import (
    ASR_MODEL_IDS,
    ASR_MODELS,
    CONVERSATION_SAMPLE_RATE,
    GENERATION_KNOBS,
    LANGUAGES,
    MODE_DESCRIPTIONS,
    MODE_LABELS,
    MODEL_IDS,
    PROVIDER_CAPABILITIES,
    SPEAKERS,
)
from .schemas import (
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
    Mode,
    ModeCapabilityResponse,
    ProviderCapabilityResponse,
    SpeakerResponse,
)


class TtsModelManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._inference_lock = threading.Lock()
        self._clone_embedding_cache: dict[str, np.ndarray] = {}
        self._model: Any | None = None
        self.active_mode: Mode | None = None
        self.active_model_id: str | None = None
        self.selected_device = self._detect_preferred_device()

    def _detect_preferred_device(self) -> str:
        try:
            import mlx.core as mx

            mx.clear_cache()
            return "mlx"
        except Exception:
            return "cpu"

    def _instantiate_model(self, model_id: str) -> tuple[Any, str]:
        from mlx_audio.tts.utils import load_model

        try:
            model = load_model(model_id)
        except Exception as exc:  # pragma: no cover - exercised against real runtime only
            raise RuntimeError(f"Unable to load {model_id} with the MLX runtime.") from exc

        return model, "mlx"

    def _release_current_model(self) -> None:
        if self._model is None:
            return

        self._model = None
        self.active_mode = None
        self.active_model_id = None
        gc.collect()
        try:
            import mlx.core as mx

            mx.clear_cache()
        except Exception:
            pass

    def ensure_mode(self, mode: Mode) -> Any:
        with self._lock:
            if self.active_mode == mode and self._model is not None:
                return self._model

            self._release_current_model()
            model_id = MODEL_IDS[mode]
            model, actual_device = self._instantiate_model(model_id)
            self._model = model
            self.active_mode = mode
            self.active_model_id = model_id
            self.selected_device = actual_device
            return model

    def capabilities(self) -> CapabilitiesResponse:
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
                input_sample_rate=CONVERSATION_SAMPLE_RATE,
                websocket_path="/api/conversation/ws",
            ),
        )

    def _validate_language(self, language: str) -> None:
        if language not in LANGUAGES:
            raise ValueError(f"Unsupported language '{language}'.")

    def _ensure_speaker(self, speaker: str) -> None:
        supported = {item["id"] for item in SPEAKERS}
        if speaker not in supported:
            raise ValueError(f"Unsupported speaker '{speaker}'.")

    def _normalize_language(self, language: str) -> str:
        cleaned = language.strip()
        return "auto" if cleaned.lower() == "auto" else cleaned

    def resolve_clone_language(
        self, requested_language: str, segments: list[str], ref_text: str | None
    ) -> str:
        cleaned = requested_language.strip() or "Auto"
        if cleaned == "Auto":
            return "Auto"

        combined = "\n".join([*segments, ref_text or ""])
        if not combined.strip():
            return cleaned

        has_hangul = bool(re.search(r"[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]", combined))
        has_kana = bool(re.search(r"[\u3040-\u30ff]", combined))
        has_cyrillic = bool(re.search(r"[\u0400-\u04ff]", combined))

        if cleaned == "English" and (has_hangul or has_kana or has_cyrillic):
            return "Auto"
        if cleaned == "Korean" and has_kana:
            return "Auto"
        if cleaned == "Japanese" and has_hangul:
            return "Auto"
        if cleaned == "Russian" and (has_hangul or has_kana):
            return "Auto"

        return cleaned

    def _generation_kwargs(self, generation: Any) -> dict[str, float | int]:
        kwargs: dict[str, float | int] = {}
        if generation.temperature is not None:
            kwargs["temperature"] = generation.temperature
        if generation.top_p is not None:
            kwargs["top_p"] = generation.top_p
        if generation.max_new_tokens is not None:
            kwargs["max_tokens"] = generation.max_new_tokens
        return kwargs

    def _stream_generation_kwargs(
        self, payload: BaseGenerationRequest | CustomGenerationRequest | DesignGenerationRequest
    ) -> dict[str, float | int | bool]:
        return {
            **self._generation_kwargs(payload.generation),
            "stream": True,
            "streaming_interval": payload.streaming_interval,
        }

    def _apply_seed(self, seed: int | None) -> None:
        if seed is None:
            return

        import mlx.core as mx

        mx.random.seed(seed)

    def _collect_audio(self, results: Any) -> tuple[np.ndarray, int]:
        collected = list(results)
        if not collected:
            raise RuntimeError("The model returned no audio.")
        sample_rate = int(collected[0].sample_rate)
        audio_parts = [np.asarray(result.audio, dtype=np.float32).reshape(-1) for result in collected]
        if not audio_parts:
            raise RuntimeError("The model returned no audio.")
        return np.concatenate(audio_parts), sample_rate

    def _iter_stream_results(
        self,
        results: Any,
        *,
        segment_index: int,
        text: str,
        sample_rate: int,
    ) -> Iterator[dict[str, Any]]:
        yielded = False
        for result in results:
            yielded = True
            chunk_sample_rate = int(getattr(result, "sample_rate", sample_rate))
            yield {
                "segment_index": segment_index,
                "text": text,
                "audio": np.asarray(result.audio, dtype=np.float32),
                "sample_rate": chunk_sample_rate,
                "is_final_chunk": bool(getattr(result, "is_final_chunk", False)),
            }

        if not yielded:
            raise RuntimeError("The model returned no audio.")

    def _iter_chunked_audio(
        self,
        wav: np.ndarray,
        *,
        sample_rate: int,
        segment_index: int,
        text: str,
        streaming_interval: float,
    ) -> Iterator[dict[str, Any]]:
        audio = np.asarray(wav, dtype=np.float32).reshape(-1)
        if audio.size == 0:
            raise RuntimeError("The model returned no audio.")

        chunk_size = max(1, int(sample_rate * max(streaming_interval, 0.08)))
        for start in range(0, audio.size, chunk_size):
            end = min(audio.size, start + chunk_size)
            yield {
                "segment_index": segment_index,
                "text": text,
                "audio": audio[start:end],
                "sample_rate": sample_rate,
                "is_final_chunk": end >= audio.size,
            }

    def _supports_cached_clone_embedding(self, model: Any) -> bool:
        return callable(getattr(model, "extract_speaker_embedding", None)) and getattr(
            model, "speaker_encoder", None
        ) is not None

    def _extract_clone_speaker_embedding_unlocked(
        self,
        *,
        model: Any,
        ref_audio_path: str,
    ) -> np.ndarray:
        if not self._supports_cached_clone_embedding(model):
            raise RuntimeError(
                "The local clone model does not expose a reusable speaker embedding API."
            )

        from mlx_audio.utils import load_audio

        audio = load_audio(ref_audio_path, sample_rate=int(model.sample_rate))
        speaker_embedding = model.extract_speaker_embedding(audio, sr=int(model.sample_rate))
        embedding = np.asarray(speaker_embedding, dtype=np.float32)
        if embedding.ndim == 1:
            embedding = embedding.reshape(1, -1)
        return embedding

    def prepare_clone_speaker_embedding(self, *, ref_audio_path: str) -> np.ndarray:
        with self._inference_lock:
            model = self.ensure_mode("clone")
            return self._extract_clone_speaker_embedding_unlocked(
                model=model,
                ref_audio_path=ref_audio_path,
            )

    def _load_cached_clone_speaker_embedding(self, embedding_path: str) -> np.ndarray:
        cache_key = str(Path(embedding_path).resolve())
        cached = self._clone_embedding_cache.get(cache_key)
        if cached is not None:
            return cached

        embedding = np.asarray(np.load(cache_key), dtype=np.float32)
        if embedding.ndim == 1:
            embedding = embedding.reshape(1, -1)
        self._clone_embedding_cache[cache_key] = embedding
        return embedding

    def _generate_clone_with_speaker_embedding(
        self,
        *,
        model: Any,
        text: str,
        language: str,
        speaker_embedding: np.ndarray,
        generation_kwargs: dict[str, float | int | bool],
    ) -> Any:
        if not self._supports_cached_clone_embedding(model):
            raise RuntimeError(
                "The local clone model does not expose a reusable speaker embedding API."
            )

        import mlx.core as mx

        cached_embedding = mx.array(np.asarray(speaker_embedding, dtype=np.float32))
        original_extract = model.extract_speaker_embedding

        def use_cached_embedding(_audio, sr: int = int(model.sample_rate)):
            del sr
            return cached_embedding

        model.extract_speaker_embedding = use_cached_embedding
        try:
            return model.generate(
                text=text,
                lang_code=language,
                ref_audio=mx.zeros((max(400, int(model.sample_rate * 0.1)),), dtype=mx.float32),
                ref_text=None,
                **generation_kwargs,
            )
        finally:
            model.extract_speaker_embedding = original_extract

    def generate_clone_cached(
        self,
        *,
        payload: BaseGenerationRequest,
        speaker_embedding_path: str,
    ) -> tuple[list[Any], int]:
        self._validate_language(payload.language)

        with self._inference_lock:
            model = self.ensure_mode("clone")
            self._apply_seed(payload.generation.seed)
            language = self._normalize_language(
                self.resolve_clone_language(payload.language, payload.segments, None)
            )
            generation_kwargs = self._generation_kwargs(payload.generation)
            speaker_embedding = self._load_cached_clone_speaker_embedding(speaker_embedding_path)

            wavs: list[np.ndarray] = []
            sample_rate = int(model.sample_rate)
            for segment in payload.segments:
                wav, sample_rate = self._collect_audio(
                    self._generate_clone_with_speaker_embedding(
                        model=model,
                        text=segment,
                        language=language,
                        speaker_embedding=speaker_embedding,
                        generation_kwargs=generation_kwargs,
                    )
                )
                wavs.append(wav)
            return wavs, sample_rate

    def generate_custom(self, request: CustomGenerationRequest) -> tuple[list[Any], int]:
        self._validate_language(request.language)
        self._ensure_speaker(request.speaker)
        with self._inference_lock:
            model = self.ensure_mode("custom")
            self._apply_seed(request.generation.seed)
            language = self._normalize_language(request.language)
            generation_kwargs = self._generation_kwargs(request.generation)

            wavs: list[np.ndarray] = []
            sample_rate = int(model.sample_rate)
            for segment in request.segments:
                wav, sample_rate = self._collect_audio(
                    model.generate_custom_voice(
                        text=segment,
                        speaker=request.speaker,
                        language=language,
                        instruct=request.instruct,
                        **generation_kwargs,
                    )
                )
                wavs.append(wav)
            return wavs, sample_rate

    def generate_design(self, request: DesignGenerationRequest) -> tuple[list[Any], int]:
        self._validate_language(request.language)
        with self._inference_lock:
            model = self.ensure_mode("design")
            self._apply_seed(request.generation.seed)
            language = self._normalize_language(request.language)
            generation_kwargs = self._generation_kwargs(request.generation)

            wavs: list[np.ndarray] = []
            sample_rate = int(model.sample_rate)
            for segment in request.segments:
                wav, sample_rate = self._collect_audio(
                    model.generate_voice_design(
                        text=segment,
                        language=language,
                        instruct=request.instruct,
                        **generation_kwargs,
                    )
                )
                wavs.append(wav)
            return wavs, sample_rate

    def generate_clone(
        self,
        *,
        payload: BaseGenerationRequest,
        ref_audio_path: str,
        ref_text: str | None,
        x_vector_only_mode: bool,
    ) -> tuple[list[Any], int]:
        self._validate_language(payload.language)
        if not (ref_text or "").strip():
            if not x_vector_only_mode:
                raise ValueError(
                    "Reference transcript is required unless x-vector only mode is enabled."
                )

        with self._inference_lock:
            model = self.ensure_mode("clone")
            self._apply_seed(payload.generation.seed)
            language = self._normalize_language(
                self.resolve_clone_language(payload.language, payload.segments, ref_text)
            )
            generation_kwargs = self._generation_kwargs(payload.generation)

            wavs: list[np.ndarray] = []
            sample_rate = int(model.sample_rate)
            speaker_embedding = (
                self._extract_clone_speaker_embedding_unlocked(
                    model=model,
                    ref_audio_path=ref_audio_path,
                )
                if x_vector_only_mode
                else None
            )
            for segment in payload.segments:
                result = (
                    self._generate_clone_with_speaker_embedding(
                        model=model,
                        text=segment,
                        language=language,
                        speaker_embedding=speaker_embedding,
                        generation_kwargs=generation_kwargs,
                    )
                    if speaker_embedding is not None
                    else model.generate(
                        text=segment,
                        lang_code=language,
                        ref_audio=ref_audio_path,
                        ref_text=ref_text,
                        **generation_kwargs,
                    )
                )
                wav, sample_rate = self._collect_audio(result)
                wavs.append(wav)
            return wavs, sample_rate

    def stream_custom(self, request: CustomGenerationRequest) -> Iterator[dict[str, Any]]:
        self._validate_language(request.language)
        self._ensure_speaker(request.speaker)
        def iterator() -> Iterator[dict[str, Any]]:
            with self._inference_lock:
                model = self.ensure_mode("custom")
                self._apply_seed(request.generation.seed)
                language = self._normalize_language(request.language)
                generation_kwargs = self._stream_generation_kwargs(request)
                sample_rate = int(model.sample_rate)

                for segment_index, segment in enumerate(request.segments):
                    yield from self._iter_stream_results(
                        model.generate_custom_voice(
                            text=segment,
                            speaker=request.speaker,
                            language=language,
                            instruct=request.instruct,
                            **generation_kwargs,
                        ),
                        segment_index=segment_index,
                        text=segment,
                        sample_rate=sample_rate,
                    )

        return iterator()

    def stream_design(self, request: DesignGenerationRequest) -> Iterator[dict[str, Any]]:
        self._validate_language(request.language)
        def iterator() -> Iterator[dict[str, Any]]:
            with self._inference_lock:
                model = self.ensure_mode("design")
                self._apply_seed(request.generation.seed)
                language = self._normalize_language(request.language)
                generation_kwargs = self._stream_generation_kwargs(request)
                sample_rate = int(model.sample_rate)

                for segment_index, segment in enumerate(request.segments):
                    yield from self._iter_stream_results(
                        model.generate_voice_design(
                            text=segment,
                            language=language,
                            instruct=request.instruct,
                            **generation_kwargs,
                        ),
                        segment_index=segment_index,
                        text=segment,
                        sample_rate=sample_rate,
                    )

        return iterator()

    def stream_clone(
        self,
        *,
        payload: BaseGenerationRequest,
        ref_audio_path: str,
        ref_text: str | None,
        x_vector_only_mode: bool,
    ) -> Iterator[dict[str, Any]]:
        self._validate_language(payload.language)
        if not (ref_text or "").strip():
            if not x_vector_only_mode:
                raise ValueError(
                    "Reference transcript is required unless x-vector only mode is enabled."
                )

        def iterator() -> Iterator[dict[str, Any]]:
            with self._inference_lock:
                model = self.ensure_mode("clone")
                self._apply_seed(payload.generation.seed)
                language = self._normalize_language(
                    self.resolve_clone_language(payload.language, payload.segments, ref_text)
                )
                generation_kwargs = (
                    self._stream_generation_kwargs(payload)
                    if x_vector_only_mode
                    else self._generation_kwargs(payload.generation)
                )
                sample_rate = int(model.sample_rate)
                speaker_embedding = (
                    self._extract_clone_speaker_embedding_unlocked(
                        model=model,
                        ref_audio_path=ref_audio_path,
                    )
                    if x_vector_only_mode
                    else None
                )

                for segment_index, segment in enumerate(payload.segments):
                    if speaker_embedding is not None:
                        yield from self._iter_stream_results(
                            self._generate_clone_with_speaker_embedding(
                                model=model,
                                text=segment,
                                language=language,
                                speaker_embedding=speaker_embedding,
                                generation_kwargs=generation_kwargs,
                            ),
                            segment_index=segment_index,
                            text=segment,
                            sample_rate=sample_rate,
                        )
                        continue

                    wav, sample_rate = self._collect_audio(
                        model.generate(
                            text=segment,
                            lang_code=language,
                            ref_audio=ref_audio_path,
                            ref_text=ref_text,
                            **generation_kwargs,
                        )
                    )
                    yield from self._iter_chunked_audio(
                        wav,
                        sample_rate=sample_rate,
                        segment_index=segment_index,
                        text=segment,
                        streaming_interval=payload.streaming_interval,
                    )

        return iterator()

    def stream_clone_cached(
        self,
        *,
        payload: BaseGenerationRequest,
        speaker_embedding_path: str,
    ) -> Iterator[dict[str, Any]]:
        self._validate_language(payload.language)

        def iterator() -> Iterator[dict[str, Any]]:
            with self._inference_lock:
                model = self.ensure_mode("clone")
                self._apply_seed(payload.generation.seed)
                language = self._normalize_language(
                    self.resolve_clone_language(payload.language, payload.segments, None)
                )
                generation_kwargs = self._stream_generation_kwargs(payload)
                sample_rate = int(model.sample_rate)
                speaker_embedding = self._load_cached_clone_speaker_embedding(
                    speaker_embedding_path
                )

                for segment_index, segment in enumerate(payload.segments):
                    yield from self._iter_stream_results(
                        self._generate_clone_with_speaker_embedding(
                            model=model,
                            text=segment,
                            language=language,
                            speaker_embedding=speaker_embedding,
                            generation_kwargs=generation_kwargs,
                        ),
                        segment_index=segment_index,
                        text=segment,
                        sample_rate=sample_rate,
                    )

        return iterator()


class AsrModelManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._inference_lock = threading.Lock()
        self._model: Any | None = None
        self.active_model_id: str | None = None
        self.selected_device = self._detect_preferred_device()

    def _detect_preferred_device(self) -> str:
        try:
            import mlx.core as mx

            mx.clear_cache()
            return "mlx"
        except Exception:
            return "cpu"

    def _instantiate_model(self, model_id: str) -> tuple[Any, str]:
        from mlx_audio.stt import load

        try:
            model = load(model_id)
        except Exception as exc:  # pragma: no cover - exercised against real runtime only
            raise RuntimeError(f"Unable to load {model_id} with the MLX runtime.") from exc

        return model, "mlx"

    def _release_current_model(self) -> None:
        if self._model is None:
            return

        self._model = None
        self.active_model_id = None
        gc.collect()
        try:
            import mlx.core as mx

            mx.clear_cache()
        except Exception:
            pass

    def ensure_model(self, model_id: str) -> Any:
        with self._lock:
            if self.active_model_id == model_id and self._model is not None:
                return self._model

            self._release_current_model()
            model, actual_device = self._instantiate_model(model_id)
            self._model = model
            self.active_model_id = model_id
            self.selected_device = actual_device
            return model

    def _normalize_language(self, language: str | None) -> str | None:
        if language is None:
            return None
        cleaned = language.strip()
        if not cleaned or cleaned.lower() == "auto":
            return None
        if cleaned not in LANGUAGES:
            raise ValueError(f"Unsupported language '{cleaned}'.")
        return cleaned

    def _resample_audio(self, audio: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
        if source_rate == target_rate:
            return np.asarray(audio, dtype=np.float32)

        samples = np.asarray(audio, dtype=np.float32).reshape(-1)
        if samples.size == 0:
            return samples

        duration = samples.shape[0] / source_rate
        target_length = max(1, int(round(duration * target_rate)))
        source_positions = np.linspace(0.0, duration, num=samples.shape[0], endpoint=False)
        target_positions = np.linspace(0.0, duration, num=target_length, endpoint=False)
        return np.interp(target_positions, source_positions, samples).astype(np.float32)

    def transcribe_file(
        self,
        *,
        file_path: str,
        model_id: str,
        language: str | None,
        send_to_chat: bool = False,
    ) -> AsrTranscriptionResponse:
        normalized_language = self._normalize_language(language)
        try:
            with self._inference_lock:
                model = self.ensure_model(model_id)
                result = model.generate(file_path, language=normalized_language)
        except Exception as exc:  # pragma: no cover - real runtime only
            raise RuntimeError("The ASR model failed to transcribe the uploaded audio.") from exc

        segments = [
            AsrSegmentResponse(
                text=str(segment.get("text", "")).strip(),
                start=float(segment.get("start", 0.0)),
                end=float(segment.get("end", 0.0)),
            )
            for segment in getattr(result, "segments", [])
            if str(segment.get("text", "")).strip()
        ]
        duration_seconds = round(float(segments[-1].end), 2) if segments else 0.0
        return AsrTranscriptionResponse(
            text=str(getattr(result, "text", "")).strip(),
            language=normalized_language or self._infer_language(result),
            duration_seconds=duration_seconds,
            model_id=model_id,
            segments=segments,
            send_to_chat=send_to_chat,
        )

    def transcribe_array(
        self,
        *,
        audio: np.ndarray,
        source_rate: int,
        model_id: str,
        language: str | None,
    ) -> AsrTranscriptionResponse:
        normalized_language = self._normalize_language(language)
        resampled = self._resample_audio(audio, source_rate, CONVERSATION_SAMPLE_RATE)
        try:
            with self._inference_lock:
                model = self.ensure_model(model_id)
                result = model.generate(resampled, language=normalized_language)
        except Exception as exc:  # pragma: no cover - real runtime only
            raise RuntimeError("The ASR model failed to transcribe the buffered audio.") from exc

        segments = [
            AsrSegmentResponse(
                text=str(segment.get("text", "")).strip(),
                start=float(segment.get("start", 0.0)),
                end=float(segment.get("end", 0.0)),
            )
            for segment in getattr(result, "segments", [])
            if str(segment.get("text", "")).strip()
        ]
        duration_seconds = round(float(len(resampled) / CONVERSATION_SAMPLE_RATE), 2)
        return AsrTranscriptionResponse(
            text=str(getattr(result, "text", "")).strip(),
            language=normalized_language or self._infer_language(result),
            duration_seconds=duration_seconds,
            model_id=model_id,
            segments=segments,
        )

    def _infer_language(self, result: Any) -> str | None:
        languages = getattr(result, "language", None)
        if isinstance(languages, str):
            return languages
        if isinstance(languages, list) and languages:
            return str(languages[0])
        return None


class ModelManager(TtsModelManager):
    """Compatibility alias for older tests and bootstrap code."""
