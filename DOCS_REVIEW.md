# Documentation Review - Findings & Updates Needed

**Branch**: `docs/review-and-update`  
**Date**: 2026-01-30  
**Reviewer**: plebdevbot

## Summary

Several documentation files reference the planned architecture (Neo4j + Graphiti) rather than the current implementation (SQLite + Qdrant). This review identifies discrepancies and proposes updates.

---

## Current Stack (Actual Implementation)

Based on `docker-compose.yml` and running deployment:

| Service | Description | Port |
|---------|-------------|------|
| **maple-proxy** | LLM proxy (OpenAI-compatible) | 8080 |
| **qdrant** | Vector database | 6333-6334 |
| **searxng** | Web search engine | 8080 (internal) |
| **backend** | FastAPI + SQLite | 8000 |
| **frontend** | Vite/React app | 5173 |

**Storage**:
- SQLite database (`/data/sanctum.db`) for users, documents, settings
- Qdrant for vector embeddings
- Local embedding model: `intfloat/multilingual-e5-base` (768-dim)

**Authentication**: Nostr (admin) + Email magic links (users)

---

## Files Requiring Updates

### 1. `README.md` ⚠️ **HIGH PRIORITY**

**Issues**:
- ❌ References Neo4j extensively (browser, credentials, queries)
- ❌ Smoke test endpoint `/test` shows Neo4j data structures
- ❌ Architecture diagram shows Neo4j instead of SQLite
- ❌ Missing SearXNG service
- ❌ Service URLs table includes Neo4j Browser

**Needs**:
- ✅ Update architecture diagram: SQLite + Qdrant
- ✅ Update service URLs (remove Neo4j, add SearXNG info)
- ✅ Update smoke test example to match current `/health` endpoint
- ✅ Add Nostr auth mention for admin setup
- ✅ Update embedding model section (already correct)

---

### 2. `HighLevel.md` ⚠️ **MEDIUM PRIORITY**

**Issues**:
- ❌ Describes Neo4j + Graphiti as primary architecture
- ❌ "Status: Architecture finalized. Implementation in progress."
- ❌ No mention of SearXNG
- ❌ Graph-first RAG pipeline described, but implementation uses SQLite

**Options**:
1. **Mark as "Planned Architecture"** and add note that current implementation uses SQLite
2. **Create separate `ARCHITECTURE_CURRENT.md`** documenting actual implementation
3. **Update inline** to reflect current state

**Recommendation**: Option 2 - preserve vision doc, add current state doc

---

### 3. `docs/authentication.md`

**Status**: Need to review (likely references Nostr correctly)

---

### 4. `docs/sqlite-*.md` Files

**Status**: Likely accurate - need to verify they match current schema

---

### 5. `docs/upload-documents.md`

**Status**: Need to verify API endpoints match current implementation

---

### 6. `docs/tools.md`

**Status**: Check if SearXNG integration is documented

---

## Proposed Changes

### Phase 1: Critical Fixes (README.md)
1. Update architecture diagram
2. Fix service URLs table
3. Update quick start examples
4. Remove Neo4j references

### Phase 2: Architecture Documentation
1. Rename `HighLevel.md` → `ARCHITECTURE_PLANNED.md`
2. Create `ARCHITECTURE_CURRENT.md` documenting actual implementation
3. Update top-level docs to reference both

### Phase 3: Detailed Docs Review
1. Review and update `docs/authentication.md`
2. Verify SQLite docs match schema
3. Update `docs/tools.md` with SearXNG
4. Check integration tests docs

---

## Questions for Maintainer

1. Is Neo4j + Graphiti still the long-term goal? (If yes, keep HighLevel.md as-is and just add notes)
2. Should we maintain both "current" and "planned" architecture docs?
3. Are there any other undocumented services or features?

---

## Next Steps

- [ ] Update README.md with accurate architecture
- [ ] Create ARCHITECTURE_CURRENT.md
- [ ] Review all docs/* files
- [ ] Test all documented commands
- [ ] Submit PR to upstream
