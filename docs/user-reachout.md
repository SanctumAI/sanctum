# User Reachout (Authenticated, Email-Only)

Last updated: 2026-02-09
Status: implemented (backend + frontend + admin config)

## Goal

Add a small, authenticated-only "User Reachout" path from the chat UI that emails an admin-configured inbox.

Constraints:

- Email-only (no storage in SQLite; no ticket system).
- Authenticated-only (do not require user approval; pending users can reach out).
- Rate-limited with sensible defaults.
- i18n-friendly and theme-consistent.

Non-goals (for v1):

- Persisting reachout threads.
- Attachments.
- Guaranteeing delivery (SMTP availability varies).
- Cross-replica shared rate limiting (see Limitations).

## Implementation Plan (Now Shipped)

### 1. Admin Configuration (Instance Settings)

Storage:

- Stored in `instance_settings` via the existing admin settings API (supports extra keys).
  - Admin UI: `frontend/src/pages/AdminUserConfig.tsx` (under `/admin/users`)
  - DB seeding defaults: `backend/app/database.py`

Settings keys:

| Key | Visibility | Type | Default | Notes |
|---|---|---|---|---|
| `reachout_enabled` | public | string boolean | `"false"` | Must be in `SAFE_PUBLIC_SETTINGS` to show user UI |
| `reachout_mode` | public | enum string | `"support"` | One of `feedback`, `help`, `support` |
| `reachout_title` | public | string | `""` | Optional UI override |
| `reachout_description` | public | string | `""` | Optional UI override |
| `reachout_button_label` | public | string | `""` | Optional UI override |
| `reachout_success_message` | public | string | `""` | Optional UI override |
| `reachout_to_email` | admin-only | string | `""` | Required when enabled |
| `reachout_subject_prefix` | admin-only | string | `""` | Optional prefix prepended to subject |
| `reachout_rate_limit_per_hour` | admin-only | int string | `"3"` | Defaults are enforced by seed + backend fallback |
| `reachout_rate_limit_per_day` | admin-only | int string | `"10"` | Defaults are enforced by seed + backend fallback |
| `reachout_include_ip` | admin-only | string boolean | `"false"` | Include masked client IP in emails (GDPR: see note below) |

Validation rules:

- Admin UI should prevent saving `reachout_enabled=true` without `reachout_to_email`.
- `reachout_to_email` should be validated as a well-formed email address at save time (currently only a non-empty check is performed; see Known Issues).
- Backend must still enforce: disabled feature returns `404`; missing destination email returns `503`.

Seed defaults:

- Implemented in `backend/app/database.py` within `seed_default_settings()`.

### 2. Backend API (Authenticated Endpoint + Email)

Endpoint:

- `POST /reachout` in `backend/app/main.py`
- Auth:
  - `Depends(auth.get_current_user)` (authenticated user required, approval not required)

Request/response models:

- `backend/app/models.py`
  - `ReachoutRequest { message: str }`
  - `ReachoutResponse { success: bool, message: str }`

Behavior:

- If `reachout_enabled != "true"`: return `404` (reduce probing).
- Validate request:
  - `message` required
  - enforce max length (currently `5000`)
- Determine destination:
  - `reachout_to_email` required; if missing return `503`
- Email delivery:
  - Uses `auth._get_smtp_config()` (same SMTP stack as magic links and `/auth/test-email`)
  - If SMTP host missing and not in mock mode: return `503`
  - Async implementation note:
    - SMTP interactions are executed via `asyncio.to_thread(...)` so the async endpoint does not block the event loop.
  - Subject format:
    - `[{instance_name}] {Mode}: user reachout`, with optional `reachout_subject_prefix` prepended
  - Reply-To:
    - Best-effort: user email from the signed session token payload
      - **Privacy note:** The user's email is included without explicit per-message consent. The modal description copy should inform users that replies go to their email.
  - Body includes:
    - Escaped message content
    - Minimal metadata for triage: instance name, user id, user-agent (truncated)
    - Client IP is **omitted by default**. When `reachout_include_ip` is `"true"`, a masked IP (IPv4 /24, IPv6 /64) is included. See **IP Addresses & GDPR** below.
  - Logging:
    - Avoid logging the reachout message
    - Mock mode may log To/Subject/User ID, but MUST NOT include message content (PII protection).

Error handling:

| Status | Meaning |
|---|---|
| `400` | invalid request (missing/too long) |
| `404` | feature disabled (intentional to reduce probing) |
| `429` | rate limited |
| `503` | reachout destination missing, SMTP misconfigured, or email send failure |

### 3. Rate Limiting (Defaults + Implementation Notes)

Default limits:

- Per hour: `3`
- Per day: `10`

Implementation:

- Two `RateLimiter` instances (hour/day windows) in `backend/app/main.py`:
  - `window_seconds=3600` and `window_seconds=86400`
  - Limit values are read from instance settings (strings) and coerced to ints
- `backend/app/rate_limit.py` supports a callable `limit` so the limiter can read updated instance settings without restart.
  - Note: this means a setting read happens per request; if that becomes a hot path, add caching.
- Keying:
  - Uses the same approach as `_rate_limit_key()` in `backend/app/main.py`:
    - Prefer a stable authenticated identity (admin/user id) when available, falling back to bearer token digest, cookie token digest, then client IP

**Deployment constraint:**

- The current `RateLimiter` is in-memory (`backend/app/rate_limit.py`).
  - It resets on backend restart.
  - It is not shared across multiple backend workers/replicas, so limits are per-process. In multi-replica deployments, the effective limit is N x the configured limit (where N is the number of replicas).
  - Acceptable for v1; for production at scale we should replace with Redis or another shared store.

### 4. Frontend UX (Chat Header Button + Modal)

Entry point:

- `frontend/src/pages/ChatPage.tsx`
  - Fetches `/settings/public` once and caches reachout flags in component state.
  - Shows an envelope icon button in the chat header only when `reachout_enabled=true`.
    - Tooltip/aria label is driven by `reachout_mode` (feedback/help/support).

Modal:

- `frontend/src/components/reachout/ReachoutModal.tsx`
  - Fields: message textarea, submit, cancel
  - Submit:
    - `fetch(${API_BASE}/reachout, { method: 'POST', credentials: 'include', body: { message } })`
  - Error handling:
    - `429`: translated "try later"
    - `404`: translated "unavailable"
    - `503`: translated "not configured"
    - Other: generic failure

Auth/CSRF:

- This is a cookie-authenticated `POST`, so CSRF is enforced by backend middleware.
- The frontend relies on the global secure fetch wrapper (`frontend/src/utils/secureFetch.ts`) to inject `X-CSRF-Token` automatically.

Theme considerations:

- Modal styles must use theme tokens (`bg-surface`, `border-border`, `text-text`, etc.) so it renders correctly across:
  - `surface_style` presets
  - `typography_preset` presets
  - light/dark variants (if/when added)
- Avoid hardcoding colors in the modal; only use existing design tokens.

### 5. i18n / Copy Strategy

User-facing strings:

- Add keys in `frontend/src/i18n/locales/en.json` (other locales fall back to English).
- Suggested keys:
  - `reachout.mode.feedback.openButton`, `reachout.mode.feedback.title`, `reachout.mode.feedback.description`
  - `reachout.mode.help.openButton`, `reachout.mode.help.title`, `reachout.mode.help.description`
  - `reachout.mode.support.openButton`, `reachout.mode.support.title`, `reachout.mode.support.description`
  - `reachout.form.messageLabel`, `reachout.form.placeholder`, `reachout.form.send`
  - `reachout.status.success`
  - `reachout.errors.required`, `reachout.errors.rateLimited`, `reachout.errors.unavailable`, `reachout.errors.notConfigured`, `reachout.errors.failed`

Admin UI strings:

- Suggested keys under `admin.reachout.*` for `frontend/src/pages/AdminUserConfig.tsx`.

Copy resolution order (UI):

1. If admin override setting exists (non-empty string), use it.
2. Else use i18n defaults based on `reachout_mode`.

Note:

- Admin overrides are stored in instance settings and apply to all languages (they are not per-locale).

Implementation detail (current):

- User-facing reachout strings are present in `frontend/src/i18n/locales/en.json`.
- Admin UI reachout strings are present in `frontend/src/i18n/locales/en.json` under `admin.reachout.*`.

## Testing (Manual Acceptance)

### UI

1. With `reachout_enabled=false`: no reachout button appears in the chat header.
2. With `reachout_enabled=true` and valid `reachout_to_email`:
  - button appears
  - submitting sends an email (or succeeds in mock mode)
3. Rate limiting:
  - after `reachout_rate_limit_per_hour` submissions, next request returns `429`
  - UI shows the translated rate limit message
4. i18n:
  - switching language changes modal strings (or falls back to English)
5. Data handling:
  - no reachout content is written to SQLite

### API (Curl)

Note: cookie-CSRF is enforced for unsafe requests when using cookie auth. For CLI tests, prefer Bearer auth.

```bash
curl -X POST http://localhost:8000/reachout \
  -H "Authorization: Bearer <user_session_token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello, I need help with..."}'
```

Expected responses:

- `200` `{ "success": true, "message": "Message sent" }`
- `404` when disabled
- `503` when misconfigured
- `429` when rate limited

CSRF sanity check (browser/cookie clients):

- If you remove the `X-CSRF-Token` header on a cookie-authenticated `POST`, the backend should return `403` from the CSRF middleware.

## IP Addresses & GDPR

IP addresses are personal data under GDPR (and similar regulations). Reachout emails **omit the client IP by default**.

Admins who need the IP for abuse triage can enable it via the `reachout_include_ip` instance setting (or `REACHOUT_INCLUDE_IP` env var). When enabled:

- IPv4 addresses are masked to /24 (e.g. `1.2.3.0`)
- IPv6 addresses are masked to /64 (e.g. `2001:db8::/64`)

Admins enabling this setting should ensure their data-processing records account for the collection, and that any applicable privacy notice covers IP processing for abuse prevention / triage.

## Known Issues / Follow-Ups

### Rate Limiting (Scaling)

- Replace in-memory limiter with Redis-backed storage.

### Email Validation (Pre-GA)

- Implement before public-facing deployment: validate `reachout_to_email` format server-side before allowing enable.

### Abuse Resistance (Pre-GA)

- Implement before public-facing deployment: additional throttles:
  - per-user/day
  - per-IP/day
  - spam keyword heuristics
  - optional "cooldown" UI feedback

### Observability

- Add structured logs that confirm sends without recording message content.
- Add metrics counters for `reachout.success`, `reachout.failure`, `reachout.rate_limited`.

## Implementation (As Built)

Backend:

- Defaults seeded in `backend/app/database.py` (`seed_default_settings()`).
- Public setting exposure via `SAFE_PUBLIC_SETTINGS` in `backend/app/main.py` and `GET /settings/public`.
- Endpoint: `POST /reachout` in `backend/app/main.py`:
  - Auth: `auth.get_current_user` (authenticated-only; approval not required)
  - Rate limits: `reachout_hour_limiter` and `reachout_day_limiter` (settings-backed)
  - Email: SMTP send via `auth._get_smtp_config()` (same stack as magic links / test email)
- Dynamic limiter support: `backend/app/rate_limit.py` accepts a callable `limit` so instance-setting changes apply without restart.
- Rate limit keying: Uses `rate_limit_key()` from `backend/app/rate_limit_key.py`, which prefers stable user/admin identity (`user_id:<id>` or `admin_id:<id>`) from verified tokens before falling back to token digests or client IP. This ensures rate limits persist across token rotation.

Frontend:

- Chat entry point: `frontend/src/pages/ChatPage.tsx` shows an envelope header button when `reachout_enabled=true` from `/settings/public`.
- Modal: `frontend/src/components/reachout/ReachoutModal.tsx` posts to `/reachout`, uses theme tokens (`bg-surface`, `border-border`, `text-text`), and relies on the global CSRF injection wrapper.
- Admin UI: `frontend/src/pages/AdminUserConfig.tsx` includes controls for:
  - enable toggle, mode, destination email, subject prefix, hour/day limits, include-IP toggle, and copy overrides.
