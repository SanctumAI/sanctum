"""
Sanctum Config Loader

Centralized configuration loading with database-first approach.
Reads deployment config from database, falls back to environment variables.
Includes caching with TTL for performance.
"""

import os
import time
import logging
import threading
from typing import Optional, Any

logger = logging.getLogger("sanctum.config_loader")

# Placeholder used when masking secret values in API responses
# This constant should be used consistently across the codebase
MASKED_VALUE_PLACEHOLDER = "********"

# Cache configuration with thread safety
_config_cache: dict[str, Any] = {}
_cache_time: float = 0
_cache_lock = threading.Lock()
CACHE_TTL = 60  # seconds

# Key translation map for Maple-backed LLM config.
# UI uses generic keys, runtime also supports Maple-specific env aliases.
KEY_TRANSLATION = {
    "LLM_API_URL": "MAPLE_BASE_URL",
    "LLM_MODEL": "MAPLE_MODEL",
    "LLM_API_KEY": "MAPLE_API_KEY",
}

# Email config translation
EMAIL_KEY_TRANSLATION = {
    "MOCK_SMTP": "MOCK_EMAIL",
}


def _get_provider() -> str:
    """Get current LLM provider from config or env (Maple only)."""
    # Use cache to avoid repeated DB queries
    _refresh_cache_if_needed()
    configured = None
    with _cache_lock:
        if "LLM_PROVIDER" in _config_cache:
            value = _config_cache["LLM_PROVIDER"]
            if value and value != MASKED_VALUE_PLACEHOLDER:
                configured = str(value).strip().lower()
    if not configured:
        configured = os.getenv("LLM_PROVIDER", "maple").strip().lower()
    if configured and configured != "maple":
        logger.warning("Unsupported LLM_PROVIDER=%r detected; using maple", configured)
    return "maple"


def _refresh_cache_if_needed():
    """Refresh config cache if TTL expired"""
    global _config_cache, _cache_time

    current_time = time.time()

    # Quick check under lock - don't hold lock during DB I/O
    with _cache_lock:
        if current_time - _cache_time < CACHE_TTL:
            return  # Cache still valid
        # Mark that we're refreshing to prevent concurrent refreshes
        last_cache_time = _cache_time

    # Perform DB query outside the lock to avoid blocking other threads
    try:
        import database

        # Build cache from database using raw values (not masked)
        with database.get_cursor() as cursor:
            cursor.execute("SELECT key, value, is_secret FROM deployment_config")
            rows = cursor.fetchall()

        new_cache = {}
        for row in rows:
            value = row["value"]
            if value is None:
                continue

            # Secrets are encrypted at rest in SQLite; decrypt before caching so runtime code
            # always sees the real value (env values remain plaintext).
            if row["is_secret"] and value:
                try:
                    value = database._decrypt_deployment_secret_value(value)  # internal helper
                except Exception as e:
                    logger.warning(f"Failed to decrypt deployment_config secret for key={row['key']!r}: {e}")
                    continue

            new_cache[row["key"]] = value

        # Re-acquire lock to update cache atomically
        with _cache_lock:
            # Only update if no other thread refreshed while we were querying
            if _cache_time == last_cache_time:
                _config_cache = new_cache
                _cache_time = current_time
                logger.debug(f"Config cache refreshed with {len(new_cache)} entries")

    except Exception as e:
        logger.warning(f"Failed to refresh config cache: {e}")
        # Apply backoff: retry after 10 seconds rather than immediately
        # This prevents thundering herd when DB is struggling, even if cache has stale data
        with _cache_lock:
            if _cache_time == last_cache_time:
                _cache_time = current_time - CACHE_TTL + 10


def invalidate_cache():
    """Invalidate the config cache (call after updates)"""
    global _cache_time
    with _cache_lock:
        _cache_time = 0


def get_config(key: str, default: Any = None) -> Any:
    """
    Get configuration value with database-first approach.

    1. Check database via cache
    2. Translate key based on provider if needed
    3. Fall back to environment variable

    Args:
        key: The configuration key to retrieve
        default: Default value if not found

    Returns:
        Configuration value or default
    """
    _refresh_cache_if_needed()

    # Check database cache first (thread-safe read)
    with _cache_lock:
        if key in _config_cache:
            value = _config_cache[key]
            # Treat empty strings as "unset" so env/default can still apply.
            # This makes it possible to "remove" a DB override without deleting rows.
            if value is not None and not (isinstance(value, str) and value.strip() == "") and value != MASKED_VALUE_PLACEHOLDER:
                return value

    # Try key translation for Maple-specific aliases.
    if key in KEY_TRANSLATION:
        translated_key = KEY_TRANSLATION[key]
        # Check cache for translated key (thread-safe read)
        with _cache_lock:
            if translated_key in _config_cache:
                value = _config_cache[translated_key]
                if value is not None and not (isinstance(value, str) and value.strip() == "") and value != MASKED_VALUE_PLACEHOLDER:
                    return value
        # Fall back to env var with translated key
        env_value = os.getenv(translated_key)
        if env_value is not None:
            return env_value

    # Try email key translation
    if key in EMAIL_KEY_TRANSLATION:
        translated_key = EMAIL_KEY_TRANSLATION[key]
        with _cache_lock:
            if translated_key in _config_cache:
                value = _config_cache[translated_key]
                if value is not None and not (isinstance(value, str) and value.strip() == "") and value != MASKED_VALUE_PLACEHOLDER:
                    return value
        env_value = os.getenv(translated_key)
        if env_value is not None:
            return env_value

    # Fall back to environment variable with original key
    env_value = os.getenv(key)
    if env_value is not None:
        return env_value

    return default


def get_llm_config() -> dict:
    """
    Get all LLM-related configuration.
    Returns Maple-backed generic keys mapped to current values.
    """
    return {
        "provider": _get_provider(),
        "base_url": get_config("LLM_API_URL"),
        "model": get_config("LLM_MODEL"),
        "api_key": get_config("LLM_API_KEY"),
    }


def _safe_int(value: Any, default: int) -> int:
    """Safely convert value to int, returning default on failure."""
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


def _unwrap_wrapping_quotes(value: str) -> str:
    """
    Remove a single pair of wrapping quotes: '"foo"' -> 'foo', "'foo'" -> "foo".
    Common when users set values in `.env` with quotes (Compose treats quotes literally).
    """
    s = value.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ("'", '"'):
        return s[1:-1].strip()
    return s


def _normalize_nonsecret_str(value: Any) -> str:
    """Normalize strings from env/DB for non-secret config values."""
    if value is None:
        return ""
    return _unwrap_wrapping_quotes(str(value))


def get_smtp_config() -> dict:
    """
    Get SMTP configuration with lazy loading.
    Returns config dict with all SMTP settings.
    """
    mock_mode = get_config("MOCK_EMAIL", get_config("MOCK_SMTP", "false"))

    return {
        "host": _normalize_nonsecret_str(get_config("SMTP_HOST", "")),
        "port": _safe_int(get_config("SMTP_PORT", "587"), 587),
        "user": _normalize_nonsecret_str(get_config("SMTP_USER", "")),
        # Passwords can legitimately contain leading/trailing whitespace; don't strip.
        "password": str(get_config("SMTP_PASS", "") or ""),
        "from_address": _normalize_nonsecret_str(get_config("SMTP_FROM", "Sanctum <noreply@localhost>")),
        "timeout": _safe_int(get_config("SMTP_TIMEOUT", "10"), 10),
        "mock_mode": mock_mode.lower() == "true" if isinstance(mock_mode, str) else bool(mock_mode),
    }
