from __future__ import annotations

from typing import Final

from .schemas import ProviderId

LANGUAGES: Final[list[str]] = [
    "Auto",
    "Chinese",
    "English",
    "Japanese",
    "Korean",
    "German",
    "French",
    "Russian",
    "Portuguese",
    "Spanish",
    "Italian",
]

MODEL_IDS: Final[dict[str, str]] = {
    "custom": "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
    "design": "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit",
    "clone": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit",
}

ASR_MODEL_IDS: Final[dict[str, str]] = {
    "default": "mlx-community/Qwen3-ASR-1.7B-8bit",
    "compact": "mlx-community/Qwen3-ASR-0.6B-8bit",
}

ASR_MODELS: Final[list[dict[str, str]]] = [
    {
        "id": ASR_MODEL_IDS["default"],
        "label": "Qwen3-ASR 1.7B",
        "description": "Highest-quality local multilingual Qwen ASR option.",
        "checkpoint": ASR_MODEL_IDS["default"],
    },
    {
        "id": ASR_MODEL_IDS["compact"],
        "label": "Qwen3-ASR 0.6B",
        "description": "Smaller local Qwen ASR model with lower memory and faster startup.",
        "checkpoint": ASR_MODEL_IDS["compact"],
    },
]

MODE_LABELS: Final[dict[str, str]] = {
    "custom": "Custom Voice",
    "design": "Voice Design",
    "clone": "Voice Clone",
}

MODE_DESCRIPTIONS: Final[dict[str, str]] = {
    "custom": "Pick one of the official Qwen premium timbres and optionally add style instructions.",
    "design": "Describe the voice you want in natural language and synthesize directly from the prompt.",
    "clone": "Upload a short reference clip to clone a voice for new text.",
}

GENERATION_KNOBS: Final[dict[str, dict[str, float | int | None]]] = {
    "temperature": {"default": 0.7, "min": 0.0, "max": 2.0},
    "top_p": {"default": 0.9, "min": 0.0, "max": 1.0},
    "max_new_tokens": {"default": 2048, "min": 64, "max": 8192},
    "seed": {"default": None, "min": 0, "max": 2147483647},
}

PROVIDER_CAPABILITIES: Final[list[dict[str, str | bool | ProviderId]]] = [
    {
        "id": "openai_compatible",
        "label": "OpenAI-compatible",
        "description": "Use a base URL, API key, and model name against OpenAI-style servers.",
        "base_url_configurable": True,
        "native": False,
    },
    {
        "id": "gemini",
        "label": "Gemini",
        "description": "Use Gemini's native API with streamed text responses and local Qwen speech.",
        "base_url_configurable": True,
        "native": True,
    },
    {
        "id": "anthropic",
        "label": "Anthropic",
        "description": "Use Claude's native Messages API with streamed text responses and local Qwen speech.",
        "base_url_configurable": True,
        "native": True,
    },
]

DEFAULT_OPENAI_BASE_URL: Final[str] = "https://api.openai.com/v1"
DEFAULT_GEMINI_BASE_URL: Final[str] = "https://generativelanguage.googleapis.com"
DEFAULT_ANTHROPIC_BASE_URL: Final[str] = "https://api.anthropic.com"

CONVERSATION_SAMPLE_RATE: Final[int] = 16000
PARTIAL_TRANSCRIPTION_MIN_SECONDS: Final[float] = 0.9
SENTENCE_BOUNDARY_CHARS: Final[tuple[str, ...]] = (".", "!", "?", "\n")

SPEAKERS: Final[list[dict[str, str]]] = [
    {
        "id": "Vivian",
        "name": "Vivian",
        "description": "Bright, slightly edgy young female voice.",
        "native_language": "Chinese",
    },
    {
        "id": "Serena",
        "name": "Serena",
        "description": "Warm, gentle young female voice.",
        "native_language": "Chinese",
    },
    {
        "id": "Uncle_Fu",
        "name": "Uncle_Fu",
        "description": "Seasoned male voice with a low, mellow timbre.",
        "native_language": "Chinese",
    },
    {
        "id": "Dylan",
        "name": "Dylan",
        "description": "Youthful Beijing male voice with a clear, natural timbre.",
        "native_language": "Chinese (Beijing Dialect)",
    },
    {
        "id": "Eric",
        "name": "Eric",
        "description": "Lively Chengdu male voice with a slightly husky brightness.",
        "native_language": "Chinese (Sichuan Dialect)",
    },
    {
        "id": "Ryan",
        "name": "Ryan",
        "description": "Dynamic male voice with strong rhythmic drive.",
        "native_language": "English",
    },
    {
        "id": "Aiden",
        "name": "Aiden",
        "description": "Sunny American male voice with a clear midrange.",
        "native_language": "English",
    },
    {
        "id": "Ono_Anna",
        "name": "Ono Anna",
        "description": "Playful Japanese female voice with a light, nimble timbre.",
        "native_language": "Japanese",
    },
    {
        "id": "Sohee",
        "name": "Sohee",
        "description": "Warm Korean female voice with rich emotion.",
        "native_language": "Korean",
    },
]
