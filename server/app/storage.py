from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import numpy as np
import soundfile as sf

from .schemas import AudioClipResponse


class AudioStorage:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def save_clip(
        self,
        *,
        wav: np.ndarray,
        sample_rate: int,
        segment_index: int,
        text: str,
        language: str,
        speaker: str | None = None,
        instruct: str | None = None,
        x_vector_only_mode: bool | None = None,
    ) -> AudioClipResponse:
        audio_id = uuid4().hex
        file_name = f"{audio_id}.wav"
        path = self.root / file_name
        normalized_wav = np.asarray(wav, dtype=np.float32)
        sf.write(path, normalized_wav, sample_rate)
        duration_seconds = round(float(len(normalized_wav) / sample_rate), 2) if sample_rate else 0.0
        return AudioClipResponse(
            id=audio_id,
            audio_url=f"/api/audio/{audio_id}",
            file_name=file_name,
            segment_index=segment_index,
            text=text,
            language=language,
            sample_rate=sample_rate,
            duration_seconds=duration_seconds,
            speaker=speaker,
            instruct=instruct,
            x_vector_only_mode=x_vector_only_mode,
        )

    def get_path(self, audio_id: str) -> Path:
        path = self.root / f"{audio_id}.wav"
        if not path.exists():
            raise FileNotFoundError(audio_id)
        return path

