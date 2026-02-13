# Sanctum — Current Architecture (v0.1 MVP)

This document describes the **current** implementation of Sanctum. For the planned graph-first architecture using Neo4j + Graphiti, see [ARCHITECTURE_PLANNED.md](./ARCHITECTURE_PLANNED.md).

---

## Stack Overview

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Backend** | FastAPI (Python 3.11) | API orchestration, ingest pipeline, RAG queries |
| **Frontend** | Vite + React + TypeScript | Admin dashboard, user chat interface |
| **Database** | SQLite | Users, documents, settings, jobs, sessions |
| **Vector Store** | Qdrant | Semantic search embeddings (768-dim) |
| **Web Search** | SearXNG | Privacy-preserving metasearch for web tool |
| **LLM Proxy** | maple-proxy | OpenAI-compatible LLM gateway |
| **Deployment** | Docker Compose | Container orchestration |

---

## Service Architecture

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

### Service Ports

| Service | Port | URL |
|---------|------|-----|
| Frontend (Vite) | 5173 | http://localhost:5173 |
| Backend (FastAPI) | 8000 | http://localhost:8000 |
| Qdrant Dashboard | 6333 | http://localhost:6333/dashboard |
| Qdrant gRPC | 6334 | - |
| maple-proxy | 8080 | http://localhost:8080 |
| SearXNG | 8080 (internal) | - |

---

## Data Storage

### SQLite (`/data/sanctum.db`)

All structured data is stored in SQLite:

- **Users**: Nostr pubkeys (admin), email users, sessions
- **Documents**: Uploaded files metadata, ingest jobs (including `ontology_id` — taxonomy for categorizing documents; valid values: `general`, `bitcoin`; see `/ingest/ontologies`)
- **Settings**: Instance configuration (branding, SMTP, LLM settings)
- **Custom Fields**: Admin-defined user profile fields

Volume: `sqlite_data:/data`

### Qdrant

Vector embeddings for semantic search:

- **Collection**: `sanctum_knowledge`
- **Dimensions**: 768 (multilingual-e5-base)
- **Payload**: Document metadata, chunk references

Volume: `qdrant_data:/qdrant/storage`

### File Storage

- **Uploads**: `./uploads` (bind mount)
- **Model Cache**: `embedding_cache:/root/.cache/huggingface`

---

## Authentication

### Admin Authentication (Nostr NIP-07)

1. Admin clicks "Login with Nostr"
2. Browser extension signs challenge
3. Backend verifies the signed event (kind `22242`) and registers the **first** admin
4. Signed session token issued (single-admin instance)

### User Authentication (Email Magic Link)

1. User enters email address
2. Backend sends magic link via SMTP
3. User clicks link, verifies token
4. Signed session token issued

> User onboarding is blocked until an admin has authenticated at least once (instance setup complete).

See [docs/authentication.md](./docs/authentication.md) for details.

---

## RAG Pipeline

### Ingest Flow

```
Document Upload → Text Extraction → Chunking → Embedding → Qdrant Storage
                                       │
                                       └──→ SQLite (job metadata)
```

1. Document uploaded via `/ingest/upload`
2. Text extracted (PyMuPDF via `PDF_EXTRACT_MODE=fast` default; Docling via `PDF_EXTRACT_MODE=quality`)
3. Text split into chunks (~1500 chars with overlap)
4. Chunks embedded using `intfloat/multilingual-e5-base`
5. Vectors stored in Qdrant with metadata
6. Job status tracked in SQLite

### Query Flow

```
User Query → Embed → Qdrant Search → Top-K Results → LLM Context → Response
```

1. User submits question via chat
2. Query embedded using same model
3. Qdrant returns semantically similar chunks
4. Chunks assembled into context
5. LLM generates response with sources (returned as `sources` in the `/query` response)
6. Response returned to user

---

## Embedding Model

- **Model**: `intfloat/multilingual-e5-base`
- **Dimensions**: 768
- **Prefix Convention**: "passage: " for documents, "query: " for search
- **Languages**: 100+ (including Spanish, optimized for multilingual use)
- **Size**: ~500MB (cached in Docker volume)

---

## LLM Integration

### maple-proxy (Default)

- OpenAI-compatible API at `/v1/chat/completions`
- Supports structured outputs
- Privacy-preserving proxy layer

### Ollama (Optional)

- Local inference alternative
- Configure via `LLM_PROVIDER=ollama` environment variable

---

## Tools

The RAG system supports tool use for enhanced responses:

| Tool | Description | Access |
|------|-------------|--------|
| `web-search` | SearXNG metasearch | All users |
| `db-query` | Direct database queries | Admin only |

See [docs/tools.md](./docs/tools.md) for details.

---

## Key API Endpoints

### Health & Testing

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health check (Qdrant status) |
| `/test` | GET | Smoke test (verifies Qdrant seeded data) |
| `/llm/test` | GET | LLM provider connectivity test |

### Public Config

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/instance/status` | GET | Instance setup status for frontend routing |
| `/settings/public` | GET | Public instance branding settings |
| `/config/public` | GET | Simulation flags (`SIMULATE_*`). Note: These flags default to `false` and control frontend UI behavior. They must be disabled in production. |
| `/session-defaults` | GET | Chat session defaults (optional `user_type_id`) |

### Ingest

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ingest/upload` | POST | Upload document for processing |
| `/ingest/ontologies` | GET | List valid ontology IDs |
| `/ingest/jobs` | GET | List ingest jobs (admin or approved user — see [authentication.md](./docs/authentication.md#user-approval-workflow)) |
| `/ingest/status/{job_id}` | GET | Get job status |
| `/ingest/jobs/{job_id}` | DELETE | Delete document + vectors (admin only) |
| `/ingest/stats` | GET | Qdrant collection statistics |
| `/ingest/wipe` | POST | Delete Qdrant collections (dev only) |

### Query

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/query` | POST | RAG query with document context |
| `/vector-search` | POST | Direct vector similarity search |

---

## What's Different from Planned Architecture

The current MVP uses a simpler stack than the planned graph-first architecture:

| Aspect | Current (MVP) | Planned |
|--------|--------------|---------|
| **Structured Data** | SQLite | Neo4j |
| **Knowledge Graph** | None | Graphiti |
| **Entity Extraction** | Manual via ontologies | Automatic via Graphiti |
| **Relationship Modeling** | Flat document references | Graph traversal |
| **Query Expansion** | Vector similarity only | Graph + vector hybrid |

### Why SQLite for MVP?

1. **Simpler deployment**: No additional services to manage
2. **Sufficient for MVP**: Document-level RAG doesn't require graph
3. **Faster iteration**: Schema changes are trivial
4. **Migration path exists**: SQLite data can export to Neo4j

### When to Migrate to Graph

Consider migrating to the planned Neo4j + Graphiti architecture when:

- Complex entity relationships become important
- Query expansion via graph traversal is needed
- Automatic entity extraction is required
- Knowledge base exceeds SQLite performance limits

---

## Docker Compose Services

```yaml
services:
  backend:     # FastAPI + SQLite
  frontend:    # Vite dev server
  qdrant:      # Vector database
  maple-proxy: # LLM gateway
  searxng:     # Web search
```

### Commands

```bash
# Start all services
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml up --build

# View logs
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml logs -f backend

# Reset all data
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml down -v
```

---

## Environment Variables

**Configuration Precedence**: Values in SQLite (set via `/admin/deployment`) take priority over environment variables. This allows runtime configuration changes without container restarts.

To use environment-variable-only mode, leave the SQLite config values empty (they will fall back to env vars). See `docs/admin-deployment-config.md` for override management.

Key configuration options (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `maple` | LLM backend (`maple` or `ollama`) |
| `LLM_API_URL` | (provider-specific) | Base URL for LLM provider. Set this generic variable OR the provider-specific `MAPLE_BASE_URL`/`OLLAMA_BASE_URL` |
| `LLM_MODEL` | (provider-specific) | Model name. Set this generic variable OR the provider-specific `MAPLE_MODEL`/`OLLAMA_MODEL` |
| `MAPLE_API_KEY` | (required) | API key for maple-proxy when `LLM_PROVIDER=maple` |
| `QDRANT_HOST` | `qdrant` | Qdrant hostname |
| `QDRANT_PORT` | `6333` | Qdrant port |
| `EMBEDDING_MODEL` | `intfloat/multilingual-e5-base` | Embedding model name |
| `SEARXNG_URL` | `http://searxng:8080` | SearXNG endpoint |
| `FRONTEND_URL` | `http://localhost:5173` | Base URL for magic links |
| `MOCK_EMAIL` | `true` | Log magic links instead of sending (alias: `MOCK_SMTP`) |
| `SMTP_TIMEOUT` | `10` | SMTP connection timeout (seconds) |
| `SIMULATE_USER_AUTH` | `false` | ⚠️ **NEVER enable in production** — Bypasses magic link verification |
| `SIMULATE_ADMIN_AUTH` | `false` | ⚠️ **NEVER enable in production** — Shows mock Nostr auth option |
| `PDF_EXTRACT_MODE` | `fast` | PDF extraction mode (`fast` for PyMuPDF, `quality` for Docling) |
| `BASE_DOMAIN` | `localhost` | Root domain name |
| `INSTANCE_URL` | `http://localhost:5173` | Full app URL with protocol |
| `API_BASE_URL` | `http://localhost:8000` | API base URL |
| `ADMIN_BASE_URL` | `http://localhost:5173/admin` | Admin panel URL |
| `EMAIL_DOMAIN` | `localhost` | Domain for email addresses |
| `DKIM_SELECTOR` | `sanctum` | DKIM DNS selector |
| `SPF_INCLUDE` | (empty) | SPF include directive (e.g., include:_spf.google.com) |
| `DMARC_POLICY` | `v=DMARC1; p=none` | DMARC DNS policy record |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed CORS origins |
| `WEBHOOK_BASE_URL` | `http://localhost:8000` | Webhook callback base URL |
| `FORCE_HTTPS` | `false` | Redirect HTTP to HTTPS |
| `HSTS_MAX_AGE` | `31536000` | HSTS max-age in seconds |
| `MONITORING_URL` | `http://localhost:8000/health` | Health monitoring endpoint |
| `SSL_CERT_PATH` | (empty) | SSL certificate file path |
| `SSL_KEY_PATH` | (empty) | SSL private key file path |
| `TRUSTED_PROXIES` | (empty) | Trusted reverse proxies |

### Production Checklist

Before deploying to production, ensure these variables are configured:

| Variable | Requirement | Notes |
|----------|-------------|-------|
| `CORS_ORIGINS` | **Required** | Replace localhost with production domain(s) |
| `FORCE_HTTPS` | **Required** | Set to `true` |
| `MOCK_EMAIL` | **Required** | Set to `false` and configure SMTP |
| `SIMULATE_USER_AUTH` | **Required** | Must be `false` or unset |
| `SIMULATE_ADMIN_AUTH` | **Required** | Must be `false` or unset |
| `DMARC_POLICY` | Recommended | Use `p=quarantine` or `p=reject` |
| `TRUSTED_PROXIES` | Required if behind proxy | Configure to prevent IP spoofing |
| `SSL_CERT_PATH` / `SSL_KEY_PATH` | If terminating TLS | Provide paths to certificates |

---

## Related Documentation

- [ARCHITECTURE_PLANNED.md](./ARCHITECTURE_PLANNED.md) — Future graph-first architecture
- [docs/authentication.md](./docs/authentication.md) — Auth flows
- [docs/tools.md](./docs/tools.md) — Tool system documentation
- [docs/upload-documents.md](./docs/upload-documents.md) — Ingest guide
- [docs/admin-deployment-config.md](./docs/admin-deployment-config.md) — Deployment config guide
- [docs/sqlite-rag-docs-tracking.md](./docs/sqlite-rag-docs-tracking.md) — SQLite schema
