# Admin Deployment Configuration

This guide covers the deployment configuration system available to admins at `/admin/deployment`. It lets you manage LLM, email, domains, SSL, and other environment-level settings without editing `.env` files.

## Overview

Deployment config values are stored in SQLite (`deployment_config` table) and take precedence over environment variables at runtime. On startup, the backend syncs known environment variables into the database if they’re missing.

**Precedence order:**
1. `deployment_config` (SQLite)
2. Environment variables
3. Built‑in defaults (where defined)

## Where It Lives

- UI: `/admin/deployment`
- API base: `/admin/deployment/*` (admin auth required)
- Storage: `deployment_config` + `config_audit_log`

## Key Behaviors

- **Secret values are masked** in list views.
- **Reveal secrets** via `GET /admin/deployment/config/{key}/reveal`.
- **Empty secret updates are ignored** to avoid accidental credential wipe.
- **Config changes are audited** in `config_audit_log`.
- Some keys **require restart** to take effect (see `requires_restart`).

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/admin/deployment/config` | GET | List all config values grouped by category |
| `/admin/deployment/config/{key}` | GET | Read one config key (masked if secret) |
| `/admin/deployment/config/{key}/reveal` | GET | Reveal a secret value |
| `/admin/deployment/config/{key}` | PUT | Update a config value |
| `/admin/deployment/config/export` | GET | Export `.env`‑style text (includes secrets) |
| `/admin/deployment/config/validate` | POST | Validate config and return errors/warnings |
| `/admin/deployment/health` | GET | Health checks for Qdrant/LLM/SearXNG/SMTP |
| `/admin/deployment/restart-required` | GET | Keys changed since service start that require restart |
| `/admin/deployment/audit-log` | GET | Recent config changes |

## Validation Rules

The validation endpoint enforces guardrails, including:
- `SMTP_PORT`, `QDRANT_PORT`: integer 1‑65535
- `RAG_TOP_K`: integer 1‑100
- URL fields must include protocol (e.g., `https://`)
- Domain fields must be valid DNS names
- `FORCE_HTTPS`: boolean
- `HSTS_MAX_AGE`: non‑negative integer

It also warns if `INSTANCE_URL` is missing from `CORS_ORIGINS`.

## Validation UI

Click **Validate Config** to run server-side checks and display results in the admin UI.
The validation banner includes:
- The timestamp of the last validation.
- A summary count and detailed lists of errors and warnings.
- An **Out of date** indicator if configuration changes after validation.
- A dismiss button, plus a quick **Revalidate** action when results are stale.

If you edit any deployment setting after validating, the banner is marked out of date until you validate again.

## Common Workflows

### LLM Provider

Use provider‑agnostic keys where possible:
- `LLM_PROVIDER` (`maple` or `ollama`)
- `LLM_API_URL`
- `LLM_MODEL`

Provider‑specific keys (`MAPLE_BASE_URL`, `MAPLE_MODEL`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`) are also supported and mapped internally.

Example (set Maple model and base URL):
```bash
curl -X PUT http://localhost:8000/admin/deployment/config/LLM_PROVIDER \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"value":"maple"}'

curl -X PUT http://localhost:8000/admin/deployment/config/LLM_API_URL \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"value":"http://maple-proxy:8080/v1"}'

curl -X PUT http://localhost:8000/admin/deployment/config/LLM_MODEL \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"value":"kimi-k2-thinking"}'
```

### Email + SMTP

Set `SMTP_*` values, then use the test email endpoint to verify delivery.
`MOCK_SMTP` is the deployment UI alias for `MOCK_EMAIL` (if both are set, `MOCK_EMAIL` wins).

```bash
curl -X PUT http://localhost:8000/admin/deployment/config/SMTP_HOST \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"value":"smtp.mailgun.org"}'
```

Send a test email:
```bash
curl -X POST http://localhost:8000/auth/test-email \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```

The SMTP health check reports:
- **Healthy** if the last test succeeded
- **Unknown** if not tested yet
- **Unknown (Mock mode)** if `MOCK_SMTP=true`

### Domains & SSL

Typical domain setup:
- `BASE_DOMAIN`, `INSTANCE_URL`, `API_BASE_URL`, `ADMIN_BASE_URL`
- `EMAIL_DOMAIN`, `DKIM_SELECTOR`, `SPF_INCLUDE`, `DMARC_POLICY`
- `CORS_ORIGINS` (include `INSTANCE_URL`)

SSL/HTTPS:
- `FORCE_HTTPS`, `HSTS_MAX_AGE`
- `SSL_CERT_PATH`, `SSL_KEY_PATH`, `TRUSTED_PROXIES`

Some of these require restart; use `/admin/deployment/restart-required` to see what changed.

### Simulation Flags (Testing Only)

For local development:
- `SIMULATE_ADMIN_AUTH=true` shows a mock Nostr login button
- `SIMULATE_USER_AUTH=true` allows token‑less verify on `/verify`

These flags are read by the frontend via `/config/public`. Keep them off in production.

## Restart Required

Config entries include a `requires_restart` flag. When such keys change, the service won’t fully apply them until restart. Use:

```bash
curl http://localhost:8000/admin/deployment/restart-required \
  -H "Authorization: Bearer <admin-token>"
```

## Exporting `.env`

`/admin/deployment/config/export` returns an `.env`‑style file with **secrets included**. Treat it as sensitive.

## Related Docs

- `docs/email-auth.md` for provider‑specific SMTP setup
- `docs/authentication.md` for magic link behavior and simulation flags
- `docs/sqlite-admin-system.md` for schema and admin endpoints
