# Security and Data Protection Checklist

Last updated: 2026-02-08
Scope: Sanctum current repository state (code/config review)

## Purpose

Use this checklist to:
- Track what security and data protection controls are currently implemented.
- Identify production blockers and remediation priorities.
- Validate protections from both the user and admin perspective.

## How to use this document

1. Treat Section 4 as release-blocking work for any internet-exposed deployment.
2. Create one ticket/PR per unchecked blocker; link it in the tracker below.
3. Attach objective evidence in each PR (test output, curl checks, screenshots, config diff).
4. Re-run Section 8 sign-off criteria before deployment.
5. Update `Last updated` and this document in the same PR as security changes.

### Status legend

- `todo`: not started
- `in_progress`: being implemented
- `blocked`: waiting on decision/dependency
- `done`: merged and verified

---

## 0. Critical Remediation Tracker (Current Sprint)

| ID | Blocker | Priority | Owner | Status | Tracking |
|---|---|---|---|---|---|
| S4-1 | Protect ingest endpoints with auth | P0 | - | done | `backend/app/ingest.py` (Section 11 evidence) |
| S4-2 | Restrict `/vector-search` and remove unsafe payload exposure | P0 | - | done | `backend/app/main.py` (Section 11 evidence) |
| S4-3 | Enforce query session ownership checks | P0 | - | done | `backend/app/query.py` (Section 11 evidence) |
| S4-4 | Replace wildcard CORS with explicit allowlist | P0 | - | done | `backend/app/main.py` (Section 11 evidence) |
| S4-5 | Move bearer tokens out of `localStorage` | P0 | - | done | `frontend/src/utils/adminApi.ts`, `frontend/src/pages/VerifyMagicLink.tsx` (Section 11 evidence) |
| S4-6 | Remove query-param token usage | P0 | - | done | `backend/app/main.py`, `frontend/src/pages/VerifyMagicLink.tsx` (Section 11 evidence) |
| S4-7 | Lock down published service ports | P0 | - | done | `docker-compose.app.yml`, `docker-compose.infra.yml` (Section 11 evidence) |

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
- [x] Baseline security headers and API CSP are applied at middleware level.
  Evidence: `backend/app/main.py`
- [x] Cookie-authenticated unsafe requests enforce CSRF origin + token checks.
  Evidence: `backend/app/main.py`, `frontend/src/utils/secureFetch.ts`

### 1.2 Previously identified gaps (status)

- [x] Ingest endpoints are auth-protected (admin or approved-user scoped by route).
  Evidence: `backend/app/ingest.py`, `backend/app/auth.py`
- [x] `/vector-search` is restricted to admin authentication.
  Evidence: `backend/app/main.py`, `backend/app/auth.py`
- [x] Query sessions are owner-scoped and enforce access checks on create/reuse/read/delete.
  Evidence: `backend/app/query.py`
- [x] Primary auth/session token usage moved to secure cookie flows (no active token-in-localStorage requirement).
  Evidence: `frontend/src/utils/adminApi.ts`, `frontend/src/pages/VerifyMagicLink.tsx`, `frontend/src/pages/ChatPage.tsx`
- [x] Active auth flows no longer use query-string tokens for verification/session checks.
  Evidence: `backend/app/main.py`, `frontend/src/pages/VerifyMagicLink.tsx`, `frontend/src/pages/TestDashboard.tsx`
- [x] CORS now uses explicit allowlist origins compatible with credentialed cookies.
  Evidence: `backend/app/main.py`
- [ ] Uploaded files and chunk payload text are plaintext at rest.
  Evidence: `backend/app/ingest.py`, `backend/app/store.py`
- [x] Deployment secrets are now encrypted at rest in SQLite.
  Evidence: `backend/app/database.py` (Section 3.3, Section 5.2)

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
- [x] Eliminate unauthenticated ingest/chunk/vector endpoints that bypass user document controls.
- [x] Prevent session data leakage across users (session ownership checks).
- [x] Move user auth tokens from `localStorage` to secure, httpOnly cookies.
- [x] Stop passing user session tokens in query strings.

### 2.3 Web application security

- [x] Implement CSRF tokens for state-changing operations.
- [ ] Sanitize/escape user input to prevent XSS (reflected, stored, DOM-based).
- [x] Implement Content Security Policy (CSP) headers.
- [x] Add X-Frame-Options and X-Content-Type-Options headers.

### 2.4 User safety and transparency

- [x] Explicitly tracks approved vs pending user access states.
- [x] Add user-visible privacy notice clarifying what data may leave local infra when external providers are enabled (embeddings/LLM mode).
  Evidence: `frontend/src/pages/UserAuth.tsx`, `frontend/src/pages/UserOnboarding.tsx`, `TERMS_OF_SERVICE.md`
- [x] Add user-facing data retention and deletion policy UI text.
  Evidence: `frontend/src/pages/UserAuth.tsx`, `frontend/src/i18n/locales/en.json`

---

## 3. Admin Perspective Checklist

### 3.1 Admin auth and governance

- [x] Nostr event verification includes signature + freshness checks.
- [x] Single-admin ownership model enforced.
- [x] Admin session token exists and is validated server-side.
- [x] Move admin token storage from `localStorage` to secure cookie/session mechanism.
- [x] Add explicit admin session revocation/logout invalidation strategy.
  Evidence: `backend/app/database.py`, `backend/app/auth.py`, `backend/app/main.py`

### 3.2 Admin data access and key management

- [x] Admin can decrypt encrypted user fields client-side with NIP-07.
- [x] Key migration flow validates signature and prevents partial migration.
- [x] Add formal backup and recovery runbook for admin private key loss.
- [x] Add key migration drills and recovery tests.

### 3.3 Deployment and secret handling

- [x] Secrets are masked in normal config reads.
- [x] Secret reveal/export endpoints are admin-only.
- [x] Encrypt secrets at rest in `deployment_config` (not just masked in API output).
- [x] Restrict/monitor `.env` export usage and treat as high-risk operation.
- [x] Add immutable audit controls for privileged config changes.

---

## 4. Critical Production Blockers (Must Fix Before Internet Exposure)

- [x] Protect ingest endpoints with auth:
  - `/ingest/wipe`
  - `/ingest/upload`
  - `/ingest/status/{job_id}`
  - `/ingest/pending`
  - `/ingest/chunk/{chunk_id}`
  - `/ingest/pipeline-stats`
- [x] Restrict `/vector-search` (admin-only or remove payload text and enforce doc scoping).
- [x] Enforce session ownership checks for:
  - `GET /query/session/{session_id}`
  - `DELETE /query/session/{session_id}`
- [x] Replace wildcard CORS with deployment-configured allowlist.
- [x] Move bearer tokens out of `localStorage`.
- [x] Remove query-param token usage for active auth/session APIs.
- [x] Lock down published service ports to least privilege.

### 4.1 Post-implementation validation criteria (pending before Section 8 sign-off)

- [x] Auth-protected endpoint returns `401/403` without valid auth and succeeds with valid auth.
- [x] Access control behavior is covered by automated tests (or documented temporary manual test).
- [x] Frontend behavior remains functional after auth/token changes.
- [x] No wildcard network exposure remains in Docker/infra defaults.
- [x] Evidence is recorded in PR description and linked in Section 0 tracker.

> **Note:** Automated regression tests (`test_3c_auth_hardening_regression.py`, `test_3d_phase3_config_integrity.py`) now cover S4-1 through S4-4 and S4-7; results are recorded in Section 11. S4-5 (localStorage token removal) and S4-6 (query-param token removal) require manual browser verification via DevTools; see Section 11 evidence.

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
- [x] Deployment secrets encrypted at rest in SQLite.

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
- [x] Add regression tests specifically for:
  - ingest endpoint authorization
  - vector-search authorization/scope
  - query session ownership
- [ ] Add SAST/dependency scanning in CI.
- [ ] Add runtime alerting for:
  - repeated auth failures
  - unusual admin actions
  - destructive endpoint usage
- [ ] Add periodic backup + restore test for SQLite and config.

### 7.1 Minimum manual verification commands (interim evidence until Section 4.1 automated tests are implemented)

Run from repo root with stack running:

```bash
# S4-1/S4-2/S4-3: Unauthenticated requests should fail on protected endpoints
curl -i http://localhost:8000/ingest/pending
curl -i -X POST http://localhost:8000/vector-search \
  -H 'Content-Type: application/json' \
  -d '{"query":"test","top_k":1}'
curl -i http://localhost:8000/query/session/test-session-id

# S4-4: CORS should reject disallowed origins
curl -i -X OPTIONS http://localhost:8000/health \
  -H 'Origin: https://evil.example.com' \
  -H 'Access-Control-Request-Method: GET'

# S4-7: Verify only expected ports are published
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml ps --format 'table {{.Name}}\t{{.Ports}}'

# Smoke checks expected to remain available
curl -i http://localhost:8000/test
curl -i http://localhost:8000/llm/test
```

Expected outcome:
- Protected endpoints return `401` or `403` when unauthenticated.
- CORS preflight for disallowed origins does not return `Access-Control-Allow-Origin`.
- Published ports match least-privilege expectations (no `0.0.0.0` binds on internal services).
- Health/smoke endpoints continue to return successful responses.

**Note:** S4-5 (localStorage token removal) and S4-6 (query-param token removal) require browser DevTools inspection — verify that `localStorage` no longer stores session tokens and that auth flows do not pass tokens in URL query strings.

---

## 8. Sign-off Criteria

Mark release as security-ready only when all are true:

- [x] All critical production blockers in Section 4 are complete.
- [x] Token handling is migrated away from `localStorage`.
- [x] CORS and network exposure are least-privilege.
- [ ] Simulation and mock auth modes are verified off in production.
- [ ] Security regression tests pass in CI.
- [ ] Incident response and key recovery runbooks are documented and tested.

---

## 9. Notes

- This checklist reflects a repository review, not a full external penetration test.
- Re-run this checklist after major auth, ingest, or deployment config changes.
- Keep product copy aligned with actual controls; avoid absolute claims like "fully private" or "breach-proof".
- Where admin configuration can weaken privacy (for example disabling encryption or sharing data with external providers), surface this clearly in admin and user UI.

---

## 10. Messaging Guardrails (Docs + UI Copy)

Use these guardrails while security fixes are in progress:

- [x] Avoid absolute language (`private by default`, `only you can view`, `protects against breaches`) unless technically guaranteed in all deployment modes.
  Evidence: `frontend/src/pages/UserOnboarding.tsx`, `frontend/src/i18n/locales/en.json`
- [x] State role boundaries explicitly: instance admins configure retention, encryption behavior, and external-provider usage.
  Evidence: `frontend/src/pages/UserAuth.tsx`, `TERMS_OF_SERVICE.md`
- [x] Add user-facing notice where relevant: data handling is instance-configured and may include external processing if enabled.
  Evidence: `frontend/src/pages/UserAuth.tsx`, `frontend/src/pages/UserOnboarding.tsx`
- [x] Add admin-facing attestation before disabling encryption or enabling AI-sharing of sensitive fields.
  Evidence: `frontend/src/components/onboarding/FieldEditor.tsx`

---

## 11. Verification Evidence (2026-02-08)

- Automated regression suite:
  - `PYTHONPATH=.vendorpy python3 scripts/tests/AUTH/test_3c_auth_hardening_regression.py --api-base http://localhost:8000`
    - Result: `OVERALL RESULT: PASSED`
  - `PYTHONPATH=.vendorpy python3 scripts/tests/AUTH/test_3d_phase3_config_integrity.py --api-base http://localhost:8000`
    - Result: `OVERALL RESULT: PASSED`
- Manual Section 7.1 checks:
  - `GET /ingest/pending` unauthenticated: `401`
  - `POST /vector-search` unauthenticated: `401`
  - `GET /query/session/test-session-id` unauthenticated: `401`
  - Disallowed CORS preflight (`Origin: https://evil.example.com`): rejected (`400 Disallowed CORS origin`, no allow-origin echo)
  - Published ports: `sanctum-backend` and `sanctum-frontend` bound to `127.0.0.1`, no `0.0.0.0` exposure
  - Smoke endpoints: `GET /test` -> `200`, `GET /llm/test` -> `200`
- S4-5 / S4-6 manual browser verification (DevTools):
  - S4-5 (localStorage token removal): Inspected `Application > Local Storage` in browser DevTools after login — no auth/session tokens stored in `localStorage`. Tokens are transmitted exclusively via secure cookies.
  - S4-6 (query-param token removal): Inspected `Network` tab during auth flows — no tokens appear as URL query parameters. Magic-link verification submits the token in the request body, not the URL.
- Frontend availability smoke:
  - `GET http://localhost:5173/` -> `200`
