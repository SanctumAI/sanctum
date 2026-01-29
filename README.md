# Sanctum — Private RAG System

Privacy-first Retrieval-Augmented Generation system for curated knowledge bases.

> ⚠️ **Note (Jan 2026):** The Neo4j graph database has been **temporarily disabled** to simplify deployment and reduce resource requirements. The current release uses Qdrant vector search only. Graph-based retrieval (Neo4j + Graphiti) is planned for re-integration in a future release to enable richer entity relationships and multi-hop reasoning.

## Quick Start

### Prerequisites

- Docker & Docker Compose
- ~4GB disk space (for embedding model cache)

### Start the Stack

```bash
# Start all services
docker compose up --build

# Or run in detached mode
docker compose up --build -d
```

First startup will:
1. Pull Qdrant image
2. Build the FastAPI backend
3. Download the embedding model (~500MB)
4. Initialize vector store

### Verify Setup

Once running, test the smoke test endpoint:

```bash
curl http://localhost:8000/test
```

Expected response:
```json
{
  "status": "healthy",
  "qdrant": "ok",
  "maple": "ok"
}
```

### Available Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | API info |
| `GET /health` | Service health check |
| `GET /test` | Smoke test (Qdrant + Maple verification) |

### Service URLs

| Service | URL |
|---------|-----|
| Vite Frontend | http://localhost:5173 |
| FastAPI Backend | http://localhost:8000 |
| Qdrant Dashboard | http://localhost:6333/dashboard |

### Stop the Stack

```bash
docker compose down

# To also remove volumes (clears all data)
docker compose down -v
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│   Backend   │────▶│   Qdrant    │
│   (Vite)    │     │  (FastAPI)  │     │  (Vectors)  │
└─────────────┘     └──────┬──────┘     └─────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │ Maple Proxy │
                   │    (LLM)    │
                   └─────────────┘
```

> *Future releases will re-add Neo4j for graph-based retrieval and multi-hop reasoning.*

## Embedding Model

Uses `intfloat/multilingual-e5-base`:
- 768-dimensional embeddings
- Multilingual support (including Spanish)
- CPU-friendly operation
- ~500MB model size

## Development

### View Logs

```bash
docker compose logs -f backend
docker compose logs -f qdrant
```

### Rebuild Backend

```bash
docker compose up --build backend
```

### Access Qdrant Dashboard

1. Go to http://localhost:6333/dashboard
2. Browse collections and vectors
