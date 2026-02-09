# User Type Migration Plan

This plan enables admins to migrate users between user types while safely handling missing onboarding answers over time.

## Goals

- Allow admin-triggered user type migration without forcing immediate answer collection.
- Prompt users for missing required onboarding fields at next login/session.
- Support schema evolution when admins add new fields to existing user types.
- Keep onboarding completeness decisions server-authoritative.

## Core Principles

- Field definitions remain the source of truth for requiredness and scope.
- Completeness should be computed by backend using effective user type + global fields.
- Frontend routing should rely on backend onboarding status, not only local storage.
- Type-specific fields should override same-name global fields for effective prompts.

## API Contracts

## Phase 1 (Implemented)

### `GET /users/me/onboarding-status`

Purpose: Return canonical onboarding completeness for the authenticated user.

Auth:
- User-only endpoint. Uses `require_admin_or_user` for session validation (no
  standalone `require_user` dependency exists), then explicitly returns `403
  Forbidden` when the caller is an admin.

Response:

```json
{
  "user_id": 123,
  "user_type_id": 2,
  "effective_user_type_id": 2,
  "needs_user_type": false,
  "needs_onboarding": true,
  "total_fields": 5,
  "required_fields": 3,
  "completed_required_fields": 2,
  "missing_required_fields": [
    {
      "id": 44,
      "field_name": "license_number",
      "field_type": "text",
      "required": true,
      "display_order": 3,
      "user_type_id": 2,
      "placeholder": "Enter your license number",
      "options": null,
      "encryption_enabled": true,
      "include_in_chat": false,
      "created_at": "2026-02-08 17:00:00"
    }
  ],
  "missing_optional_fields": []
}
```

Rules:
- If multiple user types exist and user has no type selected, `needs_user_type=true`.
- If only one type exists and user type is null, that type is treated as effective.
- `needs_onboarding=true` when required answers are missing.
- Backward compatibility: optional-only schemas still return onboarding needed for users with zero prior answers.

## Phase 2 (Implemented - Backend)

### `POST /admin/users/{user_id}/migrate-type`

Purpose: Migrate one user to a new type.

Request:

```json
{
  "target_user_type_id": 5,
  "allow_incomplete": true,
  "reason": "Support role change"
}
```

Response:

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

Behavior:
- With `allow_incomplete=true`, migration succeeds even with missing required fields.
- With `allow_incomplete=false`, single-user migration returns `400` if required fields would be missing.
- User is prompted later via onboarding-status gate.

### `POST /admin/users/migrate-type/batch`

Purpose: Bulk migration with per-user results.

Request:

```json
{
  "user_ids": [101, 102, 103],
  "target_user_type_id": 5,
  "allow_incomplete": true
}
```

Response:

```json
{
  "success": true,
  "migrated": 3,
  "failed": 0,
  "results": [
    { "user_id": 101, "success": true, "missing_required_count": 1 },
    { "user_id": 102, "success": true, "missing_required_count": 2 },
    { "user_id": 103, "success": true, "missing_required_count": 0 }
  ]
}
```

Behavior:
- With `allow_incomplete=true`, users migrate and response includes each user's missing-required summary.
- With `allow_incomplete=false`, users with missing required fields are reported as failed in `results` and skipped.

## Phase 3 (Planned)

### `POST /users/me/onboarding-fields`

Purpose: Save only newly answered onboarding fields for current user.

Request:

```json
{
  "fields": {
    "license_number": "A12345",
    "practice_state": "CA"
  }
}
```

Response:

```json
{
  "success": true,
  "needs_onboarding": false,
  "missing_required_fields": []
}
```

Behavior:
- Partial writes allowed.
- Server validates only submitted fields + remaining required completeness.
- Existing answers are preserved.

## Rollout Order

1. Phase 1: Add backend onboarding-status endpoint and enforce it at chat entry.
2. Phase 2: Add admin migration endpoints with `allow_incomplete` behavior.
3. Phase 3: Update onboarding UI to render missing-only fields and submit partial updates.
4. Phase 4: Add audit log entries for type migration and optional bulk tooling in admin UI.

## Edge Cases Covered

- User type deleted while users still reference it:
  Require replacement type or block deletion when users exist.
- New required field added after users onboarded:
  Users are redirected to onboarding until missing required fields are answered.
- Multiple types with null `user_type_id`:
  Explicit user-type selection required before onboarding can complete.
- Global + type field with same name:
  Effective scope prefers type-specific definition.
