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

# SMTP Configuration - now loaded lazily via config_loader
# Keep module-level defaults for startup


def _safe_int(value: str | None, default: int) -> int:
    """Safely parse an integer from string, returning default on failure."""
    if value is None:
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


_SMTP_DEFAULTS = {
    "host": os.environ.get("SMTP_HOST", ""),
    "port": _safe_int(os.environ.get("SMTP_PORT"), 587),
    "user": os.environ.get("SMTP_USER", ""),
    "password": os.environ.get("SMTP_PASS", ""),
    "from_address": os.environ.get("SMTP_FROM", "Sanctum <noreply@localhost>"),
    "timeout": _safe_int(os.environ.get("SMTP_TIMEOUT"), 10),
    "mock_mode": MOCK_EMAIL,
}


def _get_smtp_config() -> dict:
    """
    Get SMTP configuration with runtime config support.
    Checks config_loader first, falls back to environment variables.
    """
    try:
        from config_loader import get_smtp_config
        config = get_smtp_config()
        # Validate required keys exist
        required_keys = {"host", "port", "user", "password", "from_address", "timeout", "mock_mode"}
        if config and required_keys.issubset(config.keys()):
            return config
        logger.warning("config_loader returned incomplete SMTP config, using defaults")
        return _SMTP_DEFAULTS
    except ImportError:
        return _SMTP_DEFAULTS
    except Exception as e:
        logger.warning(f"Failed to load SMTP config from config_loader: {e}")
        return _SMTP_DEFAULTS


# ============================================================================
# DEPRECATED: Legacy module-level SMTP constants
# ============================================================================
# These constants are frozen at import time and will NOT reflect runtime
# configuration changes. They are kept for backwards compatibility only.
#
# PREFERRED API: Use the runtime-aware accessor functions instead:
#   - get_smtp_host() / get_smtp_port() / get_smtp_user() / etc.
#   - Or use _get_smtp_config() to get the full config dict
#
# These legacy constants will be removed in a future version.
# ============================================================================
SMTP_HOST = _SMTP_DEFAULTS["host"]
SMTP_PORT = _SMTP_DEFAULTS["port"]
SMTP_USER = _SMTP_DEFAULTS["user"]
SMTP_PASS = _SMTP_DEFAULTS["password"]
SMTP_FROM = _SMTP_DEFAULTS["from_address"]
SMTP_TIMEOUT = _SMTP_DEFAULTS["timeout"]


# ============================================================================
# Runtime-aware SMTP configuration accessors
# ============================================================================
# These functions read from config_loader at runtime, supporting dynamic
# configuration changes without requiring a restart.
# ============================================================================

def get_smtp_host() -> str:
    """
    Get SMTP host with runtime config support.
    
    Returns:
        SMTP server hostname (empty string if not configured)
    """
    return _get_smtp_config()["host"]


def get_smtp_port() -> int:
    """
    Get SMTP port with runtime config support.
    
    Returns:
        SMTP server port (default: 587)
    """
    return _get_smtp_config()["port"]


def get_smtp_user() -> str:
    """
    Get SMTP username with runtime config support.
    
    Returns:
        SMTP username (empty string if not configured)
    """
    return _get_smtp_config()["user"]


def get_smtp_pass() -> str:
    """
    Get SMTP password with runtime config support.
    
    Returns:
        SMTP password (empty string if not configured)
    """
    return _get_smtp_config()["password"]


def get_smtp_from() -> str:
    """
    Get SMTP from address with runtime config support.
    
    Returns:
        From email address (default: "Sanctum <noreply@localhost>")
    """
    return _get_smtp_config()["from_address"]


def get_smtp_timeout() -> int:
    """
    Get SMTP timeout with runtime config support.
    
    Returns:
        SMTP connection timeout in seconds (default: 10)
    """
    return _get_smtp_config()["timeout"]

# Token expiration (15 minutes)
MAGIC_LINK_MAX_AGE = 15 * 60

# Session expiration (7 days)
SESSION_MAX_AGE = 7 * 24 * 60 * 60

# Serializers
_magic_link_serializer = URLSafeTimedSerializer(SECRET_KEY)
_session_serializer = URLSafeTimedSerializer(SECRET_KEY)


def verify_smtp_config() -> dict:
    """
    Verify SMTP configuration on startup (no email sent).

    Returns a dict with:
        - configured: bool - whether SMTP settings are present
        - mock_mode: bool - whether emails will be mocked (logged only)
        - connection_ok: bool - whether we can connect to SMTP server
        - error: str | None - error message if connection failed
    """
    # Get config lazily to support runtime changes
    smtp = _get_smtp_config()

    result = {
        "configured": False,
        "mock_mode": smtp["mock_mode"],
        "connection_ok": False,
        "error": None
    }

    # Check if SMTP is configured
    if not smtp["host"]:
        logger.warning("SMTP not configured: SMTP_HOST is empty")
        logger.info("Emails will be logged to console (mock mode implicit)")
        result["mock_mode"] = True  # Effectively in mock mode when unconfigured
        return result

    result["configured"] = True

    # If mock mode is enabled, skip connection test
    if smtp["mock_mode"]:
        logger.info(f"SMTP configured (host={smtp['host']}, port={smtp['port']}) but MOCK_EMAIL=true")
        logger.info("Magic link emails will be logged to console instead of sent")
        return result

    # Attempt connection test (no email sent)
    logger.info(f"Testing SMTP connection to {smtp['host']}:{smtp['port']}...")
    try:
        if smtp["port"] == 465:
            # Port 465 uses implicit SSL
            with smtplib.SMTP_SSL(smtp["host"], smtp["port"], timeout=smtp["timeout"]) as server:
                server.login(smtp["user"], smtp["password"])
                # NOOP command tests the connection without sending
                server.noop()
        else:
            # Port 587 (and others) use STARTTLS
            with smtplib.SMTP(smtp["host"], smtp["port"], timeout=smtp["timeout"]) as server:
                server.ehlo()
                if server.has_extn('starttls'):
                    server.starttls()
                    server.ehlo()
                server.login(smtp["user"], smtp["password"])
                server.noop()

        result["connection_ok"] = True
        logger.info(f"SMTP connection OK: {smtp['host']}:{smtp['port']} (from: {smtp['from_address']})")

    except smtplib.SMTPAuthenticationError as e:
        result["error"] = f"SMTP authentication failed: {e}"
        logger.error(result["error"])
    except smtplib.SMTPConnectError as e:
        result["error"] = f"SMTP connection failed: {e}"
        logger.error(result["error"])
    except TimeoutError:
        result["error"] = f"SMTP connection timed out after {smtp['timeout']}s"
        logger.error(result["error"])
    except Exception as e:
        result["error"] = f"SMTP error: {e}"
        logger.error(result["error"])

    return result


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
    # Dev mode: accept mock token for frontend testing
    if MOCK_EMAIL and token == "dev-mode-mock-token":
        logger.debug("Accepting dev-mode-mock-token (MOCK_EMAIL=true)")
        # Return a placeholder that get_current_user will handle
        return {"user_id": -1, "email": "dev-mode", "dev_mode": True}

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
    # Get config lazily to support runtime changes
    smtp = _get_smtp_config()

    verify_url = f"{FRONTEND_URL}/verify?token={token}"

    # Mock mode for development
    if smtp["mock_mode"] or not smtp["host"]:
        logger.info("=" * 60)
        logger.info("MAGIC LINK (mock mode - no email sent)")
        logger.info(f"To: {to_email}")
        logger.info(f"URL: {verify_url}")
        logger.info("=" * 60)
        return True

    # Build email
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Sign in to Sanctum"
    msg["From"] = smtp["from_address"]
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
        if smtp["port"] == 465:
            # Port 465 uses implicit SSL (connection starts encrypted)
            with smtplib.SMTP_SSL(smtp["host"], smtp["port"], timeout=smtp["timeout"]) as server:
                server.login(smtp["user"], smtp["password"])
                server.sendmail(smtp["from_address"], [to_email], msg.as_string())
        else:
            # Port 587 (and others) use STARTTLS (plain connection upgraded to TLS)
            with smtplib.SMTP(smtp["host"], smtp["port"], timeout=smtp["timeout"]) as server:
                server.ehlo()
                if server.has_extn('starttls'):
                    server.starttls()
                    server.ehlo()  # Re-identify after TLS upgrade
                server.login(smtp["user"], smtp["password"])
                server.sendmail(smtp["from_address"], [to_email], msg.as_string())
        logger.info("Magic link email sent successfully")
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

    # Dev mode: return a mock approved user for testing
    if data.get("dev_mode"):
        logger.debug("Returning dev mode mock user")
        return {
            "id": -1,
            "email": "dev@localhost",
            "name": "Dev User",
            "approved": True,
            "dev_mode": True
        }

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


async def require_admin_or_approved_user(authorization: Optional[str] = Header(None)) -> dict:
    """
    FastAPI dependency that accepts EITHER:
    - A valid admin session token, OR
    - A valid approved user session token
    
    Use this on endpoints (like /llm/chat) that should be accessible to both admins and users.
    """
    import database

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization[7:]
    
    # Try admin token first
    admin_data = verify_admin_session_token(token)
    if admin_data:
        admin = database.get_admin_by_pubkey(admin_data["pubkey"])
        if admin:
            return {"id": admin["id"], "type": "admin", "approved": True, "pubkey": admin_data["pubkey"]}
    
    # Try user token
    user_data = verify_session_token(token)
    if user_data:
        # Dev mode: return mock user
        if user_data.get("dev_mode"):
            logger.debug("Returning dev mode mock user for admin_or_approved")
            return {
                "id": -1,
                "email": "dev@localhost",
                "name": "Dev User",
                "approved": True,
                "type": "user",
                "dev_mode": True
            }

        user = database.get_user(user_data["user_id"])
        if user:
            if not user.get("approved"):
                raise HTTPException(status_code=403, detail="User not approved")
            user["type"] = "user"
            return user

    raise HTTPException(status_code=401, detail="Invalid or expired token")
