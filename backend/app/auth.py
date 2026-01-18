"""
Sanctum Authentication Module
Handles magic link email authentication with signed tokens.
"""

import os
import secrets
import smtplib
import logging
from pathlib import Path
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from typing import Optional

from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature
from fastapi import Depends, HTTPException, Header

logger = logging.getLogger("sanctum.auth")


def _get_or_create_secret_key() -> str:
    """
    Get SECRET_KEY from environment, or generate and persist one.
    Priority: ENV var > persisted file > generate new

    The key is persisted in the same directory as the SQLite database,
    ensuring it survives container restarts via Docker volume.
    """
    # 1. Check environment variable first (highest priority)
    env_key = os.environ.get("SECRET_KEY")
    if env_key:
        logger.info("Using SECRET_KEY from environment variable")
        return env_key

    # 2. Check for persisted key file (same directory as SQLite)
    data_dir = Path(os.environ.get("SQLITE_PATH", "/data/sanctum.db")).parent
    key_file = data_dir / ".secret_key"

    if key_file.exists():
        logger.info(f"Using persisted SECRET_KEY from {key_file}")
        return key_file.read_text().strip()

    # 3. Generate new key and persist it
    new_key = secrets.token_hex(32)
    try:
        key_file.parent.mkdir(parents=True, exist_ok=True)
        key_file.write_text(new_key)
        # Restrict permissions (owner read/write only)
        key_file.chmod(0o600)
        logger.warning(f"Generated new SECRET_KEY and saved to {key_file}")
    except Exception as e:
        logger.warning(f"Could not persist SECRET_KEY to {key_file}: {e}")
        logger.warning("Using generated key for this session only (tokens will be invalid after restart)")

    return new_key


# Configuration
SECRET_KEY = _get_or_create_secret_key()
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
MOCK_EMAIL = os.environ.get("MOCK_EMAIL", "false").lower() == "true"

# SMTP Configuration
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "Sanctum <noreply@localhost>")

# Token expiration (15 minutes)
MAGIC_LINK_MAX_AGE = 15 * 60

# Session expiration (7 days)
SESSION_MAX_AGE = 7 * 24 * 60 * 60

# Serializers
_magic_link_serializer = URLSafeTimedSerializer(SECRET_KEY)
_session_serializer = URLSafeTimedSerializer(SECRET_KEY)


def create_magic_link_token(email: str, name: str = "") -> str:
    """Generate a signed, time-limited magic link token."""
    return _magic_link_serializer.dumps(
        {"email": email, "name": name},
        salt="magic-link"
    )


def verify_magic_link_token(token: str) -> Optional[dict]:
    """
    Verify a magic link token.
    Returns {"email": ..., "name": ...} if valid, None otherwise.
    """
    try:
        data = _magic_link_serializer.loads(
            token,
            salt="magic-link",
            max_age=MAGIC_LINK_MAX_AGE
        )
        return data
    except SignatureExpired:
        logger.warning("Magic link token expired")
        return None
    except BadSignature:
        logger.warning("Invalid magic link token signature")
        return None


def create_session_token(user_id: int, email: str) -> str:
    """Generate a signed session token (stored in cookie)."""
    return _session_serializer.dumps(
        {"user_id": user_id, "email": email},
        salt="session"
    )


def verify_session_token(token: str) -> Optional[dict]:
    """
    Verify a session token.
    Returns {"user_id": ..., "email": ...} if valid, None otherwise.
    """
    try:
        data = _session_serializer.loads(
            token,
            salt="session",
            max_age=SESSION_MAX_AGE
        )
        return data
    except SignatureExpired:
        logger.debug("Session token expired")
        return None
    except BadSignature:
        logger.debug("Invalid session token signature")
        return None


# Admin session token functions
ADMIN_SESSION_SALT = "admin-session"
ADMIN_SESSION_MAX_AGE = 7 * 24 * 60 * 60  # 7 days


def create_admin_session_token(admin_id: int, pubkey: str) -> str:
    """Generate a signed admin session token."""
    return _session_serializer.dumps(
        {"admin_id": admin_id, "pubkey": pubkey, "type": "admin"},
        salt=ADMIN_SESSION_SALT
    )


def verify_admin_session_token(token: str) -> Optional[dict]:
    """Verify an admin session token. Returns payload if valid, None otherwise."""
    try:
        data = _session_serializer.loads(
            token,
            salt=ADMIN_SESSION_SALT,
            max_age=ADMIN_SESSION_MAX_AGE
        )
        if data.get("type") != "admin":
            return None
        return data
    except (SignatureExpired, BadSignature):
        return None


def send_magic_link_email(to_email: str, token: str) -> bool:
    """
    Send magic link email via SMTP.
    Returns True if sent successfully.
    In MOCK_EMAIL mode, logs the link instead of sending.
    """
    verify_url = f"{FRONTEND_URL}/verify?token={token}"

    # Mock mode for development
    if MOCK_EMAIL or not SMTP_HOST:
        logger.info("=" * 60)
        logger.info("MAGIC LINK (mock mode - no email sent)")
        logger.info(f"To: {to_email}")
        logger.info(f"URL: {verify_url}")
        logger.info("=" * 60)
        return True

    # Build email
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Sign in to Sanctum"
    msg["From"] = SMTP_FROM
    msg["To"] = to_email

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; color: #333;">
        <div style="max-width: 480px; margin: 0 auto;">
            <h2 style="color: #333; margin-bottom: 24px;">Sign in to Sanctum</h2>
            <p style="margin-bottom: 24px;">Click the button below to sign in. This link will expire in 15 minutes.</p>
            <a href="{verify_url}"
               style="display: inline-block; background: #3B82F6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
                Sign in to Sanctum
            </a>
            <p style="margin-top: 24px; font-size: 14px; color: #666;">
                If you didn't request this email, you can safely ignore it.
            </p>
            <p style="margin-top: 24px; font-size: 12px; color: #999;">
                Or copy this link: {verify_url}
            </p>
        </div>
    </body>
    </html>
    """
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_FROM, [to_email], msg.as_string())
        logger.info(f"Magic link email sent to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Failed to send magic link email: {e}")
        return False


async def require_admin(authorization: Optional[str] = Header(None)) -> dict:
    """
    FastAPI dependency requiring valid admin authentication.
    Returns admin dict or raises 401.
    """
    # Import here to avoid circular imports
    import database

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization[7:]
    data = verify_admin_session_token(token)
    if not data:
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")

    admin = database.get_admin_by_pubkey(data["pubkey"])
    if not admin:
        raise HTTPException(status_code=401, detail="Admin not found")

    return admin


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """
    FastAPI dependency requiring valid user authentication.
    Returns user dict or raises 401.
    """
    import database

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization[7:]
    data = verify_session_token(token)
    if not data:
        raise HTTPException(status_code=401, detail="Invalid or expired session token")

    user = database.get_user(data["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user


async def require_approved_user(user: dict = Depends(get_current_user)) -> dict:
    """
    FastAPI dependency requiring an approved user.
    Use on chat/query endpoints.
    """
    if not user.get("approved"):
        raise HTTPException(status_code=403, detail="User not approved")
    return user
