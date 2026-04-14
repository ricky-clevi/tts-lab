from __future__ import annotations

import gc
import os
import re
import threading
from collections.abc import Iterator
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

import numpy as np
import soundfile as sf

from .constants import (
    ASR_MODELS,
    CONVERSATION_SAMPLE_RATE,
    GENERATION_KNOBS,
    LANGUAGES,
    MODE_DESCRIPTIONS,
    MODE_LABELS,
    PROVIDER_CAPABILITIES,
    SPEAKERS,
)
from .runtime import RuntimeSelection, resolve_runtime_selection
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

_RUNTIME_LOCK = threading.RLock()


def _estimate_file_duration_seconds(path: str) -> float:
    try:
        info = sf.info(path)
    except Exception:
        return 0.0
    if not info.samplerate:
        return 0.0
    return round(float(info.frames) / float(info.samplerate), 2)


def _coerce_wav_list(wavs: Any) -> list[np.ndarray]:
    if isinstance(wavs, np.ndarray):
        if wavs.ndim == 1:
            return [np.asarray(wavs, dtype=np.float32).reshape(-1)]
        if wavs.ndim == 2:
            return [np.asarray(item, dtype=np.float32).reshape(-1) for item in wavs]

    if isinstance(wavs, (list, tuple)):
        return [np.asarray(item, dtype=np.float32).reshape(-1) for item in wavs]

    return [np.asarray(wavs, dtype=np.float32).reshape(-1)]


class TtsModelManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._inference_lock = threading.Lock()
        self._runtime_lock = _RUNTIME_LOCK
        self._clone_embedding_cache: dict[str, tuple[np.ndarray, np.ndarray | None]] = {}
        self._clone_prompt_cache: dict[str, Any] = {}
        self._model: Any | None = None
        self.active_mode: Mode | None = None
        self.active_model_id: str | None = None
        self.runtime: RuntimeSelection = resolve_runtime_selection()
        self.runtime_backend = self.runtime.backend
        self.runtime_platform = self.runtime.platform_name
        self.runtime_dtype = self.runtime.torch_dtype_name
        self.runtime_attention = self.runtime.attn_implementation
        self.model_ids = self.runtime.tts_model_ids
        self.selected_device = self.runtime.device_label

    def _torch_dtype(self):
        import torch

        mapping = {
            "float16": torch.float16,
            "bfloat16": torch.bfloat16,
            "float32": torch.float32,
        }
        return mapping.get(self.runtime.torch_dtype_name or "float32", torch.float32)

    def _instantiate_model(self, model_id: str) -> tuple[Any, str]:
        if self.runtime_backend == "mlx":
            from mlx_audio.tts.utils import load_model

            try:
                model = load_model(model_id)
            except Exception as exc:  # pragma: no cover - exercised against real runtime only
                raise RuntimeError(f"Unable to load {model_id} with the MLX runtime.") from exc
            return model, "mlx"

        from qwen_tts import Qwen3TTSModel

        kwargs: dict[str, Any] = {
            "device_map": self.runtime.device,
            "dtype": self._torch_dtype(),
        }
        if self.runtime.attn_implementation:
            kwargs["attn_implementation"] = self.runtime.attn_implementation

        try:
            model = Qwen3TTSModel.from_pretrained(model_id, **kwargs)
        except Exception as exc:  # pragma: no cover - exercised against real runtime only
            raise RuntimeError(f"Unable to load {model_id} with the Ivy CUDA runtime.") from exc
        return model, self.runtime.device_label

    def _release_current_model(self) -> None:
        if self._model is None:
            return

        self._model = None
        self.active_mode = None
        self.active_model_id = None
        gc.collect()

        if self.runtime_backend == "mlx":
            try:
                import mlx.core as mx

                mx.clear_cache()
            except Exception:
                pass
            return

        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def ensure_mode(self, mode: Mode) -> Any:
        with self._lock:
            if self.active_mode == mode and self._model is not None:
                return self._model

            self._release_current_model()
            model_id = self.model_ids[mode]
            model, actual_device = self._instantiate_model(model_id)
            self._model = model
            self.active_mode = mode
            self.active_model_id = model_id
            self.selected_device = actual_device
            return model

    def capabilities(self) -> CapabilitiesResponse:
        runtime_asr_models = [
            AsrModelCapabilityResponse(
                id=self.runtime.asr_model_ids[slot],
                label=item["label"],
                description=item["description"],
                checkpoint=self.runtime.asr_model_ids[slot],
            )
            for slot, item in zip(("default", "compact"), ASR_MODELS, strict=True)
        ]

        return CapabilitiesResponse(
            active_mode=self.active_mode,
            selected_device=self.selected_device,
            runtime_backend=self.runtime_backend,
            runtime_platform=self.runtime_platform,
            runtime_dtype=self.runtime_dtype,
            runtime_attention=self.runtime_attention,
            languages=LANGUAGES,
            speakers=[SpeakerResponse(**speaker) for speaker in SPEAKERS],
            generation_knobs=GENERATION_KNOBS,
            modes=[
                ModeCapabilityResponse(
                    id=mode,
                    label=MODE_LABELS[mode],
                    description=MODE_DESCRIPTIONS[mode],
                    checkpoint=self.model_ids[mode],
                )
                for mode in ("custom", "design", "clone")
            ],
            asr=AsrCapabilityResponse(
                default_model=self.runtime.asr_model_ids["default"],
                models=runtime_asr_models,
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

    def _apply_seed(self, seed: int | None) -> None:
        if seed is None:
            return

        if self.runtime_backend == "mlx":
            import mlx.core as mx

            mx.random.seed(seed)
            return

        try:
            import torch

            torch.manual_seed(seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(seed)
        except Exception:
            pass

    def _collect_audio(self, results: Any) -> tuple[np.ndarray, int]:
        collected = list(results)
        if not collected:
            raise RuntimeError("The model returned no audio.")
        sample_rate = int(collected[0].sample_rate)
        audio_parts = [np.asarray(result.audio, dtype=np.float32).reshape(-1) for result in collected]
        if not audio_parts:
            raise RuntimeError("The model returned no audio.")
        return np.concatenate(audio_parts), sample_rate

    def _collect_qwen_audio(self, wavs: Any, sample_rate: int) -> tuple[list[np.ndarray], int]:
        collected = _coerce_wav_list(wavs)
        if not collected:
            raise RuntimeError("The model returned no audio.")
        return collected, int(sample_rate)

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
        return self.runtime_backend == "mlx" and callable(
            getattr(model, "extract_speaker_embedding", None)
        ) and getattr(model, "speaker_encoder", None) is not None

    def _supports_cached_clone_icl(self, model: Any) -> bool:
        return self.runtime_backend == "mlx" and getattr(
            getattr(model, "speech_tokenizer", None), "has_encoder", False
        )

    def _extract_clone_speaker_embedding_unlocked(
        self,
        *,
        model: Any,
        ref_audio_path: str,
    ) -> np.ndarray:
        if not self._supports_cached_clone_embedding(model):
            raise RuntimeError(
                "The active clone runtime does not expose a reusable speaker embedding API."
            )

        from mlx_audio.utils import load_audio

        audio = load_audio(ref_audio_path, sample_rate=int(model.sample_rate))
        speaker_embedding = model.extract_speaker_embedding(audio, sr=int(model.sample_rate))
        embedding = np.asarray(speaker_embedding, dtype=np.float32)
        if embedding.ndim == 1:
            embedding = embedding.reshape(1, -1)
        return embedding

    def prepare_clone_speaker_embedding(self, *, ref_audio_path: str) -> np.ndarray:
        with self._runtime_lock, self._inference_lock:
            model = self.ensure_mode("clone")
            return self._extract_clone_speaker_embedding_unlocked(
                model=model,
                ref_audio_path=ref_audio_path,
            )

    def _qwen_clone_prompt_cache_key(
        self,
        *,
        ref_audio_path: str,
        ref_text: str | None,
        x_vector_only_mode: bool,
    ) -> str:
        resolved_audio = str(Path(ref_audio_path).resolve())
        normalized_text = (ref_text or "").strip()
        return "::".join([resolved_audio, normalized_text, "xvector" if x_vector_only_mode else "full"])

    def _build_qwen_clone_prompt(
        self,
        *,
        model: Any,
        ref_audio_path: str,
        ref_text: str | None,
        x_vector_only_mode: bool,
    ) -> Any:
        cache_key = self._qwen_clone_prompt_cache_key(
            ref_audio_path=ref_audio_path,
            ref_text=ref_text,
            x_vector_only_mode=x_vector_only_mode,
        )
        cached = self._clone_prompt_cache.get(cache_key)
        if cached is not None:
            return cached

        kwargs: dict[str, Any] = {"ref_audio": ref_audio_path}
        if ref_text:
            kwargs["ref_text"] = ref_text
        if x_vector_only_mode:
            kwargs["x_vector_only_mode"] = True
        prompt = model.create_voice_clone_prompt(**kwargs)
        self._clone_prompt_cache[cache_key] = prompt
        return prompt

    def prepare_clone_conditioning_assets(
        self, *, ref_audio_path: str
    ) -> tuple[np.ndarray | None, np.ndarray | None]:
        with self._runtime_lock, self._inference_lock:
            model = self.ensure_mode("clone")
            if self.runtime_backend != "mlx":
                self._build_qwen_clone_prompt(
                    model=model,
                    ref_audio_path=ref_audio_path,
                    ref_text=None,
                    x_vector_only_mode=True,
                )
                return None, None

            speaker_embedding = self._extract_clone_speaker_embedding_unlocked(
                model=model,
                ref_audio_path=ref_audio_path,
            )
            ref_codes: np.ndarray | None = None
            if self._supports_cached_clone_icl(model):
                from mlx_audio.utils import load_audio

                import mlx.core as mx

                audio = load_audio(ref_audio_path, sample_rate=int(model.sample_rate))
                if audio.ndim == 1:
                    audio = audio[None, None, :]
                elif audio.ndim == 2:
                    audio = audio[None, :]
                codes = model.speech_tokenizer.encode(audio)
                mx.eval(codes)
                ref_codes = np.asarray(codes, dtype=np.int32)
            return speaker_embedding, ref_codes

    def warm_clone_runtime(
        self,
        *,
        speaker_embedding_path: str | None = None,
        ref_audio_path: str | None = None,
        ref_text: str | None = None,
    ) -> None:
        with self._runtime_lock, self._inference_lock:
            model = self.ensure_mode("clone")
            if speaker_embedding_path:
                self._load_cached_clone_conditioning(speaker_embedding_path)
            elif ref_audio_path and self.runtime_backend == "mlx":
                from mlx_audio.utils import load_audio

                load_audio(ref_audio_path)
            elif ref_audio_path and self.runtime_backend == "qwen" and ref_text:
                self._build_qwen_clone_prompt(
                    model=model,
                    ref_audio_path=ref_audio_path,
                    ref_text=ref_text,
                    x_vector_only_mode=False,
                )

    def _load_cached_clone_conditioning(
        self, embedding_path: str
    ) -> tuple[np.ndarray, np.ndarray | None]:
        cache_key = str(Path(embedding_path).resolve())
        cached = self._clone_embedding_cache.get(cache_key)
        if cached is not None:
            return cached

        loaded = np.load(cache_key, allow_pickle=False)
        if isinstance(loaded, np.lib.npyio.NpzFile):
            if "speaker_embedding" not in loaded.files:
                raise RuntimeError("Clone cache is missing the speaker embedding.")
            embedding = np.asarray(loaded["speaker_embedding"], dtype=np.float32)
            ref_codes = (
                np.asarray(loaded["ref_codes"], dtype=np.int32)
                if "ref_codes" in loaded.files
                else None
            )
        else:
            embedding = np.asarray(loaded, dtype=np.float32)
            ref_codes = None

        if embedding.ndim == 1:
            embedding = embedding.reshape(1, -1)
        self._clone_embedding_cache[cache_key] = (embedding, ref_codes)
        return embedding, ref_codes

    def _generate_clone_with_speaker_embedding(
        self,
        *,
        model: Any,
        text: str,
        language: str,
        ref_text: str | None,
        speaker_embedding: np.ndarray,
        ref_codes: np.ndarray | None,
        generation_kwargs: dict[str, float | int | bool],
    ) -> Any:
        if not self._supports_cached_clone_embedding(model):
            raise RuntimeError(
                "The local clone model does not expose a reusable speaker embedding API."
            )

        import mlx.core as mx

        cached_embedding = mx.array(np.asarray(speaker_embedding, dtype=np.float32))
        original_extract = model.extract_speaker_embedding
        original_encode = getattr(model.speech_tokenizer, "encode", None)

        def use_cached_embedding(_audio, sr: int = int(model.sample_rate)):
            del sr
            return cached_embedding

        model.extract_speaker_embedding = use_cached_embedding
        try:
            if ref_codes is not None and ref_text:
                cached_ref_codes = mx.array(np.asarray(ref_codes, dtype=np.int32))

                def use_cached_ref_codes(_audio):
                    return cached_ref_codes

                if original_encode is not None:
                    model.speech_tokenizer.encode = use_cached_ref_codes
                return model.generate(
                    text=text,
                    lang_code=language,
                    ref_audio=mx.zeros((max(400, int(model.sample_rate * 0.1)),), dtype=mx.float32),
                    ref_text=ref_text,
                    **generation_kwargs,
                )

            return model.generate(
                text=text,
                lang_code=language,
                ref_audio=mx.zeros((max(400, int(model.sample_rate * 0.1)),), dtype=mx.float32),
                ref_text=None,
                **generation_kwargs,
            )
        finally:
            model.extract_speaker_embedding = original_extract
            if original_encode is not None:
                model.speech_tokenizer.encode = original_encode

    def generate_clone_cached(
        self,
        *,
        payload: BaseGenerationRequest,
        speaker_embedding_path: str,
        ref_text: str | None,
    ) -> tuple[list[Any], int]:
        if self.runtime_backend != "mlx":
            raise RuntimeError(
                "Cached clone embeddings are only supported by the MLX backend. "
                "Use the saved reference audio path on Linux/NVIDIA."
            )

        self._validate_language(payload.language)

        with self._runtime_lock, self._inference_lock:
            model = self.ensure_mode("clone")
            self._apply_seed(payload.generation.seed)
            language = self._normalize_language(
                self.resolve_clone_language(payload.language, payload.segments, ref_text)
            )
            generation_kwargs = self._generation_kwargs(payload.generation)
            speaker_embedding, ref_codes = self._load_cached_clone_conditioning(
                speaker_embedding_path
            )

            wavs: list[np.ndarray] = []
            sample_rate = int(model.sample_rate)
            for segment in payload.segments:
                wav, sample_rate = self._collect_audio(
                    self._generate_clone_with_speaker_embedding(
                        model=model,
                        text=segment,
                        language=language,
                        ref_text=ref_text,
                        speaker_embedding=speaker_embedding,
                        ref_codes=ref_codes,
                        generation_kwargs=generation_kwargs,
                    )
                )
                wavs.append(wav)
            return wavs, sample_rate

    def generate_custom(self, request: CustomGenerationRequest) -> tuple[list[Any], int]:
        self._validate_language(request.language)
        self._ensure_speaker(request.speaker)
        with self._runtime_lock, self._inference_lock:
            model = self.ensure_mode("custom")
            self._apply_seed(request.generation.seed)
            language = self._normalize_language(request.language)
            generation_kwargs = self._generation_kwargs(request.generation)

            if self.runtime_backend == "mlx":
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

            wavs: list[np.ndarray] = []
            sample_rate = 0
            for segment in request.segments:
                generated, sample_rate = model.generate_custom_voice(
                    text=segment,
                    language=language,
                    speaker=request.speaker,
                    instruct=request.instruct or "",
                    **generation_kwargs,
                )
                segment_wavs, sample_rate = self._collect_qwen_audio(generated, sample_rate)
                wavs.extend(segment_wavs)
            return wavs, sample_rate

    def generate_design(self, request: DesignGenerationRequest) -> tuple[list[Any], int]:
        self._validate_language(request.language)
        with self._runtime_lock, self._inference_lock:
            model = self.ensure_mode("design")
            self._apply_seed(request.generation.seed)
            language = self._normalize_language(request.language)
            generation_kwargs = self._generation_kwargs(request.generation)

            if self.runtime_backend == "mlx":
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

            wavs: list[np.ndarray] = []
            sample_rate = 0
            for segment in request.segments:
                generated, sample_rate = model.generate_voice_design(
                    text=segment,
                    language=language,
                    instruct=request.instruct,
                    **generation_kwargs,
                )
                segment_wavs, sample_rate = self._collect_qwen_audio(generated, sample_rate)
                wavs.extend(segment_wavs)
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
        if not (ref_text or "").strip() and not x_vector_only_mode:
            raise ValueError(
                "Reference transcript is required unless x-vector only mode is enabled."
            )

        with self._runtime_lock, self._inference_lock:
            model = self.ensure_mode("clone")
            self._apply_seed(payload.generation.seed)
            language = self._normalize_language(
                self.resolve_clone_language(payload.language, payload.segments, ref_text)
            )
            generation_kwargs = self._generation_kwargs(payload.generation)

            if self.runtime_backend == "mlx":
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
                            ref_text=None,
                            speaker_embedding=speaker_embedding,
                            ref_codes=None,
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

            clone_prompt = self._build_qwen_clone_prompt(
                model=model,
                ref_audio_path=ref_audio_path,
                ref_text=ref_text,
                x_vector_only_mode=x_vector_only_mode,
            )
            wavs: list[np.ndarray] = []
            sample_rate = 0
            for segment in payload.segments:
                generated, sample_rate = model.generate_voice_clone(
                    text=segment,
                    language=language,
                    voice_clone_prompt=clone_prompt,
                    **generation_kwargs,
                )
                segment_wavs, sample_rate = self._collect_qwen_audio(generated, sample_rate)
                wavs.extend(segment_wavs)
            return wavs, sample_rate

    def stream_custom(self, request: CustomGenerationRequest) -> Iterator[dict[str, Any]]:
        self._validate_language(request.language)
        self._ensure_speaker(request.speaker)

        def iterator() -> Iterator[dict[str, Any]]:
            with self._runtime_lock, self._inference_lock:
                model = self.ensure_mode("custom")
                self._apply_seed(request.generation.seed)
                language = self._normalize_language(request.language)
                sample_rate = int(getattr(model, "sample_rate", 24000))

                if self.runtime_backend == "mlx":
                    generation_kwargs = {
                        **self._generation_kwargs(request.generation),
                        "stream": True,
                        "streaming_interval": request.streaming_interval,
                    }
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
                    return

                generation_kwargs = self._generation_kwargs(request.generation)
                for segment_index, segment in enumerate(request.segments):
                    wavs, sample_rate = model.generate_custom_voice(
                        text=segment,
                        language=language,
                        speaker=request.speaker,
                        instruct=request.instruct or "",
                        **generation_kwargs,
                    )
                    segment_wavs, sample_rate = self._collect_qwen_audio(wavs, sample_rate)
                    for wav in segment_wavs:
                        yield from self._iter_chunked_audio(
                            wav,
                            sample_rate=sample_rate,
                            segment_index=segment_index,
                            text=segment,
                            streaming_interval=request.streaming_interval,
                        )

        return iterator()

    def stream_design(self, request: DesignGenerationRequest) -> Iterator[dict[str, Any]]:
        self._validate_language(request.language)

        def iterator() -> Iterator[dict[str, Any]]:
            with self._runtime_lock, self._inference_lock:
                model = self.ensure_mode("design")
                self._apply_seed(request.generation.seed)
                language = self._normalize_language(request.language)
                sample_rate = int(getattr(model, "sample_rate", 24000))

                if self.runtime_backend == "mlx":
                    generation_kwargs = {
                        **self._generation_kwargs(request.generation),
                        "stream": True,
                        "streaming_interval": request.streaming_interval,
                    }
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
                    return

                generation_kwargs = self._generation_kwargs(request.generation)
                for segment_index, segment in enumerate(request.segments):
                    wavs, sample_rate = model.generate_voice_design(
                        text=segment,
                        language=language,
                        instruct=request.instruct,
                        **generation_kwargs,
                    )
                    segment_wavs, sample_rate = self._collect_qwen_audio(wavs, sample_rate)
                    for wav in segment_wavs:
                        yield from self._iter_chunked_audio(
                            wav,
                            sample_rate=sample_rate,
                            segment_index=segment_index,
                            text=segment,
                            streaming_interval=request.streaming_interval,
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
        if not (ref_text or "").strip() and not x_vector_only_mode:
            raise ValueError(
                "Reference transcript is required unless x-vector only mode is enabled."
            )

        def iterator() -> Iterator[dict[str, Any]]:
            with self._runtime_lock, self._inference_lock:
                model = self.ensure_mode("clone")
                self._apply_seed(payload.generation.seed)
                language = self._normalize_language(
                    self.resolve_clone_language(payload.language, payload.segments, ref_text)
                )
                sample_rate = int(getattr(model, "sample_rate", 24000))

                if self.runtime_backend == "mlx":
                    generation_kwargs = (
                        {
                            **self._generation_kwargs(payload.generation),
                            "stream": True,
                            "streaming_interval": payload.streaming_interval,
                        }
                        if x_vector_only_mode
                        else self._generation_kwargs(payload.generation)
                    )
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
                                    ref_text=None,
                                    speaker_embedding=speaker_embedding,
                                    ref_codes=None,
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
                    return

                generation_kwargs = self._generation_kwargs(payload.generation)
                clone_prompt = self._build_qwen_clone_prompt(
                    model=model,
                    ref_audio_path=ref_audio_path,
                    ref_text=ref_text,
                    x_vector_only_mode=x_vector_only_mode,
                )
                for segment_index, segment in enumerate(payload.segments):
                    wavs, sample_rate = model.generate_voice_clone(
                        text=segment,
                        language=language,
                        voice_clone_prompt=clone_prompt,
                        **generation_kwargs,
                    )
                    segment_wavs, sample_rate = self._collect_qwen_audio(wavs, sample_rate)
                    for wav in segment_wavs:
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
        ref_text: str | None,
    ) -> Iterator[dict[str, Any]]:
        if self.runtime_backend != "mlx":
            raise RuntimeError(
                "Cached clone embeddings are only supported by the MLX backend. "
                "Use the saved reference audio path on Linux/NVIDIA."
            )

        self._validate_language(payload.language)

        def iterator() -> Iterator[dict[str, Any]]:
            with self._runtime_lock, self._inference_lock:
                model = self.ensure_mode("clone")
                self._apply_seed(payload.generation.seed)
                language = self._normalize_language(
                    self.resolve_clone_language(payload.language, payload.segments, ref_text)
                )
                generation_kwargs = {
                    **self._generation_kwargs(payload.generation),
                    "stream": True,
                    "streaming_interval": payload.streaming_interval,
                }
                sample_rate = int(model.sample_rate)
                speaker_embedding, ref_codes = self._load_cached_clone_conditioning(
                    speaker_embedding_path
                )

                for segment_index, segment in enumerate(payload.segments):
                    yield from self._iter_stream_results(
                        self._generate_clone_with_speaker_embedding(
                            model=model,
                            text=segment,
                            language=language,
                            ref_text=ref_text,
                            speaker_embedding=speaker_embedding,
                            ref_codes=ref_codes,
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
        self._runtime_lock = _RUNTIME_LOCK
        self._model: Any | None = None
        self.active_model_id: str | None = None
        self.runtime: RuntimeSelection = resolve_runtime_selection()
        self.runtime_backend = self.runtime.backend
        self.runtime_platform = self.runtime.platform_name
        self.runtime_dtype = self.runtime.torch_dtype_name
        self.runtime_attention = self.runtime.attn_implementation
        self.model_ids = self.runtime.asr_model_ids
        self.selected_device = self.runtime.device_label

    def _torch_dtype(self):
        import torch

        mapping = {
            "float16": torch.float16,
            "bfloat16": torch.bfloat16,
            "float32": torch.float32,
        }
        return mapping.get(self.runtime.torch_dtype_name or "float32", torch.float32)

    def _instantiate_model(self, model_id: str) -> tuple[Any, str]:
        if self.runtime_backend == "mlx":
            from mlx_audio.stt import load

            try:
                model = load(model_id)
            except Exception as exc:  # pragma: no cover - exercised against real runtime only
                raise RuntimeError(f"Unable to load {model_id} with the MLX runtime.") from exc
            return model, "mlx"

        from qwen_asr import Qwen3ASRModel

        kwargs: dict[str, Any] = {
            "device_map": self.runtime.device,
            "dtype": self._torch_dtype(),
            "max_inference_batch_size": int(os.getenv("QWEN_ASR_MAX_INFERENCE_BATCH_SIZE", "32")),
            "max_new_tokens": int(os.getenv("QWEN_ASR_MAX_NEW_TOKENS", "256")),
        }
        if self.runtime.attn_implementation:
            kwargs["attn_implementation"] = self.runtime.attn_implementation

        try:
            model = Qwen3ASRModel.from_pretrained(model_id, **kwargs)
        except Exception as exc:  # pragma: no cover - exercised against real runtime only
            raise RuntimeError(f"Unable to load {model_id} with the Ivy CUDA runtime.") from exc
        return model, self.runtime.device_label

    def _release_current_model(self) -> None:
        if self._model is None:
            return

        self._model = None
        self.active_model_id = None
        gc.collect()
        if self.runtime_backend == "mlx":
            try:
                import mlx.core as mx

                mx.clear_cache()
            except Exception:
                pass
            return

        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
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

    def _qwen_transcribe(self, *, model: Any, audio: Any, language: str | None) -> Any:
        result = model.transcribe(audio=audio, language=language)
        if isinstance(result, list):
            return result[0] if result else None
        return result

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
            with self._runtime_lock, self._inference_lock:
                model = self.ensure_model(model_id)
                if self.runtime_backend == "mlx":
                    result = model.generate(file_path, language=normalized_language)
                else:
                    result = self._qwen_transcribe(
                        model=model,
                        audio=file_path,
                        language=normalized_language,
                    )
        except Exception as exc:  # pragma: no cover - real runtime only
            raise RuntimeError("The ASR model failed to transcribe the uploaded audio.") from exc

        if self.runtime_backend == "mlx":
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

        text = str(getattr(result, "text", "") if result is not None else "").strip()
        return AsrTranscriptionResponse(
            text=text,
            language=normalized_language or self._infer_language(result),
            duration_seconds=_estimate_file_duration_seconds(file_path),
            model_id=model_id,
            segments=[],
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
        temp_path: str | None = None
        try:
            with self._runtime_lock, self._inference_lock:
                model = self.ensure_model(model_id)
                if self.runtime_backend == "mlx":
                    result = model.generate(resampled, language=normalized_language)
                else:
                    with NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
                        temp_path = temp_file.name
                    sf.write(temp_path, resampled, CONVERSATION_SAMPLE_RATE)
                    result = self._qwen_transcribe(
                        model=model,
                        audio=temp_path,
                        language=normalized_language,
                    )
        except Exception as exc:  # pragma: no cover - real runtime only
            raise RuntimeError("The ASR model failed to transcribe the buffered audio.") from exc
        finally:
            if temp_path:
                Path(temp_path).unlink(missing_ok=True)

        if self.runtime_backend == "mlx":
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

        duration_seconds = round(float(len(resampled) / CONVERSATION_SAMPLE_RATE), 2)
        return AsrTranscriptionResponse(
            text=str(getattr(result, "text", "") if result is not None else "").strip(),
            language=normalized_language or self._infer_language(result),
            duration_seconds=duration_seconds,
            model_id=model_id,
            segments=[],
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
