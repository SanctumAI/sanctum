# Sanctum — Private RAG System

Privacy-first Retrieval-Augmented Generation system for curated knowledge bases.

## Quick Start

### Prerequisites

- Docker & Docker Compose
- ~4GB disk space (for embedding model cache)

### Configure Environment (Recommended)

```bash
cp .env.example .env
# Set MAPLE_API_KEY in .env (required for LLM features)
# For production email auth, set MOCK_EMAIL=false and configure SMTP_* + FRONTEND_URL
# You can also manage LLM/SMTP/domain settings later in the admin UI at /admin/deployment
```

### Start the Stack

Docker Compose is split into two files:
- **`docker-compose.infra.yml`** — Infrastructure services (Qdrant, maple-proxy, SearXNG)
- **`docker-compose.app.yml`** — Application services (backend, frontend)

This separation lets you keep infrastructure running while rebuilding just the app, avoiding database restarts when only code changes.

```bash
# First time or full restart: start everything
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml up --build -d

# Rebuild only app (keeps infra services running: qdrant, maple-proxy, searxng)
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml up --build -d backend frontend
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

After the first admin login, additional configuration is available in the admin UI:
- `/admin/instance` - branding and instance settings
- `/admin/users` - user types and onboarding fields
- `/admin/ai` - prompt and LLM parameters
- `/admin/deployment` - deployment config (LLM, SMTP, domains, SSL)

See `docs/admin-deployment-config.md` for deployment config details.

### Available Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | API info |
| `GET /health` | Service health check |
| `GET /test` | Smoke test (Qdrant + health check) |
| `GET /llm/test` | LLM provider connectivity test |

### Service URLs

| Service | URL |
|---------|-----|
| Vite Frontend | http://localhost:5173 |
| FastAPI Backend | http://localhost:8000 |
| Qdrant Dashboard | http://localhost:6333/dashboard |
| maple-proxy (LLM) | http://localhost:8080 |

### Stop the Stack

```bash
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml down

# To also remove volumes (clears all data)
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml down -v
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
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml logs -f backend
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml logs -f qdrant
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml logs -f maple-proxy
```

### Rebuild Backend

```bash
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml up --build backend
```
