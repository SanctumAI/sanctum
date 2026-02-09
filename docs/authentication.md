# Sanctum Authentication

This document describes the two authentication systems in Sanctum:
- **Admin Authentication** - Nostr NIP-07 signed events
- **User Authentication** - Magic link email

For how sessions are stored and secured (cookies, bearer tokens, CSRF), see `docs/sessions.md`.

## Overview

Sanctum uses a two-tier authentication model:

| Role | Auth Method | Purpose |
|------|-------------|---------|
| **Admin** | Nostr NIP-07 | Instance configuration, user management |
| **User** | Email magic link | Access to RAG knowledge base |

Both systems are **passwordless** by design, improving security by eliminating password storage and credential theft risks.

---

## Admin Authentication (Nostr NIP-07)

Admins authenticate using a Nostr browser extension (Alby, nos2x, etc.) that signs authentication events.

### How It Works

```
┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│   Browser    │     │   Nostr      │     │   Backend   │
│   Frontend   │     │   Extension  │     │   API       │
└──────┬───────┘     └──────┬───────┘     └──────┬──────┘
       │                    │                    │
       │  1. Request pubkey │                    │
       │ ─────────────────> │                    │
       │                    │                    │
       │  2. Return pubkey  │                    │
       │ <───────────────── │                    │
       │                    │                    │
       │  3. Request signature (auth event)      │
       │ ─────────────────> │                    │
       │                    │                    │
       │  4. Return signed event                 │
       │ <───────────────── │                    │
       │                    │                    │
       │  5. POST /admin/auth with signed event  │
       │ ──────────────────────────────────────> │
       │                    │                    │
       │  6. Verify signature, create/return admin
       │ <────────────────────────────────────── │
```

### Event Structure

Admin auth uses a custom Nostr event kind `22242`:

```json
{
  "id": "sha256-of-serialized-event",
  "pubkey": "admin-hex-pubkey",
  "created_at": 1705000000,
  "kind": 22242,
  "tags": [
    ["action", "admin_auth"]
  ],
  "content": "",
  "sig": "schnorr-signature"
}
```

**Requirements:**
- Kind must be `22242` (Sanctum admin auth)
- Must have `["action", "admin_auth"]` tag
- Timestamp must be within 5 minutes of server time
- Signature must be valid BIP-340 Schnorr

**Single-admin constraint:** The first admin to authenticate becomes the only admin for the instance. Subsequent admin auth attempts return `403` ("Admin registration is closed"). The admin can migrate to a new Nostr keypair using key migration, but this does not transfer ownership to a different person.

### API Endpoint

#### `POST /admin/auth`

Authenticate or register an admin using a signed Nostr event.

**Request:**
```bash
curl -X POST http://localhost:8000/admin/auth \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "id": "...",
      "pubkey": "...",
      "created_at": 1705000000,
      "kind": 22242,
      "tags": [["action", "admin_auth"]],
      "content": "",
      "sig": "..."
    }
  }'
```

**Response:**
```json
{
  "admin": {
    "id": 1,
    "pubkey": "abc123...",
    "created_at": "2024-01-15T10:30:00"
  },
  "session_token": "eyJhZG1pbl9pZCI6MSwi...",
  "is_new": true,
  "instance_initialized": true
}
```

The `session_token` must be included in subsequent admin API requests as `Authorization: Bearer <token>`.

**Errors:**
- `401` - Invalid signature, wrong event kind, expired timestamp, or missing action tag
- `403` - Admin registration is closed (an admin already exists)
- `429` - Rate limit exceeded (10 requests per minute per IP)

**Rate Limiting:** 10 requests per minute per IP address. Returns 429 after limit is exceeded.

### Frontend Integration

The frontend uses the NIP-07 `window.nostr` API:

```typescript
// Check for Nostr extension
if (!window.nostr) {
  throw new Error('No Nostr extension found')
}

// Get public key
const pubkey = await window.nostr.getPublicKey()

// Create auth event
const event = {
  kind: 22242,
  created_at: Math.floor(Date.now() / 1000),
  tags: [['action', 'admin_auth']],
  content: '',
  pubkey: pubkey
}

// Sign with extension
const signedEvent = await window.nostr.signEvent(event)

// Send to backend
const response = await fetch('/api/admin/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ event: signedEvent })
})
```

### Supported Extensions

Any NIP-07 compatible browser extension:
- [Alby](https://getalby.com/) (recommended)
- [nos2x](https://github.com/nicholasflamel/nos2x)
- [Flamingo](https://www.flamingo.zip/)
- [Nostr Connect](https://nostrconnect.com/)

### Admin Key Migration

Admins can migrate to a new Nostr keypair without losing access to encrypted user data.
This re-encrypts all PII to the new pubkey.

See [sqlite-encryption.md](./sqlite-encryption.md#admin-key-migration) for details.

---

## User Authentication (Magic Link)

Users authenticate via email magic links - no password required.

**Setup requirement:** User auth endpoints are disabled until an admin has authenticated at least once (instance setup complete). If no admin exists, `/auth/magic-link` returns `503` with "Instance not configured."

### How It Works

```
┌──────────────┐     ┌─────────────┐     ┌─────────────┐
│   User       │     │   Backend   │     │   Email     │
│   Browser    │     │   API       │     │   (SMTP)    │
└──────┬───────┘     └──────┬──────┘     └──────┬──────┘
       │                    │                    │
       │  1. Enter email    │                    │
       │ ─────────────────> │                    │
       │                    │                    │
       │  2. Generate token │                    │
       │                    │  3. Send magic link
       │                    │ ─────────────────> │
       │                    │                    │
       │  4. "Check email"  │                    │
       │ <───────────────── │                    │
       │                    │                    │
       │  5. Click link in email                 │
       │ ──────────────────────────────────────> │
       │                    │                    │
       │  6. Load frontend /verify?token=xxx     │
       │ ──────────────────────────────────────> │
       │                    │                    │
       │  7. Frontend POST /auth/verify {token}  │
       │ ─────────────────> │                    │
       │                    │                    │
       │  8. Verify token, create user, set session cookie
       │ <───────────────── │                    │
```

### Token Generation

Tokens are generated using `itsdangerous.URLSafeTimedSerializer`:

- **Algorithm**: HMAC-SHA1 with timestamp
- **Payload**: `{"email": "...", "name": "..."}`
- **Salt**: `"magic-link"`
- **Expiration**: 15 minutes

Example token: `eyJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJuYW1lIjoiSm9obiJ9.ZoVhNg.abc123...`

### Session Tokens

After verification, the user receives a session token:

- **Algorithm**: HMAC-SHA1 with timestamp
- **Payload**: `{"user_id": 123, "email": "..."}`
- **Salt**: `"session"`
- **Expiration**: 7 days

In browser flows, the backend sets this as an `httpOnly` cookie (the token is not readable by frontend JavaScript). The token is also returned in the JSON response for non-browser clients.

### API Endpoints

#### `POST /auth/magic-link`

Request a magic link email.

**Request:**
```bash
curl -X POST http://localhost:8000/auth/magic-link \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "name": "John Doe"}'
```

**Response:**
```json
{
  "success": true,
  "message": "Magic link sent. Check your email."
}
```

**Errors:**
- `400` - Email is required
- `429` - Rate limit exceeded (5 requests per minute per IP)
- `500` - Failed to send email
- `503` - Instance not configured (no admin has authenticated yet)

**Rate Limiting:** 5 requests per minute per IP address. Prevents email flooding attacks.

---

#### Frontend route: `/verify?token=...`

Magic link emails point to the frontend route `/verify?token=...`.
The frontend extracts the token from the URL and calls the backend verify endpoint below.

#### `POST /auth/verify`

Verify a magic link token and create a session (sets auth cookies).

**Request:**
```bash
curl -X POST http://localhost:8000/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"token":"eyJlbWFpbCI6..."}'
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "user_type_id": null,
    "approved": true,
    "created_at": "2024-01-15T10:30:00",
    "needs_onboarding": false,
    "needs_user_type": false
  },
  "session_token": "eyJ1c2VyX2lkIjoxLC..."
}
```

**Errors:**
- `401` - Invalid or expired magic link

---

#### `GET /auth/me`

Get the current authenticated user.

Authentication sources:
- Cookie session (browser default), or
- `Authorization: Bearer <session_token>` (CLI clients)

**Request (Bearer):**
```bash
curl http://localhost:8000/auth/me \
  -H "Authorization: Bearer <session_token>"
```

**Response (authenticated):**
```json
{
  "authenticated": true,
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "user_type_id": null,
    "approved": true,
    "created_at": "2024-01-15T10:30:00",
    "needs_onboarding": false,
    "needs_user_type": false
  }
}
```

**Response (not authenticated):**
```json
{
  "authenticated": false,
  "user": null
}
```

---

#### `POST /auth/test-email`

Send a test email to verify SMTP configuration (admin only).

**Request:**
```bash
curl -X POST http://localhost:8000/auth/test-email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"email": "you@example.com"}'
```

**Response:**
```json
{
  "success": true,
  "message": "Test email sent successfully"
}
```

**Response (mock mode):**
```json
{
  "success": true,
  "message": "Test email sent successfully (mock mode enabled - check backend logs)"
}
```

If `MOCK_EMAIL=true` (or `MOCK_SMTP=true` via deployment config), the response notes that mock mode is enabled.

**Errors:**
- `401/403` - Unauthorized or not an admin
- `400` - Email address required
- `500` - Failed to send test email

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | (auto-generated) | Key for signing tokens. If not set, auto-generates and persists to `/data/.secret_key` |
| `FRONTEND_URL` | `http://localhost:5173` | Base URL for magic link emails |
| `MOCK_EMAIL` | `false` | Log magic links instead of sending emails (note: `.env.example` sets this to `true` for local dev) |
| `MOCK_SMTP` | (alias) | Deployment-config alias for `MOCK_EMAIL` |
| `SMTP_HOST` | (empty) | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | (empty) | SMTP username |
| `SMTP_PASS` | (empty) | SMTP password |
| `SMTP_FROM` | `Sanctum <noreply@localhost>` | From address for emails |

### Development Mode (Mock Email)

With `MOCK_EMAIL=true` (commonly enabled in local dev via `.env.example`), or `MOCK_SMTP=true` via deployment config, magic links are logged to the console instead of being sent via email:

```
============================================================
MAGIC LINK (mock mode - no email sent)
To: user@example.com
URL: http://localhost:5173/verify?token=eyJlbWFpbCI6...
============================================================
```

Copy the URL from the backend logs to test the verification flow.

### Production Mode (SMTP)

Copy `.env.example` to `.env` and configure SMTP:

```bash
cp .env.example .env
# Edit .env with your SMTP settings
```

Required settings:
```env
MOCK_EMAIL=false
SMTP_HOST=smtp.yourdomain.com
SMTP_PORT=587
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=your-smtp-password
SMTP_FROM=Sanctum <noreply@yourdomain.com>
FRONTEND_URL=https://yourdomain.com
```

> **Note:** `SECRET_KEY` is auto-generated on first run and persisted to `/data/.secret_key`. See `.env.example` for all configuration options.

---

## Frontend Storage Keys

The frontend stores non-secret auth markers and onboarding state in localStorage.

Auth secrets should not be stored in localStorage. Browser authentication is cookie-based (see `docs/sessions.md`).

| Key | Description |
|-----|-------------|
| `sanctum_admin_pubkey` | Admin Nostr pubkey (after NIP-07 auth) |
| `sanctum_user_email` | Verified user email |
| `sanctum_user_name` | User display name |
| `sanctum_user_type_id` | Selected user type during onboarding |
| `sanctum_user_profile` | Complete user profile (JSON) |
| `sanctum_user_approved` | Whether user is approved ("true"/"false") |
| `sanctum_custom_fields` | Cached custom field definitions (JSON) |
| `sanctum_pending_email` | Email awaiting magic link verification |
| `sanctum_pending_name` | Name awaiting verification |

Legacy keys:

Some older builds used localStorage for tokens. If you see these keys, clear them:

- `sanctum_admin_session_token`
- `sanctum_session_token`

---

## User Approval Workflow

Sanctum supports optional manual approval of new users before they can access the system.

### How It Works

1. **Instance Setting**: `auto_approve_users` controls default behavior
   - `"true"` (default): New users are automatically approved
   - `"false"`: New users must wait for admin approval

2. **Database**: Users have an `approved` column (INTEGER: 1=approved, 0=pending)

3. **Frontend Routing**: After magic link verification:
   - If `approved = true`: User proceeds to onboarding flow (`/user-type` → `/profile` → `/chat`)
   - If `approved = false`: User is redirected to `/pending` (waiting page)

### Current Limitations

> **Note:** The approval workflow is partially implemented:
> - No dedicated admin endpoint exists for approving/rejecting users
> - Admins can update the `approved` field via `PUT /users/{user_id}` or the database explorer
> - No admin UI for viewing/managing pending users
> - See "Production Hardening" below for details

---

## Development/Testing Modes

The codebase includes several development conveniences that are disabled by default in production.

### Mock Email Mode

With `MOCK_EMAIL=true` (or `MOCK_SMTP=true` via deployment config), magic links are logged to console instead of sent via SMTP. This is controlled by the backend environment variable.

### Simulation Flags (Backend)

Mock auth features are controlled by backend config and exposed via `/config/public`.

When enabled:
- **`SIMULATE_ADMIN_AUTH=true`**: "Mock Connection" button appears on `/admin`
  - Generates a fake 64-character hex pubkey
  - Bypasses real NIP-07 extension signing
  - Note: Admin API calls will fail (no valid session token)
- **`SIMULATE_USER_AUTH=true`**: `/verify` can succeed without a token using `sanctum_pending_email` (testing only)

These flags can be set via the deployment config UI (`/admin/deployment`) or environment variables.
Database values take precedence over env vars. Keep them disabled in production.

### Configuration

Add to your backend environment (e.g., `.env` or `docker-compose.app.yml`):
```bash
# Development
SIMULATE_ADMIN_AUTH=true
SIMULATE_USER_AUTH=true

# Production (default - no action needed)
# SIMULATE_* not set or set to false
```

See "Production Hardening" below for complete production deployment guidance.

---

## Security Considerations

### Magic Link Tokens
- **15 minute expiration** - Short window reduces risk of interception
- **Single-use by design** - Each verification creates a new session
- **Signed, not encrypted** - Email is visible in token but cannot be forged

### Session Tokens
- **7 day expiration** - Balance between convenience and security
- **HMAC-signed** - Cannot be forged without SECRET_KEY
- **User sessions are stateless** - No server-side per-token storage; validity is based on signature + expiry
- **Admin sessions support server-side revocation** - Admin tokens include a `session_nonce` checked against the DB (rotated on logout)

### Admin Events
- **5 minute window** - Prevents replay attacks
- **BIP-340 Schnorr** - Industry-standard cryptographic signatures
- **Pubkey-based** - No shared secrets, key never leaves browser extension

### General
- **No passwords** - Eliminates credential stuffing, phishing, password reuse
- **No password hashing** - Nothing to crack
- **Self-custody keys** - Admin private keys never touch the server

### Production Deployment

The following security features are implemented:
- **Endpoint authentication** - All admin endpoints require valid session token
- **Rate limiting** - Auth endpoints are rate-limited (5/min for magic-link, 10/min for admin auth)
- **Simulated auth disabled by default** - Requires `SIMULATE_*` flags to enable
- **Auto-generated SECRET_KEY** - Persisted to `/data/.secret_key` on first run

### Production Hardening

Recommended production steps:
- Set a stable `SECRET_KEY` in your environment or ensure `/data/` is persisted
- Configure SMTP with a verified domain and SPF/DKIM/DMARC
- Disable `SIMULATE_*` flags and `MOCK_EMAIL` in production
- Restrict admin access to trusted networks
- Use HTTPS in front of the backend and configure `CORS_ORIGINS` appropriately

---

## Files

### Backend

| File | Description |
|------|-------------|
| `backend/app/auth.py` | Magic link token generation, email sending, session management |
| `backend/app/nostr.py` | BIP-340 Schnorr signature verification |
| `backend/app/rate_limit.py` | In-memory rate limiter for auth endpoints |
| `backend/app/main.py` | Auth API endpoints |
| `backend/app/database.py` | User storage with email lookup |

### Frontend

| File | Description |
|------|-------------|
| `frontend/src/pages/AdminOnboarding.tsx` | NIP-07 admin login |
| `frontend/src/pages/UserAuth.tsx` | Email magic link form |
| `frontend/src/pages/VerifyMagicLink.tsx` | Token verification page |
| `frontend/src/types/onboarding.ts` | Storage keys and helpers |
| `frontend/src/utils/adminApi.ts` | Admin API helper with auth headers |
| `frontend/src/utils/nostrAuth.ts` | Nostr event signing for admin auth |

---

## Troubleshooting

### "No Nostr extension found"

Install a NIP-07 compatible browser extension like [Alby](https://getalby.com/).

### Magic link expired

Magic links expire after 15 minutes. Request a new one from the login page.

### "Invalid signature" on admin auth

1. Ensure your system clock is accurate (within 5 minutes)
2. Try signing out and back into your Nostr extension
3. Check browser console for extension errors

### Email not received

1. Check spam/junk folder
2. Verify SMTP configuration is correct
3. Check backend logs for send errors:
   ```bash
   docker compose -f docker-compose.infra.yml -f docker-compose.app.yml logs backend | grep -i "magic link"
   ```
4. In development, ensure you're checking the backend logs for mock mode output
