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
1. Pull Qdrant and other service images
2. Build the FastAPI backend
3. Download the embedding model (~500MB)
4. Initialize SQLite database

### Verify Setup

Once running, test the smoke test endpoint:

```bash
curl http://localhost:8000/test
```

Expected response:
```json
{
  "qdrant": {
    "status": "ok",
    "vector_id": "6437e612-5e33-5e2e-99ee-b40fa6a6b018",
    "payload": {
      "claim_id": "claim_udhr_1948",
      "text": "La Declaración Universal de Derechos Humanos fue adoptada en 1948.",
      "language": "es"
    },
    "vector_dimension": 768
  },
  "message": "Smoke test passed!",
  "success": true
}
```

### Admin Setup (First Run)

Sanctum requires a NIP-07 admin login before user signups are enabled. Open the frontend at `http://localhost:5173` and complete the admin login flow. Until the first admin authenticates, `/auth/magic-link` returns `503` ("Instance not configured").

### Available Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | API info |
| `GET /health` | Service health check |
| `GET /test` | Smoke test (Qdrant + health check) |

### Service URLs

| Service | URL |
|---------|-----|
| Vite Frontend | http://localhost:5173 |
| FastAPI Backend | http://localhost:8000 |
| Qdrant Dashboard | http://localhost:6333/dashboard |
| maple-proxy (LLM) | http://localhost:8080 |

### Stop the Stack

```bash
docker compose down

# To also remove volumes (clears all data)
docker compose down -v
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│   Backend   │────▶│   SQLite    │
│   (Vite)    │     │  (FastAPI)  │     │   (Data)    │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                ┌──────────┼──────────┐
                ▼          ▼          ▼
         ┌──────────┐ ┌────────┐ ┌────────┐
         │  Qdrant  │ │ maple  │ │SearXNG │
         │(Vectors) │ │ proxy  │ │(Search)│
         └──────────┘ └────────┘ └────────┘
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
docker compose logs -f qdrant
docker compose logs -f maple-proxy
```

### Rebuild Backend

```bash
docker compose up --build backend
```
