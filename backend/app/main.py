"""
Sanctum Backend - FastAPI Application
Smoke test implementation for verifying Neo4j and Qdrant connectivity.
"""

import os
import uuid
import logging
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from neo4j import GraphDatabase
from qdrant_client import QdrantClient
from pydantic import BaseModel
from typing import Optional, List
from sentence_transformers import SentenceTransformer

from llm import get_provider

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
