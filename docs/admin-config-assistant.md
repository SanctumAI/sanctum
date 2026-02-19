# Admin Configuration Assistant

This document describes the admin configuration assistant workflow used by:
- the admin-only configuration assistant bubble (bottom-right), and
- the full chat page (`/chat`) when the caller is an authenticated admin.

## Goals

- Provide an in-product, admin-only AI assistant for configuration questions.
- Give the assistant full awareness of current configuration state:
  - Instance settings
  - Deployment configuration (env-var backed keys stored in SQLite)
  - AI config (prompt sections, parameters, defaults), including per-user-type effective values
  - User types and onboarding field definitions
  - Document defaults (global + per-user-type effective values)
- Allow the assistant to propose and apply changes (with explicit confirmation).
- Keep tool behavior unified with the full chat page (`/chat`) so admins get the same tool pipeline from either entry point.
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
  - Secrets are NOT fetched and NOT sent to Maple unless the admin flips the "Share secret env vars" toggle.

Defense-in-depth:
- When secret sharing is enabled, the frontend keeps the revealed secret values locally and redacts any exact matches from rendered assistant messages (to prevent accidental echoing).

## Architecture

### Frontend

- Component: `frontend/src/components/admin/AdminConfigAssistant.tsx`
- Mounted for all admin pages in: `frontend/src/components/shared/AdminRoute.tsx`
- Full chat admin mode: `frontend/src/pages/ChatPage.tsx`
- Shares the same chat send runtime as `ChatPage`:
  - `frontend/src/utils/llmChat.ts` (`sendLlmChatWithUnifiedTools`)
- Transport: uses `POST /llm/chat` with:
  - `tools` (same admin-visible tool IDs as full chat: `web-search`, `db-query`, `admin-config`)
  - `admin-config` UI meta-tool toggle (enables/disables config snapshot context + change-set workflow)
  - `tool_context` (admin-only override) for the admin config snapshot
  - `client_executed_tools` (explicitly communicates any tools already run client-side)

Tool defaults:
- Reads `/session-defaults` and applies `web_search_enabled` default on load (same default source as full chat).
- In current frontend behavior, admin `/chat` uses this assistant pipeline (snapshot context + changeset review/apply) and does not use document-scope RAG mode.

Panel sizing:
- The bubble header includes an explicit `Expand` / `Compact` control.
- On admin setup/configuration routes, the bubble defaults to the larger size when opened.

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
- A change set may contain at most 50 requests.
- Requests are applied sequentially, one HTTP call at a time (not as a single database transaction). Partial apply is possible.
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

Note: Instance settings are updated via the single endpoint `PUT /admin/settings` (partial update supported). The backend does not expose per-key endpoints like `PUT /admin/settings/instance_name`.

### Normalization Rules (LLM Output Hardening)

Before allowlist validation, the frontend normalizes common LLM output drift:

- Coalesces `PUT /admin/settings/{key}` with body `{ "value": ... }` into a single `PUT /admin/settings` patch object.
- Normalizes `POST /admin/user-types` bodies (supports `order` alias -> `display_order`).
- Normalizes `POST /admin/user-fields` bodies (supports aliases like `name`/`label`, `type`, `order`, `includeInChat`, `userTypeId`).
- For `POST /admin/user-fields`, `options` must be a native JSON array (`["A","B"]`), not a JSON-encoded string (`"[\"A\",\"B\"]"`).
- Parses boolean-like values (`true/false`, `1/0`, `yes/no`) and integer-like values where supported.

### User Type Placeholders (Single Change Set)

Sometimes you want one change set to both create user types and then reference them (for fields, AI config overrides, or document defaults overrides) without guessing numeric IDs.

The admin assistant UI supports a placeholder token in paths and request bodies:

- `@type:<slug>`

Where `<slug>` is the slugified user type name, computed as:
1. Convert to lowercase
2. Replace each run of one or more non-alphanumeric characters with a single `_`
3. Trim any leading/trailing `_`

Examples:
- `"Bitcoin Designer"` → `bitcoin_designer`
- `"A & B Project"` → `a_b_project`
- `"  Spaced  "` → `spaced`

This placeholder is resolved client-side at apply time by looking at existing user types and the responses from `POST /admin/user-types`.

The placeholder may appear in:

- request path segments that require a user type id
- request bodies as `"user_type_id": "@type:<slug>"`

Example:

```json
{
  "version": 1,
  "summary": "Add a new user type and attach one onboarding field",
  "requests": [
    {
      "method": "POST",
      "path": "/admin/user-types",
      "body": { "name": "Bitcoin Designer", "description": "Design-focused users" }
    },
    {
      "method": "POST",
      "path": "/admin/user-fields",
      "body": {
        "field_name": "Portfolio URL",
        "field_type": "url",
        "user_type_id": "@type:bitcoin_designer",
        "required": false
      }
    }
  ]
}
```

Explicitly blocked:
- Secret reveal endpoints (`/reveal`)
- Config export endpoints (`/export`)
- Prompt preview endpoints (`/prompts/preview`)
- Generic tool execution (`/admin/tools/execute`)

## Operational Notes

- Secret sharing is intentionally not persisted (it resets when the assistant is closed).
- The assistant now shows the same tool toggles as full chat and uses the same backend endpoint/tool semantics.
- If a deployment key change requires restart, the assistant should mention it. The backend already tracks restart-required keys via `/admin/deployment/restart-required`.
- After applying a change set, the UI runs:
  - `POST /admin/deployment/config/validate`
  - `GET /admin/deployment/restart-required`
  and appends a short summary to the chat.

## Troubleshooting

### User-Field Create Reports `options ... list_type`

Error example:
- `POST /admin/user-fields: ... options Input should be a valid list [type=list_type, input_type=str]`

What to check:
- Ensure the request body uses a real JSON array for `options`, not a quoted JSON string.
- Confirm `field_type` is `select` when sending `options`.
- If the payload is already correct but the error persists, verify the backend is running a build that returns parsed field `options` arrays in create/update responses.

### Retry Then `Field name already exists for this type`

If a retry fails with duplicate field name after an earlier failure:
- Assume the earlier call may have persisted the row.
- Verify current state with `GET /admin/user-fields` (optionally filtered by `user_type_id`).
- Use `PUT /admin/user-fields/{field_id}` to correct metadata instead of re-POSTing the same field name.

## Quick Verification

Run the parity script to confirm full-chat and bubble payloads produce matching `tools_used` behavior:

```bash
python scripts/tests/TOOLS/test_4a_unified_chat_tools_parity.py --admin-token <ADMIN_TOKEN>
```
