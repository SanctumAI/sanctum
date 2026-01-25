# Encrypted SQLite Data Model (NIP-04)

This document describes how Sanctum encrypts PII in SQLite using Nostr NIP-04 and NIP-07.

Scope:
- Data at rest: SQLite fields for user PII are encrypted.
- Write path: backend encrypts with an ephemeral keypair to the admin pubkey.
- Read path: admin frontend decrypts via NIP-07 (`window.nostr.nip04.decrypt`).
- No plaintext storage for PII once an admin is configured.

## Design Goals

- Encrypt PII in SQLite at rest.
- Keep queries/joins working by leaving IDs and foreign keys unencrypted.
- Allow admin-only decryption in the UI via NIP-07.
- Preserve email lookup via a blind index.
- Reject onboarding until an admin pubkey exists.

## NIP-04 Encryption Details

NIP-04 format:
- `ciphertext = base64(encrypted_bytes) + "?iv=" + base64(iv)`
- AES-256-CBC with a 16-byte IV

Key agreement:
- ECDH using secp256k1.
- Only the X coordinate of the shared point is used as the AES key.
- Keys are **x-only** pubkeys (32-byte hex, no prefix).

Ephemeral keys:
- Each encrypted field uses a fresh ephemeral keypair.
- The ephemeral pubkey is stored alongside the ciphertext to enable decryption.

## Key Formats and Normalization

All pubkeys are stored in **32-byte hex (x-only)** format.

Inputs accepted:
- `npub...` (bech32) -> decoded to x-only hex
- `hex` (64 chars)

Normalization utilities:
- Backend: `backend/app/nostr_keys.py` (`normalize_pubkey`)
- Frontend: `frontend/src/utils/nostrKeys.ts` (`normalizePubkey`)

If a pubkey is invalid or not decodable, the request is rejected.

## Database Schema Changes

### users

Encrypted fields:
- `encrypted_email` (TEXT)
- `ephemeral_pubkey_email` (TEXT)
- `email_blind_index` (TEXT, **UNIQUE**)
- `encrypted_name` (TEXT)
- `ephemeral_pubkey_name` (TEXT)

Legacy columns (kept for migration only, now forced to NULL):
- `email` (TEXT)
- `name` (TEXT)

### user_field_values

Encrypted fields:
- `encrypted_value` (TEXT)
- `ephemeral_pubkey` (TEXT)

Legacy column (kept for migration only, now forced to NULL):
- `value` (TEXT)

### Blind Index (Email)

To preserve email lookup:
- `email_blind_index = HMAC-SHA256(normalized_email, blind_index_key)`
- `blind_index_key` is derived from `SECRET_KEY` in `auth.py`
- `email_blind_index` has a UNIQUE index to preserve unique email semantics

Normalization:
- `email.strip().lower()`

## Write Path (Encryption)

All PII writes are encrypted immediately:

1. Admin pubkey must exist (instance configured).
2. Backend generates ephemeral keypair.
3. Compute shared secret with admin pubkey.
4. AES-256-CBC encrypt and store ciphertext + ephemeral pubkey.
5. Clear plaintext columns.

Primary write surfaces:
- `database.create_user` (email, name)
- `database.set_user_field(s)` (dynamic fields)
- Admin DB explorer row insert/update

DB explorer encryption is enforced in:
- `backend/app/main.py` `_encrypt_row_for_write()`

If a write attempts to store plaintext in PII columns, it is either:
- Encrypted automatically (if using `email`, `name`, `value` inputs), or
- Rejected if encrypted columns are provided without required ephemeral pubkeys.

## Read Path (Decryption)

Backend returns encrypted blobs:
- `encrypted_email`, `encrypted_name`
- `fields_encrypted`

Frontend decrypts in admin UI via NIP-07:
- `window.nostr.nip04.decrypt(ephemeral_pubkey, ciphertext)`

Admin UI surfaces:
- Test Dashboard user list is decrypted on load.
- If decryption is unavailable, UI shows `[Encrypted]`.

DB Explorer:
- Decrypts `encrypted_*` columns via NIP-07 (`window.nostr.nip04.decrypt`).
- Column headers show `fieldname 🔓` for encrypted fields.
- `ephemeral_pubkey_*` columns are hidden from display.
- Shows `[Decrypting...]` during async decryption.
- Shows `[Encrypted]` if decryption fails or NIP-07 unavailable.

Admin Chat (db-query tool):
- Default tool path returns encrypted values (ciphertext + ephemeral keys).
- If the admin has NIP-07, the frontend can decrypt results client-side and send a decrypted tool context to `/llm/chat`.
- This keeps private keys in the browser while allowing the LLM to use plaintext for that request.
- The `/query` (RAG) endpoint does not execute tools; db-query runs via `/llm/chat`.
- If decryption fails (missing key or no NIP-07), the frontend falls back to the encrypted tool path.
- Raw tool results for this flow are fetched via `/admin/tools/execute` (admin-only).

## Pre-Admin Onboarding Gate

Onboarding is blocked until an admin exists:
- `/auth/magic-link`
- `/auth/verify`
- `/users`

If no admin pubkey exists, these return `503 Instance not configured`.

## Dynamic Field Serialization

All dynamic fields are serialized before encryption:
- `string` -> as-is
- `boolean` -> `"true"` / `"false"`
- `number` -> string form (no formatting)

Unsupported types are rejected.

## Migration for Legacy Data

`database.migrate_encrypt_existing_data()` is available for older deployments where plaintext was stored. It:
- Encrypts any non-null `email`, `name`, `value` where encrypted columns are empty.
- Clears plaintext columns after encryption.
- Populates `email_blind_index`.

Important:
- If duplicate emails exist, the UNIQUE blind index will fail.
- Run after cleaning duplicates or merge conflicts manually.

## Security Notes and Limitations

- NIP-04 is **confidentiality-only** (no MAC/integrity).
- NIP-04 is marked "unrecommended" by Nostr, but accepted for this project.
- Ephemeral pubkeys are stored in DB alongside ciphertext.
- PII search is limited:
  - Email lookup uses blind index.
  - Name search is not supported.

## Operational Guidance

Prereqs:
- Admin must authenticate via NIP-07 at least once.
- `SECRET_KEY` must be stable across restarts or blind index lookups will break.

Verification steps:
1. Create admin (NIP-07).
2. Create user or update fields.
3. Inspect SQLite:
   - `encrypted_*` columns populated
   - `email`, `name`, `value` columns are NULL
4. Use admin UI to confirm decrypt works.

## Reference Files

Backend:
- `backend/app/encryption.py`
- `backend/app/nostr_keys.py`
- `backend/app/database.py`
- `backend/app/main.py`

Frontend:
- `frontend/src/utils/encryption.ts`
- `frontend/src/utils/nostrKeys.ts`
- `frontend/src/pages/TestDashboard.tsx`
- `frontend/src/pages/AdminDatabaseExplorer.tsx`
