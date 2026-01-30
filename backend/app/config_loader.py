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

# Key translation maps for different LLM providers
# UI uses generic keys, providers use specific keys
KEY_TRANSLATION = {
    "maple": {
        "LLM_API_URL": "MAPLE_BASE_URL",
        "LLM_MODEL": "MAPLE_MODEL",
        "LLM_API_KEY": "MAPLE_API_KEY",
    },
    "ollama": {
        "LLM_API_URL": "OLLAMA_BASE_URL",
        "LLM_MODEL": "OLLAMA_MODEL",
    },
}

# Email config translation
EMAIL_KEY_TRANSLATION = {
    "MOCK_SMTP": "MOCK_EMAIL",
}


def _get_provider() -> str:
    """Get current LLM provider from config or env"""
    # Use cache to avoid repeated DB queries
    _refresh_cache_if_needed()
    with _cache_lock:
        if "LLM_PROVIDER" in _config_cache:
            value = _config_cache["LLM_PROVIDER"]
            if value and value != MASKED_VALUE_PLACEHOLDER:
                return value
    return os.getenv("LLM_PROVIDER", "maple")


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
            cursor.execute("SELECT key, value FROM deployment_config")
            rows = cursor.fetchall()

        new_cache = {}
        for row in rows:
            if row["value"] is not None:
                new_cache[row["key"]] = row["value"]

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
            if value is not None:
                return value

    # Try key translation for provider-specific keys
    provider = _get_provider()
    translation_map = KEY_TRANSLATION.get(provider, {})

    # If this is a generic key, try the provider-specific version
    if key in translation_map:
        translated_key = translation_map[key]
        # Check cache for translated key (thread-safe read)
        with _cache_lock:
            if translated_key in _config_cache:
                value = _config_cache[translated_key]
                if value is not None:
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
                if value is not None:
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
    Returns provider-agnostic keys mapped to current values.
    """
    provider = _get_provider()

    return {
        "provider": provider,
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


def get_smtp_config() -> dict:
    """
    Get SMTP configuration with lazy loading.
    Returns config dict with all SMTP settings.
    """
    mock_mode = get_config("MOCK_EMAIL", get_config("MOCK_SMTP", "false"))

    return {
        "host": get_config("SMTP_HOST", ""),
        "port": _safe_int(get_config("SMTP_PORT", "587"), 587),
        "user": get_config("SMTP_USER", ""),
        "password": get_config("SMTP_PASS", ""),
        "from_address": get_config("SMTP_FROM", "Sanctum <noreply@localhost>"),
        "timeout": _safe_int(get_config("SMTP_TIMEOUT", "10"), 10),
        "mock_mode": mock_mode.lower() == "true" if isinstance(mock_mode, str) else bool(mock_mode),
    }
