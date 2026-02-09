"""
Sanctum Deployment Configuration Router
Handles environment settings, service health checks, and .env management.
"""

import os
import time
import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query, Request
from fastapi.responses import PlainTextResponse

import httpx

import auth
import database
from rate_limit import RateLimiter
from models import (
    DeploymentConfigItem,
    DeploymentConfigResponse,
    DeploymentConfigUpdate,
    ServiceHealthItem,
    ServiceHealthResponse,
    DeploymentValidationResponse,
    ConfigAuditLogEntry,
    ConfigAuditLogResponse,
    SuccessResponse,
)

logger = logging.getLogger("sanctum.deployment_config")

# Track when this module was loaded (service start time)
# Used to determine which config changes require restart
SERVICE_START_TIME = datetime.now(timezone.utc)

router = APIRouter(prefix="/admin/deployment", tags=["deployment"])

# High-risk export endpoint limiter (best-effort in-memory)
def _parse_rate_limit() -> int:
    try:
        return int(os.getenv("RATE_LIMIT_CONFIG_EXPORT_PER_HOUR", "5"))
    except ValueError:
        return 5

config_export_limiter = RateLimiter(
    limit=_parse_rate_limit(),
    window_seconds=60 * 60,
)


# Environment variable to config key mapping
# These are the keys we allow managing through the UI
ENV_CONFIG_MAP = {
    # LLM Settings
    "LLM_PROVIDER": {"category": "llm", "description": "LLM provider (maple, ollama)", "requires_restart": True, "default": "maple"},
    "LLM_MODEL": {"category": "llm", "description": "Model name/identifier", "requires_restart": False},  # Provider-translated
    "LLM_API_URL": {"category": "llm", "description": "LLM API base URL", "requires_restart": True},  # Provider-translated
    # Embedding Settings
    "EMBEDDING_MODEL": {"category": "embedding", "description": "Sentence transformer model", "requires_restart": True, "default": "intfloat/multilingual-e5-base"},
    # Email Settings (no defaults - optional, user must configure)
    "SMTP_HOST": {"category": "email", "description": "SMTP server hostname", "requires_restart": False},
    "SMTP_PORT": {"category": "email", "description": "SMTP server port", "requires_restart": False},
    "SMTP_USER": {"category": "email", "description": "SMTP username", "requires_restart": False, "is_secret": True},
    "SMTP_PASS": {"category": "email", "description": "SMTP password", "requires_restart": False, "is_secret": True},
    "SMTP_FROM": {"category": "email", "description": "From email address", "requires_restart": False},
    "MOCK_SMTP": {"category": "email", "description": "Enable mock email mode", "requires_restart": False},
    # SMTP test status keys (internal, set by test-email endpoint)
    "SMTP_LAST_TEST_SUCCESS": {"category": "email", "description": "Whether last SMTP test was successful", "requires_restart": False},
    "SMTP_LAST_TEST_AT": {"category": "email", "description": "Timestamp of last SMTP test", "requires_restart": False},
    # Storage Settings
    "SQLITE_PATH": {"category": "storage", "description": "SQLite database path", "requires_restart": True, "default": "/data/sanctum.db"},
    "UPLOADS_DIR": {"category": "storage", "description": "Uploads directory path", "requires_restart": True, "default": "/uploads"},
    # Qdrant Settings
    "QDRANT_HOST": {"category": "storage", "description": "Qdrant server hostname", "requires_restart": True, "default": "qdrant"},
    "QDRANT_PORT": {"category": "storage", "description": "Qdrant server port", "requires_restart": True, "default": "6333"},
    # Search Settings
    "SEARXNG_URL": {"category": "search", "description": "SearXNG instance URL", "requires_restart": False, "default": "http://searxng:8080"},
    # Security Settings
    "FRONTEND_URL": {"category": "security", "description": "Frontend application URL", "requires_restart": False, "default": "http://localhost:5173"},
    "SIMULATE_USER_AUTH": {"category": "security", "description": "Allow user verification without magic link token (testing only)", "requires_restart": False, "default": "false"},
    "SIMULATE_ADMIN_AUTH": {"category": "security", "description": "Show mock Nostr connection button for admin auth (testing only)", "requires_restart": False, "default": "false"},
    # RAG Settings
    "RAG_TOP_K": {"category": "llm", "description": "Default RAG retrieval count", "requires_restart": False, "default": "8"},
    "PDF_EXTRACT_MODE": {"category": "llm", "description": "PDF extraction mode (fast/quality)", "requires_restart": False, "default": "fast"},
    # Domain & URLs Settings
    "BASE_DOMAIN": {"category": "domains", "description": "Root domain name", "requires_restart": False, "default": "localhost"},
    "INSTANCE_URL": {"category": "domains", "description": "Full application URL with protocol", "requires_restart": True, "default": "http://localhost:5173"},
    "API_BASE_URL": {"category": "domains", "description": "API subdomain URL (optional)", "requires_restart": True, "default": "http://localhost:8000"},
    "ADMIN_BASE_URL": {"category": "domains", "description": "Admin panel subdomain URL (optional)", "requires_restart": True, "default": "http://localhost:5173/admin"},
    "EMAIL_DOMAIN": {"category": "domains", "description": "Domain for email addresses", "requires_restart": False, "default": "localhost"},
    "DKIM_SELECTOR": {"category": "domains", "description": "DKIM DNS record selector", "requires_restart": False, "default": "sanctum"},
    "SPF_INCLUDE": {"category": "domains", "description": "SPF DNS include directive (e.g., include:_spf.google.com)", "requires_restart": False, "default": ""},
    "DMARC_POLICY": {"category": "domains", "description": "DMARC DNS policy record", "requires_restart": False, "default": "v=DMARC1; p=none"},
    "CORS_ORIGINS": {"category": "domains", "description": "Comma-separated allowed CORS origins", "requires_restart": True, "default": "http://localhost:5173"},
    "CDN_DOMAINS": {"category": "domains", "description": "Content delivery domains", "requires_restart": False},
    "CUSTOM_SEARXNG_URL": {"category": "domains", "description": "Private SearXNG instance URL", "requires_restart": True},
    "WEBHOOK_BASE_URL": {"category": "domains", "description": "Webhook callback base URL", "requires_restart": False, "default": "http://localhost:8000"},
    # SSL & Security Settings
    "TRUSTED_PROXIES": {"category": "ssl", "description": "Trusted reverse proxies (cloudflare, aws, custom)", "requires_restart": True},
    "SSL_CERT_PATH": {"category": "ssl", "description": "SSL certificate file path", "requires_restart": True},
    "SSL_KEY_PATH": {"category": "ssl", "description": "SSL private key file path", "requires_restart": True, "is_secret": True},
    "FORCE_HTTPS": {"category": "ssl", "description": "Redirect HTTP to HTTPS", "requires_restart": True, "default": "false"},
    "HSTS_MAX_AGE": {"category": "ssl", "description": "HSTS max-age in seconds", "requires_restart": False, "default": "31536000"},
    "MONITORING_URL": {"category": "general", "description": "Health monitoring endpoint URL", "requires_restart": False, "default": "http://localhost:8000/health"},
}

# Keys that should never be exposed or editable
FORBIDDEN_KEYS = {"SECRET_KEY", "DATABASE_URL", "ADMIN_PRIVATE_KEY"}

# Allowed table names for audit log queries (prevents SQL injection)
ALLOWED_AUDIT_TABLES = {"deployment_config", "ai_config", "document_defaults"}


def _config_to_item(config: dict) -> DeploymentConfigItem:
    """Convert database row to DeploymentConfigItem"""
    return DeploymentConfigItem(
        key=config["key"],
        value=config["value"],
        is_secret=bool(config.get("is_secret")),
        requires_restart=bool(config.get("requires_restart")),
        category=config["category"],
        description=config.get("description"),
        updated_at=config.get("updated_at"),
    )


def _sync_env_to_db() -> None:
    """
    Sync current environment variables to the database.
    Only syncs keys that are in ENV_CONFIG_MAP and don't already exist in DB.
    Uses key translation for provider-specific variables.
    """
    # Import key translation from config_loader
    from config_loader import KEY_TRANSLATION, EMAIL_KEY_TRANSLATION

    # Get the current provider for key translation
    provider = os.getenv("LLM_PROVIDER", "maple")
    translation_map = KEY_TRANSLATION.get(provider, {})

    for key, meta in ENV_CONFIG_MAP.items():
        if key in FORBIDDEN_KEYS:
            continue

        existing = database.get_deployment_config(key)

        # Try to get value from env, with key translation
        value = None

        # 1. Try the original key
        value = os.getenv(key)

        # 2. If not found, try provider-translated key
        if value is None and key in translation_map:
            translated_key = translation_map[key]
            value = os.getenv(translated_key)

        # 3. If not found, try email key translation
        if value is None and key in EMAIL_KEY_TRANSLATION:
            translated_key = EMAIL_KEY_TRANSLATION[key]
            value = os.getenv(translated_key)

        # 4. Fall back to default from config map
        if value is None:
            value = meta.get("default", "")

        if existing:
            # Backfill empty values with defaults/env values
            existing_value = existing.get("value")
            should_backfill_value = (existing_value is None or existing_value == "") and value not in (None, "")
            # Keep metadata in sync for known one-off category corrections.
            should_sync_metadata = (
                key == "MONITORING_URL" and existing.get("category") != meta["category"]
            )

            if should_backfill_value or should_sync_metadata:
                value_to_store = existing_value if existing_value not in (None, "") else value
                database.upsert_deployment_config(
                    key=key,
                    value=value_to_store,
                    is_secret=meta.get("is_secret", False),
                    requires_restart=meta.get("requires_restart", False),
                    category=meta["category"],
                    description=meta.get("description", ""),
                )
                if should_backfill_value:
                    logger.debug(f"Backfilled empty config: {key} (value: {'***' if meta.get('is_secret') else value_to_store})")
                elif should_sync_metadata:
                    logger.debug(f"Synchronized config metadata: {key} (category -> {meta['category']})")
            continue

        database.upsert_deployment_config(
            key=key,
            value=value,
            is_secret=meta.get("is_secret", False),
            requires_restart=meta.get("requires_restart", False),
            category=meta["category"],
            description=meta.get("description", ""),
        )
        logger.debug(f"Synced env var to DB: {key} (value: {'***' if meta.get('is_secret') else value})")


@router.on_event("startup")
async def startup_sync() -> None:
    """Sync environment variables to database on startup"""
    _sync_env_to_db()


@router.get("/config", response_model=DeploymentConfigResponse)
async def get_deployment_config(admin: dict = Depends(auth.require_admin)):
    """
    Get all deployment configuration grouped by category.
    Secret values are masked.
    Requires admin authentication.
    """
    # Note: env sync happens at startup via lifespan hook - no need to sync on every read

    all_config = database.get_all_deployment_config()

    response = DeploymentConfigResponse()
    for config in all_config:
        item = _config_to_item(config)
        category = config["category"]

        if category == "llm":
            response.llm.append(item)
        elif category == "embedding":
            response.embedding.append(item)
        elif category == "email":
            response.email.append(item)
        elif category == "storage":
            response.storage.append(item)
        elif category == "security":
            response.security.append(item)
        elif category == "search":
            response.search.append(item)
        elif category == "domains":
            response.domains.append(item)
        elif category == "ssl":
            response.ssl.append(item)
        else:
            response.general.append(item)

    return response


@router.get("/config/export", response_class=PlainTextResponse)
async def export_env_file(
    request: Request,
    admin: dict = Depends(auth.require_admin),
    _: None = Depends(config_export_limiter),
):
    """
    Export current configuration as .env file format.
    Secret values are included (not masked).
    Requires admin authentication.
    """
    logger.warning(
        "High-risk config export requested by admin=%s from ip=%s",
        admin.get("pubkey", "unknown"),
        request.client.host if request.client else "unknown",
    )
    lines = ["# Sanctum Configuration Export", f"# Generated: {datetime.now(timezone.utc).isoformat()}", ""]

    # Get raw values from database (not masked)
    with database.get_cursor() as cursor:
        cursor.execute("SELECT * FROM deployment_config ORDER BY category, key")
        configs = [dict(row) for row in cursor.fetchall()]

    current_category = None
    for config in configs:
        if config["key"] in FORBIDDEN_KEYS:
            continue

        # Add category header
        if config["category"] != current_category:
            if current_category is not None:
                lines.append("")
            lines.append(f"# {config['category'].upper()}")
            current_category = config["category"]

        if config.get("is_secret"):
            value = database.get_deployment_config_value(config["key"]) or ""
        else:
            value = config["value"] or ""
        # Quote values with spaces or special chars, escape backslashes, newlines, tabs, and dollar signs
        if " " in value or "=" in value or "#" in value or '"' in value or "\\" in value or "\n" in value or "\r" in value or "\t" in value or "$" in value:
            # Escape backslashes first, then quotes, then dollar signs, then control characters
            value = value.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$").replace("\r", "\\r").replace("\n", "\\n").replace("\t", "\\t")
            value = f'"{value}"'

        lines.append(f"{config['key']}={value}")

    # Explicitly audit high-risk export action.
    # old/new values are intentionally omitted to avoid logging secret material.
    database.log_config_audit_event(
        table_name="deployment_config",
        config_key=".env_export",
        old_value=None,
        new_value=(
            f"exported_keys={len([c for c in configs if c.get('key') not in FORBIDDEN_KEYS])};"
            f"ip={request.client.host if request.client else 'unknown'}"
        ),
        changed_by=admin.get("pubkey", "unknown"),
    )

    return "\n".join(lines)


@router.get("/config/{key}", response_model=DeploymentConfigItem)
async def get_deployment_config_by_key(key: str, admin: dict = Depends(auth.require_admin)):
    """
    Get a single deployment config value.
    Secret values are masked.
    Requires admin authentication.
    """
    if key in FORBIDDEN_KEYS:
        raise HTTPException(status_code=403, detail="Access to this key is forbidden")

    config = database.get_deployment_config(key)
    if not config:
        raise HTTPException(status_code=404, detail=f"Config key not found: {key}")

    return _config_to_item(config)


@router.get("/config/{key}/reveal")
async def reveal_deployment_config_secret(key: str, admin: dict = Depends(auth.require_admin)):
    """
    Get the unmasked value of a secret config key.
    Only works for keys marked as secrets.
    Requires admin authentication.
    """
    if key in FORBIDDEN_KEYS:
        raise HTTPException(status_code=403, detail="Access to this key is forbidden")

    # Check database first for consistency with get_deployment_config_by_key
    config = database.get_deployment_config(key)
    if not config:
        raise HTTPException(status_code=404, detail=f"Config key not found: {key}")

    # Validate it's a secret using ENV_CONFIG_MAP metadata
    meta = ENV_CONFIG_MAP.get(key)
    if not meta or not meta.get("is_secret"):
        raise HTTPException(status_code=400, detail="This key is not a secret")

    # Get unmasked value using internal function
    value = database.get_deployment_config_value(key)

    return {"key": key, "value": value or ""}


@router.put("/config/{key}", response_model=DeploymentConfigItem)
async def update_deployment_config_value(
    key: str,
    update: DeploymentConfigUpdate,
    admin: dict = Depends(auth.require_admin)
):
    """
    Update a deployment config value.
    Note: Changes may require service restart to take effect.
    Requires admin authentication.
    """
    if key in FORBIDDEN_KEYS:
        raise HTTPException(status_code=403, detail="This key cannot be modified")

    if key not in ENV_CONFIG_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown config key: {key}")

    meta = ENV_CONFIG_MAP[key]
    value_to_save = update.value

    # For secret keys, preserve existing value if new value is empty/whitespace
    # This prevents accidentally clearing secrets when the masked value is submitted
    if meta.get("is_secret") and (not value_to_save or not value_to_save.strip()):
        existing_value = database.get_deployment_config_value(key)
        if existing_value:
            value_to_save = existing_value
            logger.debug(f"Preserving existing secret value for {key} (empty value submitted)")

    # Validate specific keys (only if we have a real value to validate)
    if key in ("SMTP_PORT", "QDRANT_PORT") and value_to_save:
        try:
            port = int(value_to_save)
            if port < 1 or port > 65535:
                raise ValueError()
        except ValueError:
            raise HTTPException(status_code=400, detail="Port must be between 1 and 65535")

    # Normalize and validate SMTP hostname-ish fields.
    # Users often paste `"smtp.example.com"` (quotes become literal in some env loaders)
    # or `smtp.example.com:587` (port belongs in SMTP_PORT).
    if key in ("SMTP_HOST", "SMTP_USER", "SMTP_FROM") and isinstance(value_to_save, str):
        value_to_save = value_to_save.strip()
        if len(value_to_save) >= 2 and value_to_save[0] == value_to_save[-1] and value_to_save[0] in ("'", '"'):
            value_to_save = value_to_save[1:-1].strip()

    if key == "SMTP_HOST" and value_to_save:
        if "://" in value_to_save or "/" in value_to_save:
            raise HTTPException(
                status_code=400,
                detail="SMTP_HOST must be a hostname only (e.g., smtp.example.com) without protocol or path",
            )
        # Detect common host:port paste (allow IPv6 which contains multiple colons).
        if isinstance(value_to_save, str) and value_to_save.count(":") == 1:
            host_part, port_part = value_to_save.rsplit(":", 1)
            if host_part and port_part.isdigit():
                raise HTTPException(
                    status_code=400,
                    detail="SMTP_HOST should not include a port. Put the port in SMTP_PORT instead.",
                )

    if key == "RAG_TOP_K" and value_to_save:
        try:
            top_k = int(value_to_save)
            if top_k < 1 or top_k > 100:
                raise ValueError()
        except ValueError:
            raise HTTPException(status_code=400, detail="RAG_TOP_K must be between 1 and 100")

    # URL validation for URL-type fields
    URL_KEYS = {"INSTANCE_URL", "API_BASE_URL", "ADMIN_BASE_URL", "CUSTOM_SEARXNG_URL",
                "WEBHOOK_BASE_URL", "MONITORING_URL"}
    if key in URL_KEYS and value_to_save:
        from urllib.parse import urlparse
        parsed = urlparse(value_to_save)
        if not parsed.scheme or not parsed.netloc:
            raise HTTPException(status_code=400, detail=f"{key} must be a valid URL with protocol (e.g., https://example.com)")

    # Domain validation
    DOMAIN_KEYS = {"BASE_DOMAIN", "EMAIL_DOMAIN"}
    if key in DOMAIN_KEYS and value_to_save:
        import re
        domain_pattern = r'^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$'
        if not re.match(domain_pattern, value_to_save):
            raise HTTPException(status_code=400, detail=f"{key} must be a valid domain name")

    # HSTS max-age validation
    if key == "HSTS_MAX_AGE" and value_to_save:
        try:
            hsts = int(value_to_save)
            if hsts < 0:
                raise ValueError()
        except ValueError:
            raise HTTPException(status_code=400, detail="HSTS_MAX_AGE must be a non-negative integer")

    # Boolean validation for FORCE_HTTPS
    if key == "FORCE_HTTPS" and value_to_save:
        if value_to_save.lower() not in ("true", "false", "1", "0", "yes", "no", "on", "off"):
            raise HTTPException(status_code=400, detail="FORCE_HTTPS must be a boolean value (true/false, 1/0, yes/no, on/off)")

    # Get admin pubkey for audit log
    admin_pubkey = admin.get("pubkey")
    if not admin_pubkey:
        logger.warning("Admin pubkey not found in auth context for config update")
        admin_pubkey = "unknown"

    # Upsert the config (atomic create-or-update)
    database.upsert_deployment_config(
        key=key,
        value=value_to_save,
        is_secret=meta.get("is_secret", False),
        requires_restart=meta.get("requires_restart", False),
        category=meta["category"],
        description=meta.get("description", ""),
        changed_by=admin_pubkey,
    )

    # If SMTP config changed, reset test status so user re-verifies
    smtp_keys = {"SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"}
    if key in smtp_keys:
        try:
            database.upsert_deployment_config(
                key="SMTP_LAST_TEST_SUCCESS",
                value="false",
                is_secret=False,
                requires_restart=False,
                category="email",
                description="Whether last SMTP test was successful",
                changed_by=admin_pubkey,
            )
            logger.info(f"SMTP test status reset due to {key} change")
        except Exception as e:
            logger.warning(f"Failed to reset SMTP test status after {key} change: {e}")

    # Invalidate config cache so changes take effect immediately
    try:
        from config_loader import invalidate_cache
        invalidate_cache()
        logger.info(f"Config cache invalidated after updating {key}")
    except ImportError as e:
        logger.debug(f"config_loader not available, skipping cache invalidation: {e}")

    # Return updated config
    updated = database.get_deployment_config(key)
    if not updated:
        raise HTTPException(status_code=500, detail="Config updated but could not be retrieved")
    return _config_to_item(updated)


@router.post("/config/validate", response_model=DeploymentValidationResponse)
async def validate_config(admin: dict = Depends(auth.require_admin)):
    """
    Validate current configuration.
    Checks for required values and valid formats.
    Requires admin authentication.
    """
    errors = []
    warnings = []

    all_config = database.get_all_deployment_config()
    config_dict = {c["key"]: c["value"] for c in all_config}

    # Check required settings
    required = ["LLM_PROVIDER", "QDRANT_HOST", "QDRANT_PORT"]
    for key in required:
        if not config_dict.get(key):
            errors.append(f"Missing required setting: {key}")

    # Check port values
    for port_key in ["SMTP_PORT", "QDRANT_PORT"]:
        if config_dict.get(port_key):
            try:
                port = int(config_dict[port_key])
                if port < 1 or port > 65535:
                    errors.append(f"{port_key} must be between 1 and 65535")
            except ValueError:
                errors.append(f"{port_key} must be a number")

    # Warnings for common issues
    if config_dict.get("MOCK_SMTP", "").lower() == "true":
        warnings.append("MOCK_SMTP is enabled - emails will not be sent")

    if not config_dict.get("SMTP_HOST") and config_dict.get("MOCK_SMTP", "").lower() != "true":
        warnings.append("SMTP not configured - email features will not work")

    if not config_dict.get("SEARXNG_URL"):
        warnings.append("SEARXNG_URL not configured - web search will not work")

    # Check for SSL configuration consistency
    ssl_cert = config_dict.get("SSL_CERT_PATH", "")
    ssl_key = config_dict.get("SSL_KEY_PATH", "")
    force_https = config_dict.get("FORCE_HTTPS", "").lower() in ("true", "1", "yes", "on")

    if force_https and (not ssl_cert or not ssl_key):
        warnings.append("FORCE_HTTPS is enabled but SSL certificate paths are not configured")

    if ssl_cert and not ssl_key:
        warnings.append("SSL_CERT_PATH is set but SSL_KEY_PATH is missing")

    if ssl_key and not ssl_cert:
        warnings.append("SSL_KEY_PATH is set but SSL_CERT_PATH is missing")

    # Check CORS origins match configured domains
    cors_origins_raw = config_dict.get("CORS_ORIGINS", "")
    instance_url = config_dict.get("INSTANCE_URL", "").rstrip("/")
    if instance_url and cors_origins_raw:
        # Parse comma-separated origins and normalize (strip whitespace and trailing slashes)
        cors_origins_list = [origin.strip().rstrip("/") for origin in cors_origins_raw.split(",") if origin.strip()]
        if instance_url not in cors_origins_list:
            warnings.append("INSTANCE_URL is not included in CORS_ORIGINS - this may cause CORS errors")

    return DeploymentValidationResponse(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings
    )


@router.get("/health", response_model=ServiceHealthResponse)
async def get_service_health(admin: dict = Depends(auth.require_admin)):
    """
    Get health status of all connected services.
    Requires admin authentication.
    """
    services = []
    all_config = database.get_all_deployment_config()
    config_dict = {c["key"]: c["value"] for c in all_config}

    # Check Qdrant
    qdrant_host = config_dict.get("QDRANT_HOST") or os.getenv("QDRANT_HOST", "localhost")
    qdrant_port = config_dict.get("QDRANT_PORT") or os.getenv("QDRANT_PORT", "6333")
    try:
        start = time.time()
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"http://{qdrant_host}:{qdrant_port}/collections")
        response_time = int((time.time() - start) * 1000)
        services.append(ServiceHealthItem(
            name="Qdrant",
            status="healthy" if resp.status_code == 200 else "unhealthy",
            response_time_ms=response_time,
            last_checked=datetime.now(timezone.utc).isoformat(),
        ))
    except Exception as e:
        logger.warning(f"Qdrant health check failed: {e}")
        services.append(ServiceHealthItem(
            name="Qdrant",
            status="unhealthy",
            last_checked=datetime.now(timezone.utc).isoformat(),
            error="Connection failed",
        ))

    # Check LLM Provider
    llm_provider = config_dict.get("LLM_PROVIDER") or os.getenv("LLM_PROVIDER", "maple")
    llm_url = config_dict.get("LLM_API_URL") or os.getenv("LLM_API_URL", "")

    if llm_provider == "maple":
        base_url = llm_url or "http://maple-proxy:8080"
        if base_url.endswith("/v1"):
            base_url = base_url[:-3]
        llm_health_url = base_url.rstrip("/") + "/health"
    elif llm_provider == "ollama":
        llm_health_url = (llm_url or "http://localhost:11434").rstrip("/") + "/api/version"
    else:
        llm_health_url = None

    if llm_health_url:
        try:
            start = time.time()
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(llm_health_url)
            response_time = int((time.time() - start) * 1000)
            services.append(ServiceHealthItem(
                name=f"LLM ({llm_provider})",
                status="healthy" if resp.status_code == 200 else "unhealthy",
                response_time_ms=response_time,
                last_checked=datetime.now(timezone.utc).isoformat(),
            ))
        except Exception as e:
            logger.warning(f"LLM ({llm_provider}) health check failed: {e}")
            services.append(ServiceHealthItem(
                name=f"LLM ({llm_provider})",
                status="unhealthy",
                last_checked=datetime.now(timezone.utc).isoformat(),
                error="Connection failed",
            ))

    # Check SearXNG
    searxng_url = config_dict.get("SEARXNG_URL") or os.getenv("SEARXNG_URL", "")
    if searxng_url:
        try:
            start = time.time()
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{searxng_url.rstrip('/')}/healthz")
            response_time = int((time.time() - start) * 1000)
            services.append(ServiceHealthItem(
                name="SearXNG",
                status="healthy" if resp.status_code == 200 else "unhealthy",
                response_time_ms=response_time,
                last_checked=datetime.now(timezone.utc).isoformat(),
            ))
        except Exception as e:
            logger.warning(f"SearXNG health check failed: {e}")
            services.append(ServiceHealthItem(
                name="SearXNG",
                status="unhealthy",
                last_checked=datetime.now(timezone.utc).isoformat(),
                error="Connection failed",
            ))
    else:
        services.append(ServiceHealthItem(
            name="SearXNG",
            status="unknown",
            last_checked=datetime.now(timezone.utc).isoformat(),
            error="Not configured",
        ))

    # Check SMTP (if configured)
    smtp_host = config_dict.get("SMTP_HOST") or os.getenv("SMTP_HOST", "")
    mock_smtp = (config_dict.get("MOCK_SMTP") or os.getenv("MOCK_SMTP", "")).lower() == "true"

    if mock_smtp:
        services.append(ServiceHealthItem(
            name="SMTP",
            status="unknown",
            last_checked=datetime.now(timezone.utc).isoformat(),
            error="Mock mode enabled",
        ))
    elif smtp_host:
        # Check for recent successful test
        last_test_at = config_dict.get("SMTP_LAST_TEST_AT")
        last_test_success = config_dict.get("SMTP_LAST_TEST_SUCCESS") == "true"

        if last_test_success and last_test_at:
            # Show as healthy with last test time
            services.append(ServiceHealthItem(
                name="SMTP",
                status="healthy",
                last_checked=last_test_at,
                error=None,
            ))
        else:
            # Not tested yet
            services.append(ServiceHealthItem(
                name="SMTP",
                status="unknown",
                last_checked=datetime.now(timezone.utc).isoformat(),
                error="Configured - click 'Send Test Email' to verify",
            ))
    else:
        services.append(ServiceHealthItem(
            name="SMTP",
            status="unknown",
            last_checked=datetime.now(timezone.utc).isoformat(),
            error="Not configured",
        ))

    # Check if restart is required
    restart_keys = database.get_restart_required_keys()
    audit_log = database.get_config_audit_log(limit=50, table_name="deployment_config")

    # Find keys that were changed since service started
    changed_requiring_restart = []
    for entry in audit_log:
        if entry["config_key"] in restart_keys:
            try:
                # Parse the changed_at timestamp and compare to service start time
                changed_at_str = entry["changed_at"]
                # Handle both Z suffix and +00:00 suffix for UTC
                changed_at = datetime.fromisoformat(changed_at_str.replace("Z", "+00:00"))
                if changed_at > SERVICE_START_TIME:
                    changed_requiring_restart.append(entry["config_key"])
            except (ValueError, TypeError, AttributeError):
                # Skip entries with invalid timestamps
                pass

    return ServiceHealthResponse(
        services=services,
        restart_required=len(changed_requiring_restart) > 0,
        changed_keys_requiring_restart=list(set(changed_requiring_restart)),
    )


@router.get("/restart-required", response_model=dict)
async def check_restart_required(admin: dict = Depends(auth.require_admin)):
    """
    Check if service restart is needed after config changes.
    Requires admin authentication.
    """
    restart_keys = database.get_restart_required_keys()
    audit_log = database.get_config_audit_log(limit=100, table_name="deployment_config")

    changed_requiring_restart = []
    for entry in audit_log:
        if entry["config_key"] in restart_keys:
            try:
                # Parse the changed_at timestamp and compare to service start time
                changed_at_str = entry["changed_at"]
                changed_at = datetime.fromisoformat(changed_at_str.replace("Z", "+00:00"))
                if changed_at > SERVICE_START_TIME:
                    changed_requiring_restart.append({
                        "key": entry["config_key"],
                        "changed_at": entry["changed_at"],
                    })
            except (ValueError, TypeError, AttributeError):
                # Skip entries with invalid timestamps
                pass

    return {
        "restart_required": len(changed_requiring_restart) > 0,
        "changed_keys": changed_requiring_restart[:10],  # Limit to recent
    }


@router.get("/audit-log", response_model=ConfigAuditLogResponse)
async def get_audit_log(
    limit: int = Query(default=50, ge=1, le=1000),
    table_name: Optional[str] = None,
    admin: dict = Depends(auth.require_admin)
):
    """
    Get configuration audit log.
    Requires admin authentication.
    """
    # Validate table_name against allowlist to prevent SQL injection
    if table_name is not None and table_name not in ALLOWED_AUDIT_TABLES:
        raise HTTPException(status_code=400, detail=f"Invalid table_name: {table_name}")

    entries = database.get_config_audit_log(limit=limit, table_name=table_name)

    return ConfigAuditLogResponse(
        entries=[
            ConfigAuditLogEntry(
                id=e["id"],
                table_name=e["table_name"],
                config_key=e["config_key"],
                old_value=e.get("old_value"),
                new_value=e.get("new_value"),
                changed_by=e["changed_by"],
                changed_at=e["changed_at"],
            )
            for e in entries
        ]
    )


@router.get("/audit-log/verify", response_model=dict)
async def verify_audit_log_chain(
    table_name: Optional[str] = Query(default=None),
    admin: dict = Depends(auth.require_admin),
):
    """
    Verify tamper-evident hash chain integrity for configuration audit log.
    The chain is global across all config tables; optional `table_name` limits
    reporting scope while integrity is validated end-to-end.
    Requires admin authentication.
    """
    if table_name is not None and table_name not in ALLOWED_AUDIT_TABLES:
        raise HTTPException(status_code=400, detail=f"Invalid table_name: {table_name}")

    return database.verify_config_audit_log_chain(table_name=table_name)
