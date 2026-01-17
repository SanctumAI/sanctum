"""
Sanctum Backend - FastAPI Application
Smoke test implementation for verifying Neo4j and Qdrant connectivity.
"""

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from neo4j import GraphDatabase
from qdrant_client import QdrantClient
from pydantic import BaseModel
from typing import Optional

app = FastAPI(
    title="Sanctum API",
    description="Privacy-first RAG system for curated knowledge",
    version="0.1.0"
)

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
            # Retrieve the seeded point
            points = client.retrieve(
                collection_name=COLLECTION_NAME,
                ids=["claim_udhr_1948"],
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
