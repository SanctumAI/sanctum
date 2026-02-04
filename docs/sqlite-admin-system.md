# SQLite Admin & User Management System

This document describes the SQLite-based admin and user management system in Sanctum.

> **See also:** [Authentication](./authentication.md) for detailed documentation on admin (Nostr NIP-07) and user (magic link email) authentication flows.
> **See also:** [Encrypted SQLite Data Model (NIP-04)](./sqlite-encryption.md) for the full encryption design and updated schema details.

## Overview

SQLite provides persistent storage for:
- **Admin authentication** - Nostr pubkey-based admin access
- **Instance settings** - Configurable instance branding/settings
- **Instance state** - Setup completion and admin initialization flags
- **Deployment configuration** - Environment-level settings (LLM, email, storage) + audit log
- **AI configuration** - Prompt sections, parameters, and session defaults (with per-user-type overrides)
- **Document defaults** - Per-document availability/defaults (with per-user-type overrides)
- **User types** - Groups of users with different onboarding question sets
- **User management** - Onboarded users with dynamic custom fields

## User Onboarding Flow

```
┌─────────┐    ┌─────────┐    ┌──────────┐
│  /login │ -> │  /auth  │ -> │ /verify  │
└─────────┘    └─────────┘    └────┬─────┘
   Language       Email           │
   Selection    Magic Link        │
                                  │
         ┌────────────────────────┴────────────────────────┐
         │                                                 │
         v                                                 v
   ┌───────────┐                              ┌─────────────────┐
   │ /pending  │  (if approved = false)       │   /user-type    │  (if approved = true)
   │  Waiting  │                              └────────┬────────┘
   └───────────┘                                       │
                                                       v
                                              ┌─────────────────┐
                                              │    /profile     │
                                              └────────┬────────┘
                                                       │
                                                       v
                                              ┌─────────────────┐
                                              │     /chat       │
                                              └─────────────────┘

* /user-type: only shown if >1 types exist, otherwise auto-selected
* /profile: only shown if custom fields exist for the user's type
* /pending: shown when user.approved = false (controlled by auto_approve_users setting)
```

### Conditional Flow Logic

1. **User Type Selection** (`/user-type`)
   - **0 types configured**: Skip entirely, proceed to `/profile`
   - **1 type configured**: Auto-select that type, skip to `/profile`
   - **2+ types configured**: Show type selector UI

2. **Profile Fields** (`/profile`)
   - **0 fields for user's type**: Skip to `/chat`
   - **1+ fields**: Show field form, then proceed to `/chat`

## Database Schema

### Tables

#### `admins`
Stores admin Nostr pubkeys for authentication.

| Column | Type | Description |
| -------- | ------ | ------------- |
| `id` | INTEGER | Primary key (auto-increment) |
| `pubkey` | TEXT | Unique Nostr pubkey |
| `created_at` | TIMESTAMP | Creation timestamp |

#### `instance_settings`
Key-value store for instance configuration.

| Column | Type | Description |
| -------- | ------ | ------------- |
| `key` | TEXT | Setting key (primary key) |
| `value` | TEXT | Setting value |
| `updated_at` | TIMESTAMP | Last update timestamp |

**Default settings:**
- `instance_name`: "Sanctum"
- `primary_color`: "#3B82F6"
- `description`: "A privacy-first RAG knowledge base"
- `auto_approve_users`: "true" - When "true", new users are automatically approved; when "false", users wait at `/pending` for admin approval

#### `instance_state`
Tracks setup status flags used to gate user onboarding.

| Column | Type | Description |
| -------- | ------ | ------------- |
| `key` | TEXT | Setting key (primary key) |
| `value` | TEXT | Setting value (`"true"` / `"false"`) |
| `updated_at` | TIMESTAMP | Last update timestamp |

**Keys:**
- `admin_initialized`: Set to `"true"` after the first admin is created
- `setup_complete`: Set to `"true"` after the admin successfully authenticates

User auth endpoints require both flags to be `"true"` (see `docs/authentication.md`).

#### `user_types`
Groups of users with different onboarding question sets.

| Column | Type | Description |
| -------- | ------ | ------------- |
| `id` | INTEGER | Primary key (auto-increment) |
| `name` | TEXT | Unique type name (e.g., "researcher", "developer") |
| `description` | TEXT | Optional description |
| `display_order` | INTEGER | Order for UI display |
| `created_at` | TIMESTAMP | Creation timestamp |

#### `user_field_definitions`
Admin-defined custom fields for user onboarding.

| Column | Type | Description |
| -------- | ------ | ------------- |
| `id` | INTEGER | Primary key (auto-increment) |
| `field_name` | TEXT | Field identifier |
| `field_type` | TEXT | Field type (text, email, number, boolean, url) |
| `required` | INTEGER | 1 if required, 0 if optional |
| `display_order` | INTEGER | Order for UI display |
| `user_type_id` | INTEGER | NULL = global field, non-NULL = type-specific |
| `placeholder` | TEXT | Optional placeholder text for UI inputs |
| `options` | TEXT | JSON array of options (used by `select` fields) |
| `encryption_enabled` | INTEGER | 1 = encrypt values (default), 0 = store plaintext |
| `include_in_chat` | INTEGER | 1 = include plaintext value in chat context, 0 = exclude |
| `created_at` | TIMESTAMP | Creation timestamp |

**Note:** `field_name` + `user_type_id` must be unique. This allows the same field name to be used differently across user types.

**Encryption note:** Fields are encrypted by default. `include_in_chat` can only be enabled for fields with `encryption_enabled = 0` (plaintext), since encrypted values require the admin private key to decrypt.

#### `users`
Onboarded users.

| Column | Type | Description |
| -------- | ------ | ------------- |
| `id` | INTEGER | Primary key (auto-increment) |
| `pubkey` | TEXT | Optional Nostr pubkey (unique) |
| `encrypted_email` | TEXT | NIP-04 encrypted email |
| `ephemeral_pubkey_email` | TEXT | Ephemeral key for email decryption |
| `email_blind_index` | TEXT | HMAC hash for email lookups (UNIQUE) |
| `encrypted_name` | TEXT | NIP-04 encrypted name |
| `ephemeral_pubkey_name` | TEXT | Ephemeral key for name decryption |
| `email` | TEXT | **Legacy** (deprecated, always NULL) |
| `name` | TEXT | **Legacy** (deprecated, always NULL) |
| `user_type_id` | INTEGER | Foreign key to user_types |
| `approved` | INTEGER | 1=approved, 0=pending (default: per `auto_approve_users` setting) |
| `created_at` | TIMESTAMP | Creation timestamp |

#### `user_field_values`
Dynamic field values for users (EAV pattern).

| Column | Type | Description |
| -------- | ------ | ------------- |
| `id` | INTEGER | Primary key (auto-increment) |
| `user_id` | INTEGER | Foreign key to users |
| `field_id` | INTEGER | Foreign key to user_field_definitions |
| `encrypted_value` | TEXT | NIP-04 encrypted field value |
| `ephemeral_pubkey` | TEXT | Ephemeral key for decryption |
| `value` | TEXT | **Legacy** (deprecated, always NULL) |

#### `ai_config`
Global AI configuration values (prompt sections, parameters, defaults).

| Column | Type | Description |
| -------- | ------ | ------------- |
| `id` | INTEGER | Primary key (auto-increment) |
| `key` | TEXT | Unique config key (e.g., `prompt_tone`, `temperature`) |
| `value` | TEXT | Stored value (stringified for JSON/number/boolean) |
| `value_type` | TEXT | `string`, `number`, `boolean`, or `json` |
| `category` | TEXT | `prompt_section`, `parameter`, or `default` |
| `description` | TEXT | Human-readable description |
| `updated_at` | TIMESTAMP | Last update timestamp |

#### `ai_config_user_type_overrides`
Per-user-type overrides for AI config values.

| Column | Type | Description |
| -------- | ------ | ------------- |
| `id` | INTEGER | Primary key (auto-increment) |
| `ai_config_key` | TEXT | Config key being overridden |
| `user_type_id` | INTEGER | Foreign key to user_types |
| `value` | TEXT | Override value |
| `updated_at` | TIMESTAMP | Last update timestamp |

#### `document_defaults`
Global document availability and default state for ingest jobs.

| Column | Type | Description |
| -------- | ------ | ------------- |
| `id` | INTEGER | Primary key (auto-increment) |
| `job_id` | TEXT | Unique ingest job id |
| `is_available` | INTEGER | 1 = available for use, 0 = hidden |
| `is_default_active` | INTEGER | 1 = enabled by default for new sessions |
| `display_order` | INTEGER | Order for UI display |
| `updated_at` | TIMESTAMP | Last update timestamp |

#### `document_defaults_user_type_overrides`
Per-user-type overrides for document defaults.

| Column | Type | Description |
| -------- | ------ | ------------- |
| `id` | INTEGER | Primary key (auto-increment) |
| `job_id` | TEXT | Ingest job id |
| `user_type_id` | INTEGER | Foreign key to user_types |
| `is_available` | INTEGER | Override availability (nullable) |
| `is_default_active` | INTEGER | Override default-active state (nullable) |
| `updated_at` | TIMESTAMP | Last update timestamp |

#### `deployment_config`
Deployment-level configuration values (LLM, email, storage, etc.).

| Column | Type | Description |
| -------- | ------ | ------------- |
| `id` | INTEGER | Primary key (auto-increment) |
| `key` | TEXT | Unique config key |
| `value` | TEXT | Value (masked in API responses if secret) |
| `is_secret` | INTEGER | 1 = secret, 0 = visible |
| `requires_restart` | INTEGER | 1 = restart required to apply |
| `category` | TEXT | Grouping (llm, email, storage, etc.) |
| `description` | TEXT | Human-readable description |
| `updated_at` | TIMESTAMP | Last update timestamp |

#### `config_audit_log`
Audit trail for deployment and AI config changes.

| Column | Type | Description |
| -------- | ------ | ------------- |
| `id` | INTEGER | Primary key (auto-increment) |
| `table_name` | TEXT | Source table (`deployment_config`, `ai_config`, `document_defaults`) |
| `config_key` | TEXT | Key or job_id that changed |
| `old_value` | TEXT | Previous value |
| `new_value` | TEXT | New value |
| `changed_by` | TEXT | Admin pubkey that made the change |
| `changed_at` | TIMESTAMP | Change timestamp |

## Field Scoping

Fields can be **global** or **type-specific**:

- **Global fields** (`user_type_id = NULL`): Shown for all user types
- **Type-specific fields** (`user_type_id = <id>`): Only shown for that user type

When fetching fields for a user type, the system returns:
1. All global fields
2. Type-specific fields for that type

## API Endpoints

### Admin Authentication

#### `POST /admin/auth`
Register or authenticate the admin using a signed Nostr event (kind `22242`).
Only the **first** admin to authenticate can register; subsequent attempts are rejected.

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

See [Authentication](./authentication.md) for the full event format and validation rules.

#### `GET /admin/list`
List all registered admins.

#### `DELETE /admin/{pubkey}`
Remove an admin by pubkey.

---

### Instance Settings

#### `GET /admin/settings`
Get all instance settings.

#### `PUT /admin/settings`
Update instance settings (partial update supported).

```bash
curl -X PUT http://localhost:8000/admin/settings \
  -H "Content-Type: application/json" \
  -d '{"instance_name": "My Sanctum", "primary_color": "#FF5733"}'
```

---

### Deployment Configuration (Admin)

Manage environment-level settings through the admin API. Values are stored in `deployment_config` and audited.

#### `GET /admin/deployment/config`
Get all deployment config values grouped by category (secret values masked).

#### `GET /admin/deployment/config/{key}`
Get a single config value (masked if secret).

#### `GET /admin/deployment/config/{key}/reveal`
Reveal a secret value (admin only).

#### `PUT /admin/deployment/config/{key}`
Update a config value. Returns `requires_restart` if a restart is needed.

#### `GET /admin/deployment/config/export`
Export current config as `.env`-style text (includes secrets).

#### `POST /admin/deployment/config/validate`
Validate config and return errors/warnings (e.g., missing SMTP, invalid ports).

#### `GET /admin/deployment/health`
Health check for Qdrant/LLM/SearXNG/SMTP plus restart requirement.

#### `GET /admin/deployment/restart-required`
List keys changed since service start that require restart.

#### `GET /admin/deployment/audit-log`
Recent config changes (default 50, up to 1000).

**Common keys:** `LLM_PROVIDER`, `LLM_API_URL`, `LLM_MODEL`, `EMBEDDING_MODEL`, `SMTP_*`, `MOCK_SMTP` (deployment UI alias for `MOCK_EMAIL`; `MOCK_EMAIL` takes precedence if both are set), `SQLITE_PATH`, `UPLOADS_DIR`, `QDRANT_HOST`, `QDRANT_PORT`, `SEARXNG_URL`, `FRONTEND_URL`, `RAG_TOP_K`, `PDF_EXTRACT_MODE`.

---

### AI Configuration (Admin)

Manage prompt sections, LLM parameters, and session defaults stored in `ai_config`, with optional per-user-type overrides.

#### `GET /admin/ai-config`
Get all AI config values grouped by category.

#### `GET /admin/ai-config/{key}`
Get a single AI config item.

#### `PUT /admin/ai-config/{key}`
Update a config value (type-checked).

#### `GET /admin/ai-config/user-type/{user_type_id}`
Get effective AI config for a user type (shows overrides vs inherited values).

#### `PUT /admin/ai-config/user-type/{user_type_id}/{key}`
Set an override value for a user type.

#### `DELETE /admin/ai-config/user-type/{user_type_id}/{key}`
Remove an override (revert to global default).

#### `POST /admin/ai-config/prompts/preview`
Preview the assembled prompt using global config.

#### `POST /admin/ai-config/user-type/{user_type_id}/prompts/preview`
Preview the assembled prompt with user-type overrides applied.

---

### User Types

#### `GET /user-types` (Public)
List all user types. Used by frontend during onboarding to determine if type selection is needed.

```bash
curl http://localhost:8000/user-types
```

**Response:**
```json
{
  "types": [
    {"id": 1, "name": "researcher", "description": "Academic researchers", "display_order": 0},
    {"id": 2, "name": "developer", "description": "Software developers", "display_order": 1}
  ]
}
```

#### `GET /admin/user-types`
List all user types (admin endpoint, same response).

#### `POST /admin/user-types`
Create a new user type.

```bash
curl -X POST http://localhost:8000/admin/user-types \
  -H "Content-Type: application/json" \
  -d '{"name": "researcher", "description": "Academic researchers"}'
```

#### `PUT /admin/user-types/{type_id}`
Update a user type.

#### `DELETE /admin/user-types/{type_id}`
Delete a user type (cascades to type-specific field definitions).

---

### User Field Definitions

#### `GET /admin/user-fields`
Get all user field definitions.

**Query params:**
- `user_type_id`: Optional. When provided, returns global fields plus fields for that type.

#### `POST /admin/user-fields`
Create a new user field definition.

```bash
# Global field (shown for all types)
curl -X POST http://localhost:8000/admin/user-fields \
  -H "Content-Type: application/json" \
  -d '{"field_name": "email", "field_type": "email", "required": true}'

# Type-specific field
curl -X POST http://localhost:8000/admin/user-fields \
  -H "Content-Type: application/json" \
  -d '{"field_name": "institution", "field_type": "text", "user_type_id": 1}'
```

**Field types:**
| Type | Description | Frontend Input |
| ------ | ------------- | ---------------- |
| `text` | Single-line text | Text input |
| `email` | Email with validation | Email input |
| `number` | Numeric value | Number input |
| `textarea` | Multi-line text | Textarea |
| `select` | Dropdown selection | Select (requires options) |
| `checkbox` | Boolean toggle | Checkbox |
| `date` | Date value | Date picker |
| `url` | URL with validation | URL input |

**Field metadata:**
- `placeholder`: Optional placeholder text for inputs
- `options`: Required for `select` fields (array of strings)
- `encryption_enabled`: Defaults to `true` (encrypt values at rest)
- `include_in_chat`: Defaults to `false`; only allowed when `encryption_enabled = false`

#### `PUT /admin/user-fields/{field_id}`
Update a field definition.

#### `DELETE /admin/user-fields/{field_id}`
Delete a field definition (and all associated user values).

#### `PUT /admin/user-fields/{field_id}/encryption`
Update encryption settings for a field definition.

**Notes:**
- Disabling encryption stores future values as plaintext (existing encrypted values remain encrypted)
- Enabling encryption encrypts future values (existing plaintext remains plaintext)
- Enabling encryption auto-disables `include_in_chat`
- Pass `force=true` to acknowledge warnings

---

### User Management

#### `GET /admin/users`
List all users with their field values.

#### `POST /users`
Create/onboard a new user.

```bash
curl -X POST http://localhost:8000/users \
  -H "Content-Type: application/json" \
  -d '{
    "pubkey": "npub1user...",
    "email": "user@example.com",
    "name": "John Doe",
    "user_type_id": 1,
    "fields": {
      "institution": "MIT"
    }
  }'
```

**Parameters:**
- `pubkey`: Optional Nostr public key (npub or hex)
- `email`: Optional email address — send as **plaintext**; server encrypts it (stored in `encrypted_email`) and computes a blind index for lookups
- `name`: Optional name — send as **plaintext**; server encrypts it (stored in `encrypted_name`)
- `user_type_id`: Optional ID of the user type
- `fields`: Dynamic fields defined by admin for the user type — send values as **plaintext**; server encrypts each (stored in `encrypted_value`)

**Validation:**
- Required fields (global + type-specific) must be provided
- Unknown fields are rejected
- Duplicate pubkeys are rejected
- Duplicate emails are rejected (via blind index)

#### `GET /users/{user_id}`
Get a user by ID with all field values.

#### `PUT /users/{user_id}`
Update a user's field values.

**Note on User Approval:**
This endpoint can also update the `approved` field to manually approve/reject users:
```bash
curl -X PUT http://localhost:8000/users/1 \
  -H "Content-Type: application/json" \
  -d '{"approved": true}'
```

> There is currently no dedicated `/admin/users/{id}/approve` endpoint. See [security-hardening.md](./security-hardening.md) for planned improvements.

#### `DELETE /users/{user_id}`
Delete a user and all their field values.

---

### Document Defaults (Admin)

Control which completed ingest jobs are available and enabled by default for new sessions.

#### `GET /admin/documents/defaults`
List all completed documents with default availability/active flags.

#### `PUT /admin/documents/{job_id}/defaults`
Update defaults for a single document (`is_available`, `is_default_active`, `display_order`).

#### `PUT /admin/documents/defaults/batch`
Batch update defaults for multiple documents.

#### `GET /admin/documents/defaults/available`
Get all job_ids currently available.

#### `GET /admin/documents/defaults/active`
Get all job_ids active by default for new sessions.

#### User-type overrides
- `GET /admin/documents/defaults/user-type/{user_type_id}`
- `PUT /admin/documents/{job_id}/defaults/user-type/{user_type_id}`
- `DELETE /admin/documents/{job_id}/defaults/user-type/{user_type_id}`
- `GET /admin/documents/defaults/user-type/{user_type_id}/active`

User-type overrides take precedence over global defaults.

---

### Database Explorer (Admin)

Direct database access for admin debugging/management.

#### `GET /admin/db/tables`
List all tables with schema and row counts.

#### `GET /admin/db/tables/{table_name}`
Get paginated table data.

**Query params:**
- `page` (default: 1)
- `page_size` (default: 50, max: 500)

#### `GET /admin/db/tables/{table_name}/schema`
Get table schema without data.

#### `POST /admin/db/query`
Execute a read-only SQL query (SELECT only).

```bash
curl -X POST http://localhost:8000/admin/db/query \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM users WHERE user_type_id = 1"}'
```

**Encryption note:** This endpoint returns encrypted columns (`encrypted_*`) and their matching `ephemeral_pubkey_*` values. Decryption happens client-side in admin UIs via NIP-07. For the admin chat tool (`db-query`), see `docs/tools.md` for the `/admin/tools/execute` + `tool_context` flow.

#### CRUD Endpoints
- `POST /admin/db/tables/{table_name}/rows` - Insert row
- `PUT /admin/db/tables/{table_name}/rows/{row_id}` - Update row
- `DELETE /admin/db/tables/{table_name}/rows/{row_id}` - Delete row

**Allowed tables:** `admins`, `instance_settings`, `user_types`, `user_field_definitions`, `users`, `user_field_values`

## Docker Configuration

SQLite data persists via Docker volume:

```yaml
# docker-compose.app.yml
services:
  backend:
    environment:
      - SQLITE_PATH=/data/sanctum.db
    volumes:
      - sqlite_data:/data

volumes:
  sqlite_data:
```

## Usage Example: Multi-Type User Onboarding

```bash
# 1. Create user types
curl -X POST http://localhost:8000/admin/user-types \
  -H "Content-Type: application/json" \
  -d '{"name": "researcher", "description": "Academic researchers"}'

curl -X POST http://localhost:8000/admin/user-types \
  -H "Content-Type: application/json" \
  -d '{"name": "developer", "description": "Software developers"}'

# 2. Create global fields (all types)
curl -X POST http://localhost:8000/admin/user-fields \
  -H "Content-Type: application/json" \
  -d '{"field_name": "email", "field_type": "email", "required": true}'

curl -X POST http://localhost:8000/admin/user-fields \
  -H "Content-Type: application/json" \
  -d '{"field_name": "name", "field_type": "text", "required": true}'

# 3. Create researcher-specific fields
curl -X POST http://localhost:8000/admin/user-fields \
  -H "Content-Type: application/json" \
  -d '{"field_name": "institution", "field_type": "text", "required": true, "user_type_id": 1}'

curl -X POST http://localhost:8000/admin/user-fields \
  -H "Content-Type: application/json" \
  -d '{"field_name": "research_area", "field_type": "text", "user_type_id": 1}'

# 4. Create developer-specific fields
curl -X POST http://localhost:8000/admin/user-fields \
  -H "Content-Type: application/json" \
  -d '{"field_name": "github_username", "field_type": "text", "user_type_id": 2}'

curl -X POST http://localhost:8000/admin/user-fields \
  -H "Content-Type: application/json" \
  -d '{"field_name": "company", "field_type": "text", "user_type_id": 2}'

# 5. Onboard a researcher
curl -X POST http://localhost:8000/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane@university.edu",
    "name": "Dr. Jane Smith",
    "user_type_id": 1,
    "fields": {
      "institution": "MIT",
      "research_area": "Machine Learning"
    }
  }'

# 6. Onboard a developer
curl -X POST http://localhost:8000/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@company.com",
    "name": "John Developer",
    "user_type_id": 2,
    "fields": {
      "github_username": "johndev",
      "company": "Acme Corp"
    }
  }'
```

## Files

### Backend

| File | Description |
| ------ | ------------- |
| `backend/app/database.py` | SQLite connection, schema, and CRUD operations |
| `backend/app/models.py` | Pydantic request/response models |
| `backend/app/seed.py` | Database initialization on startup |
| `backend/app/main.py` | API endpoint definitions |
| `backend/app/encryption.py` | NIP-04 encryption, ECDH, blind index |
| `backend/app/nostr_keys.py` | Pubkey normalization (npub/hex) |

### Frontend

| File | Description |
| ------ | ------------- |
| `frontend/src/types/onboarding.ts` | TypeScript types, storage keys, helper functions |
| `frontend/src/pages/UserTypeSelection.tsx` | User type selection page |
| `frontend/src/pages/UserProfile.tsx` | Dynamic profile form based on fields |
| `frontend/src/pages/PendingApproval.tsx` | Waiting page for unapproved users |
| `frontend/src/pages/AdminSetup.tsx` | Admin configuration UI (types + fields) |
| `frontend/src/pages/AdminInstanceConfig.tsx` | Instance settings (name, branding, approvals) |
| `frontend/src/pages/AdminAIConfig.tsx` | AI prompt/parameter configuration |
| `frontend/src/pages/AdminDeploymentConfig.tsx` | Deployment config + service health |
| `frontend/src/pages/AdminDocumentUpload.tsx` | Document upload + defaults management |
| `frontend/src/pages/AdminDatabaseExplorer.tsx` | SQLite database browser UI (with encryption support) |
| `frontend/src/components/onboarding/FieldEditor.tsx` | Field creation/editing form |
| `frontend/src/components/onboarding/DynamicField.tsx` | Dynamic field renderer |
| `frontend/src/utils/encryption.ts` | NIP-07 decryption utilities |
| `frontend/src/utils/nostrKeys.ts` | Pubkey normalization |

## Frontend Storage Keys

The frontend uses localStorage for temporary state during onboarding:

| Key | Description |
| ----- | ------------- |
| `sanctum_admin_pubkey` | Admin Nostr pubkey (after login) |
| `sanctum_admin_session_token` | Admin session token (after NIP-07 auth) |
| `sanctum_session_token` | User session token (after magic link verification) |
| `sanctum_user_email` | Verified user email |
| `sanctum_user_name` | User display name |
| `sanctum_user_type_id` | Selected user type ID |
| `sanctum_user_profile` | Complete user profile (JSON) |
| `sanctum_pending_email` | Email awaiting verification |
| `sanctum_pending_name` | Name awaiting verification |

## Admin UI Features

### Instance Settings
- Edit instance name, branding color, and description
- Toggle auto-approve for new users

### Deployment Configuration
- Update LLM, email, storage, and search settings
- Validate config and check service health
- Export `.env` and review recent config changes

### AI Configuration
- Edit prompt sections, LLM parameters, and session defaults
- Preview assembled prompts
- Override AI config per user type

### User Types Section
- Create new user types with name and description
- Delete user types (cascades to associated field definitions)
- View all configured types

### User Fields Section
- Add fields with type, name, required flag
- Assign fields to specific user types or "Global" (all types)
- Edit existing fields
- Reorder fields (display order)
- Delete fields

### Document Defaults
- Upload documents and monitor ingest jobs
- Set availability and default-active status
- Configure per-user-type document overrides

### Database Explorer
- Browse all SQLite tables
- View paginated data with schema info
- Execute read-only SQL queries
- Insert/update/delete rows (admin only)

**Encryption handling:**
- Encrypted columns (`encrypted_*`) are decrypted client-side via NIP-07
- Column headers display as `fieldname 🔓` for encrypted fields
- `ephemeral_pubkey_*` columns are hidden from the table view
- Requires admin's Nostr wallet extension (e.g., Alby, nos2x) for decryption

## Troubleshooting

### SQLite Schema Errors

**Error:** `no such column: user_type_id` (or similar)

**Cause:** The database schema in code changed, but the old SQLite database file persists. SQLite's `CREATE TABLE IF NOT EXISTS` doesn't modify existing tables.

**Solution:** Reset the SQLite volume to recreate the database with the new schema:

```bash
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml down
docker volume rm sanctum-rag-runtime_sqlite_data
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml up --build
```

> **Warning:** This deletes all data in the SQLite database (admins, users, settings, etc.)

### Backend Won't Start

If the backend container exits immediately or keeps restarting:

1. **Check logs:**
   ```bash
   docker compose -f docker-compose.infra.yml -f docker-compose.app.yml logs backend --tail 50
   ```

2. **Common causes:**
   - SQLite schema mismatch (see above)
   - Import errors in `database.py` or `models.py`
   - Missing dependencies

3. **Verify dependencies are healthy:**
   ```bash
   docker compose -f docker-compose.infra.yml -f docker-compose.app.yml ps
   # All dependencies should show "healthy" status
   ```

### CORS Errors in Browser

If you see CORS errors like "CORS request did not succeed" with `Status code: (null)`:

**This is NOT a CORS configuration issue.** The `(null)` status code means the request never reached the backend.

**Check:**
1. Is the backend running? `docker compose -f docker-compose.infra.yml -f docker-compose.app.yml ps`
2. Can you reach the backend directly? `curl http://localhost:8000/health`
3. Check backend logs for errors: `docker compose -f docker-compose.infra.yml -f docker-compose.app.yml logs backend`

The backend CORS middleware is configured to allow all origins (`allow_origins=["*"]`). If the backend is running, CORS should work.
