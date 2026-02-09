# Security

This document describes Sanctum's current security model and the minimum hardening steps for an internet-exposed deployment.

For a more exhaustive engineering checklist, see `docs/security-data-protection-checklist.md`.

## Security Model (Current)

- Passwordless auth:
  - Admin auth: Nostr NIP-07 signed events.
  - User auth: email magic links.
- Session handling:
  - Signed, time-limited session tokens.
  - Browser auth uses `httpOnly` cookies plus CSRF protection for unsafe requests.
  - CLI/non-browser clients can use `Authorization: Bearer <token>`.
  - See `docs/sessions.md`.
- Data protection:
  - User PII fields are encrypted at rest in SQLite once an admin has initialized the instance. Before initialization, user creation is blocked (the instance must be initialized first). The initialization step generates the encryption key.
  - Deployment config secrets are masked in reads and encrypted at rest.
  - See `docs/sqlite-encryption.md`.
- Baseline web protections:
  - Explicit CORS allowlist suitable for credentialed cookies.
  - CSRF enforcement for cookie-authenticated unsafe requests.
  - Security headers (CSP for API responses, HSTS when HTTPS is detected, X-Frame-Options, etc).

## Production Hardening (Minimum)

### 1. Lock Down Secrets and Keys

- Set a strong, stable `SECRET_KEY` via a secret manager.
  - Rotating `SECRET_KEY` invalidates existing sessions.
- Protect admin private keys.
  - Read `docs/admin-key-recovery-runbook.md`.

### 2. Disable Dev/Simulation Paths

- Ensure these are false in production:
  - `MOCK_EMAIL=false`
  - `SIMULATE_USER_AUTH=false`
  - `SIMULATE_ADMIN_AUTH=false`

### 3. Enforce TLS End-to-End

- Serve the frontend and backend over HTTPS.
- Put the backend behind a reverse proxy that:
  - Terminates TLS.
  - Sets `X-Forwarded-Proto: https`.
  - Enforces HSTS (or rely on backend HSTS when HTTPS is detected).
- Configure trusted proxies if applicable (see deployment config docs).

### 4. Configure Origins for Cookie Auth

Credentialed cookies require explicit origins.

- Set `FRONTEND_URL` to your public frontend origin.
- Set `CORS_ALLOW_ORIGINS` (or `CORS_ORIGINS`) to a comma-separated list of explicit `scheme://host[:port]` origins.
- Do not use `*` — the backend silently drops it from the allowlist because credentialed cookies require explicit origins (per the Fetch spec). No error is raised; `*` entries simply have no effect.

### 5. Keep Cookies Secure

Recommended:

- `SESSION_COOKIE_SECURE=true` (or enable production mode via `SANCTUM_ENV=production`)
- `SESSION_COOKIE_SAMESITE=lax` (or `none` only when you understand the cross-site implications)
- Set `SESSION_COOKIE_DOMAIN` only if you need cross-subdomain cookies.

### 6. Limit Network Exposure

- Ensure only necessary ports are published externally.
- Keep Qdrant and any internal services private where possible.

### 7. Review Data Flows and Retention

- Uploaded files in `uploads/` are runtime artifacts; treat them as sensitive.
- Define retention and deletion policies for:
  - Uploaded documents and derived chunks
  - Logs
  - RAG session state (see `docs/sessions.md` for current in-memory behavior)
    - **Note:** In-memory only — lost on process restart and not shared across replicas. Plan for persistent storage before multi-worker deployments.

## Operational References

- `docs/security-data-protection-checklist.md` - status and remediation tracker.
- `docs/admin-deployment-config.md` - deployment-time security settings and validation.
- `docs/sessions.md` - cookie/bearer auth sessions and CSRF model.

