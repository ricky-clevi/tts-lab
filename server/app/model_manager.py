from __future__ import annotations

import gc
import threading
from typing import Any

import numpy as np

from .constants import GENERATION_KNOBS, LANGUAGES, MODE_DESCRIPTIONS, MODE_LABELS, MODEL_IDS, SPEAKERS
from .schemas import BaseGenerationRequest, CapabilitiesResponse, CustomGenerationRequest, DesignGenerationRequest, Mode, ModeCapabilityResponse, SpeakerResponse


class ModelManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
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

        import mlx.core as mx

        mx.random.seed(seed)

    def _collect_audio(self, results: Any) -> tuple[np.ndarray, int]:
        collected = list(results)
        if not collected:
            raise RuntimeError("The model returned no audio.")

        result = collected[-1]
        return np.asarray(result.audio, dtype=np.float32), int(result.sample_rate)

    def generate_custom(self, request: CustomGenerationRequest) -> tuple[list[Any], int]:
        self._validate_language(request.language)
        self._ensure_speaker(request.speaker)
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
        if x_vector_only_mode:
            raise ValueError("The local MLX Qwen runtime does not support x-vector only mode yet. Provide a reference transcript and leave that option disabled.")
        if not (ref_text or "").strip():
            raise ValueError("Reference transcript is required unless x-vector only mode is enabled.")

        model = self.ensure_mode("clone")
        self._apply_seed(payload.generation.seed)
        language = self._normalize_language(payload.language)
        generation_kwargs = self._generation_kwargs(payload.generation)

        wavs: list[np.ndarray] = []
        sample_rate = int(model.sample_rate)
        for segment in payload.segments:
            wav, sample_rate = self._collect_audio(
                model.generate(
                    text=segment,
                    lang_code=language,
                    ref_audio=ref_audio_path,
                    ref_text=ref_text,
                    **generation_kwargs,
                )
            )
            wavs.append(wav)
        return wavs, sample_rate
