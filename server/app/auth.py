"""
Authentication module for Ivy Voice Lab.
Handles JWT tokens, password hashing, and FastAPI dependencies.
"""

import hmac
import os
import secrets
from hashlib import sha256
from datetime import datetime, timedelta, timezone
from typing import Dict, Any
import bcrypt
from jose import jwt
from jose.exceptions import JWTError, ExpiredSignatureError
from fastapi import Depends, HTTPException, status, Request

# JWT configuration
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24
JWT_SECRET = os.getenv("JWT_SECRET", "")

MAX_BCRYPT_PASSWORD_BYTES = 72


def _password_bytes(plain_password: str) -> bytes:
    data = plain_password.encode("utf-8")
    if len(data) > MAX_BCRYPT_PASSWORD_BYTES:
        raise ValueError("Password cannot be longer than 72 bytes.")
    return data


def validate_jwt_secret() -> None:
    """Validate that JWT_SECRET is configured."""
    if not JWT_SECRET:
        raise RuntimeError("JWT_SECRET environment variable is required. Please set it before running.")


def hash_password(plain_password: str) -> str:
    """Hash a plain text password using bcrypt."""
    return bcrypt.hashpw(_password_bytes(plain_password), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain text password against a bcrypt hash."""
    try:
        return bcrypt.checkpw(_password_bytes(plain_password), hashed_password.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(user_id: str, username: str, role: str) -> str:
    """
    Create a JWT access token.

    Args:
        user_id: The user's UUID
        username: The user's username
        role: The user's role ('admin' or 'user')

    Returns:
        Encoded JWT token
    """
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=JWT_EXPIRY_HOURS)

    payload = {
        "sub": user_id,  # subject (user ID)
        "username": username,
        "role": role,
        "iat": int(now.timestamp()),  # issued at
        "exp": int(expires.timestamp()),  # expiration
    }

    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Dict[str, Any]:
    """
    Decode and validate a JWT token.

    Args:
        token: The JWT token to decode

    Returns:
        Decoded token payload

    Raises:
        HTTPException: If token is invalid or expired
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def validate_user_payload(payload: Dict[str, Any], db: Any) -> Dict[str, Any]:
    """Validate JWT claims against the current database user state."""
    user_id = str(payload.get("sub") or "").strip()
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.get_user_by_id(user_id) if db is not None else None
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not bool(user.get("is_active")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User is inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )

    role = str(user.get("role") or "")
    if role not in {"admin", "user"}:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User role is invalid",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {
        "sub": str(user["id"]),
        "username": str(user["username"]),
        "role": role,
    }


def hash_service_token(token: str) -> str:
    """Hash a long-lived service token for constant-time database lookup."""
    return sha256(token.encode("utf-8")).hexdigest()


def generate_service_token() -> str:
    """Generate a new service token value suitable for bootstrap env configuration."""
    return secrets.token_urlsafe(40)


def extract_bearer_or_api_key(request: Request) -> str | None:
    """Extract Bearer, X-API-Key, or query token credentials from a request."""
    api_key = request.headers.get("X-API-Key")
    if api_key:
        return api_key.strip()

    auth_header = request.headers.get("Authorization")
    if auth_header:
        parts = auth_header.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1].strip()

    query_token = request.query_params.get("token")
    if query_token:
        return query_token.strip()

    return None


def verify_runtime_api_key(provided: str | None) -> bool:
    configured = os.getenv("RUNTIME_API_KEY", "").strip()
    if not configured or not provided:
        return False
    return hmac.compare_digest(provided, configured)


def require_runtime_api_key(request: Request) -> None:
    """Require the OpenAI-compatible runtime API key."""
    if verify_runtime_api_key(extract_bearer_or_api_key(request)):
        return
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing runtime API key",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(request: Request) -> Dict[str, Any]:
    """
    FastAPI dependency to extract and validate the current user from the Authorization header.

    Args:
        request: The FastAPI request object

    Returns:
        Decoded token payload (contains 'sub' for user_id, 'username', 'role')

    Raises:
        HTTPException: If no token or invalid token
    """
    token = extract_bearer_or_api_key(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_token(token)
    db = getattr(getattr(request.app, "state", None), "db", None)
    return validate_user_payload(payload, db)


def require_admin(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """
    FastAPI dependency to ensure the current user is an admin.

    Args:
        current_user: The current user (from get_current_user dependency)

    Returns:
        The user dict if admin, otherwise raises exception

    Raises:
        HTTPException: If user is not an admin
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user
