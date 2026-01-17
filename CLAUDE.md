# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sanctum is a privacy-first Retrieval-Augmented Generation (RAG) system for building and querying curated knowledge bases. The stack uses FastAPI (Python 3.11), Neo4j for graph storage, and Qdrant for vector search.

## Common Commands

### Start/Stop Services
```bash
docker compose up --build          # Start all services (blocking)
docker compose up --build -d       # Start detached
docker compose down                # Stop services
docker compose down -v             # Stop and clear all data
```

### View Logs
```bash
docker compose logs -f backend     # Backend logs
docker compose logs -f neo4j       # Neo4j logs
docker compose logs -f qdrant      # Qdrant logs
```

### Verify Services
```bash
curl http://localhost:8000/test    # Smoke test (verifies Neo4j + Qdrant connectivity)
curl http://localhost:8000/health  # Health check
```

## Architecture

**Services** (all on Docker network `sanctum-net`):
- **Backend** (port 8000): FastAPI app with uvicorn hot-reload
- **Neo4j** (ports 7474/7687): Graph database for knowledge representation
- **Qdrant** (ports 6333/6334): Vector database for semantic search

**Data Flow**:
1. `seed.py` runs on backend startup - creates test data in Neo4j and embeddings in Qdrant
2. `main.py` exposes the FastAPI application with endpoints for querying

**Key Files**:
- `backend/app/main.py` - FastAPI routes and service initialization
- `backend/app/seed.py` - Database seeding with test claims/sources
- `docker-compose.yml` - Service orchestration

**Data Model**:
- Neo4j nodes: `Claim` and `Source` with `SUPPORTED_BY` relationships
- Qdrant collection: `sanctum_smoke_test` with 768-dimensional embeddings
- Qdrant point IDs use UUIDs derived via `uuid.uuid5(uuid.NAMESPACE_DNS, claim_id)`
- Embedding model: `intfloat/multilingual-e5-base` (uses "passage: " prefix convention)

**Version Constraints** (in requirements.txt):
- `numpy<2` required - torch/transformers compiled against NumPy 1.x
- `transformers==4.36.0` pinned - newer versions incompatible with torch 2.1.2

## Development Notes

- Backend auto-reloads on code changes (uvicorn --reload)
- First startup downloads ~500MB embedding model to `embedding_cache` volume
- Neo4j credentials: `neo4j` / `sanctum_dev_password`
- Neo4j browser: http://localhost:7474
- Qdrant dashboard: http://localhost:6333/dashboard
- No test framework configured yet - use `/test` endpoint for manual verification
