# Post-Hackathon TODOs

## Ingestion Pipeline
- [ ] **Persist sessions** - Move `_sessions` dict in `query.py` to SQLite/Redis (lost on restart)
- [ ] **Entity normalization** - Fuzzy matching for entity names in `store.py` (currently exact case-insensitive only; "lawyer" vs "legal counsel" = duplicates)
- [ ] **Ontology validation** - Validate LLM extraction output against ontology schema before storing (reject invalid entity/relationship types)
- [ ] **Ontology bypass mode** - Add `USE_ONTOLOGY=false` flag to skip structured extraction and just embed raw chunks
- [ ] **Local ingestion** - Test ingestion flow running outside Docker

## Model / LLM
- [ ] **Kimi K2 thinking** - Evaluate Kimi K2 for extraction quality vs current providers
- [ ] **RAG benchmark** - Build eval suite: ingest test doc → run queries → score retrieval accuracy

## Auth & Security
- [ ] **Email auth** - Add email/password or magic link auth for production (currently Nostr-only)
- [ ] **NIP-04 encryption** - Encrypt user data at rest in SQLite using admin's Nostr key

## Frontend
- [ ] **Copy polish** - Review and tighten UI text
- [ ] **i18n completeness** - Audit all strings covered by language config
- [ ] **Configurability** - Expose more settings (theme, language) in UI
- [ ] **Style improvements** - Visual polish pass

## DevOps
- [ ] **Deployment wizard** - Guided setup for self-hosting (env vars, secrets, domain config)

## chores
- [ ] TOS
