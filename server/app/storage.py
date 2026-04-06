from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import numpy as np
import soundfile as sf
from datetime import datetime, timezone
import json
import shutil

from .schemas import AudioClipResponse, CloneVoiceProfileResponse


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


class VoiceProfileStorage:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def save_profile(
        self,
        *,
        source_path: str,
        source_name: str,
        language: str,
        reference_text: str,
        label: str | None = None,
    ) -> CloneVoiceProfileResponse:
        profile_id = uuid4().hex
        extension = Path(source_name).suffix or ".wav"
        audio_file_name = f"{profile_id}{extension}"
        destination = self.root / audio_file_name
        shutil.copy2(source_path, destination)
        created_at = datetime.now(timezone.utc)
        response = CloneVoiceProfileResponse(
            id=profile_id,
            label=(label or Path(source_name).stem or "Cloned voice").strip(),
            language=language,
            reference_text=reference_text,
            audio_file_name=audio_file_name,
            audio_path=str(destination),
            created_at=created_at,
        )
        metadata_path = self.root / f"{profile_id}.json"
        metadata_path.write_text(
            json.dumps(response.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return response

    def get_path(self, profile_id: str) -> Path:
        metadata_path = self.root / f"{profile_id}.json"
        if not metadata_path.exists():
            raise FileNotFoundError(profile_id)
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        path = Path(str(payload["audio_path"]))
        if not path.exists():
            raise FileNotFoundError(profile_id)
        return path
