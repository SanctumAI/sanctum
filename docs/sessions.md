# Sessions

Sanctum has two distinct "session" concepts:

- Auth sessions: browser/API authentication for admins and users (signed tokens, usually via cookies).
- RAG sessions: conversation continuity for `/query` (`session_id`), used to keep chat history and extracted context.

This doc explains both, plus the CSRF model used with cookie-based auth.

## Auth Sessions (Admin and User)

### What A Session Token Is

Sanctum issues signed, time-limited tokens using `itsdangerous.URLSafeTimedSerializer` with `SECRET_KEY`:

- User session token salt: `session`
- Admin session token salt: `admin-session`
- Default lifetime: 7 days (user and admin)

Session tokens are signed (integrity protected) but not encrypted, so treat them as secrets.

### How Tokens Are Carried

Sanctum supports two ways to authenticate requests:

1. Cookie auth (browser default)
   - User cookie name: `sanctum_session` (configurable)
   - Admin cookie name: `sanctum_admin_session` (configurable)
   - Cookies are `httpOnly` with secure defaults.
2. Bearer auth (CLI / non-browser clients)
   - Use `Authorization: Bearer <token>`
   - When a Bearer token is present, cookie-based CSRF checks are not enforced.

Both modes use the same token format. Browser clients typically use cookie auth so the token is not accessible to JavaScript.

### Quick Curl Examples

Validate a user session token (Bearer):

```bash
curl http://localhost:8000/auth/me \
  -H "Authorization: Bearer <session_token>"
```

Validate an admin session token (Bearer):

```bash
curl http://localhost:8000/admin/session \
  -H "Authorization: Bearer <admin_session_token>"
```

### Login and Logout

User login:

- Frontend receives a magic link token (from `/verify?token=...`).
- Frontend calls `POST /auth/verify` with JSON `{ "token": "..." }`.
- Backend sets the user session cookie and a CSRF cookie.

User logout:

- `POST /auth/logout` clears auth cookies for the browser.
- User session tokens are otherwise stateless; there is no server-side per-token revocation (expiry or `SECRET_KEY` rotation ends validity).

Admin login:

- Frontend signs a Nostr NIP-07 event and calls `POST /admin/auth`.
- Backend sets the admin session cookie and a CSRF cookie.

Admin logout and revocation:

- `POST /admin/logout` clears auth cookies.
- If the request includes a valid admin token, the backend rotates `admins.session_nonce` to invalidate previously issued admin tokens.

### Cookie and CSRF Model

Sanctum enforces CSRF only for cookie-authenticated unsafe requests (non-`GET/HEAD/OPTIONS/TRACE`).

Rules:

- Requests using `Authorization: Bearer ...` are not subject to the cookie-CSRF check.
- Cookie-authenticated unsafe requests must include:
  - A trusted `Origin` (or `Referer`) that matches the backend CORS allowlist.
  - `X-CSRF-Token` header equal to the `sanctum_csrf` cookie value (double-submit).

The frontend automatically injects `X-CSRF-Token` for API requests.

### Relevant Configuration

Session signing:

- `SECRET_KEY`
  - If not set, the backend generates one and persists it to the SQLite data directory as `.secret_key`.
  - Rotating `SECRET_KEY` invalidates all existing session tokens.

Cookie settings:

- `USER_SESSION_COOKIE_NAME` (default `sanctum_session`)
- `ADMIN_SESSION_COOKIE_NAME` (default `sanctum_admin_session`)
- `CSRF_COOKIE_NAME` (default `sanctum_csrf`)
- `SESSION_COOKIE_SAMESITE` (default `lax`)
- `SESSION_COOKIE_DOMAIN` (default unset)
- `SESSION_COOKIE_SECURE`
  - Defaults to secure in production mode, and is forced to secure when `SameSite=None`.

Origins:

- `CORS_ALLOW_ORIGINS` or `CORS_ORIGINS` sets the allowlist.
- `FRONTEND_URL` is appended to the allowlist if set.
- Wildcard `*` is ignored (credentialed cookies require explicit origins).

## RAG Sessions (`/query` session_id)

### What It Is (And Is Not)

The `/query` API supports a `session_id` field used for conversation continuity:

- It is not an authentication token.
- It is not stored as a cookie by default.
- It links multiple `/query` calls together (chat history, extracted facts, jurisdiction, etc).

The backend currently stores RAG sessions in an in-memory dictionary (per backend process). This means:

- RAG sessions are lost on backend restart.
- RAG session continuity is not reliable across multiple backend replicas.

> **Production warning:** In-memory storage means sessions have no durability guarantees. A process restart or OOM kill silently discards all active RAG sessions. For deployments requiring session continuity, plan to migrate to a persistent store (e.g., Redis or SQLite).

### Ownership and Access Control

RAG sessions are owner-scoped:

- Admins can access any RAG session.
- Non-admin users can only access sessions they created.

Enforcement:

- Reusing an existing `session_id` checks ownership and returns `403` if it does not belong to the caller.
- `GET /query/session/{session_id}` and `DELETE /query/session/{session_id}` require auth and enforce the same access checks.

### API Behavior

- `POST /query` returns `session_id` in the response. Clients should reuse it for follow-up questions.
- `GET /query/session/{session_id}` returns session state (messages and derived state) for debugging/admin workflows.
- `DELETE /query/session/{session_id}` deletes the session (best-effort; deleting a missing session still returns deleted).

## Debugging and Verification

Useful endpoints:

- `GET /auth/me` (cookie or Bearer) to validate a user session.
- `GET /admin/session` (cookie or Bearer) to validate an admin session.
- `GET /query/session/{session_id}` to inspect RAG session state (requires auth and ownership).
