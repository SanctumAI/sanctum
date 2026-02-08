"""
Sanctum Backend - FastAPI Application
RAG system with Qdrant vector search.
Also provides user/admin management via SQLite.
"""

import asyncio
import os
import uuid
import logging
import time
import re
import math
import tempfile
import sqlite3
import hashlib
import secrets
from urllib.parse import urlparse
from fastapi import FastAPI, HTTPException, Query, Depends, Request, BackgroundTasks, Response, Header, Cookie
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from qdrant_client import QdrantClient
from pydantic import BaseModel
from typing import Optional, List, Dict
from sentence_transformers import SentenceTransformer

from llm import get_provider
from tools import init_tools, ToolOrchestrator, ToolCallInfo
import database
from models import (
    AdminAuth, AdminResponse, AdminListResponse,
    AdminAuthRequest, AdminAuthResponse,
    InstanceSettings, InstanceSettingsResponse, InstanceStatusResponse,
    # User Type models
    UserTypeCreate, UserTypeUpdate, UserTypeResponse, UserTypeListResponse,
    # Field Definition models
    FieldDefinitionCreate, FieldDefinitionUpdate, FieldDefinitionResponse, FieldDefinitionListResponse,
    FieldEncryptionRequest, FieldEncryptionResponse,
    UserCreate, UserUpdate, UserResponse, UserListResponse,
    SuccessResponse,
    # Database Explorer models
    ColumnInfo, TableInfo, TablesListResponse,
    TableDataResponse, DBQueryRequest, DBQueryResponse,
    RowMutationRequest, RowMutationResponse,
    # Magic Link Auth models
    MagicLinkRequest, MagicLinkResponse, VerifyTokenRequest,
    VerifyTokenResponse, AuthUserResponse, SessionUserResponse,
    # Session defaults
    SessionDefaultsResponse,
    # Test email
    TestEmailRequest, TestEmailResponse,
)
from nostr import verify_auth_event, get_pubkey_from_event
import auth
from rate_limit import RateLimiter

# Embedding model config
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "intfloat/multilingual-e5-base")

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("sanctum.main")

# Import routers
from ingest import router as ingest_router
from query import router as query_router
from ai_config import router as ai_config_router
from deployment_config import router as deployment_config_router
from key_migration import router as key_migration_router

logger.info("Starting Sanctum API...")

app = FastAPI(
    title="Sanctum API",
    description="Privacy-first RAG system for curated knowledge",
    version="0.1.0"
)

def _normalize_origin(origin: str) -> str:
    """
    Normalize an origin value for CORS matching.
    Keeps only scheme + host[:port], strips paths/trailing slashes, and rejects wildcard.
    """
    raw = origin.strip()
    if not raw or raw == "*":
        return ""

    parsed = urlparse(raw)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    logger.warning(
        "Ignoring schemeless/invalid origin %r; expected format 'scheme://host[:port]'",
        raw,
    )
    return ""


def _get_cors_allow_origins() -> list[str]:
    """
    Resolve explicit CORS allowlist.
    Wildcard origins are intentionally rejected for authenticated deployments.
    """
    configured = os.getenv("CORS_ALLOW_ORIGINS") or os.getenv("CORS_ORIGINS", "")
    raw_origins = [origin.strip() for origin in configured.split(",") if origin.strip()]
    if "*" in raw_origins:
        logger.warning("Ignoring '*' in CORS allowlist; explicit origins are required for credentialed auth")

    origins: list[str] = []
    for raw_origin in raw_origins:
        normalized = _normalize_origin(raw_origin)
        if normalized and normalized not in origins:
            origins.append(normalized)

    frontend_origin = _normalize_origin(os.getenv("FRONTEND_URL", ""))
    if frontend_origin and frontend_origin not in origins:
        origins.append(frontend_origin)

    if not origins:
        origins = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]

    return origins


def _csrf_allowed_origins() -> set[str]:
    """Origins trusted for cookie-authenticated state-changing requests."""
    return set(_get_cors_allow_origins())


def _request_origin(request: Request) -> str | None:
    """Resolve origin from Origin header, with Referer fallback."""
    origin = _normalize_origin(request.headers.get("origin", ""))
    if origin:
        return origin

    referer = request.headers.get("referer")
    if referer:
        return _normalize_origin(referer)

    return None


def _is_secure_request(request: Request) -> bool:
    """Detect HTTPS requests (direct or behind trusted proxy)."""
    forwarded_proto = request.headers.get("x-forwarded-proto", "").lower()
    if forwarded_proto == "https":
        return True
    return request.url.scheme == "https"


def _api_content_security_policy() -> str:
    """
    CSP for API responses.
    Keep strict defaults while allowing explicit override for deployments.
    """
    configured = os.getenv("SECURITY_CSP", "").strip()
    if configured:
        return configured
    return "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"


def _apply_security_headers(request: Request, response: Response) -> None:
    """Attach baseline security headers to backend responses."""
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")

    # Keep docs usable by not forcing strict CSP on docs assets.
    if not request.url.path.startswith(("/docs", "/redoc", "/openapi.json")):
        response.headers.setdefault("Content-Security-Policy", _api_content_security_policy())

    if _is_secure_request(request):
        max_age = os.getenv("HSTS_MAX_AGE", "31536000").strip() or "31536000"
        response.headers.setdefault("Strict-Transport-Security", f"max-age={max_age}; includeSubDomains")


def _has_cookie_session(request: Request) -> bool:
    """Whether request carries Sanctum auth cookies."""
    return bool(
        request.cookies.get(auth.USER_SESSION_COOKIE_NAME)
        or request.cookies.get(auth.ADMIN_SESSION_COOKIE_NAME)
    )


def _has_bearer_auth(request: Request) -> bool:
    """Whether request carries Authorization bearer token."""
    header = request.headers.get("authorization", "")
    return header.startswith("Bearer ")


def _should_enforce_csrf(request: Request) -> bool:
    """CSRF applies to unsafe methods when cookie auth is used."""
    if request.method.upper() in {"GET", "HEAD", "OPTIONS", "TRACE"}:
        return False

    # Token/header-based clients are not subject to cookie-CSRF checks.
    if _has_bearer_auth(request):
        return False

    return _has_cookie_session(request)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    """
    Unified security middleware:
    - Enforces CSRF for cookie-authenticated unsafe requests
    - Applies standard security headers
    """
    if _should_enforce_csrf(request):
        origin = _request_origin(request)
        if not origin or origin not in _csrf_allowed_origins():
            return JSONResponse(status_code=403, content={"detail": "Invalid request origin"})

        csrf_cookie = request.cookies.get(auth.CSRF_COOKIE_NAME)
        csrf_header = request.headers.get("X-CSRF-Token")
        if not csrf_cookie or not csrf_header or not secrets.compare_digest(csrf_cookie, csrf_header):
            return JSONResponse(status_code=403, content={"detail": "CSRF validation failed"})

    response = await call_next(request)
    _apply_security_headers(request, response)
    return response

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_cors_allow_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(ingest_router)
app.include_router(query_router)
app.include_router(ai_config_router)
app.include_router(deployment_config_router)
app.include_router(key_migration_router)


@app.on_event("startup")
async def startup_event():
    """Run startup checks"""
    # Verify SMTP configuration (connection test, no email sent)
    smtp_status = auth.verify_smtp_config()
    if smtp_status["configured"] and not smtp_status["mock_mode"] and not smtp_status["connection_ok"]:
        logger.warning("SMTP is configured but connection test failed - email sending may not work")

# Rate limiters for auth endpoints
magic_link_limiter = RateLimiter(limit=5, window_seconds=60)   # 5 per minute
admin_auth_limiter = RateLimiter(limit=10, window_seconds=60)  # 10 per minute


def _rate_limit_key(request: Request) -> str:
    """
    Stable key for API rate limiting.
    Prefer auth identity (bearer/cookie), fallback to client IP.
    """
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()[:20]
        return f"bearer:{digest}"

    cookie_token = request.cookies.get(auth.ADMIN_SESSION_COOKIE_NAME) or request.cookies.get(auth.USER_SESSION_COOKIE_NAME)
    if cookie_token:
        digest = hashlib.sha256(cookie_token.encode("utf-8")).hexdigest()[:20]
        return f"cookie:{digest}"

    client_host = request.client.host if request.client else "unknown"
    return f"ip:{client_host}"


def _safe_int_env(key: str, default: int) -> int:
    """Read an env var as int, falling back to *default* on bad values."""
    raw = os.getenv(key)
    if raw is None:
        return default
    try:
        return int(raw)
    except (ValueError, TypeError):
        logger.warning("Invalid integer for env %s=%r, using default %d", key, raw, default)
        return default


chat_limiter = RateLimiter(
    limit=_safe_int_env("RATE_LIMIT_CHAT_PER_MINUTE", 120),
    window_seconds=60,
    key_func=_rate_limit_key,
)

vector_search_limiter = RateLimiter(
    limit=_safe_int_env("RATE_LIMIT_VECTOR_SEARCH_PER_MINUTE", 30),
    window_seconds=60,
    key_func=_rate_limit_key,
)

# Configuration from environment
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))

# Collection name for smoke test
COLLECTION_NAME = "sanctum_smoke_test"


class SmokeTestResult(BaseModel):
    """Response model for smoke test endpoint"""
    qdrant: dict
    message: str
    success: bool


class HealthResponse(BaseModel):
    """Response model for health endpoint"""
    status: str
    services: dict


class LLMTestResult(BaseModel):
    """Response model for LLM smoke test endpoint"""
    success: bool
    provider: str
    health: bool
    response: Optional[str] = None
    model: Optional[str] = None
    error: Optional[str] = None


class ToolCallInfoResponse(BaseModel):
    """Info about a tool that was called"""
    tool_id: str
    tool_name: str
    query: Optional[str] = None


class ChatRequest(BaseModel):
    """Request model for chat endpoint"""
    message: str
    tools: List[str] = []
    tool_context: Optional[str] = None


class ChatResponse(BaseModel):
    """Response model for chat endpoint"""
    message: str
    model: str
    provider: str
    tools_used: List[ToolCallInfoResponse] = []


class ToolExecuteRequest(BaseModel):
    """Request model for executing a tool without LLM response (admin-only)."""
    tool_id: str
    query: str


class ToolExecuteResponse(BaseModel):
    """Response model for tool execution (admin-only)."""
    success: bool
    tool_id: str
    tool_name: str
    data: Optional[dict] = None
    error: Optional[str] = None


class QueryRequest(BaseModel):
    """Request model for RAG query endpoint"""
    question: str
    top_k: int = 3
    tools: List[str] = []


class Citation(BaseModel):
    """Citation from retrieved knowledge"""
    claim_id: str
    claim_text: str
    source_title: str
    source_url: Optional[str] = None


class QueryResponse(BaseModel):
    """Response model for RAG query endpoint"""
    answer: str
    citations: List[Citation]
    model: str
    provider: str
    tools_used: List[ToolCallInfoResponse] = []


class VectorSearchRequest(BaseModel):
    """Request model for vector search endpoint"""
    query: str
    top_k: int = 5
    collection: str = "sanctum_smoke_test"


class VectorSearchResultItem(BaseModel):
    """Single vector search result"""
    id: str
    score: float
    payload: dict


class VectorSearchResponse(BaseModel):
    """Response model for vector search endpoint"""
    results: List[VectorSearchResultItem]
    query_embedding_dim: int
    collection: str


# Lazy-loaded embedding model singleton
_embedding_model = None


def get_embedding_model():
    """Get or create the embedding model (lazy singleton)"""
    global _embedding_model
    if _embedding_model is None:
        _embedding_model = SentenceTransformer(EMBEDDING_MODEL)
    return _embedding_model


# Initialize tool registry
_tool_registry = init_tools()


def get_tool_orchestrator() -> ToolOrchestrator:
    """Get a tool orchestrator instance"""
    return ToolOrchestrator(_tool_registry)


# Admin-only tools that require additional authorization
ADMIN_ONLY_TOOLS = {"db-query"}


def filter_tools_for_user(tools: List[str], user: dict) -> List[str]:
    """Filter tool list based on user permissions.

    Admin-only tools (like db-query) are removed if user is not an admin.
    """
    if not tools:
        return tools

    user_pubkey = user.get("pubkey")
    is_admin = user_pubkey and database.is_admin(user_pubkey)

    if is_admin:
        return tools  # Admins can use all tools

    # Filter out admin-only tools for non-admins
    return [t for t in tools if t not in ADMIN_ONLY_TOOLS]


def get_qdrant_client():
    """Create Qdrant client connection"""
    return QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "name": "Sanctum API",
        "version": "0.1.0",
        "status": "running"
    }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check health of all services"""
    services = {
        "qdrant": "unknown"
    }

    # Check Qdrant
    try:
        client = get_qdrant_client()
        client.get_collections()
        services["qdrant"] = "healthy"
    except Exception as e:
        services["qdrant"] = f"unhealthy: {str(e)}"

    all_healthy = all(s == "healthy" for s in services.values())

    return HealthResponse(
        status="healthy" if all_healthy else "degraded",
        services=services
    )


@app.get("/test", response_model=SmokeTestResult)
async def smoke_test():
    """
    Smoke test endpoint that verifies Qdrant contains seeded data.
    """
    qdrant_result = {"status": "error", "vector_id": None, "payload": None}

    # Test Qdrant - retrieve the seeded embedding
    try:
        client = get_qdrant_client()

        # Check if collection exists
        collections = client.get_collections().collections
        collection_exists = any(c.name == COLLECTION_NAME for c in collections)

        if collection_exists:
            # Retrieve the seeded point using UUID derived from claim ID
            claim_id = "claim_udhr_1948"
            point_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, claim_id))
            points = client.retrieve(
                collection_name=COLLECTION_NAME,
                ids=[point_uuid],
                with_vectors=True
            )

            if points:
                point = points[0]
                qdrant_result = {
                    "status": "ok",
                    "vector_id": point.id,
                    "payload": point.payload,
                    "vector_dimension": len(point.vector) if point.vector else 0
                }
            else:
                qdrant_result = {
                    "status": "error",
                    "message": "Seeded embedding not found"
                }
        else:
            qdrant_result = {
                "status": "error",
                "message": f"Collection '{COLLECTION_NAME}' does not exist. Run seed script."
            }
    except Exception as e:
        qdrant_result = {
            "status": "error",
            "message": f"Qdrant error: {str(e)}"
        }

    # Determine overall success
    success = qdrant_result.get("status") == "ok"
    message = "Smoke test passed!" if success else "Smoke test failed. Check Qdrant status."

    return SmokeTestResult(
        qdrant=qdrant_result,
        message=message,
        success=success
    )


@app.get("/llm/test", response_model=LLMTestResult)
async def llm_smoke_test():
    """
    Smoke test LLM provider connectivity.

    Tests the configured LLM provider (set via LLM_PROVIDER env var):
    - Checks provider health endpoint
    - Sends a simple test prompt
    - Returns the response

    Supports: maple, ollama
    """
    provider_name = os.getenv("LLM_PROVIDER", "maple")

    try:
        provider = get_provider()

        # Check health first
        health = provider.health_check()
        if not health:
            return LLMTestResult(
                success=False,
                provider=provider.name,
                health=False,
                error=f"Provider '{provider.name}' health check failed"
            )

        # Send a simple test prompt
        result = provider.complete("Say 'hello' and nothing else.")

        return LLMTestResult(
            success=True,
            provider=provider.name,
            health=True,
            response=result.content,
            model=result.model
        )

    except Exception as e:
        return LLMTestResult(
            success=False,
            provider=provider_name,
            health=False,
            error=str(e)
        )


@app.post("/llm/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    user: dict = Depends(auth.require_admin_or_approved_user),
    _: None = Depends(chat_limiter),
):
    """
    Chat endpoint with optional tool support.

    Takes a user message and optional list of tool IDs.
    If tools are specified, executes them and includes results in context.
    Requires authenticated admin OR approved user.
    """
    try:
        tools_used = []
        prompt = request.message
        seen_tool_keys = set()

        def _merge_tools_used(existing: list[ToolCallInfoResponse], infos: list[ToolCallInfo]) -> list[ToolCallInfoResponse]:
            merged = list(existing)
            for info in infos:
                key = (info.tool_id, info.query)
                if key in seen_tool_keys:
                    continue
                seen_tool_keys.add(key)
                merged.append(ToolCallInfoResponse(
                    tool_id=info.tool_id,
                    tool_name=info.tool_name,
                    query=info.query
                ))
            return merged

        tool_context_parts = []

        if request.tool_context:
            if user.get("type") != "admin":
                raise HTTPException(status_code=403, detail="Tool context override is admin-only")

            tool_context_parts.append(request.tool_context)

            # Build tools_used from provided tool IDs (client-side tool execution)
            tools_used = []
            for tool_id in request.tools:
                tool = _tool_registry.get(tool_id)
                if tool:
                    key = (tool_id, request.message)
                    if key not in seen_tool_keys:
                        seen_tool_keys.add(key)
                        tools_used.append(ToolCallInfoResponse(
                            tool_id=tool_id,
                            tool_name=tool.definition.name,
                            query=request.message
                        ))

            # Allow other tools to run server-side (excluding db-query to avoid duplicate encrypted context)
            allowed_tools = filter_tools_for_user(request.tools, user)
            allowed_tools = [tool_id for tool_id in allowed_tools if tool_id != "db-query"]

            if allowed_tools:
                orchestrator = get_tool_orchestrator()
                tool_context, tool_infos = await orchestrator.execute_tools(
                    query=request.message,
                    tool_ids=allowed_tools
                )

                if tool_context:
                    tool_context_parts.append(tool_context)

                tools_used = _merge_tools_used(tools_used, tool_infos)
        else:
            # Filter tools based on user permissions (admin-only tools removed for non-admins)
            allowed_tools = filter_tools_for_user(request.tools, user)

            # Execute tools if any are selected
            if allowed_tools:
                orchestrator = get_tool_orchestrator()
                tool_context, tool_infos = await orchestrator.execute_tools(
                    query=request.message,
                    tool_ids=allowed_tools
                )

                # Convert ToolCallInfo to response format
                tools_used = _merge_tools_used([], tool_infos)

                if tool_context:
                    tool_context_parts.append(tool_context)

        # Import AI config functions for dynamic prompt building
        from ai_config import build_chat_prompt, get_llm_parameters

        # Get user_type_id from authenticated user for per-type config
        user_type_id = user.get("user_type_id")

        # Get LLM parameters from config (with user-type overrides if applicable)
        llm_params = get_llm_parameters(user_type_id=user_type_id)
        temperature = llm_params.get("temperature", 0.1)

        # Get user profile context for chat personalization (unencrypted fields only)
        user_profile_context = None
        user_id = user.get("id")
        if user_id and user_id != -1:  # Skip dev mode mock user (id=-1)
            user_profile_context = database.get_user_chat_context_values(
                user_id=user_id,
                user_type_id=user_type_id
            )
            # Only pass if there's actual data
            if not user_profile_context:
                user_profile_context = None

        # Build prompt using AI config (with user-type overrides if applicable)
        combined_context = "\n\n".join(tool_context_parts) if tool_context_parts else ""
        prompt = build_chat_prompt(
            message=request.message,
            context=combined_context,
            user_type_id=user_type_id,
            user_profile_context=user_profile_context,
        )

        provider = get_provider()
        result = provider.complete(prompt, temperature=temperature)
        return ChatResponse(
            message=result.content,
            model=result.model,
            provider=result.provider,
            tools_used=tools_used
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/tools/execute", response_model=ToolExecuteResponse)
async def execute_admin_tool(request: ToolExecuteRequest, admin: dict = Depends(auth.require_admin)):
    """
    Execute an admin-only tool and return raw results.
    Used for client-side decryption flows (e.g., db-query with NIP-07).
    """
    tool_id = request.tool_id
    if tool_id not in ADMIN_ONLY_TOOLS:
        raise HTTPException(status_code=403, detail=f"Tool '{tool_id}' is not admin-only or not allowed")

    tool = _tool_registry.get(tool_id)
    if not tool:
        return ToolExecuteResponse(
            success=False,
            tool_id=tool_id,
            tool_name=tool_id,
            data=None,
            error="Tool not found"
        )

    try:
        result = await tool.execute(query=request.query)
        return ToolExecuteResponse(
            success=result.success,
            tool_id=tool_id,
            tool_name=tool.definition.name,
            data=result.data,
            error=result.error
        )
    except Exception as e:
        logger.exception(f"Tool execution failed for '{tool_id}': {e}")
        return ToolExecuteResponse(
            success=False,
            tool_id=tool_id,
            tool_name=tool.definition.name if tool.definition else tool_id,
            data=None,
            error=str(e)
        )


# NOTE: /query endpoint moved to query.py router (session-aware RAG)
# The query.py module provides:
# - Session-aware conversation history
# - Vector search retrieval
# - Configurable system prompts
# - Fact extraction for context


@app.post("/vector-search", response_model=VectorSearchResponse)
async def vector_search(
    request: VectorSearchRequest,
    admin: dict = Depends(auth.require_admin),
    _: None = Depends(vector_search_limiter),
):
    """
    Direct vector search endpoint (no LLM generation).

    Useful for debugging:
    1. Embeds the query text
    2. Searches Qdrant for similar vectors
    3. Returns results with similarity scores

    This lets you test embedding + search separately from LLM generation.
    """
    try:
        # 1. Embed the query
        model = get_embedding_model()
        query_embedding = model.encode(f"query: {request.query}").tolist()

        # 2. Search Qdrant
        qdrant = get_qdrant_client()
        search_result = qdrant.query_points(
            collection_name=request.collection,
            query=query_embedding,
            limit=request.top_k,
            with_payload=True
        )
        results = search_result.points

        # 3. Format results
        search_results = [
            VectorSearchResultItem(
                id=str(r.id),
                score=r.score,
                payload=r.payload or {}
            )
            for r in results
        ]

        return VectorSearchResponse(
            results=search_results,
            query_embedding_dim=len(query_embedding),
            collection=request.collection
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Magic Link Authentication Endpoints
# =============================================================================

@app.post("/auth/magic-link", response_model=MagicLinkResponse)
async def send_magic_link(
    request: Request,
    body: MagicLinkRequest,
    _: None = Depends(magic_link_limiter),
    __: None = Depends(auth.require_instance_setup_complete)
):
    """
    Send a magic link to the user's email for authentication.
    Creates a signed, time-limited token and sends it via email.
    Rate limited to 5 requests per minute per IP.
    
    Requires instance setup to be complete (admin must authenticate first).
    """
    email = body.email.strip().lower()
    name = body.name.strip()

    if not email:
        raise HTTPException(status_code=400, detail="Email is required")

    # Require admin to be configured before onboarding
    if not database.list_admins():
        raise HTTPException(
            status_code=503,
            detail="Instance not configured. An admin must be registered before users can sign up."
        )

    # Generate token
    token = auth.create_magic_link_token(email, name)

    # Send email (or log in mock mode)
    success = auth.send_magic_link_email(email, token)

    if not success:
        raise HTTPException(status_code=500, detail="Failed to send magic link email")

    return MagicLinkResponse(
        success=True,
        message="Magic link sent. Check your email."
    )


def _compute_onboarding_flags(user: dict) -> tuple[bool, bool]:
    """Return (needs_onboarding, needs_user_type) for the given user."""
    if not user:
        return False, False

    user_type_id = user.get("user_type_id")
    user_types = database.list_user_types()

    needs_user_type = len(user_types) > 1 and not user_type_id
    if needs_user_type:
        return True, True

    # If only one type exists, treat it as the effective type even if not yet stored
    effective_type_id = user_type_id
    if effective_type_id is None and len(user_types) == 1:
        effective_type_id = user_types[0]["id"]

    if effective_type_id is None:
        # Only global fields apply when no type is selected
        field_defs = [
            f for f in database.get_field_definitions()
            if f.get("user_type_id") is None
        ]
    else:
        field_defs = database.get_field_definitions(
            user_type_id=effective_type_id,
            include_global=True
        )

    if not field_defs:
        return False, False

    fields = user.get("fields") or {}
    fields_encrypted = user.get("fields_encrypted") or {}
    user_fields = set(fields.keys()) | set(fields_encrypted.keys())

    # If there are fields configured but none stored, onboarding hasn't been completed yet
    if not user_fields:
        return True, False

    required_fields = [f["field_name"] for f in field_defs if f.get("required")]
    if not required_fields:
        return False, False

    for field_name in required_fields:
        if field_name in fields_encrypted:
            continue
        value = fields.get(field_name)
        if value is None:
            return True, False
        if isinstance(value, str) and not value.strip():
            return True, False

    return False, False


async def _verify_magic_link_and_create_session(token: str, response: Response) -> VerifyTokenResponse:
    """
    Verify a magic link token, create/return the user, and set session cookie.
    """
    # Verify token
    data = auth.verify_magic_link_token(token)
    if not data:
        raise HTTPException(status_code=401, detail="Invalid or expired magic link")

    email = data["email"]
    name = data.get("name", "")

    # Get or create user
    user = database.get_user_by_email(email)
    if not user:
        # Create new user
        user_id = database.create_user(email=email, name=name)
        user = database.get_user(user_id)

    # Create session token
    session_token = auth.create_session_token(user["id"], email)
    auth.set_user_session_cookie(response, session_token)

    needs_onboarding, needs_user_type = _compute_onboarding_flags(user)

    return VerifyTokenResponse(
        success=True,
        user=AuthUserResponse(
            id=user["id"],
            email=email,
            name=name or user.get("name"),
            user_type_id=user.get("user_type_id"),
            approved=bool(user.get("approved", 1)),
            created_at=user.get("created_at"),
            needs_onboarding=needs_onboarding,
            needs_user_type=needs_user_type
        ),
        session_token=session_token
    )


@app.post("/auth/verify", response_model=VerifyTokenResponse)
async def verify_magic_link(
    body: VerifyTokenRequest,
    response: Response,
    _: None = Depends(auth.require_instance_setup_complete),
):
    """
    Verify a magic link token and create/return the user.
    Active clients should use this POST endpoint (token in JSON body).
    """
    token = body.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token is required")
    return await _verify_magic_link_and_create_session(token, response)


@app.post("/auth/dev-session", response_model=VerifyTokenResponse)
async def create_dev_session(
    body: MagicLinkRequest,
    response: Response,
    _: None = Depends(auth.require_instance_setup_complete),
):
    """
    Development-only auth helper for simulated user onboarding.
    Enabled only when SIMULATE_USER_AUTH=true and never in production mode.
    """
    if auth.is_production_mode() or not _get_simulation_setting("SIMULATE_USER_AUTH", "false"):
        raise HTTPException(status_code=403, detail="Simulated auth is disabled")

    email = body.email.strip().lower()
    name = body.name.strip()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")

    user = database.get_user_by_email(email)
    if not user:
        user_id = database.create_user(email=email, name=name)
        user = database.get_user(user_id)

    session_token = auth.create_session_token(user["id"], email)
    auth.set_user_session_cookie(response, session_token)
    needs_onboarding, needs_user_type = _compute_onboarding_flags(user)

    return VerifyTokenResponse(
        success=True,
        user=AuthUserResponse(
            id=user["id"],
            email=email,
            name=name or user.get("name"),
            user_type_id=user.get("user_type_id"),
            approved=bool(user.get("approved", 1)),
            created_at=user.get("created_at"),
            needs_onboarding=needs_onboarding,
            needs_user_type=needs_user_type,
        ),
        session_token=session_token,
    )


@app.get("/auth/me", response_model=SessionUserResponse)
async def get_current_user(
    authorization: Optional[str] = Header(None),
    session_cookie: Optional[str] = Cookie(None, alias=auth.USER_SESSION_COOKIE_NAME),
    _: None = Depends(auth.require_instance_setup_complete)
):
    """
    Get the current authenticated user from session token.
    Returns authenticated: false if no valid session.
    
    Requires instance setup to be complete (admin must authenticate first).
    """
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
    if not token:
        token = session_cookie

    if not token:
        return SessionUserResponse(authenticated=False)

    # Verify session
    data = auth.verify_session_token(token)
    if not data:
        return SessionUserResponse(authenticated=False)

    # Simulated auth mode support (dev-only token)
    if data.get("dev_mode"):
        return SessionUserResponse(
            authenticated=True,
            user=AuthUserResponse(
                id=-1,
                email="dev@localhost",
                name="Dev User",
                user_type_id=None,
                approved=True,
                created_at=None,
                needs_onboarding=False,
                needs_user_type=False,
            ),
        )

    # Get user
    user = database.get_user(data["user_id"])
    if not user:
        return SessionUserResponse(authenticated=False)

    needs_onboarding, needs_user_type = _compute_onboarding_flags(user)

    return SessionUserResponse(
        authenticated=True,
        user=AuthUserResponse(
            id=user["id"],
            email=user.get("email", data["email"]),
            name=user.get("name"),
            user_type_id=user.get("user_type_id"),
            approved=bool(user.get("approved", 1)),
            created_at=user.get("created_at"),
            needs_onboarding=needs_onboarding,
            needs_user_type=needs_user_type
        )
    )


@app.post("/auth/logout", response_model=SuccessResponse)
async def logout_user(response: Response):
    """Clear auth session cookies for the current browser."""
    auth.clear_auth_cookies(response)
    return SuccessResponse(success=True, message="Logged out")


@app.post("/auth/test-email", response_model=TestEmailResponse)
async def send_test_email(
    body: TestEmailRequest,
    admin: dict = Depends(auth.require_admin)
):
    """
    Send a test email to verify SMTP configuration.
    Requires admin authentication.
    """
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    email = body.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email address is required")

    # Get SMTP config
    smtp = auth._get_smtp_config()

    # Check if SMTP is configured
    if not smtp["host"]:
        return TestEmailResponse(
            success=False,
            message="SMTP not configured",
            error="SMTP_HOST is not set. Configure SMTP settings first."
        )

    # Check if mock mode
    if smtp["mock_mode"]:
        logger.info("[TEST EMAIL - Mock Mode] Would send test email")
        return TestEmailResponse(
            success=True,
            message=f"Mock mode enabled. Test email would be sent to {email}."
        )

    # Build test email
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Sanctum Test Email"
    msg["From"] = smtp["from_address"]
    msg["To"] = email

    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; color: #333;">
        <div style="max-width: 480px; margin: 0 auto;">
            <h2 style="color: #333; margin-bottom: 24px;">Sanctum Test Email</h2>
            <p style="margin-bottom: 24px;">
                This is a test email from your Sanctum instance.
                If you received this, your SMTP configuration is working correctly.
            </p>
            <p style="margin-top: 24px; font-size: 14px; color: #666;">
                You can safely delete this email.
            </p>
        </div>
    </body>
    </html>
    """
    msg.attach(MIMEText(html, "html"))

    try:
        if smtp["port"] == 465:
            with smtplib.SMTP_SSL(smtp["host"], smtp["port"], timeout=smtp["timeout"]) as server:
                server.login(smtp["user"], smtp["password"])
                server.sendmail(smtp["from_address"], [email], msg.as_string())
        else:
            with smtplib.SMTP(smtp["host"], smtp["port"], timeout=smtp["timeout"]) as server:
                server.ehlo()
                if server.has_extn('starttls'):
                    server.starttls()
                    server.ehlo()  # Re-identify after TLS upgrade
                server.login(smtp["user"], smtp["password"])
                server.sendmail(smtp["from_address"], [email], msg.as_string())

        logger.info("Test email sent successfully")

        # Store successful test status in database for health checks
        # Wrapped in try/except - email was sent, so primary operation succeeded
        # even if status tracking fails
        try:
            from datetime import datetime, timezone
            database.upsert_deployment_config(
                key="SMTP_LAST_TEST_AT",
                value=datetime.now(timezone.utc).isoformat(),
                is_secret=False,
                requires_restart=False,
                category="email",
                description="Timestamp of last successful SMTP test",
            )
            database.upsert_deployment_config(
                key="SMTP_LAST_TEST_SUCCESS",
                value="true",
                is_secret=False,
                requires_restart=False,
                category="email",
                description="Whether last SMTP test was successful",
            )
        except Exception as db_err:
            logger.warning(f"Failed to update SMTP test status in database: {db_err}")

        return TestEmailResponse(
            success=True,
            message=f"Test email sent to {email}"
        )

    except smtplib.SMTPAuthenticationError as e:
        logger.error(f"SMTP authentication failed: {e}")
        return TestEmailResponse(
            success=False,
            message="SMTP authentication failed",
            error=str(e)
        )
    except smtplib.SMTPConnectError as e:
        logger.error(f"SMTP connection failed: {e}")
        return TestEmailResponse(
            success=False,
            message="Could not connect to SMTP server",
            error=str(e)
        )
    except TimeoutError:
        logger.error(f"SMTP connection timed out after {smtp['timeout']}s")
        return TestEmailResponse(
            success=False,
            message="SMTP connection timed out",
            error=f"Connection timed out after {smtp['timeout']} seconds"
        )
    except Exception as e:
        logger.error(f"Failed to send test email: {e}")
        return TestEmailResponse(
            success=False,
            message="Failed to send test email",
            error=str(e)
        )


# =============================================================================
# Admin & User Management Endpoints (SQLite)
# =============================================================================

# --- Admin Authentication ---

@app.post("/admin/auth", response_model=AdminAuthResponse)
async def admin_auth(
    response: Response,
    request: Request,
    body: AdminAuthRequest,
    _: None = Depends(admin_auth_limiter)
):
    """
    Authenticate or register an admin by verifying a signed Nostr event.

    The event must:
    - Be kind 22242 (Sanctum auth event)
    - Have action tag = "admin_auth"
    - Have valid BIP-340 Schnorr signature
    - Be signed within the last 5 minutes

    Rate limited to 10 requests per minute per IP.
    """
    # Convert Pydantic model to dict for verification
    event = body.event.model_dump()

    # Verify the signed event
    valid, error = verify_auth_event(event)
    if not valid:
        raise HTTPException(status_code=401, detail=error)

    # Extract pubkey from verified event
    pubkey = get_pubkey_from_event(event)
    if not pubkey:
        raise HTTPException(status_code=401, detail="Missing pubkey in event")

    # Check if admin exists
    existing = database.get_admin_by_pubkey(pubkey)

    # ==========================================================================
    # SECURITY: Single-admin restriction (ENFORCED)
    #
    # Only ONE admin can exist per instance. The first person to authenticate
    # via NIP-07 becomes the admin. Subsequent attempts are rejected.
    # ==========================================================================
    
    is_new = existing is None
    instance_has_admin = database.has_admin()

    if is_new and instance_has_admin:
        # Someone is trying to register as admin but an admin already exists
        raise HTTPException(
            status_code=403,
            detail="Admin registration is closed. This instance already has an admin."
        )

    if is_new:
        # First admin creation - use our single admin constraint
        try:
            database.add_admin(pubkey)
            admin = database.get_admin_by_pubkey(pubkey)
            
            # Migrate any existing plaintext data to encrypted format
            # This happens when users signed up before an admin was configured
            # Run in a thread to avoid blocking the event loop
            await asyncio.to_thread(database.migrate_encrypt_existing_data)
            
        except ValueError as e:
            # This should not happen due to our check above, but safety first
            raise HTTPException(status_code=403, detail=str(e)) from e
    else:
        admin = existing

    # Mark instance setup as complete after successful admin authentication
    database.mark_instance_setup_complete()

    # Create session token for subsequent authenticated requests
    session_token = auth.create_admin_session_token(
        admin["id"],
        pubkey,
        int(admin.get("session_nonce", 0) or 0),
    )
    auth.set_admin_session_cookie(response, session_token)

    return AdminAuthResponse(
        admin=AdminResponse(**admin),
        is_new=is_new,
        instance_initialized=instance_has_admin or is_new,  # True if had admin or just created one
        session_token=session_token
    )


@app.post("/admin/logout", response_model=SuccessResponse)
async def logout_admin(
    response: Response,
    authorization: Optional[str] = Header(None),
    admin_session_cookie: Optional[str] = Cookie(None, alias=auth.ADMIN_SESSION_COOKIE_NAME),
):
    """
    Clear auth session cookies for the current browser and revoke active admin tokens.
    Revocation is best-effort: if a valid admin token is present, rotate session nonce.
    """
    token = auth._resolve_auth_token(authorization, admin_session_cookie)
    if token:
        token_data = auth.verify_admin_session_token(token)
        if token_data:
            admin_pubkey = token_data.get("pubkey")
            if admin_pubkey:
                admin_record = database.get_admin_by_pubkey(admin_pubkey)
                if admin_record and auth.is_admin_session_current(admin_record, token_data):
                    try:
                        database.increment_admin_session_nonce(admin_pubkey)
                    except Exception as e:
                        logger.warning(f"Failed to rotate admin session nonce on logout: {e}")

    auth.clear_auth_cookies(response)
    return SuccessResponse(success=True, message="Logged out")


@app.get("/admin/list", response_model=AdminListResponse)
async def list_admins(admin: dict = Depends(auth.require_admin)):
    """List all admins (requires admin auth)"""
    admins = database.list_admins()
    return AdminListResponse(admins=[AdminResponse(**a) for a in admins])


@app.delete("/admin/{pubkey}", response_model=SuccessResponse)
async def remove_admin(pubkey: str, admin: dict = Depends(auth.require_admin)):
    """Remove an admin by pubkey (requires admin auth)"""
    from nostr_keys import normalize_pubkey
    try:
        pubkey = normalize_pubkey(pubkey)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    if database.remove_admin(pubkey):
        return SuccessResponse(success=True, message="Admin removed")
    raise HTTPException(status_code=404, detail="Admin not found")


@app.get("/admin/session", response_model=SuccessResponse)
async def validate_admin_session(admin: dict = Depends(auth.require_admin)):
    """Validate the current admin session token."""
    return SuccessResponse(success=True, message="Admin session is valid")


# --- Instance Settings ---

# Settings safe to expose publicly (branding only)
SAFE_PUBLIC_SETTINGS = {
    "instance_name",
    "primary_color",
    "description",
    "logo_url",
    "favicon_url",
    "apple_touch_icon_url",
    "icon",
    "assistant_icon",
    "user_icon",
    "assistant_name",
    "user_label",
    "header_layout",
    "header_tagline",
    "chat_bubble_style",
    "chat_bubble_shadow",
    "surface_style",
    "status_icon_set",
    "typography_preset",
}


def filter_public_settings(settings: dict) -> dict:
    """Filter settings to only include safe public keys."""
    return {k: v for k, v in settings.items() if k in SAFE_PUBLIC_SETTINGS}


@app.get("/instance/status", response_model=InstanceStatusResponse)
async def get_instance_status():
    """
    Public endpoint: Check if instance is initialized and ready for users.

    Used by frontend to determine whether to show:
    - Admin setup flow (if not initialized)
    - User waiting page (if admin exists but setup incomplete)
    - User registration (if setup complete)
    """
    settings = filter_public_settings(database.get_all_settings())
    return InstanceStatusResponse(
        initialized=database.has_admin(),
        setup_complete=database.is_instance_setup_complete(),
        ready_for_users=database.is_instance_setup_complete(),
        settings=settings
    )


@app.get("/settings/public", response_model=InstanceSettingsResponse)
async def get_public_settings():
    """Public endpoint: Get instance settings for branding (name, color, etc.)"""
    settings = filter_public_settings(database.get_all_settings())
    return InstanceSettingsResponse(settings=settings)


# Import for public config
from models import PublicConfigResponse


def _get_simulation_setting(key: str, default: str = "true") -> bool:
    """Get a simulation setting from database with env var fallback.

    Args:
        key: The config key (e.g., "SIMULATE_USER_AUTH")
        default: Default value if not found anywhere ("true" or "false")

    Returns:
        Boolean value of the setting
    """
    # First try database
    db_value = database.get_deployment_config_value(key)
    if db_value is not None:
        return db_value.lower() in ("true", "1", "yes")

    # Then try environment variable
    env_value = os.getenv(key)
    if env_value is not None:
        return env_value.lower() in ("true", "1", "yes")

    # Fall back to default
    return default.lower() in ("true", "1", "yes")


@app.get("/config/public", response_model=PublicConfigResponse)
async def get_public_config() -> PublicConfigResponse:
    """
    Public endpoint: Get simulation/development settings.

    Returns configuration flags that control testing features.
    No authentication required - these settings affect client-side behavior.
    """
    simulate_user_auth = _get_simulation_setting("SIMULATE_USER_AUTH", "false")
    simulate_admin_auth = _get_simulation_setting("SIMULATE_ADMIN_AUTH", "false")

    # Defense-in-depth: never expose simulation flags as enabled in production.
    if auth.is_production_mode():
        if simulate_user_auth or simulate_admin_auth:
            logger.warning("Simulation auth flags forced off in production mode")
        simulate_user_auth = False
        simulate_admin_auth = False

    return PublicConfigResponse(
        simulate_user_auth=simulate_user_auth,
        simulate_admin_auth=simulate_admin_auth,
    )


@app.get("/session-defaults", response_model=SessionDefaultsResponse)
async def get_session_defaults_public(
    user_type_id: Optional[int] = Query(None, description="User type ID for type-specific defaults")
) -> SessionDefaultsResponse:
    """
    Public endpoint: Get session defaults for chat initialization.
    No authentication required - returns safe defaults for new chat sessions.

    If user_type_id is provided, returns defaults with user-type-specific overrides applied.
    """
    try:
        from ai_config import get_session_defaults
        defaults = get_session_defaults(user_type_id)

        # Get document defaults with user-type inheritance if applicable
        if user_type_id is not None:
            default_docs = database.get_active_documents_for_user_type(user_type_id)
        else:
            default_docs = database.get_default_active_documents()

        return SessionDefaultsResponse(
            web_search_enabled=defaults.get("web_search_default", False),
            default_document_ids=default_docs
        )
    except Exception as e:
        logger.error(f"Failed to get session defaults: {e}")
        return SessionDefaultsResponse(
            web_search_enabled=False,
            default_document_ids=[]
        )


@app.get("/admin/settings", response_model=InstanceSettingsResponse)
async def get_settings(admin: dict = Depends(auth.require_admin)):
    """Get all instance settings (requires admin auth)"""
    settings = database.get_all_settings()
    return InstanceSettingsResponse(settings=settings)


@app.put("/admin/settings", response_model=InstanceSettingsResponse)
async def update_settings(settings: InstanceSettings, admin: dict = Depends(auth.require_admin)):
    """Update instance settings (requires admin auth)"""
    settings_dict = settings.model_dump(exclude_unset=True)
    database.update_settings(settings_dict)
    return InstanceSettingsResponse(settings=database.get_all_settings())


# --- User Types ---

@app.get("/user-types", response_model=UserTypeListResponse)
async def get_user_types_public():
    """Public endpoint: Get all user types for onboarding UI"""
    types = database.list_user_types()
    return UserTypeListResponse(types=[UserTypeResponse(**t) for t in types])


@app.get("/user-fields", response_model=FieldDefinitionListResponse)
async def get_user_fields_public(
    user_type_id: Optional[int] = Query(None),
    include_global: bool = Query(True)
):
    """
    Public endpoint: Get user field definitions for onboarding UI.
    If user_type_id is provided, returns type-specific fields.
    If include_global is True (default), also includes global fields.
    """
    fields = database.get_field_definitions(user_type_id=user_type_id, include_global=include_global)
    return FieldDefinitionListResponse(
        fields=[FieldDefinitionResponse(**f) for f in fields]
    )


@app.get("/admin/user-types", response_model=UserTypeListResponse)
async def list_user_types(admin: dict = Depends(auth.require_admin)):
    """Get all user types (requires admin auth)"""
    types = database.list_user_types()
    return UserTypeListResponse(types=[UserTypeResponse(**t) for t in types])


@app.post("/admin/user-types", response_model=UserTypeResponse)
async def create_user_type(user_type: UserTypeCreate, admin: dict = Depends(auth.require_admin)):
    """Create a new user type (requires admin auth)"""
    try:
        type_id = database.create_user_type(
            name=user_type.name,
            description=user_type.description,
            icon=user_type.icon,
            display_order=user_type.display_order
        )
        created = database.get_user_type(type_id)
        return UserTypeResponse(**created)
    except Exception as e:
        if "UNIQUE constraint" in str(e):
            raise HTTPException(status_code=400, detail="User type name already exists")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/admin/user-types/{type_id}", response_model=UserTypeResponse)
async def update_user_type(type_id: int, user_type: UserTypeUpdate, admin: dict = Depends(auth.require_admin)):
    """Update a user type (requires admin auth)"""
    existing = database.get_user_type(type_id)
    if not existing:
        raise HTTPException(status_code=404, detail="User type not found")

    database.update_user_type(
        type_id,
        name=user_type.name,
        description=user_type.description,
        icon=user_type.icon,
        display_order=user_type.display_order
    )
    updated = database.get_user_type(type_id)
    return UserTypeResponse(**updated)


@app.delete("/admin/user-types/{type_id}", response_model=SuccessResponse)
async def delete_user_type(type_id: int, admin: dict = Depends(auth.require_admin)):
    """Delete a user type (requires admin auth, cascades to field definitions)"""
    if database.delete_user_type(type_id):
        return SuccessResponse(success=True, message="User type deleted")
    raise HTTPException(status_code=404, detail="User type not found")


# --- User Field Definitions ---

@app.get("/admin/user-fields", response_model=FieldDefinitionListResponse)
async def get_field_definitions(user_type_id: Optional[int] = Query(None), admin: dict = Depends(auth.require_admin)):
    """Get user field definitions (requires admin auth).
    If user_type_id is provided, returns global fields + type-specific fields.
    """
    fields = database.get_field_definitions(user_type_id=user_type_id, include_global=True)
    return FieldDefinitionListResponse(
        fields=[FieldDefinitionResponse(**f) for f in fields]
    )


@app.post("/admin/user-fields", response_model=FieldDefinitionResponse)
async def create_field_definition(field: FieldDefinitionCreate, admin: dict = Depends(auth.require_admin)):
    """Create a new user field definition (requires admin auth).
    user_type_id: null = global field (shown for all types), or ID for type-specific
    """
    # Validate user_type_id if provided
    if field.user_type_id is not None:
        if not database.get_user_type(field.user_type_id):
            raise HTTPException(status_code=400, detail="User type not found")

    # Validation: Cannot include encrypted fields in chat context
    if field.include_in_chat and field.encryption_enabled:
        raise HTTPException(
            status_code=400,
            detail="Cannot include encrypted fields in chat context. Encrypted fields require admin's private key to decrypt."
        )

    try:
        field_id = database.create_field_definition(
            field_name=field.field_name,
            field_type=field.field_type,
            required=field.required,
            display_order=field.display_order,
            user_type_id=field.user_type_id,
            placeholder=field.placeholder,
            options=field.options,
            encryption_enabled=field.encryption_enabled,
            include_in_chat=field.include_in_chat
        )
        created = database.get_field_definition_by_id(field_id)
        return FieldDefinitionResponse(**created)
    except Exception as e:
        if "UNIQUE constraint" in str(e):
            raise HTTPException(status_code=400, detail="Field name already exists for this type")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/admin/user-fields/{field_id}", response_model=FieldDefinitionResponse)
async def update_field_definition(field_id: int, field: FieldDefinitionUpdate, admin: dict = Depends(auth.require_admin)):
    """Update a field definition (requires admin auth)"""
    existing = database.get_field_definition_by_id(field_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Field definition not found")

    # Validate user_type_id if provided
    if field.user_type_id is not None and field.user_type_id != 0:
        if not database.get_user_type(field.user_type_id):
            raise HTTPException(status_code=400, detail="User type not found")

    # Determine effective encryption state (use existing if not specified)
    effective_encryption = field.encryption_enabled if field.encryption_enabled is not None else existing.get("encryption_enabled", 1)
    effective_include_in_chat = field.include_in_chat if field.include_in_chat is not None else existing.get("include_in_chat", 0)

    # Validation: Cannot include encrypted fields in chat context
    if effective_include_in_chat and effective_encryption:
        raise HTTPException(
            status_code=400,
            detail="Cannot include encrypted fields in chat context. Encrypted fields require admin's private key to decrypt."
        )

    database.update_field_definition(
        field_id,
        field_name=field.field_name,
        field_type=field.field_type,
        required=field.required,
        display_order=field.display_order,
        user_type_id=field.user_type_id if field.user_type_id != 0 else None,
        placeholder=field.placeholder,
        options=field.options,
        encryption_enabled=field.encryption_enabled,
        include_in_chat=field.include_in_chat
    )
    updated = database.get_field_definition_by_id(field_id)
    return FieldDefinitionResponse(**updated)


@app.delete("/admin/user-fields/{field_id}", response_model=SuccessResponse)
async def delete_field_definition(field_id: int, admin: dict = Depends(auth.require_admin)):
    """Delete a user field definition (requires admin auth)"""
    if database.delete_field_definition(field_id):
        return SuccessResponse(success=True, message="Field definition deleted")
    raise HTTPException(status_code=404, detail="Field definition not found")


@app.put("/admin/user-fields/{field_id}/encryption", response_model=FieldEncryptionResponse)
async def update_field_encryption(
    field_id: int,
    encryption_request: FieldEncryptionRequest,
    _admin: dict = Depends(auth.require_admin)
) -> FieldEncryptionResponse:
    """Update encryption setting for a field definition (requires admin auth).

    WARNING: Changing encryption settings may affect existing data.
    - Enabling encryption: Future values will be encrypted, existing plaintext remains
    - Disabling encryption: Future values stored as plaintext, existing encrypted data remains

    Use force=true to bypass warnings about data migration complexity.

    Note: Enabling encryption will auto-disable include_in_chat since encrypted
    fields cannot be included in AI chat context.
    """
    # Check if field exists
    field_def = database.get_field_definition_by_id(field_id)
    if not field_def:
        raise HTTPException(status_code=404, detail="Field definition not found")

    current_encryption = field_def.get("encryption_enabled", 1)
    new_encryption = encryption_request.encryption_enabled

    warning = None

    # Check for potential data impact
    if current_encryption != int(new_encryption):
        # TODO: Check if field has existing values that would be affected
        # For now, provide general warning
        if not new_encryption:
            warning = "⚠️ Disabling encryption will store future values as plaintext. Existing encrypted data remains encrypted."
        else:
            warning = "Enabling encryption will encrypt future values. Existing plaintext data remains unencrypted."

        if not encryption_request.force and warning:
            raise HTTPException(
                status_code=400,
                detail=f"{warning} Use force=true to confirm this change."
            )

    # When enabling encryption, auto-disable include_in_chat
    include_in_chat_update = None
    if new_encryption and field_def.get("include_in_chat", 0):
        include_in_chat_update = False
        if warning:
            warning += " Also disabled 'include in chat' since encrypted fields cannot be included in AI chat context."
        else:
            warning = "Disabled 'include in chat' since encrypted fields cannot be included in AI chat context."

    # Update encryption setting (and include_in_chat if needed)
    success = database.update_field_definition(
        field_id,
        encryption_enabled=new_encryption,
        include_in_chat=include_in_chat_update
    )

    if not success:
        raise HTTPException(status_code=500, detail="Failed to update field encryption")

    return FieldEncryptionResponse(
        field_id=field_id,
        encryption_enabled=new_encryption,
        warning=warning,
        migrated_values=0  # TODO: Implement data migration counting
    )


# --- Users ---

@app.get("/admin/users", response_model=UserListResponse)
async def list_users(admin: dict = Depends(auth.require_admin)):
    """List all users with their field values (requires admin auth)"""
    users = database.list_users()
    return UserListResponse(users=[UserResponse(**u) for u in users])


def _is_admin_actor(actor: dict) -> bool:
    """Return True when auth context represents an admin."""
    return actor.get("type") == "admin"


def _require_self_or_admin(target_user_id: int, actor: dict) -> None:
    """Allow access for admins or the user who owns target_user_id."""
    if _is_admin_actor(actor):
        return

    if actor.get("id") != target_user_id:
        raise HTTPException(status_code=403, detail="Forbidden: cannot access another user")


@app.post("/users", response_model=UserResponse)
async def create_user(
    user: UserCreate,
    requester: dict = Depends(auth.require_admin_or_user)
):
    """Create/onboard a new user.

    Args:
        pubkey: Optional Nostr public key (npub or hex)
        email: Optional email address (encrypted, enables email lookups)
        name: Optional user name (encrypted)
        user_type_id: Optional ID of the user type they selected during onboarding
        fields: Dynamic fields defined by admin for the user type

    Requires authenticated user/admin context and admin to be configured first
    (for encryption to work properly).
    """
    # Check if admin is configured (required for data encryption)
    admins = database.list_admins()
    if not admins:
        raise HTTPException(
            status_code=503,
            detail="Instance not configured. An admin must be registered before users can sign up."
        )

    # Validate user_type_id if provided
    if user.user_type_id is not None:
        if not database.get_user_type(user.user_type_id):
            raise HTTPException(status_code=400, detail="User type not found")

    # Normalize pubkey if provided
    pubkey = None
    if user.pubkey:
        from nostr_keys import normalize_pubkey
        try:
            pubkey = normalize_pubkey(user.pubkey)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    # Check for existing user (by pubkey or email) to avoid duplicates
    existing_user = None
    if pubkey:
        existing_user = database.get_user_by_pubkey(pubkey)
    if not existing_user and user.email:
        existing_user = database.get_user_by_email(user.email)

    # Non-admin callers may only operate on their own user record.
    # This blocks anonymous/third-party profile mutation by email/pubkey collision.
    if not _is_admin_actor(requester):
        requester_id = requester.get("id")
        if requester_id is None:
            raise HTTPException(status_code=401, detail="Invalid user session")

        session_user = database.get_user(requester_id) if requester_id != -1 else None
        if existing_user:
            if existing_user["id"] != requester_id:
                raise HTTPException(status_code=403, detail="Forbidden: cannot modify another user")
        elif session_user:
            existing_user = session_user
        elif not requester.get("dev_mode"):
            raise HTTPException(status_code=401, detail="User session is not linked to an account")

    # Resolve effective user_type_id (use existing if not provided)
    effective_user_type_id = user.user_type_id
    if effective_user_type_id is None and existing_user:
        effective_user_type_id = existing_user.get("user_type_id")

    # Get field definitions for this user type (global + type-specific)
    if effective_user_type_id is None:
        field_defs = [
            f for f in database.get_field_definitions()
            if f.get("user_type_id") is None
        ]
    else:
        field_defs = database.get_field_definitions(
            user_type_id=effective_user_type_id,
            include_global=True
        )

    # Validate required fields
    # For partial updates (existing user), consider both existing and provided fields
    required_fields = {f["field_name"] for f in field_defs if f["required"]}
    provided_fields = set(user.fields.keys())

    if existing_user:
        # Union the existing user's fields with provided fields for validation
        existing_fields = set(existing_user.get("fields", {}).keys()) | set(existing_user.get("fields_encrypted", {}).keys())
        all_fields = existing_fields | provided_fields
        missing = required_fields - all_fields
    else:
        # New user: only check provided fields
        missing = required_fields - provided_fields

    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required fields: {', '.join(missing)}"
        )

    # Check for unknown fields (only allow fields defined for this type)
    known_fields = {f["field_name"] for f in field_defs}
    unknown = provided_fields - known_fields
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown fields: {', '.join(unknown)}"
        )

    if existing_user:
        # Update existing user (avoid duplicate accounts)
        if user.user_type_id is not None and user.user_type_id != existing_user.get("user_type_id"):
            database.update_user_type_id(existing_user["id"], user.user_type_id)
            effective_user_type_id = user.user_type_id
        if user.fields:
            database.set_user_fields(existing_user["id"], user.fields, user_type_id=effective_user_type_id)
        return UserResponse(**database.get_user(existing_user["id"]))

    # Create user
    try:
        user_id = database.create_user(
            pubkey=pubkey,
            email=user.email,
            name=user.name,
            user_type_id=user.user_type_id
        )
        if user.fields:
            database.set_user_fields(user_id, user.fields, user_type_id=effective_user_type_id)
        return UserResponse(**database.get_user(user_id))
    except Exception as e:
        if "UNIQUE constraint" in str(e):
            raise HTTPException(status_code=400, detail="User with this pubkey already exists")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/users/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    requester: dict = Depends(auth.require_admin_or_user)
):
    """Get a user by ID (self or admin)."""
    _require_self_or_admin(user_id, requester)
    user = database.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse(**user)


@app.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    user: UserUpdate,
    requester: dict = Depends(auth.require_admin_or_user)
):
    """Update a user's fields (self or admin)."""
    _require_self_or_admin(user_id, requester)
    existing = database.get_user(user_id)
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")

    # Validate fields
    if user.fields:
        field_defs = database.get_field_definitions()
        known_fields = {f["field_name"] for f in field_defs}
        unknown = set(user.fields.keys()) - known_fields
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown fields: {', '.join(unknown)}"
            )
        database.set_user_fields(user_id, user.fields)

    return UserResponse(**database.get_user(user_id))


@app.delete("/users/{user_id}", response_model=SuccessResponse)
async def delete_user(
    user_id: int,
    requester: dict = Depends(auth.require_admin_or_user)
):
    """Delete a user (self or admin)."""
    _require_self_or_admin(user_id, requester)
    if database.delete_user(user_id):
        return SuccessResponse(success=True, message="User deleted")
    raise HTTPException(status_code=404, detail="User not found")


# =============================================================================
# Database Explorer Endpoints (Admin)
# =============================================================================

# Allowed tables for read access (whitelist for security)
ALLOWED_TABLES = {
    'admins', 'instance_settings', 'user_types',
    'user_field_definitions', 'users', 'user_field_values'
}


def get_table_columns(table_name: str) -> list[ColumnInfo]:
    """Get column info for a table using PRAGMA table_info"""
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = []
    for row in cursor.fetchall():
        columns.append(ColumnInfo(
            name=row[1],  # name
            type=row[2] or "TEXT",  # type
            nullable=not row[3],  # notnull (inverted)
            primaryKey=bool(row[5]),  # pk
            defaultValue=row[4]  # dflt_value
        ))
    cursor.close()
    return columns


def get_table_row_count(table_name: str) -> int:
    """Get row count for a table"""
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
    count = cursor.fetchone()[0]
    cursor.close()
    return count


@app.get("/admin/db/tables", response_model=TablesListResponse)
async def list_db_tables(admin: dict = Depends(auth.require_admin)):
    """
    List all tables with metadata (requires admin auth).
    Returns table names, column info, and row counts.
    """
    conn = database.get_connection()
    cursor = conn.cursor()

    # Get all user-created tables
    cursor.execute("""
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    """)
    table_names = [row[0] for row in cursor.fetchall()]
    cursor.close()

    tables = []
    for name in table_names:
        if name in ALLOWED_TABLES:
            tables.append(TableInfo(
                name=name,
                columns=get_table_columns(name),
                rowCount=get_table_row_count(name)
            ))

    return TablesListResponse(tables=tables)


@app.get("/admin/db/tables/{table_name}", response_model=TableDataResponse)
async def get_db_table_data(
    table_name: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    admin: dict = Depends(auth.require_admin)
):
    """
    Get table schema and paginated data (requires admin auth).
    """
    if table_name not in ALLOWED_TABLES:
        raise HTTPException(status_code=403, detail=f"Access to table '{table_name}' is not allowed")

    try:
        columns = get_table_columns(table_name)
        total_rows = get_table_row_count(table_name)
        total_pages = math.ceil(total_rows / page_size) if total_rows > 0 else 1

        # Get paginated rows
        offset = (page - 1) * page_size
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute(f"SELECT * FROM {table_name} LIMIT ? OFFSET ?", (page_size, offset))

        # Convert to list of dicts
        col_names = [col.name for col in columns]
        rows = [dict(zip(col_names, row)) for row in cursor.fetchall()]
        cursor.close()
    except sqlite3.Error as error:
        logger.exception("Database error fetching table data", extra={"table": table_name})
        raise HTTPException(
            status_code=500,
            detail=f"Database error reading table '{table_name}': {error}"
        ) from error

    return TableDataResponse(
        table=table_name,
        columns=columns,
        rows=rows,
        totalRows=total_rows,
        page=page,
        pageSize=page_size,
        totalPages=total_pages
    )


@app.get("/admin/db/tables/{table_name}/schema")
async def get_db_table_schema(table_name: str, admin: dict = Depends(auth.require_admin)):
    """Get just the table schema without data (requires admin auth)"""
    if table_name not in ALLOWED_TABLES:
        raise HTTPException(status_code=403, detail=f"Access to table '{table_name}' is not allowed")

    return {
        "table": table_name,
        "columns": get_table_columns(table_name)
    }


def _encrypt_row_for_write(table_name: str, data: dict) -> dict:
    """Encrypt PII fields for DB explorer writes."""
    from encryption import encrypt_for_admin_required, compute_blind_index, serialize_field_value
    from nostr_keys import normalize_pubkey

    if not data:
        return data

    updated = dict(data)

    if table_name == "users":
        if "pubkey" in updated:
            pubkey_val = updated["pubkey"]
            trimmed_pubkey = str(pubkey_val).strip() if pubkey_val is not None else ""
            if trimmed_pubkey:
                updated["pubkey"] = normalize_pubkey(trimmed_pubkey)
            else:
                updated["pubkey"] = None

        if "email" in updated:
            email_val = updated["email"]
            email_str = str(email_val).strip() if email_val is not None else ""
            if email_str:
                encrypted_email, eph = encrypt_for_admin_required(email_str)
                updated["encrypted_email"] = encrypted_email
                updated["ephemeral_pubkey_email"] = eph
                updated["email_blind_index"] = compute_blind_index(email_str.lower())
                updated["email"] = None
            else:
                updated["email"] = None
                updated["encrypted_email"] = None
                updated["ephemeral_pubkey_email"] = None
                updated["email_blind_index"] = None

        if "encrypted_email" in updated and updated.get("encrypted_email") and not updated.get("ephemeral_pubkey_email"):
            raise ValueError("ephemeral_pubkey_email required when encrypted_email is provided")

        if "encrypted_email" in updated and updated.get("encrypted_email") and updated.get("email_blind_index") is None:
            raise ValueError("email_blind_index required when encrypted_email is provided")

        if "name" in updated:
            name_val = updated["name"]
            name_str = str(name_val).strip() if name_val is not None else ""
            if name_str:
                encrypted_name, eph = encrypt_for_admin_required(name_str)
                updated["encrypted_name"] = encrypted_name
                updated["ephemeral_pubkey_name"] = eph
                updated["name"] = None
            else:
                updated["name"] = None
                updated["encrypted_name"] = None
                updated["ephemeral_pubkey_name"] = None

        if "encrypted_name" in updated and updated.get("encrypted_name") and not updated.get("ephemeral_pubkey_name"):
            raise ValueError("ephemeral_pubkey_name required when encrypted_name is provided")

    elif table_name == "user_field_values":
        if "value" in updated:
            value_val = updated["value"]
            # Serialize value, use strip() only for emptiness check to preserve whitespace
            value_str = serialize_field_value(value_val) if value_val is not None else ""
            if value_str.strip():
                encrypted_value, eph = encrypt_for_admin_required(value_str)
                updated["encrypted_value"] = encrypted_value
                updated["ephemeral_pubkey"] = eph
                updated["value"] = None
            else:
                updated["value"] = None
                updated["encrypted_value"] = None
                updated["ephemeral_pubkey"] = None

        if "encrypted_value" in updated and updated.get("encrypted_value") and not updated.get("ephemeral_pubkey"):
            raise ValueError("ephemeral_pubkey required when encrypted_value is provided")

    return updated


@app.post("/admin/db/query", response_model=DBQueryResponse)
async def execute_db_query(request: DBQueryRequest, admin: dict = Depends(auth.require_admin)):
    """
    Execute a read-only SQL query (requires admin auth).
    Only SELECT statements are allowed for safety.
    """
    sql = request.sql.strip()

    # Security: Only allow SELECT statements
    if not sql.upper().startswith("SELECT"):
        return DBQueryResponse(
            success=False,
            error="Only SELECT queries are allowed. Use the CRUD endpoints for modifications."
        )

    # Security: Block dangerous patterns
    dangerous_patterns = [
        r'\bDROP\b', r'\bDELETE\b', r'\bINSERT\b', r'\bUPDATE\b',
        r'\bALTER\b', r'\bCREATE\b', r'\bTRUNCATE\b', r'\bATTACH\b',
        r'\bDETACH\b', r'\bPRAGMA\b'
    ]
    for pattern in dangerous_patterns:
        if re.search(pattern, sql, re.IGNORECASE):
            return DBQueryResponse(
                success=False,
                error=f"Query contains forbidden keyword"
            )

    start_time = time.time()

    try:
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute(sql)

        # Get column names
        columns = [desc[0] for desc in cursor.description] if cursor.description else []

        # Fetch all rows
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        cursor.close()

        execution_time = int((time.time() - start_time) * 1000)

        return DBQueryResponse(
            success=True,
            columns=columns,
            rows=rows,
            executionTimeMs=execution_time
        )
    except Exception as e:
        return DBQueryResponse(
            success=False,
            error=str(e)
        )


@app.post("/admin/db/tables/{table_name}/rows", response_model=RowMutationResponse)
async def insert_db_row(table_name: str, request: RowMutationRequest, admin: dict = Depends(auth.require_admin)):
    """Insert a new row into a table (requires admin auth)"""
    if table_name not in ALLOWED_TABLES:
        raise HTTPException(status_code=403, detail=f"Access to table '{table_name}' is not allowed")

    if not request.data:
        return RowMutationResponse(success=False, error="No data provided")

    try:
        data = _encrypt_row_for_write(table_name, request.data)
        if not data:
            return RowMutationResponse(success=False, error="No data provided")

        columns = list(data.keys())
        placeholders = ", ".join(["?" for _ in columns])
        col_names = ", ".join(columns)
        values = list(data.values())

        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            f"INSERT INTO {table_name} ({col_names}) VALUES ({placeholders})",
            values
        )
        conn.commit()

        row_id = cursor.lastrowid
        cursor.close()

        return RowMutationResponse(success=True, id=row_id)
    except ValueError as e:
        return RowMutationResponse(success=False, error=str(e))
    except Exception as e:
        return RowMutationResponse(success=False, error=str(e))


@app.put("/admin/db/tables/{table_name}/rows/{row_id}", response_model=RowMutationResponse)
async def update_db_row(table_name: str, row_id: int, request: RowMutationRequest, admin: dict = Depends(auth.require_admin)):
    """Update an existing row in a table (requires admin auth)"""
    if table_name not in ALLOWED_TABLES:
        raise HTTPException(status_code=403, detail=f"Access to table '{table_name}' is not allowed")

    if not request.data:
        return RowMutationResponse(success=False, error="No data provided")

    try:
        data = _encrypt_row_for_write(table_name, request.data)
        if not data:
            return RowMutationResponse(success=False, error="No data provided")

        set_clause = ", ".join([f"{k} = ?" for k in data.keys()])
        values = list(data.values()) + [row_id]

        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE {table_name} SET {set_clause} WHERE id = ?",
            values
        )
        conn.commit()

        if cursor.rowcount == 0:
            cursor.close()
            return RowMutationResponse(success=False, error="Row not found")

        cursor.close()
        return RowMutationResponse(success=True, id=row_id)
    except ValueError as e:
        return RowMutationResponse(success=False, error=str(e))
    except Exception as e:
        return RowMutationResponse(success=False, error=str(e))


@app.delete("/admin/db/tables/{table_name}/rows/{row_id}", response_model=RowMutationResponse)
async def delete_db_row(table_name: str, row_id: int, admin: dict = Depends(auth.require_admin)):
    """Delete a row from a table (requires admin auth)"""
    if table_name not in ALLOWED_TABLES:
        raise HTTPException(status_code=403, detail=f"Access to table '{table_name}' is not allowed")

    try:
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute(f"DELETE FROM {table_name} WHERE id = ?", (row_id,))
        conn.commit()

        if cursor.rowcount == 0:
            cursor.close()
            return RowMutationResponse(success=False, error="Row not found")

        cursor.close()
        return RowMutationResponse(success=True, id=row_id)
    except Exception as e:
        return RowMutationResponse(success=False, error=str(e))


@app.get("/admin/database/export")
async def export_database(background_tasks: BackgroundTasks, _admin: Dict = Depends(auth.require_admin)) -> FileResponse:
    """
    Export the SQLite database as a downloadable backup file.
    
    Creates a consistent snapshot of the database using SQLite's backup mechanism
    to avoid locking the live database during export. The backup file is served
    with a timestamped filename for easy organization.
    
    Args:
        _admin (Dict): Admin authentication dependency (unused but required)
        
    Returns:
        FileResponse: Database backup file with timestamped filename
        
    Raises:
        HTTPException: 
            - 404 if database file not found
            - 500 if backup creation or export fails
    """
    try:
        # Get the database file path
        db_path = database.SQLITE_PATH
        
        # Check if database file exists
        if not os.path.exists(db_path):
            raise HTTPException(status_code=404, detail="Database file not found")
        
        # Generate filename with timestamp
        import datetime
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"sanctum_backup_{timestamp}.db"
        
        # Create a temporary file for the backup
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
        temp_path = temp_file.name
        temp_file.close()
        
        try:
            # Helper to run blocking backup in thread pool
            def perform_backup() -> None:
                source_conn = sqlite3.connect(db_path)
                try:
                    backup_conn = sqlite3.connect(temp_path)
                    try:
                        source_conn.backup(backup_conn)
                    finally:
                        backup_conn.close()
                finally:
                    source_conn.close()

            # Run blocking backup operation in a thread to avoid stalling event loop
            await asyncio.to_thread(perform_backup)

            # Return the backup file as a download with cleanup
            def cleanup_temp_file() -> None:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass
            
            # Schedule cleanup after response is sent using BackgroundTasks
            background_tasks.add_task(cleanup_temp_file)
            
            return FileResponse(
                path=temp_path,
                filename=filename,
                media_type="application/octet-stream",
                headers={"Content-Disposition": f"attachment; filename={filename}"}
            )
            
        except Exception:
            # Clean up temp file on backup failure
            try:
                os.unlink(temp_path)
            except OSError:
                pass
            raise

    except HTTPException:
        # Re-raise HTTPExceptions to preserve status codes
        raise
    except Exception as e:
        logger.exception("Database export failed")
        raise HTTPException(status_code=500, detail=f"Export failed: {e!r}") from e
