# User Type Migration

User types in Sanctum control:
- which onboarding fields a user is expected to answer (global + type-specific fields)
- which AI config and document defaults apply (via per-user-type overrides)

User type migration is the admin workflow for moving existing users from one user type to another without deleting their account.

## Terminology

- **Admin vs user "role"**: "admin" is authentication/authorization (NIP-07) and is unrelated to **user types**.
- **User type**: a row in `user_types`. A user points at it via `users.user_type_id`.
- **Global field**: `user_field_definitions.user_type_id = NULL` (applies to all types).
- **Type-specific field**: `user_field_definitions.user_type_id = <type id>` (applies only to that type).
- **Effective field definitions**: when both a global field and a type-specific field share the same `field_name`, the type-specific definition wins.

## What Migration Does (And Doesn't)

What it does today:
- Updates `users.user_type_id` to the target type.
- Computes which **required** onboarding fields would be missing after the change and returns them in the response.
- Optionally blocks the migration if required fields would be missing (`allow_incomplete=false`).

What it does not do today:
- It does not "convert" or copy field values between fields that have different `field_name`s.
- It does not delete existing `user_field_values`. Values remain stored and can become "inactive" simply because their field definition is no longer effective for the user's new type.
- It does not write an audit log entry (planned).
- The request `reason` field is accepted in the plan doc, but the current backend endpoint ignores it.

## How Onboarding Enforcement Works After Migration

The backend is the source of truth for whether a user must choose a type or fill onboarding fields:
- `GET /users/me/onboarding-status` returns:
  - `needs_user_type`: true when multiple types exist and the user has no type selected
  - `needs_onboarding`: true when required fields are missing (or when the schema is optional-only and the user has never answered anything)
  - `effective_user_type_id`: the type used for evaluation (when only one type exists, a null `users.user_type_id` is treated as that single type)

The frontend chat entry (`/chat`) calls `/users/me/onboarding-status` and redirects:
- `needs_user_type=true` -> `/user-type`
- `needs_onboarding=true` -> `/profile`

The frontend also overwrites `localStorage.sanctum_user_type_id` with `effective_user_type_id` from the server to keep the client cache aligned.

## Preflight Checklist (Before You Migrate Users)

1. Confirm the target user type exists and is spelled correctly (types are referred to by numeric id).
2. Review required fields for the target type:
   - If you don't want users to be interrupted, avoid introducing new required fields until you can backfill them.
   - Alternatively, run migrations with `allow_incomplete=true` and accept that users will be sent to `/profile` on next visit.
3. If you are using the same concept across types, prefer keeping the same `field_name` so values remain applicable.
   - Example: keep `organization` as `organization` across types (don't rename to `institution` unless you intend to collect it again).

## Admin UI Workflow

UI location: `http://localhost:5173/admin/users`

In the **User Type Migration** section:
1. Choose the source filter:
   - "All users"
   - "No type selected" (useful to clean up legacy/untyped users)
   - A specific type id/name
2. Choose the target type.
3. Choose whether to **Allow incomplete migration**.
4. Migrate:
   - Click "Migrate" for a single user, or
   - Select multiple users and click "Migrate selected"

After each migration, the UI displays the number of missing required fields and (when available) the missing field names.

## API Workflow (curl)

All endpoints below require admin auth:
- Header: `Authorization: Bearer <admin-session-token>`

### Single-user migration

`POST /admin/users/{user_id}/migrate-type`

```bash
curl -X POST "http://localhost:8000/admin/users/123/migrate-type" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "target_user_type_id": 5,
    "allow_incomplete": true
  }'
```

Success response:
```json
{
  "success": true,
  "user_id": 123,
  "previous_user_type_id": 2,
  "target_user_type_id": 5,
  "missing_required_count": 2,
  "missing_required_fields": ["license_number", "practice_state"]
}
```

Error behavior:
- `400` if `target_user_type_id` does not exist
- `404` if the user does not exist
- `400` if required fields would be missing and `allow_incomplete=false`

### Batch migration

`POST /admin/users/migrate-type/batch`

```bash
curl -X POST "http://localhost:8000/admin/users/migrate-type/batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "user_ids": [101, 102, 103],
    "target_user_type_id": 5,
    "allow_incomplete": true
  }'
```

Notes:
- `user_ids` are deduplicated server-side while preserving order.
- With `allow_incomplete=false`, users who would be missing required fields are skipped and reported as failed.
- The top-level `success` is `true` only when `failed == 0`.

## Common Migration Strategies

### A. Cleaning up "untyped" users

Use the admin UI filter "No type selected" and migrate those users to the intended default type. This is the most common migration after enabling multiple user types on an existing instance.

### B. Introducing a new required field safely

If you want to avoid blocking users:
1. Add the field as optional.
2. Migrate users to the new type as needed.
3. Backfill values over time (manual admin outreach, controlled onboarding).
4. Flip the field to required once a sufficient portion of the user base has completed it.

### C. Renaming fields across types

Avoid renaming `field_name` unless you are intentionally forcing recollection.
- Migration does not map `old_field_name` -> `new_field_name`.
- If you need a mapping, do it as a one-off data migration at the database layer (and be careful with encrypted field values).

## Implementation References (Code)

- Onboarding status and effective-field resolution:
  - `backend/app/main.py` (`GET /users/me/onboarding-status`)
  - `backend/app/main.py` (`_resolve_effective_field_definitions`, `_build_onboarding_status`)
- Migration endpoints:
  - `backend/app/main.py` (`POST /admin/users/{user_id}/migrate-type`)
  - `backend/app/main.py` (`POST /admin/users/migrate-type/batch`)
- Frontend routing enforcement:
  - `frontend/src/pages/ChatPage.tsx` (redirects based on `/users/me/onboarding-status`)
  - `frontend/src/pages/AdminUserConfig.tsx` (admin UI for migration)
