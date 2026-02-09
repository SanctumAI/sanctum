"""
Rate limiting key helpers.

Goal: make rate limits resilient to token rotation (re-auth) by preferring a
stable authenticated identity when available.
"""

from __future__ import annotations

import hashlib
from fastapi import Request

import auth


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()[:20]


def _stable_actor_key_from_token(token: str) -> str | None:
    """
    Return a stable key for a verified token:
    - "admin_id:<id>" for admin session tokens
    - "user_id:<id>" for user session tokens
    """
    admin_data = auth.verify_admin_session_token(token)
    if admin_data and admin_data.get("admin_id") is not None:
        try:
            return f"admin_id:{int(admin_data['admin_id'])}"
        except (TypeError, ValueError):
            return "admin_id:unknown"

    user_data = auth.verify_session_token(token)
    if user_data and user_data.get("user_id") is not None:
        try:
            return f"user_id:{int(user_data['user_id'])}"
        except (TypeError, ValueError):
            return "user_id:unknown"

    return None


def rate_limit_key(request: Request) -> str:
    """
    Stable key for API rate limiting.

    Order:
    1. Stable actor id from verified bearer token (admin_id/user_id)
    2. Digest of bearer token
    3. Stable actor id from verified cookie token (admin_id/user_id)
    4. Digest of cookie token
    5. Client IP
    """
    auth_header = (request.headers.get("authorization", "") or "").strip()
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        if token:
            stable = _stable_actor_key_from_token(token)
            if stable:
                return stable
            return f"bearer:{_digest(token)}"

    cookie_token = request.cookies.get(auth.ADMIN_SESSION_COOKIE_NAME) or request.cookies.get(auth.USER_SESSION_COOKIE_NAME)
    if cookie_token:
        stable = _stable_actor_key_from_token(cookie_token)
        if stable:
            return stable
        return f"cookie:{_digest(cookie_token)}"

    client_host = (request.client.host if request.client else None) or "unknown"
    return f"ip:{client_host}"

