"""
Sanctum Backend - FastAPI Application
Smoke test implementation for verifying Neo4j and Qdrant connectivity.
Also provides user/admin management via SQLite.
"""

import os
import uuid
import logging
import time
import re
import math
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from neo4j import GraphDatabase
from qdrant_client import QdrantClient
from pydantic import BaseModel
from typing import Optional, List
from sentence_transformers import SentenceTransformer

from llm import get_provider
import database
from models import (
    AdminAuth, AdminResponse, AdminListResponse,
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
    RowMutationRequest, RowMutationResponse
)

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

# Configuration from environment
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "sanctum_dev_password")
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))

# Collection name for smoke test
COLLECTION_NAME = "sanctum_smoke_test"


class SmokeTestResult(BaseModel):
    """Response model for smoke test endpoint"""
    neo4j: dict
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


class ChatRequest(BaseModel):
    """Request model for chat endpoint"""
    message: str


class ChatResponse(BaseModel):
    """Response model for chat endpoint"""
    message: str
    model: str
    provider: str


class QueryRequest(BaseModel):
    """Request model for RAG query endpoint"""
    question: str
    top_k: int = 3


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


class Neo4jQueryRequest(BaseModel):
    """Request model for Neo4j query endpoint"""
    cypher: str


class Neo4jQueryResponse(BaseModel):
    """Response model for Neo4j query endpoint"""
    success: bool
    columns: List[str] = []
    rows: List[dict] = []
    error: Optional[str] = None


# Lazy-loaded embedding model singleton
_embedding_model = None


def get_embedding_model():
    """Get or create the embedding model (lazy singleton)"""
    global _embedding_model
    if _embedding_model is None:
        _embedding_model = SentenceTransformer(EMBEDDING_MODEL)
    return _embedding_model


def get_neo4j_driver():
    """Create Neo4j driver connection"""
    return GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))


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
        "neo4j": "unknown",
        "qdrant": "unknown"
    }
    
    # Check Neo4j
    try:
        driver = get_neo4j_driver()
        with driver.session() as session:
            session.run("RETURN 1")
        services["neo4j"] = "healthy"
        driver.close()
    except Exception as e:
        services["neo4j"] = f"unhealthy: {str(e)}"
    
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
    Smoke test endpoint that verifies:
    1. Neo4j contains the seeded Spanish claim/fact
    2. Qdrant contains the corresponding embedding
    
    Returns details about the seeded data if found.
    """
    neo4j_result = {"status": "error", "claim": None, "source": None}
    qdrant_result = {"status": "error", "vector_id": None, "payload": None}
    
    # Test Neo4j - retrieve the seeded claim
    try:
        driver = get_neo4j_driver()
        with driver.session() as session:
            # Query for the seeded claim and its source
            result = session.run("""
                MATCH (c:Claim)-[:SUPPORTED_BY]->(s:Source)
                WHERE c.id = 'claim_udhr_1948'
                RETURN c.id as claim_id, 
                       c.text as claim_text, 
                       c.language as language,
                       s.id as source_id, 
                       s.title as source_title
            """)
            record = result.single()
            
            if record:
                neo4j_result = {
                    "status": "ok",
                    "claim": {
                        "id": record["claim_id"],
                        "text": record["claim_text"],
                        "language": record["language"]
                    },
                    "source": {
                        "id": record["source_id"],
                        "title": record["source_title"]
                    }
                }
            else:
                neo4j_result = {
                    "status": "error",
                    "message": "Seeded claim not found. Run seed script."
                }
        driver.close()
    except Exception as e:
        neo4j_result = {
            "status": "error",
            "message": f"Neo4j error: {str(e)}"
        }
    
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
    success = (
        neo4j_result.get("status") == "ok" and 
        qdrant_result.get("status") == "ok"
    )
    
    message = "Smoke test passed! ✓" if success else "Smoke test failed. Check component status."
    
    return SmokeTestResult(
        neo4j=neo4j_result,
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
async def chat(request: ChatRequest):
    """
    Simple chat endpoint for smoke testing LLM provider.

    Takes a user message and returns the LLM response.
    """
    try:
        provider = get_provider()
        result = provider.complete(request.message)
        return ChatResponse(
            message=result.content,
            model=result.model,
            provider=result.provider
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/query", response_model=QueryResponse)
async def query(request: QueryRequest):
    """
    RAG query endpoint.

    1. Embeds the question using the same model as ingestion
    2. Searches Qdrant for semantically similar claims
    3. Resolves claim IDs to full Neo4j graph data
    4. Sends context + question to LLM
    5. Returns grounded answer with citations
    """
    try:
        # 1. Embed the question
        model = get_embedding_model()
        query_embedding = model.encode(f"query: {request.question}").tolist()

        # 2. Search Qdrant for similar vectors
        qdrant = get_qdrant_client()
        results = qdrant.search(
            collection_name=COLLECTION_NAME,
            query_vector=query_embedding,
            limit=request.top_k
        )

        if not results:
            return QueryResponse(
                answer="No relevant information found in the knowledge base.",
                citations=[],
                model="none",
                provider="none"
            )

        # 3. Resolve to Neo4j for full claim + source data
        claim_ids = [r.payload["claim_id"] for r in results]
        driver = get_neo4j_driver()
        with driver.session() as session:
            records = session.run("""
                MATCH (c:Claim)-[:SUPPORTED_BY]->(s:Source)
                WHERE c.id IN $claim_ids
                RETURN c.id as claim_id, c.text as claim_text,
                       s.title as source_title, s.url as source_url
            """, claim_ids=claim_ids)
            claims = [dict(r) for r in records]
        driver.close()

        if not claims:
            return QueryResponse(
                answer="Retrieved vectors but could not resolve to graph data.",
                citations=[],
                model="none",
                provider="none"
            )

        # 4. Build context from retrieved claims
        context = "\n".join([
            f"- {c['claim_text']} (Source: {c['source_title']})"
            for c in claims
        ])

        # 5. Generate answer using LLM
        prompt = f"""Answer the question using ONLY the context below. Cite your sources.

Context:
{context}

Question: {request.question}

Answer:"""

        provider = get_provider()
        result = provider.complete(prompt)

        # Build citations from retrieved claims
        citations = [
            Citation(
                claim_id=c["claim_id"],
                claim_text=c["claim_text"],
                source_title=c["source_title"],
                source_url=c.get("source_url")
            )
            for c in claims
        ]

        return QueryResponse(
            answer=result.content,
            citations=citations,
            model=result.model,
            provider=result.provider
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
        results = qdrant.search(
            collection_name=request.collection,
            query_vector=query_embedding,
            limit=request.top_k
        )

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


@app.post("/admin/neo4j/query", response_model=Neo4jQueryResponse)
async def neo4j_query(request: Neo4jQueryRequest):
    """
    Execute a read-only Cypher query against Neo4j.

    Only MATCH queries are allowed for safety.
    Useful for exploring the knowledge graph after ingestion.
    """
    cypher = request.cypher.strip()

    # Security: Only allow read queries (MATCH, RETURN, etc.)
    cypher_upper = cypher.upper()
    write_keywords = ['CREATE', 'MERGE', 'DELETE', 'REMOVE', 'SET', 'DROP', 'DETACH']
    for keyword in write_keywords:
        if keyword in cypher_upper:
            return Neo4jQueryResponse(
                success=False,
                error=f"Write operations not allowed. Query contains '{keyword}'."
            )

    try:
        driver = get_neo4j_driver()
        with driver.session() as session:
            result = session.run(cypher)
            # Get column names from keys
            columns = list(result.keys())
            # Convert records to dicts
            rows = []
            for record in result:
                row = {}
                for key in columns:
                    value = record[key]
                    # Handle Neo4j node/relationship objects
                    if hasattr(value, '_properties'):
                        row[key] = dict(value._properties)
                        if hasattr(value, 'labels'):
                            row[key]['_labels'] = list(value.labels)
                    elif hasattr(value, 'type'):
                        row[key] = {'_type': value.type, **dict(value._properties)}
                    else:
                        row[key] = value
                rows.append(row)
        driver.close()

        return Neo4jQueryResponse(
            success=True,
            columns=columns,
            rows=rows
        )

    except Exception as e:
        return Neo4jQueryResponse(
            success=False,
            error=str(e)
        )


# =============================================================================
# Admin & User Management Endpoints (SQLite)
# =============================================================================

# --- Admin Authentication ---

@app.post("/admin/auth", response_model=AdminResponse)
async def admin_auth(request: AdminAuth):
    """
    Authenticate or register an admin by Nostr pubkey.
    If the pubkey exists, returns the admin.
    If not, creates a new admin entry.
    """
    existing = database.get_admin_by_pubkey(request.pubkey)
    if existing:
        return AdminResponse(**existing)

    admin_id = database.add_admin(request.pubkey)
    admin = database.get_admin_by_pubkey(request.pubkey)
    return AdminResponse(**admin)


@app.get("/admin/list", response_model=AdminListResponse)
async def list_admins():
    """List all admins"""
    admins = database.list_admins()
    return AdminListResponse(admins=[AdminResponse(**a) for a in admins])


@app.delete("/admin/{pubkey}", response_model=SuccessResponse)
async def remove_admin(pubkey: str):
    """Remove an admin by pubkey"""
    if database.remove_admin(pubkey):
        return SuccessResponse(success=True, message="Admin removed")
    raise HTTPException(status_code=404, detail="Admin not found")


# --- Instance Settings ---

@app.get("/admin/settings", response_model=InstanceSettingsResponse)
async def get_settings():
    """Get all instance settings"""
    settings = database.get_all_settings()
    return InstanceSettingsResponse(settings=settings)


@app.put("/admin/settings", response_model=InstanceSettingsResponse)
async def update_settings(settings: InstanceSettings):
    """Update instance settings"""
    settings_dict = settings.model_dump(exclude_unset=True)
    database.update_settings(settings_dict)
    return InstanceSettingsResponse(settings=database.get_all_settings())


# --- User Types ---

@app.get("/user-types", response_model=UserTypeListResponse)
async def get_user_types_public():
    """Public endpoint: Get all user types for onboarding UI"""
    types = database.list_user_types()
    return UserTypeListResponse(types=[UserTypeResponse(**t) for t in types])


@app.get("/admin/user-types", response_model=UserTypeListResponse)
async def list_user_types():
    """Get all user types"""
    types = database.list_user_types()
    return UserTypeListResponse(types=[UserTypeResponse(**t) for t in types])


@app.post("/admin/user-types", response_model=UserTypeResponse)
async def create_user_type(user_type: UserTypeCreate):
    """Create a new user type"""
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
async def update_user_type(type_id: int, user_type: UserTypeUpdate):
    """Update a user type"""
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
async def delete_user_type(type_id: int):
    """Delete a user type (cascades to field definitions)"""
    if database.delete_user_type(type_id):
        return SuccessResponse(success=True, message="User type deleted")
    raise HTTPException(status_code=404, detail="User type not found")


# --- User Field Definitions ---

@app.get("/admin/user-fields", response_model=FieldDefinitionListResponse)
async def get_field_definitions(user_type_id: Optional[int] = Query(None)):
    """Get user field definitions, optionally filtered by type.
    If user_type_id is provided, returns global fields + type-specific fields.
    """
    fields = database.get_field_definitions(user_type_id=user_type_id, include_global=True)
    return FieldDefinitionListResponse(
        fields=[FieldDefinitionResponse(**f) for f in fields]
    )


@app.post("/admin/user-fields", response_model=FieldDefinitionResponse)
async def create_field_definition(field: FieldDefinitionCreate):
    """Create a new user field definition.
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
async def update_field_definition(field_id: int, field: FieldDefinitionUpdate):
    """Update a field definition"""
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
async def delete_field_definition(field_id: int):
    """Delete a user field definition"""
    if database.delete_field_definition(field_id):
        return SuccessResponse(success=True, message="Field definition deleted")
    raise HTTPException(status_code=404, detail="Field definition not found")


# --- Users ---

@app.get("/admin/users", response_model=UserListResponse)
async def list_users():
    """List all users with their field values"""
    users = database.list_users()
    return UserListResponse(users=[UserResponse(**u) for u in users])


@app.post("/users", response_model=UserResponse)
async def create_user(user: UserCreate):
    """Create/onboard a new user.
    user_type_id: Optional ID of the user type they selected during onboarding.
    """
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

    # Create user
    try:
        user_id = database.create_user(pubkey=user.pubkey, user_type_id=user.user_type_id)
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
async def list_db_tables():
    """
    List all tables with metadata.
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
    page_size: int = Query(50, ge=1, le=500)
):
    """
    Get table schema and paginated data.
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
async def get_db_table_schema(table_name: str):
    """Get just the table schema without data"""
    if table_name not in ALLOWED_TABLES:
        raise HTTPException(status_code=403, detail=f"Access to table '{table_name}' is not allowed")

    return {
        "table": table_name,
        "columns": get_table_columns(table_name)
    }


@app.post("/admin/db/query", response_model=DBQueryResponse)
async def execute_db_query(request: DBQueryRequest):
    """
    Execute a read-only SQL query.
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
async def insert_db_row(table_name: str, request: RowMutationRequest):
    """Insert a new row into a table"""
    if table_name not in ALLOWED_TABLES:
        raise HTTPException(status_code=403, detail=f"Access to table '{table_name}' is not allowed")

    if not request.data:
        return RowMutationResponse(success=False, error="No data provided")

    try:
        columns = list(request.data.keys())
        placeholders = ", ".join(["?" for _ in columns])
        col_names = ", ".join(columns)
        values = list(request.data.values())

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
    except Exception as e:
        return RowMutationResponse(success=False, error=str(e))


@app.put("/admin/db/tables/{table_name}/rows/{row_id}", response_model=RowMutationResponse)
async def update_db_row(table_name: str, row_id: int, request: RowMutationRequest):
    """Update an existing row in a table"""
    if table_name not in ALLOWED_TABLES:
        raise HTTPException(status_code=403, detail=f"Access to table '{table_name}' is not allowed")

    if not request.data:
        return RowMutationResponse(success=False, error="No data provided")

    try:
        set_clause = ", ".join([f"{k} = ?" for k in request.data.keys()])
        values = list(request.data.values()) + [row_id]

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
    except Exception as e:
        return RowMutationResponse(success=False, error=str(e))


@app.delete("/admin/db/tables/{table_name}/rows/{row_id}", response_model=RowMutationResponse)
async def delete_db_row(table_name: str, row_id: int):
    """Delete a row from a table"""
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
