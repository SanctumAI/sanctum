# Sanctum — Private RAG System

Privacy-first Retrieval-Augmented Generation system for curated knowledge bases.

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
1. Pull Neo4j and Qdrant images
2. Build the FastAPI backend
3. Download the embedding model (~500MB)
4. Seed test data into both stores

### Verify Setup

Once running, test the smoke test endpoint:

```bash
curl http://localhost:8000/test
```

Expected response:
```json
{
  "neo4j": {
    "status": "ok",
    "claim": {
      "id": "claim_udhr_1948",
      "text": "La Declaración Universal de Derechos Humanos fue adoptada en 1948.",
      "language": "es"
    },
    "source": {
      "id": "source_un_udhr",
      "title": "United Nations - Universal Declaration of Human Rights"
    }
  },
  "qdrant": {
    "status": "ok",
    "vector_id": "6437e612-5e33-5e2e-99ee-b40fa6a6b018",
    "payload": {"claim_id": "claim_udhr_1948", ...},
    "vector_dimension": 768
  },
  "message": "Smoke test passed! ✓",
  "success": true
}
```

### Available Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | API info |
| `GET /health` | Service health check |
| `GET /test` | Smoke test (Neo4j + Qdrant verification) |

### Service URLs

| Service | URL |
|---------|-----|
| FastAPI Backend | http://localhost:8000 |
| Neo4j Browser | http://localhost:7474 |
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
│   Frontend  │────▶│   Backend   │────▶│   Neo4j     │
│   (Vite)    │     │  (FastAPI)  │     │   (Graph)   │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Qdrant    │
                    │  (Vectors)  │
                    └─────────────┘
```

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
docker compose logs -f neo4j
docker compose logs -f qdrant
```

### Rebuild Backend

```bash
docker compose up --build backend
```

### Access Neo4j Browser

1. Go to http://localhost:7474
2. Connect with: `neo4j` / `sanctum_dev_password`
3. Query: `MATCH (n) RETURN n`
