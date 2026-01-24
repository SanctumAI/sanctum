"""
Sanctum Backend - FastAPI Application
RAG system with Qdrant vector search.
Also provides user/admin management via SQLite.
"""

import os
import uuid
import logging
import time
import re
import math
from fastapi import FastAPI, HTTPException, Query, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from qdrant_client import QdrantClient
from pydantic import BaseModel
from typing import Optional, List
from sentence_transformers import SentenceTransformer

from llm import get_provider
from tools import init_tools, ToolOrchestrator, ToolCallInfo
import database
from models import (
    AdminAuth, AdminResponse, AdminListResponse,
    AdminAuthRequest, AdminAuthResponse,
    InstanceSettings, InstanceSettingsResponse,
    # User Type models
    UserTypeCreate, UserTypeUpdate, UserTypeResponse, UserTypeListResponse,
    # Field Definition models
    FieldDefinitionCreate, FieldDefinitionUpdate, FieldDefinitionResponse, FieldDefinitionListResponse,
    UserCreate, UserUpdate, UserResponse, UserListResponse,
    SuccessResponse,
    # Database Explorer models
    ColumnInfo, TableInfo, TablesListResponse,
    TableDataResponse, DBQueryRequest, DBQueryResponse,
    RowMutationRequest, RowMutationResponse,
    # Magic Link Auth models
    MagicLinkRequest, MagicLinkResponse,
    VerifyTokenResponse, AuthUserResponse, SessionUserResponse
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

logger.info("Starting Sanctum API...")

app = FastAPI(
    title="Sanctum API",
    description="Privacy-first RAG system for curated knowledge",
    version="0.1.0"
)

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(ingest_router)
app.include_router(query_router)


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


class ChatResponse(BaseModel):
    """Response model for chat endpoint"""
    message: str
    model: str
    provider: str
    tools_used: List[ToolCallInfoResponse] = []


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
async def chat(request: ChatRequest, user: dict = Depends(auth.require_admin_or_approved_user)):
    """
    Chat endpoint with optional tool support.

    Takes a user message and optional list of tool IDs.
    If tools are specified, executes them and includes results in context.
    Requires authenticated admin OR approved user.
    """
    try:
        tools_used = []
        prompt = request.message

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
            tools_used = [
                ToolCallInfoResponse(
                    tool_id=info.tool_id,
                    tool_name=info.tool_name,
                    query=info.query
                )
                for info in tool_infos
            ]

            # Build augmented prompt with tool context
            if tool_context:
                prompt = f"""Use the following information to help answer the question.

{tool_context}

Question: {request.message}

Answer:"""

        provider = get_provider()
        result = provider.complete(prompt)
        return ChatResponse(
            message=result.content,
            model=result.model,
            provider=result.provider,
            tools_used=tools_used
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# NOTE: /query endpoint moved to query.py router (empathetic session-aware RAG)
# The query.py module provides:
# - Session-aware conversation history
# - 2-hop graph traversal
# - Empathetic crisis support prompts
# - Clarifying questions for jurisdiction/context


@app.post("/vector-search", response_model=VectorSearchResponse)
async def vector_search(request: VectorSearchRequest):
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
    _: None = Depends(magic_link_limiter)
):
    """
    Send a magic link to the user's email for authentication.
    Creates a signed, time-limited token and sends it via email.
    Rate limited to 5 requests per minute per IP.
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


@app.get("/auth/verify", response_model=VerifyTokenResponse)
async def verify_magic_link(token: str = Query(..., description="Magic link token")):
    """
    Verify a magic link token and create/return the user.
    Returns a session token for subsequent authenticated requests.
    """
    # Require admin to be configured before onboarding
    if not database.list_admins():
        raise HTTPException(
            status_code=503,
            detail="Instance not configured. An admin must be registered before users can sign up."
        )

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

    return VerifyTokenResponse(
        success=True,
        user=AuthUserResponse(
            id=user["id"],
            email=email,
            name=name or user.get("name"),
            user_type_id=user.get("user_type_id"),
            approved=bool(user.get("approved", 1)),
            created_at=user.get("created_at")
        ),
        session_token=session_token
    )


@app.get("/auth/me", response_model=SessionUserResponse)
async def get_current_user(token: str = Query(None, description="Session token")):
    """
    Get the current authenticated user from session token.
    Returns authenticated: false if no valid session.
    """
    if not token:
        return SessionUserResponse(authenticated=False)

    # Verify session
    data = auth.verify_session_token(token)
    if not data:
        return SessionUserResponse(authenticated=False)

    # Get user
    user = database.get_user(data["user_id"])
    if not user:
        return SessionUserResponse(authenticated=False)

    return SessionUserResponse(
        authenticated=True,
        user=AuthUserResponse(
            id=user["id"],
            email=user.get("email", data["email"]),
            name=user.get("name"),
            user_type_id=user.get("user_type_id"),
            approved=bool(user.get("approved", 1)),
            created_at=user.get("created_at")
        )
    )


# =============================================================================
# Admin & User Management Endpoints (SQLite)
# =============================================================================

# --- Admin Authentication ---

@app.post("/admin/auth", response_model=AdminAuthResponse)
async def admin_auth(
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
    # SECURITY: Single-admin restriction (v1)
    #
    # Only the FIRST person to authenticate via NIP-07 can become the admin.
    # After an admin exists, new registrations are rejected. Existing admins
    # can still re-authenticate to get new session tokens.
    #
    # TODO: Future enhancement - allow existing admins to invite new admins
    # ==========================================================================
    all_admins = database.list_admins()
    instance_initialized = len(all_admins) > 0

    if existing is None and instance_initialized:
        # Someone is trying to register as admin but an admin already exists
        raise HTTPException(
            status_code=403,
            detail="Admin registration is closed. This instance already has an admin."
        )

    is_new = existing is None

    if is_new:
        # First admin creation - only happens when no admins exist yet
        database.add_admin(pubkey)
        admin = database.get_admin_by_pubkey(pubkey)

        # Migrate any existing plaintext data to encrypted format
        # This happens when users signed up before an admin was configured
        database.migrate_encrypt_existing_data()
    else:
        admin = existing

    # Create session token for subsequent authenticated requests
    session_token = auth.create_admin_session_token(admin["id"], pubkey)

    return AdminAuthResponse(
        admin=AdminResponse(**admin),
        is_new=is_new,
        instance_initialized=instance_initialized,
        session_token=session_token
    )


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


# --- Instance Settings ---

class InstanceStatusResponse(BaseModel):
    """Response model for instance status"""
    initialized: bool  # True if an admin has been registered
    settings: dict


@app.get("/instance/status", response_model=InstanceStatusResponse)
async def get_instance_status():
    """
    Public endpoint: Check if instance is initialized (has an admin).

    Used by frontend to determine whether to show:
    - Admin setup flow (if not initialized)
    - User registration (if initialized)
    """
    admins = database.list_admins()
    settings = database.get_all_settings()
    return InstanceStatusResponse(
        initialized=len(admins) > 0,
        settings=settings
    )


@app.get("/settings/public", response_model=InstanceSettingsResponse)
async def get_public_settings():
    """Public endpoint: Get instance settings for branding (name, color, etc.)"""
    settings = database.get_all_settings()
    return InstanceSettingsResponse(settings=settings)


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

    try:
        field_id = database.create_field_definition(
            field_name=field.field_name,
            field_type=field.field_type,
            required=field.required,
            display_order=field.display_order,
            user_type_id=field.user_type_id
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

    database.update_field_definition(
        field_id,
        field_name=field.field_name,
        field_type=field.field_type,
        required=field.required,
        display_order=field.display_order,
        user_type_id=field.user_type_id if field.user_type_id != 0 else None
    )
    updated = database.get_field_definition_by_id(field_id)
    return FieldDefinitionResponse(**updated)


@app.delete("/admin/user-fields/{field_id}", response_model=SuccessResponse)
async def delete_field_definition(field_id: int, admin: dict = Depends(auth.require_admin)):
    """Delete a user field definition (requires admin auth)"""
    if database.delete_field_definition(field_id):
        return SuccessResponse(success=True, message="Field definition deleted")
    raise HTTPException(status_code=404, detail="Field definition not found")


# --- Users ---

@app.get("/admin/users", response_model=UserListResponse)
async def list_users(admin: dict = Depends(auth.require_admin)):
    """List all users with their field values (requires admin auth)"""
    users = database.list_users()
    return UserListResponse(users=[UserResponse(**u) for u in users])


@app.post("/users", response_model=UserResponse)
async def create_user(user: UserCreate):
    """Create/onboard a new user.

    Args:
        pubkey: Optional Nostr public key (npub or hex)
        email: Optional email address (encrypted, enables email lookups)
        name: Optional user name (encrypted)
        user_type_id: Optional ID of the user type they selected during onboarding
        fields: Dynamic fields defined by admin for the user type

    Requires admin to be configured first (for encryption to work properly).
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

    # Get field definitions for this user type (global + type-specific)
    field_defs = database.get_field_definitions(
        user_type_id=user.user_type_id,
        include_global=True
    )

    # Validate required fields
    required_fields = {f["field_name"] for f in field_defs if f["required"]}
    provided_fields = set(user.fields.keys())
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

    # Normalize pubkey if provided
    pubkey = None
    if user.pubkey:
        from nostr_keys import normalize_pubkey
        try:
            pubkey = normalize_pubkey(user.pubkey)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    # Create user
    try:
        user_id = database.create_user(
            pubkey=pubkey,
            email=user.email,
            name=user.name,
            user_type_id=user.user_type_id
        )
        if user.fields:
            database.set_user_fields(user_id, user.fields, user_type_id=user.user_type_id)
        return UserResponse(**database.get_user(user_id))
    except Exception as e:
        if "UNIQUE constraint" in str(e):
            raise HTTPException(status_code=400, detail="User with this pubkey already exists")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: int):
    """Get a user by ID"""
    user = database.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse(**user)


@app.put("/users/{user_id}", response_model=UserResponse)
async def update_user(user_id: int, user: UserUpdate):
    """Update a user's fields"""
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
async def delete_user(user_id: int):
    """Delete a user"""
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
        if "pubkey" in updated and updated["pubkey"] is not None:
            updated["pubkey"] = normalize_pubkey(str(updated["pubkey"]))

        if "email" in updated:
            email_val = updated["email"]
            email_str = str(email_val).strip() if email_val is not None else ""
            if email_str:
                encrypted_email, eph = encrypt_for_admin_required(email_str)
                updated["encrypted_email"] = encrypted_email
                updated["ephemeral_pubkey_email"] = eph
                updated["email_blind_index"] = compute_blind_index(email_str)
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
            # Serialize and strip to check for actual content
            value_str = serialize_field_value(value_val).strip() if value_val is not None else ""
            if value_str:
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
