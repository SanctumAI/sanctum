# Admin Configuration Assistant

This document describes the admin-only "Configuration Assistant" chat bubble (bottom-right) that helps an authenticated admin understand and modify Sanctum configuration.

## Goals

- Provide an in-product, admin-only AI assistant for configuration questions.
- Give the assistant full awareness of current configuration state:
  - Instance settings
  - Deployment configuration (env-var backed keys stored in SQLite)
  - AI config (prompt sections, parameters, defaults), including per-user-type effective values
  - User types and onboarding field definitions
  - Document defaults (global + per-user-type effective values)
- Allow the assistant to propose and apply changes (with explicit confirmation).
- Keep secret environment variables opt-in:
  - By default, secrets are not included in the assistant context.
  - An admin can explicitly toggle secret sharing per session.

## Security Model

### NIP-07 Admin Key

The admin's Nostr private key (`nsec`) is custodied by the browser extension via NIP-07 and is not accessible to the application or the assistant. The assistant should never request it.

### Secret Environment Variables

- Deployment config secrets are stored encrypted at rest in SQLite (`deployment_config`) and are masked in list endpoints.
- The admin UI can reveal a secret value with:
  - `GET /admin/deployment/config/{key}/reveal`
- The assistant bubble follows a strict rule:
  - Secrets are NOT fetched and NOT sent to the LLM provider unless the admin flips the "Share secret env vars" toggle.

Defense-in-depth:
- When secret sharing is enabled, the frontend keeps the revealed secret values locally and redacts any exact matches from rendered assistant messages (to prevent accidental echoing).

## Architecture

### Frontend

- Component: `frontend/src/components/admin/AdminConfigAssistant.tsx`
- Mounted for all admin pages in: `frontend/src/components/shared/AdminRoute.tsx`
- Transport: uses `POST /llm/chat` with `tool_context` (admin-only override) to inject an "Admin Config Snapshot" into the prompt.

### Context Snapshot Contents

On each send (and on manual refresh), the assistant builds a snapshot from:

- Instance settings:
  - `GET /admin/settings`
- Deployment config (masked secrets):
  - `GET /admin/deployment/config`
- Optional service health:
  - `GET /admin/deployment/health`
- AI config:
  - `GET /admin/ai-config`
  - `GET /admin/ai-config/user-type/{user_type_id}` for each user type
- User types + fields:
  - `GET /admin/user-types`
  - `GET /admin/user-fields?user_type_id={user_type_id}` for each user type
- Document defaults:
  - `GET /ingest/admin/documents/defaults`
  - `GET /ingest/admin/documents/defaults/user-type/{user_type_id}` for each user type

If secret sharing is enabled, it additionally fetches:

- For every deployment config item with `is_secret=true`:
  - `GET /admin/deployment/config/{key}/reveal`

### Change Application (Confirm-Then-Apply)

The assistant can propose changes by including exactly one JSON code block with this shape:

```json
{
  "version": 1,
  "summary": "One sentence summary of what will change",
  "requests": [
    {
      "method": "PUT",
      "path": "/admin/deployment/config/LLM_PROVIDER",
      "body": { "value": "maple" }
    }
  ]
}
```

The frontend validates the change set with an allowlist (methods + path prefixes), displays a masked preview for secret deployment keys, and only applies the changes if the admin clicks **Apply**.

Additional safety rules:

- Exactly one valid change set must be present. If the assistant outputs multiple code blocks that look like change sets, the UI treats it as ambiguous and refuses to apply.
- A change set may contain at most 25 requests.
- Certain high-risk endpoints are always blocked (even if they match a prefix), including:
  - `/admin/deployment/config/*/reveal`
  - `/admin/deployment/config/export`
  - `/prompts/preview`
  - `/admin/tools/execute`

Allowed mutation targets include:

- Deployment config: `PUT /admin/deployment/config/{key}`
- Instance settings: `PUT /admin/settings`
- AI config: `PUT /admin/ai-config/{key}`, `PUT /admin/ai-config/user-type/{id}/{key}`
- User types: `POST/PUT/DELETE /admin/user-types...`
- User fields: `POST/PUT/DELETE /admin/user-fields...`
- Document defaults: `PUT/DELETE /ingest/admin/documents/...`

Explicitly blocked:
- Secret reveal endpoints (`/reveal`)
- Config export endpoints (`/export`)
- Prompt preview endpoints (`/prompts/preview`)
- Generic tool execution (`/admin/tools/execute`)

## Operational Notes

- Secret sharing is intentionally not persisted (it resets when the assistant is closed).
- If a deployment key change requires restart, the assistant should mention it. The backend already tracks restart-required keys via `/admin/deployment/restart-required`.
- After applying a change set, the UI runs:
  - `POST /admin/deployment/config/validate`
  - `GET /admin/deployment/restart-required`
  and appends a short summary to the chat.
