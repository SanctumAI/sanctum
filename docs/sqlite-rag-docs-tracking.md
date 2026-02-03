# SQLite RAG Document Tracking

This document describes the SQLite-based persistence layer for tracking ingested documents in Sanctum's RAG pipeline.

---

## Overview

Previously, ingest job state was stored in JSON files (`logs/jobs_state.json`), which were not mounted into the Docker container. This caused job metadata to be lost on container rebuilds, even though the actual vector data persisted in Qdrant.

The solution: store job metadata in SQLite, which is already volume-mounted via `sqlite_data:/data`.

---

## Database Schema

### Table: `ingest_jobs`

Tracks document processing jobs from upload through completion.

```sql
CREATE TABLE IF NOT EXISTS ingest_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT UNIQUE NOT NULL,        -- Hash-based unique identifier
    filename TEXT NOT NULL,              -- Original uploaded filename
    file_path TEXT NOT NULL,             -- Path to saved file in /uploads
    status TEXT NOT NULL DEFAULT 'pending',
    ontology_id TEXT NOT NULL,           -- Extraction ontology used
    sample_percent REAL DEFAULT 100.0,   -- % of chunks processed (for testing)
    total_chunks INTEGER DEFAULT 0,
    processed_chunks INTEGER DEFAULT 0,
    failed_chunks INTEGER DEFAULT 0,
    error TEXT,                          -- Error message if failed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Job Status Values

| Status | Description |
|--------|-------------|
| `pending` | Job created, waiting to start processing |
| `processing` | Document being chunked and text extracted |
| `completed` | All chunks successfully stored to Qdrant |
| `completed_with_errors` | Finished but some chunks failed |
| `failed` | Job failed entirely (see `error` column) |

---

## Module: `backend/app/ingest_db.py`

### CRUD Status

| Operation | Function | Status | Notes |
|-----------|----------|--------|-------|
| **Create** | `create_job()` | ✅ Implemented | Creates new job record |
| **Read** | `get_job(job_id)` | ✅ Implemented | Get single job by ID |
| **Read** | `list_jobs(status, limit)` | ✅ Implemented | List jobs with optional filter |
| **Read** | `list_completed_jobs()` | ✅ Implemented | Jobs ready for RAG queries |
| **Read** | `job_exists(job_id)` | ✅ Implemented | Check if job exists |
| **Update** | `update_job_status()` | ✅ Implemented | Update status and counters |
| **Delete** | `delete_job()` | ✅ Implemented | Removes job row (API handles Qdrant + file cleanup) |
| **Delete** | `purge_old_jobs(days)` | 📋 TODO | Cleanup utility |

### Migration Helper

| Function | Status | Notes |
|----------|--------|-------|
| `migrate_from_json(jobs_dict)` | ✅ Implemented | One-time import from legacy JSON |

---

## How It Works

### On Container Startup

```
1. Check if legacy jobs_state.json exists
2. If SQLite ingest_jobs table is empty → migrate from JSON
3. Load all jobs from SQLite into memory (for fast access during processing)
4. Resume any jobs with status 'pending' or 'processing'
```

### On Document Upload (`POST /ingest/upload`)

```
1. Generate job_id (hash of filename + timestamp)
2. Save file to /uploads/{job_id}_{filename}
3. Create job record in memory AND SQLite
4. Start background processing task
5. Return job_id to client
```

### During Processing

```
1. Update in-memory job status
2. Sync to SQLite every 10 chunks (reduces DB writes)
3. Final sync on completion or failure
```

**Durability vs. Performance Trade-off:** The 10-chunk sync interval is a tunable heuristic balancing write frequency against throughput. If the container crashes mid-job, up to 10 chunks of progress may be lost (the job resumes from the last synced state).

**Mitigations:**
- Reduce the sync interval for critical/large documents (adjust in `ingest.py`)
- Enable [Chunk Persistence](#chunk-persistence-optional) for crash recovery at the individual chunk level
- Consider enabling SQLite WAL mode for better concurrent write performance under heavy ingest loads

### On List Jobs (`GET /ingest/jobs`)

```
1. Read directly from SQLite (not memory)
2. Ensures persisted data is returned even after restart
```

### On Document Delete (`DELETE /ingest/jobs/{job_id}`)

```text
1. Verify job exists (SQLite or in-memory fallback)
2. Reject deletion if status is pending/processing
3. Delete job chunks from Qdrant (fail-fast)
4. Delete uploaded file from /uploads
5. Delete job row from SQLite
6. Clear in-memory job/chunk entries
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ingest/upload` | POST | Upload document, returns job_id |
| `/ingest/jobs` | GET | List jobs (admin or approved user) |
| `/ingest/status/{job_id}` | GET | Get single job status |
| `/ingest/jobs/{job_id}` | DELETE | Delete document + vectors (admin only) |

---

## Data Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Upload PDF    │────▶│  SQLite: Job    │────▶│  Qdrant: Vectors│
│                 │     │  (metadata)     │     │  (embeddings)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

**What's stored where:**

| Store | Data | Survives Rebuild? |
|-------|------|-------------------|
| SQLite (`/data/sanctum.db`) | Job metadata (filename, status, chunk counts) | ✅ Yes (Docker volume) |
| Qdrant (`qdrant_data` volume) | Vector embeddings for RAG search | ✅ Yes (Docker volume) |
| Memory | Active chunk processing state | ❌ No (ephemeral) |

---

## Future Enhancements (TODO)

### Cleanup Utilities

```python
def purge_old_jobs(days: int = 30) -> int:
    """Delete jobs older than specified days. Returns count deleted."""
    pass
```

### Chunk Persistence (Optional)

For resumable ingestion after crashes, we could add:

```sql
CREATE TABLE IF NOT EXISTS ingest_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_id TEXT UNIQUE NOT NULL,
    job_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    source_file TEXT NOT NULL,
    char_count INTEGER DEFAULT 0,
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES ingest_jobs(job_id) ON DELETE CASCADE
);
```

This would allow resuming from the exact chunk that failed, rather than reprocessing the entire document.

---

## Related Files

- `backend/app/ingest_db.py` — SQLite CRUD operations
- `backend/app/ingest.py` — Ingest router (uses ingest_db)
- `backend/app/database.py` — Schema initialization (calls `init_ingest_schema`)
- `frontend/src/pages/ChatPage.tsx` — Fetches `/ingest/jobs` for document selector
