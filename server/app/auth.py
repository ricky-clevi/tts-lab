"""
Authentication module for Ivy Voice Lab.
Handles JWT tokens, password hashing, and FastAPI dependencies.
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional
from jose import jwt
from jose.exceptions import JWTError, ExpiredSignatureError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status, Request

# JWT configuration
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24
JWT_SECRET = os.getenv("JWT_SECRET", "")

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def validate_jwt_secret() -> None:
    """Validate that JWT_SECRET is configured."""
    if not JWT_SECRET:
        raise RuntimeError("JWT_SECRET environment variable is required. Please set it before running.")


def hash_password(plain_password: str) -> str:
    """Hash a plain text password using bcrypt."""
    return pwd_context.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain text password against a bcrypt hash."""
    return pwd_context.verify(plain_password, hashed_password)


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
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    parts = auth_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header format",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = parts[1]
    return decode_token(token)


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
