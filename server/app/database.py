"""
SQLite database layer for Ivy Voice Lab.
Handles user management, voice profile ownership, and migrations.
"""

import sqlite3
import json
import uuid
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import contextmanager


class Database:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _get_connection(self) -> sqlite3.Connection:
        """Get a connection to the database with row factory."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    @contextmanager
    def _get_cursor(self):
        """Context manager for database transactions."""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            yield cursor
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_schema(self) -> None:
        """Create tables if they don't exist."""
        with self._get_cursor() as cursor:
            # Users table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    hashed_password TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'user',
                    created_at TEXT NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1
                )
            """)

            # Voice profiles table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS voice_profiles (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    label TEXT NOT NULL,
                    language TEXT NOT NULL,
                    reference_text TEXT NOT NULL,
                    audio_file_name TEXT NOT NULL,
                    audio_path TEXT NOT NULL,
                    speaker_embedding_path TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS service_tokens (
                    id TEXT PRIMARY KEY,
                    name TEXT UNIQUE NOT NULL,
                    token_hash TEXT UNIQUE NOT NULL,
                    scopes TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_used_at TEXT,
                    expires_at TEXT,
                    revoked_at TEXT
                )
            """)

    def seed_admin(self, username: str, hashed_password: str) -> None:
        """Create admin user if one doesn't exist."""
        with self._get_cursor() as cursor:
            cursor.execute("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'")
            row = cursor.fetchone()
            if row and row['cnt'] == 0:
                user_id = str(uuid.uuid4().hex)
                now = datetime.utcnow().isoformat()
                cursor.execute("""
                    INSERT INTO users (id, username, hashed_password, role, created_at, is_active)
                    VALUES (?, ?, ?, 'admin', ?, 1)
                """, (user_id, username, hashed_password, now))

    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """Get user by username."""
        with self._get_cursor() as cursor:
            cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user by ID."""
        with self._get_cursor() as cursor:
            cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def create_user(self, username: str, hashed_password: str, role: str = "user") -> Dict[str, Any]:
        """Create a new user. Raises ValueError if username exists."""
        user_id = str(uuid.uuid4().hex)
        now = datetime.utcnow().isoformat()
        with self._get_cursor() as cursor:
            try:
                cursor.execute("""
                    INSERT INTO users (id, username, hashed_password, role, created_at, is_active)
                    VALUES (?, ?, ?, ?, ?, 1)
                """, (user_id, username, hashed_password, role, now))
            except sqlite3.IntegrityError as e:
                if "UNIQUE constraint failed: users.username" in str(e):
                    raise ValueError(f"Username '{username}' already exists")
                raise
        return {
            "id": user_id,
            "username": username,
            "role": role,
            "created_at": now,
            "is_active": True,
        }

    def list_users(self) -> List[Dict[str, Any]]:
        """List all users."""
        with self._get_cursor() as cursor:
            cursor.execute("SELECT id, username, role, created_at, is_active FROM users ORDER BY created_at DESC")
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def delete_user(self, user_id: str) -> None:
        """Delete a user and all their voice profiles."""
        with self._get_cursor() as cursor:
            cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))

    def save_voice_profile(
        self,
        profile_id: str,
        user_id: str,
        label: str,
        language: str,
        reference_text: str,
        audio_file_name: str,
        audio_path: str,
        speaker_embedding_path: Optional[str] = None,
    ) -> None:
        """Save a voice profile to the database."""
        now = datetime.utcnow().isoformat()
        with self._get_cursor() as cursor:
            cursor.execute("""
                INSERT OR REPLACE INTO voice_profiles
                (id, user_id, label, language, reference_text, audio_file_name, audio_path, speaker_embedding_path, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (profile_id, user_id, label, language, reference_text, audio_file_name, audio_path, speaker_embedding_path, now))

    def list_profiles_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        """List all voice profiles for a user."""
        with self._get_cursor() as cursor:
            cursor.execute("""
                SELECT * FROM voice_profiles
                WHERE user_id = ?
                ORDER BY created_at DESC
            """, (user_id,))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def list_all_profiles(self) -> List[Dict[str, Any]]:
        """List all voice profiles across all users (admin only)."""
        with self._get_cursor() as cursor:
            cursor.execute("""
                SELECT * FROM voice_profiles
                ORDER BY created_at DESC
            """)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def get_profile_by_id(self, profile_id: str) -> Optional[Dict[str, Any]]:
        """Get a voice profile by ID."""
        with self._get_cursor() as cursor:
            cursor.execute("SELECT * FROM voice_profiles WHERE id = ?", (profile_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def delete_profile(self, profile_id: str) -> None:
        """Delete a voice profile by ID."""
        with self._get_cursor() as cursor:
            cursor.execute("DELETE FROM voice_profiles WHERE id = ?", (profile_id,))

    def upsert_service_token(
        self,
        name: str,
        token_hash: str,
        scopes: list[str],
        expires_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create or update a hashed service token."""
        token_id = str(uuid.uuid4().hex)
        now = datetime.utcnow().isoformat()
        scopes_json = json.dumps(scopes)
        with self._get_cursor() as cursor:
            cursor.execute("""
                INSERT INTO service_tokens (id, name, token_hash, scopes, created_at, expires_at, revoked_at)
                VALUES (?, ?, ?, ?, ?, ?, NULL)
                ON CONFLICT(name) DO UPDATE SET
                    token_hash = excluded.token_hash,
                    scopes = excluded.scopes,
                    expires_at = excluded.expires_at,
                    revoked_at = NULL
            """, (token_id, name, token_hash, scopes_json, now, expires_at))
            cursor.execute("SELECT * FROM service_tokens WHERE name = ?", (name,))
            row = cursor.fetchone()
            return dict(row) if row else {}

    def get_service_token_by_hash(self, token_hash: str) -> Optional[Dict[str, Any]]:
        """Look up an active service token by hash."""
        with self._get_cursor() as cursor:
            cursor.execute("""
                SELECT * FROM service_tokens
                WHERE token_hash = ? AND revoked_at IS NULL
            """, (token_hash,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def touch_service_token(self, token_id: str) -> None:
        """Record service-token use without changing scopes."""
        with self._get_cursor() as cursor:
            cursor.execute(
                "UPDATE service_tokens SET last_used_at = ? WHERE id = ?",
                (datetime.utcnow().isoformat(), token_id),
            )

    def migrate_orphaned_profiles(self, admin_user_id: str, voice_profiles_dir: Path) -> None:
        """
        Scan voice_profiles directory for JSON files that exist on disk but have no DB row.
        Assign them to the admin user.
        """
        if not voice_profiles_dir.exists():
            return

        with self._get_cursor() as cursor:
            for json_file in voice_profiles_dir.glob("*.json"):
                profile_id = json_file.stem
                cursor.execute("SELECT id FROM voice_profiles WHERE id = ?", (profile_id,))
                if cursor.fetchone() is None:
                    # Profile exists on disk but not in DB; load metadata and insert
                    try:
                        data = json.loads(json_file.read_text())
                        # Use data from the JSON file if available
                        label = data.get("label", profile_id)
                        language = data.get("language", "en")
                        reference_text = data.get("reference_text", "")
                        audio_file_name = data.get("audio_file_name", f"{profile_id}.wav")
                        audio_path = data.get("audio_path", "")
                        speaker_embedding_path = data.get("speaker_embedding_path", f"{profile_id}.speaker.npz")
                        created_at = data.get("created_at", datetime.utcnow().isoformat())

                        cursor.execute("""
                            INSERT INTO voice_profiles
                            (id, user_id, label, language, reference_text, audio_file_name, audio_path, speaker_embedding_path, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (profile_id, admin_user_id, label, language, reference_text, audio_file_name, audio_path, speaker_embedding_path, created_at))
                    except Exception as e:
                        # Log but don't fail on individual profile migration
                        print(f"Warning: Failed to migrate profile {profile_id}: {e}")
