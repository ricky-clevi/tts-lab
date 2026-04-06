from __future__ import annotations

from .schemas import ReplyVoiceMode, StyleControls

MOOD_PROMPTS = {
    "neutral": "Keep the emotional tone neutral, composed, and matter-of-fact.",
    "calm": "Sound calm, relaxed, and emotionally steady.",
    "warm": "Sound warm, friendly, and reassuring.",
    "happy": "Sound lightly happy and upbeat without becoming cartoonish.",
    "confident": "Sound confident, assured, and articulate.",
    "serious": "Sound serious, focused, and professional.",
    "empathetic": "Sound empathetic and caring while staying controlled.",
    "sad": "Sound gently sad and reflective without audible crying.",
}

EMOTION_INTENSITY_PROMPTS = {
    "restrained": "Keep emotional expression restrained and subtle.",
    "balanced": "Use moderate emotional expression with natural variation.",
    "expressive": "Allow stronger emotional expression when the text supports it.",
}

PACE_PROMPTS = {
    "slower": "Use a slightly slower speaking pace with clear phrasing.",
    "steady": "Maintain a steady, natural speaking pace.",
    "faster": "Use a slightly quicker pace while staying intelligible.",
}

ENERGY_PROMPTS = {
    "soft": "Keep the vocal energy soft and low-pressure.",
    "balanced": "Use balanced vocal energy with a natural conversational lift.",
    "high": "Use stronger vocal energy and clearer emphasis.",
}

EXPRESSIVENESS_PROMPTS = {
    "controlled": "Keep prosody controlled with limited melodrama.",
    "natural": "Use natural prosodic variation and human-like emphasis.",
    "dramatic": "Allow broader pitch movement and more dramatic phrasing.",
}


def compose_instruction(
    base_instruction: str,
    style: StyleControls,
    mode: ReplyVoiceMode,
) -> str:
    guidance = [
        "Preserve the core identity of the selected preset speaker." if mode == "custom" else "",
        MOOD_PROMPTS.get(style.mood, ""),
        EMOTION_INTENSITY_PROMPTS.get(style.emotion_intensity, ""),
        PACE_PROMPTS.get(style.pace, ""),
        ENERGY_PROMPTS.get(style.energy, ""),
        EXPRESSIVENESS_PROMPTS.get(style.expressiveness, ""),
    ]

    if style.mood != "sad" and (
        style.emotion_intensity == "restrained" or style.expressiveness == "controlled"
    ):
        guidance.append(
            "Avoid exaggerated sadness, trembling, sobbing, or a crying delivery unless the text explicitly asks for it."
        )

    custom_guidance = base_instruction.strip()
    if custom_guidance:
        guidance.append(f"Additional guidance: {custom_guidance}")

    return " ".join(part for part in guidance if part)
