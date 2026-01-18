# SQLite Admin & User Management System

This document describes the SQLite-based admin and user management system in Sanctum.

> **See also:** [Authentication](./authentication.md) for detailed documentation on admin (Nostr NIP-07) and user (magic link email) authentication flows.

## Overview

SQLite provides persistent storage for:
- **Admin authentication** - Nostr pubkey-based admin access
- **Instance settings** - Configurable instance branding/settings
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
|--------|------|-------------|
| `id` | INTEGER | Primary key (auto-increment) |
| `pubkey` | TEXT | Unique Nostr pubkey |
| `created_at` | TIMESTAMP | Creation timestamp |

#### `instance_settings`
Key-value store for instance configuration.

| Column | Type | Description |
|--------|------|-------------|
| `key` | TEXT | Setting key (primary key) |
| `value` | TEXT | Setting value |
| `updated_at` | TIMESTAMP | Last update timestamp |

**Default settings:**
- `instance_name`: "Sanctum"
- `primary_color`: "#3B82F6"
- `description`: "A privacy-first RAG knowledge base"
- `auto_approve_users`: "true" - When "true", new users are automatically approved; when "false", users wait at `/pending` for admin approval

#### `user_types`
Groups of users with different onboarding question sets.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key (auto-increment) |
| `name` | TEXT | Unique type name (e.g., "researcher", "developer") |
| `description` | TEXT | Optional description |
| `display_order` | INTEGER | Order for UI display |
| `created_at` | TIMESTAMP | Creation timestamp |

#### `user_field_definitions`
Admin-defined custom fields for user onboarding.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key (auto-increment) |
| `field_name` | TEXT | Field identifier |
| `field_type` | TEXT | Field type (text, email, number, boolean, url) |
| `required` | INTEGER | 1 if required, 0 if optional |
| `display_order` | INTEGER | Order for UI display |
| `user_type_id` | INTEGER | NULL = global field, non-NULL = type-specific |
| `created_at` | TIMESTAMP | Creation timestamp |

**Note:** `field_name` + `user_type_id` must be unique. This allows the same field name to be used differently across user types.

#### `users`
Onboarded users.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key (auto-increment) |
| `pubkey` | TEXT | Optional Nostr pubkey (unique) |
| `email` | TEXT | User email address (unique) |
| `name` | TEXT | User display name |
| `user_type_id` | INTEGER | Foreign key to user_types |
| `approved` | INTEGER | 1=approved, 0=pending (default: per `auto_approve_users` setting) |
| `created_at` | TIMESTAMP | Creation timestamp |

#### `user_field_values`
Dynamic field values for users (EAV pattern).

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key (auto-increment) |
| `user_id` | INTEGER | Foreign key to users |
| `field_id` | INTEGER | Foreign key to user_field_definitions |
| `value` | TEXT | Field value |

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
Register or authenticate an admin by Nostr pubkey.

```bash
curl -X POST http://localhost:8000/admin/auth \
  -H "Content-Type: application/json" \
  -d '{"pubkey": "npub1..."}'
```

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
- `user_type_id`: Filter to specific type (includes global fields by default)
- `include_global`: Set to `false` to exclude global fields when filtering by type

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
|------|-------------|----------------|
| `text` | Single-line text | Text input |
| `email` | Email with validation | Email input |
| `number` | Numeric value | Number input |
| `textarea` | Multi-line text | Textarea |
| `select` | Dropdown selection | Select (requires options) |
| `checkbox` | Boolean toggle | Checkbox |
| `date` | Date value | Date picker |
| `url` | URL with validation | URL input |

#### `PUT /admin/user-fields/{field_id}`
Update a field definition.

#### `DELETE /admin/user-fields/{field_id}`
Delete a field definition (and all associated user values).

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
    "user_type_id": 1,
    "fields": {
      "email": "user@example.com",
      "institution": "MIT"
    }
  }'
```

**Validation:**
- Required fields (global + type-specific) must be provided
- Unknown fields are rejected
- Duplicate pubkeys are rejected

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

#### CRUD Endpoints
- `POST /admin/db/tables/{table_name}/rows` - Insert row
- `PUT /admin/db/tables/{table_name}/rows/{row_id}` - Update row
- `DELETE /admin/db/tables/{table_name}/rows/{row_id}` - Delete row

**Allowed tables:** `admins`, `instance_settings`, `user_types`, `user_field_definitions`, `users`, `user_field_values`

## Docker Configuration

SQLite data persists via Docker volume:

```yaml
# docker-compose.yml
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
    "user_type_id": 1,
    "fields": {
      "email": "jane@university.edu",
      "name": "Dr. Jane Smith",
      "institution": "MIT",
      "research_area": "Machine Learning"
    }
  }'

# 6. Onboard a developer
curl -X POST http://localhost:8000/users \
  -H "Content-Type: application/json" \
  -d '{
    "user_type_id": 2,
    "fields": {
      "email": "john@company.com",
      "name": "John Developer",
      "github_username": "johndev",
      "company": "Acme Corp"
    }
  }'
```

## Files

### Backend

| File | Description |
|------|-------------|
| `backend/app/database.py` | SQLite connection, schema, and CRUD operations |
| `backend/app/models.py` | Pydantic request/response models |
| `backend/app/seed.py` | Database initialization on startup |
| `backend/app/main.py` | API endpoint definitions |

### Frontend

| File | Description |
|------|-------------|
| `frontend/src/types/onboarding.ts` | TypeScript types, storage keys, helper functions |
| `frontend/src/pages/UserTypeSelection.tsx` | User type selection page |
| `frontend/src/pages/UserProfile.tsx` | Dynamic profile form based on fields |
| `frontend/src/pages/PendingApproval.tsx` | Waiting page for unapproved users |
| `frontend/src/pages/AdminSetup.tsx` | Admin configuration UI (types + fields) |
| `frontend/src/pages/AdminDatabaseExplorer.tsx` | SQLite database browser UI |
| `frontend/src/components/onboarding/FieldEditor.tsx` | Field creation/editing form |
| `frontend/src/components/onboarding/DynamicField.tsx` | Dynamic field renderer |

## Frontend Storage Keys

The frontend uses localStorage for temporary state during onboarding:

| Key | Description |
|-----|-------------|
| `sanctum_admin_pubkey` | Admin Nostr pubkey (after login) |
| `sanctum_session_token` | User session token (after magic link verification) |
| `sanctum_user_email` | Verified user email |
| `sanctum_user_name` | User display name |
| `sanctum_user_type_id` | Selected user type ID |
| `sanctum_user_profile` | Complete user profile (JSON) |
| `sanctum_pending_email` | Email awaiting verification |
| `sanctum_pending_name` | Name awaiting verification |

## Admin UI Features

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

### Database Explorer
- Browse all SQLite tables
- View paginated data with schema info
- Execute read-only SQL queries
- Insert/update/delete rows (admin only)

## Troubleshooting

### SQLite Schema Errors

**Error:** `no such column: user_type_id` (or similar)

**Cause:** The database schema in code changed, but the old SQLite database file persists. SQLite's `CREATE TABLE IF NOT EXISTS` doesn't modify existing tables.

**Solution:** Reset the SQLite volume to recreate the database with the new schema:

```bash
docker compose down
docker volume rm sanctum-rag-runtime_sqlite_data
docker compose up --build
```

> **Warning:** This deletes all data in the SQLite database (admins, users, settings, etc.)

### Backend Won't Start

If the backend container exits immediately or keeps restarting:

1. **Check logs:**
   ```bash
   docker compose logs backend --tail 50
   ```

2. **Common causes:**
   - SQLite schema mismatch (see above)
   - Import errors in `database.py` or `models.py`
   - Missing dependencies

3. **Verify dependencies are healthy:**
   ```bash
   docker compose ps
   # All dependencies should show "healthy" status
   ```

### CORS Errors in Browser

If you see CORS errors like "CORS request did not succeed" with `Status code: (null)`:

**This is NOT a CORS configuration issue.** The `(null)` status code means the request never reached the backend.

**Check:**
1. Is the backend running? `docker compose ps`
2. Can you reach the backend directly? `curl http://localhost:8000/health`
3. Check backend logs for errors: `docker compose logs backend`

The backend CORS middleware is configured to allow all origins (`allow_origins=["*"]`). If the backend is running, CORS should work.
