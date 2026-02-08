# Security and Data Protection Checklist

Last updated: 2026-02-07
Scope: Sanctum current repository state (code/config review)

## Purpose

Use this checklist to:
- Track what security and data protection controls are currently implemented.
- Identify production blockers and remediation priorities.
- Validate protections from both the user and admin perspective.

---

## 1. Current Security Posture Snapshot

### 1.1 Confirmed protections currently present

- [x] Passwordless auth is implemented for users (magic link + signed session token).
  Evidence: `backend/app/auth.py`, `backend/app/main.py`
- [x] Admin auth uses signed Nostr events with event kind, tag, timestamp, and Schnorr signature checks.
  Evidence: `backend/app/main.py`, `backend/app/nostr.py`
- [x] Single-admin constraint is enforced.
  Evidence: `backend/app/main.py`, `backend/app/database.py`
- [x] Core chat/query routes require admin or approved user auth.
  Evidence: `backend/app/main.py`, `backend/app/query.py`, `backend/app/auth.py`
- [x] User PII fields (email/name and encrypted custom fields) are encrypted at rest in SQLite.
  Evidence: `backend/app/database.py`, `backend/app/encryption.py`
- [x] Email blind index exists for encrypted email lookup.
  Evidence: `backend/app/database.py`, `backend/app/encryption.py`
- [x] Deployment config secrets are masked in standard API reads.
  Evidence: `backend/app/database.py`, `backend/app/deployment_config.py`
- [x] Admin key migration includes signed authorization checks and transactional migration.
  Evidence: `backend/app/key_migration.py`

### 1.2 Major gaps currently present

- [ ] Several ingest endpoints are unauthenticated, including destructive and data-exposing routes.
  Evidence: `backend/app/ingest.py`
- [ ] `/vector-search` is unauthenticated and can expose payload text from Qdrant.
  Evidence: `backend/app/main.py`, `backend/app/store.py`
- [ ] Query sessions are in-memory and not scoped to owner on get/delete endpoints.
  Evidence: `backend/app/query.py`
- [ ] Auth/session tokens are stored in `localStorage` (admin and user).
  Evidence: `frontend/src/types/onboarding.ts`, `frontend/src/utils/adminApi.ts`
- [ ] Some auth flows use query-string tokens (`/auth/verify`, `/auth/me`), increasing token leak risk.
  Evidence: `backend/app/main.py`, `frontend/src/pages/VerifyMagicLink.tsx`
- [ ] CORS is currently wildcard (`*`) in backend.
  Evidence: `backend/app/main.py`
- [ ] Uploaded files and chunk payload text are plaintext at rest.
  Evidence: `backend/app/ingest.py`, `backend/app/store.py`
- [ ] Deployment secrets are stored plaintext in SQLite (masked at API layer only).
  Evidence: `backend/app/database.py`

---

## 2. User Perspective Checklist

### 2.1 Authentication and account access

- [x] Magic link token is signed and time-limited.
- [x] User session token is signed and time-limited.
- [x] Chat/query access requires authenticated and approved users.
- [ ] Add anti-enumeration response behavior for auth endpoints.
- [ ] Add abuse-resistant rate limiting that works across multiple backend instances for:
  - Auth endpoints
  - File upload endpoints
  - Vector search operations
  - Query/chat operations

### 2.2 Data confidentiality and privacy

- [x] User PII fields are encrypted before DB write after admin initialization.
- [x] User document access in `/query` is filtered by allowed `job_id`s for user type.
- [ ] Eliminate unauthenticated ingest/chunk/vector endpoints that bypass user document controls.
- [ ] Prevent session data leakage across users (session ownership checks).
- [ ] Move user auth tokens from `localStorage` to secure, httpOnly cookies.
- [ ] Stop passing user session tokens in query strings.

### 2.3 Web application security

- [ ] Implement CSRF tokens for state-changing operations.
- [ ] Sanitize/escape user input to prevent XSS (reflected, stored, DOM-based).
- [ ] Implement Content Security Policy (CSP) headers.
- [ ] Add X-Frame-Options and X-Content-Type-Options headers.

### 2.4 User safety and transparency

- [x] Explicitly tracks approved vs pending user access states.
- [ ] Add user-visible privacy notice clarifying what data may leave local infra when external providers are enabled (embeddings/LLM mode).
- [ ] Add user-facing data retention and deletion policy UI text.

---

## 3. Admin Perspective Checklist

### 3.1 Admin auth and governance

- [x] Nostr event verification includes signature + freshness checks.
- [x] Single-admin ownership model enforced.
- [x] Admin session token exists and is validated server-side.
- [ ] Move admin token storage from `localStorage` to secure cookie/session mechanism.
- [ ] Add explicit admin session revocation/logout invalidation strategy.

### 3.2 Admin data access and key management

- [x] Admin can decrypt encrypted user fields client-side with NIP-07.
- [x] Key migration flow validates signature and prevents partial migration.
- [ ] Add formal backup and recovery runbook for admin private key loss.
- [ ] Add key migration drills and recovery tests.

### 3.3 Deployment and secret handling

- [x] Secrets are masked in normal config reads.
- [x] Secret reveal/export endpoints are admin-only.
- [ ] Encrypt secrets at rest in `deployment_config` (not just masked in API output).
- [ ] Restrict/monitor `.env` export usage and treat as high-risk operation.
- [ ] Add immutable audit controls for privileged config changes.

---

## 4. Critical Production Blockers (Must Fix Before Internet Exposure)

- [ ] Protect ingest endpoints with auth:
  - `/ingest/wipe`
  - `/ingest/upload`
  - `/ingest/status/{job_id}`
  - `/ingest/pending`
  - `/ingest/chunk/{chunk_id}`
  - `/ingest/pipeline-stats`
- [ ] Restrict `/vector-search` (admin-only or remove payload text and enforce doc scoping).
- [ ] Enforce session ownership checks for:
  - `GET /query/session/{session_id}`
  - `DELETE /query/session/{session_id}`
- [ ] Replace wildcard CORS with deployment-configured allowlist.
- [ ] Move bearer tokens out of `localStorage`.
- [ ] Remove query-param token usage for active auth/session APIs.
- [ ] Lock down published service ports to least privilege.

---

## 5. Data Protection Model Checklist

### 5.1 Data classification and input validation

- [ ] Maintain explicit classification for:
  - PII fields (email/name/user fields)
  - Uploaded documents
  - Derived chunks/embeddings
  - Secrets and credentials
- [ ] Verify all database queries use parameterized/prepared statements (no string concatenation).
- [ ] Implement input validation for all user-supplied data (length, type, format).

### 5.2 At-rest controls

- [x] PII fields in `users`/`user_field_values` are encrypted.
- [ ] Uploaded files in `uploads/` encrypted at rest.
- [ ] Qdrant payload text minimized or encrypted.
- [ ] Deployment secrets encrypted at rest in SQLite.

### 5.3 In-transit controls

- [ ] Enforce TLS end-to-end for frontend/backend in production.
- [ ] Ensure external provider calls use HTTPS and pinned trusted endpoints where feasible.
- [ ] Ensure reverse proxy enforces HTTPS, HSTS, and secure headers.

### 5.4 Retention and deletion

- [x] Admin can delete ingest jobs and associated vectors.
- [ ] Define retention schedule for uploads/chunks/sessions/logs.
- [ ] Add secure erase process where applicable.
- [ ] Document full user-data deletion path (including vector and file artifacts).

---

## 6. Configuration and Environment Hardening Checklist

- [ ] Set production env indicator (`SANCTUM_ENV=production` or equivalent).
- [ ] Ensure `MOCK_EMAIL=false` in production.
- [ ] Ensure simulation flags are disabled:
  - `SIMULATE_USER_AUTH=false`
  - `SIMULATE_ADMIN_AUTH=false`
- [ ] Set strong, stable `SECRET_KEY` via secret manager.
- [ ] Restrict backend and infra ports to private networks/VPN where possible.
- [ ] Remove dev-only reload mode in production runtime.
- [ ] Use non-root containers and hardened container runtime settings.

---

## 7. Monitoring, Testing, and Verification Checklist

- [ ] Add automated security tests for auth on all endpoints.
- [ ] Add regression tests specifically for:
  - ingest endpoint authorization
  - vector-search authorization/scope
  - query session ownership
- [ ] Add SAST/dependency scanning in CI.
- [ ] Add runtime alerting for:
  - repeated auth failures
  - unusual admin actions
  - destructive endpoint usage
- [ ] Add periodic backup + restore test for SQLite and config.

---

## 8. Sign-off Criteria

Mark release as security-ready only when all are true:

- [ ] All critical production blockers in Section 4 are complete.
- [ ] Token handling is migrated away from `localStorage`.
- [ ] CORS and network exposure are least-privilege.
- [ ] Simulation and mock auth modes are verified off in production.
- [ ] Security regression tests pass in CI.
- [ ] Incident response and key recovery runbooks are documented and tested.

---

## 9. Notes

- This checklist reflects a repository review, not a full external penetration test.
- Re-run this checklist after major auth, ingest, or deployment config changes.
