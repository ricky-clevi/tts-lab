from __future__ import annotations

from pathlib import Path
from uuid import uuid4
from dataclasses import dataclass

import numpy as np
import soundfile as sf
from datetime import datetime, timezone
import json
import shutil

from .schemas import AudioClipResponse, CloneVoiceProfileResponse


@dataclass
class StoredVoiceProfile:
    id: str
    label: str
    language: str
    reference_text: str
    audio_file_name: str
    audio_path: str
    speaker_embedding_path: str | None
    created_at: datetime


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
        speaker_embedding: np.ndarray | None = None,
        ref_codes: np.ndarray | None = None,
    ) -> StoredVoiceProfile:
        profile_id = uuid4().hex
        extension = Path(source_name).suffix or ".wav"
        audio_file_name = f"{profile_id}{extension}"
        destination = self.root / audio_file_name
        shutil.copy2(source_path, destination)
        speaker_embedding_path: str | None = None
        if speaker_embedding is not None or ref_codes is not None:
            embedding_path = self.root / f"{profile_id}.speaker.npz"
            payload: dict[str, np.ndarray] = {}
            if speaker_embedding is not None:
                payload["speaker_embedding"] = np.asarray(speaker_embedding, dtype=np.float32)
            if ref_codes is not None:
                payload["ref_codes"] = np.asarray(ref_codes, dtype=np.int32)
            np.savez(embedding_path, **payload)
            speaker_embedding_path = str(embedding_path)
        created_at = datetime.now(timezone.utc)
        profile = StoredVoiceProfile(
            id=profile_id,
            label=(label or Path(source_name).stem or "Cloned voice").strip(),
            language=language,
            reference_text=reference_text,
            audio_file_name=audio_file_name,
            audio_path=str(destination),
            speaker_embedding_path=speaker_embedding_path,
            created_at=created_at,
        )
        metadata_path = self.root / f"{profile_id}.json"
        metadata_path.write_text(
            json.dumps(
                {
                    "id": profile.id,
                    "label": profile.label,
                    "language": profile.language,
                    "reference_text": profile.reference_text,
                    "audio_file_name": profile.audio_file_name,
                    "audio_path": profile.audio_path,
                    "speaker_embedding_path": profile.speaker_embedding_path,
                    "created_at": profile.created_at.isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return profile

    def _candidate_path(self, raw_path: str | None) -> Path | None:
        if not raw_path:
            return None
        return Path(raw_path)

    def _candidate_file_name(self, raw_path: str | None) -> str | None:
        if not raw_path:
            return None
        normalized = raw_path.replace("\\", "/")
        name = Path(normalized).name
        return name or None

    def resolve_audio_path(self, profile_id: str, audio_file_name: str | None, audio_path: str | None) -> Path | None:
        candidates: list[Path] = []
        if path := self._candidate_path(audio_path):
            candidates.append(path)
        if audio_file_name:
            candidates.append(self.root / audio_file_name)
        candidates.append(self.root / f"{profile_id}.wav")

        seen: set[Path] = set()
        for candidate in candidates:
            if candidate in seen:
                continue
            seen.add(candidate)
            if candidate.exists():
                return candidate
        return None

    def resolve_embedding_path(self, profile_id: str, speaker_embedding_path: str | None) -> Path | None:
        candidates: list[Path] = []
        if path := self._candidate_path(speaker_embedding_path):
            candidates.append(path)
        if file_name := self._candidate_file_name(speaker_embedding_path):
            candidates.append(self.root / file_name)
        candidates.append(self.root / f"{profile_id}.speaker.npz")

        seen: set[Path] = set()
        for candidate in candidates:
            if candidate in seen:
                continue
            seen.add(candidate)
            if candidate.exists():
                return candidate
        return None

    def get_profile(self, profile_id: str) -> StoredVoiceProfile:
        metadata_path = self.root / f"{profile_id}.json"
        if not metadata_path.exists():
            raise FileNotFoundError(profile_id)
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        profile = StoredVoiceProfile(
            id=str(payload["id"]),
            label=str(payload["label"]),
            language=str(payload["language"]),
            reference_text=str(payload["reference_text"]),
            audio_file_name=str(payload["audio_file_name"]),
            audio_path=str(payload["audio_path"]),
            speaker_embedding_path=str(payload.get("speaker_embedding_path") or "") or None,
            created_at=datetime.fromisoformat(str(payload["created_at"]).replace("Z", "+00:00")),
        )
        audio_path = self.resolve_audio_path(profile.id, profile.audio_file_name, profile.audio_path)
        if audio_path is None:
            raise FileNotFoundError(profile_id)
        profile.audio_path = str(audio_path)

        embedding_path = self.resolve_embedding_path(profile.id, profile.speaker_embedding_path)
        if embedding_path is None:
            profile.speaker_embedding_path = None
        else:
            profile.speaker_embedding_path = str(embedding_path)
        return profile

    def get_path(self, profile_id: str) -> Path:
        path = Path(self.get_profile(profile_id).audio_path)
        if not path.exists():
            raise FileNotFoundError(profile_id)
        return path
