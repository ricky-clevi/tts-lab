from __future__ import annotations

import importlib.util
import os
import platform
from dataclasses import dataclass
from typing import Literal

RuntimeBackend = Literal["mlx", "qwen"]

DEFAULT_TTS_MODEL_IDS: dict[RuntimeBackend, dict[str, str]] = {
    "mlx": {
        "custom": "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
        "design": "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit",
        "clone": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit",
    },
    "qwen": {
        "custom": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
        "design": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
        "clone": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    },
}

DEFAULT_ASR_MODEL_IDS: dict[RuntimeBackend, dict[str, str]] = {
    "mlx": {
        "default": "mlx-community/Qwen3-ASR-1.7B-8bit",
        "compact": "mlx-community/Qwen3-ASR-0.6B-8bit",
    },
    "qwen": {
        "default": "Qwen/Qwen3-ASR-1.7B",
        "compact": "Qwen/Qwen3-ASR-0.6B",
    },
}


@dataclass(frozen=True)
class RuntimeSelection:
    backend: RuntimeBackend
    device: str
    device_label: str
    torch_dtype_name: str | None
    attn_implementation: str | None
    tts_model_ids: dict[str, str]
    asr_model_ids: dict[str, str]
    platform_name: str


def _has_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def _env(name: str, default: str) -> str:
    value = os.getenv(name)
    return value.strip() if value and value.strip() else default


def _resolve_tts_model_ids(backend: RuntimeBackend) -> dict[str, str]:
    defaults = DEFAULT_TTS_MODEL_IDS[backend]
    return {
        "custom": _env("QWEN_TTS_CUSTOM_MODEL_ID", defaults["custom"]),
        "design": _env("QWEN_TTS_DESIGN_MODEL_ID", defaults["design"]),
        "clone": _env("QWEN_TTS_CLONE_MODEL_ID", defaults["clone"]),
    }


def _resolve_asr_model_ids(backend: RuntimeBackend) -> dict[str, str]:
    defaults = DEFAULT_ASR_MODEL_IDS[backend]
    return {
        "default": _env("QWEN_ASR_DEFAULT_MODEL_ID", defaults["default"]),
        "compact": _env("QWEN_ASR_COMPACT_MODEL_ID", defaults["compact"]),
    }


def _prefer_mlx() -> bool:
    return (
        platform.system() == "Darwin"
        and platform.machine().lower() in {"arm64", "aarch64"}
        and _has_module("mlx.core")
        and _has_module("mlx_audio")
    )


def _prefer_qwen() -> bool:
    return _has_module("qwen_tts") and _has_module("qwen_asr")


def _resolve_backend(preference: str) -> RuntimeBackend:
    normalized = preference.lower()
    if normalized in {"mlx", "apple"}:
        return "mlx"
    if normalized in {"qwen", "torch", "cuda"}:
        return "qwen"
    if _prefer_mlx():
        return "mlx"
    if _prefer_qwen():
        return "qwen"
    if _has_module("mlx_audio"):
        return "mlx"
    return "qwen"


def _resolve_qwen_device(preference: str) -> tuple[str, str]:
    normalized = preference.lower()
    if normalized not in {"", "auto"}:
        return preference, preference

    try:
        import torch

        if torch.cuda.is_available():
            index = torch.cuda.current_device()
            return f"cuda:{index}", f"cuda:{index}"
    except Exception:
        pass

    return "cpu", "cpu"


def _resolve_qwen_dtype_name(device: str, preference: str) -> str:
    normalized = preference.lower()
    if normalized in {"float16", "fp16", "half"}:
        return "float16"
    if normalized in {"bfloat16", "bf16"}:
        return "bfloat16"
    if normalized in {"float32", "fp32"}:
        return "float32"

    if device.startswith("cuda"):
        try:
            import torch

            return "bfloat16" if torch.cuda.is_bf16_supported() else "float16"
        except Exception:
            return "float16"

    return "float32"


def _resolve_attn_implementation(device: str, preference: str) -> str | None:
    normalized = preference.lower()
    if normalized in {"", "auto"}:
        if not device.startswith("cuda"):
            return None
        return "flash_attention_2" if _has_module("flash_attn") else "sdpa"
    if normalized in {"none", "off", "disabled"}:
        return None
    return preference


def resolve_runtime_selection() -> RuntimeSelection:
    backend = _resolve_backend(_env("QWEN_AUDIO_BACKEND", "auto"))
    platform_name = f"{platform.system().lower()}-{platform.machine().lower()}"

    if backend == "mlx":
        return RuntimeSelection(
            backend="mlx",
            device="mlx",
            device_label="mlx",
            torch_dtype_name=None,
            attn_implementation=None,
            tts_model_ids=_resolve_tts_model_ids("mlx"),
            asr_model_ids=_resolve_asr_model_ids("mlx"),
            platform_name=platform_name,
        )

    device, device_label = _resolve_qwen_device(_env("QWEN_AUDIO_DEVICE", "auto"))
    dtype_name = _resolve_qwen_dtype_name(device, _env("QWEN_AUDIO_TORCH_DTYPE", "auto"))
    attn_implementation = _resolve_attn_implementation(
        device,
        _env("QWEN_AUDIO_ATTN_IMPLEMENTATION", "auto"),
    )
    return RuntimeSelection(
        backend="qwen",
        device=device,
        device_label=device_label,
        torch_dtype_name=dtype_name,
        attn_implementation=attn_implementation,
        tts_model_ids=_resolve_tts_model_ids("qwen"),
        asr_model_ids=_resolve_asr_model_ids("qwen"),
        platform_name=platform_name,
    )
