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
- `email_blind_index` has a UNIQUE index to preserve unique email semantics

Normalization:
- `email.strip().lower()`

#### Blind Index Key Derivation

The `blind_index_key` is derived in `encryption.py` via `_get_blind_index_key()`:

```python
blind_index_key = SHA256("sanctum-blind-index:" + SECRET_KEY)
```

Properties:
- **Domain separation**: Prefix `"sanctum-blind-index:"` ensures this key is distinct from other uses of `SECRET_KEY`
- **Output**: 32-byte key suitable for HMAC-SHA256
- **Stability**: Key is cached for the process lifetime; changing `SECRET_KEY` invalidates all existing blind indexes

Note: This uses simple SHA-256 concatenation rather than a formal KDF (HKDF). For production hardening, consider migrating to HKDF with explicit salt and info parameters.

**Key rotation**: If `SECRET_KEY` changes, all `email_blind_index` values become invalid. To rotate:
1. Export all user emails (requires admin decryption)
2. Update `SECRET_KEY`
3. Re-compute blind indexes for all users via `migrate_encrypt_existing_data()`

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

### Why NIP-04?

**Rationale for choosing NIP-04:**
- **NIP-07 compatibility**: Direct integration with browser extensions (nos2x, Alby) via `window.nostr.nip04.decrypt()`
- **Implementation simplicity**: Well-understood AES-256-CBC with ECDH key agreement
- **Ecosystem interoperability**: Widely supported across Nostr clients and tools

**Alternatives considered:**
- **NIP-44**: Recommended replacement with versioning, padding, and HMAC. Rejected due to limited NIP-07 extension support at time of implementation.
- **NIP-59**: Gift-wrapped encrypted events. Overkill for database field encryption; designed for relay messaging.
- **libsodium sealed boxes**: Would require custom key management outside Nostr ecosystem.

### Threat Model and Accepted Risks

**NIP-04 limitations:**
- **No MAC/integrity**: Ciphertext is malleable; bit-flipping attacks possible
- **No authentication**: Cannot verify sender without additional signing
- **Deterministic IV position**: IV is visible in ciphertext format

**Accepted risks for this use case:**
- Database is trusted storage; we accept ciphertext integrity from DB layer
- Admin is sole decryptor; no sender authentication needed
- PII confidentiality is primary goal; integrity attacks require DB write access

**Mitigations in place:**
- Admin-only write access to PII tables
- Ephemeral keypairs per field prevent cross-field correlation
- Blind index uses HMAC (provides integrity for lookups)

### Future Migration to NIP-44

**Triggers for migration:**
- NIP-07 extensions widely support `nip44.decrypt()`
- Security audit requires authenticated encryption
- New deployment or major version bump

**Migration steps:**
1. Add `encryption_version` column to track NIP-04 vs NIP-44 rows
2. Implement `nip44_encrypt()` / `nip44_decrypt()` in `encryption.py`
3. New writes use NIP-44; reads check version and decrypt accordingly
4. Batch migration script to re-encrypt existing NIP-04 data
5. Remove NIP-04 code path after full migration

### General Limitations

- Ephemeral pubkeys are stored in DB alongside ciphertext.
- PII search is limited:
  - Email lookup uses blind index.
  - Name search is not supported.

## Operational Guidance

### Prerequisites

- Admin must authenticate via NIP-07 at least once.
- `SECRET_KEY` must be stable across restarts or blind index lookups will break.

### Verification Steps

1. Create admin (NIP-07).
2. Create user or update fields.
3. Inspect SQLite:
   - `encrypted_*` columns populated
   - `email`, `name`, `value` columns are NULL
4. Use admin UI to confirm decrypt works.

### Key Management

#### Admin Private Key (NIP-07)

**Critical**: Loss of the admin's Nostr private key means **permanent loss of all encrypted PII**. There is no recovery mechanism without the private key.

**Backup procedures:**
- Export nsec (bech32 private key) from your NIP-07 extension
- Store encrypted backup in a secure location (password manager, hardware security module, or offline storage)
- Never store nsec in plaintext on networked systems
- Test recovery by importing nsec to a fresh NIP-07 extension and verifying decryption works

**Rotation cadence:**
- Rotate admin keys annually or after suspected compromise
- Before rotation: ensure new admin is added and can decrypt existing data
- Key rotation requires re-encryption of all PII to the new admin pubkey

#### SECRET_KEY Management

`SECRET_KEY` (in `.env` or environment) is used for:
- JWT signing (auth tokens)
- Blind index key derivation

**Backup procedures:**
- Store `SECRET_KEY` in secure secrets management (Vault, AWS Secrets Manager, etc.)
- Document the value in encrypted offline backup
- Never commit to version control

**Rotation process:**
1. **Warning**: Rotating `SECRET_KEY` invalidates all blind indexes and active JWTs
2. Export all user data (requires admin decryption of emails)
3. Update `SECRET_KEY` in environment
4. Restart backend
5. Run `migrate_encrypt_existing_data()` to recompute blind indexes
6. Users will need to re-authenticate (JWTs invalidated)

### Multi-Admin Support

Current implementation uses the **first admin's pubkey** for all encryption. To support multiple admins:

**Adding admins:**
- Additional admins can be added via `/admin/admins` endpoint
- However, only the first admin can decrypt existing PII
- New admins can authenticate but cannot decrypt data encrypted to the original admin

**Future enhancement:**
- Re-encrypt PII to multiple admin pubkeys (one ciphertext per admin)
- Or use a shared admin key with secure key distribution

**Revoking admin access:**
- Remove admin from `admins` table
- If revoking the primary (first) admin: must first re-encrypt all PII to a new admin pubkey

### Emergency Access and Recovery

#### If the only admin is unavailable:

1. **Immediate**: No PII decryption is possible without the admin's private key
2. **If nsec backup exists**: Import to a NIP-07 extension and authenticate
3. **If no backup exists**: Encrypted PII is permanently inaccessible

#### Incident response checklist:

- [ ] Verify admin NIP-07 extension is accessible
- [ ] Test decryption of a known user record
- [ ] If compromised: rotate admin key and re-encrypt all PII
- [ ] If `SECRET_KEY` compromised: rotate and recompute blind indexes
- [ ] Document incident and update backup procedures

#### Trusted key escrow (optional):

For organizations requiring continuity:
- Split admin nsec using Shamir's Secret Sharing (e.g., 2-of-3 threshold)
- Store shares with separate trusted parties
- Document reconstruction procedure
- Test reconstruction annually

### Admin Key Migration

The admin key migration feature allows transferring encryption authority to a new Nostr keypair. This is useful when:
- Admin needs to rotate keys for security reasons
- Transferring admin responsibility to a different person
- Recovering from a potentially compromised key

#### Migration Process

1. **Preparation**: Backend returns all encrypted PII (emails, names, field values) with their ephemeral pubkeys
2. **Decryption**: Frontend decrypts each field using current admin's NIP-07 extension
3. **Authorization**: Admin signs a Nostr event (kind 22242, action: "admin_key_migration")
4. **Execution**: Backend re-encrypts all data to new admin pubkey in atomic transaction
5. **Cleanup**: Admin pubkey updated, session cleared, redirect to login

#### API Endpoints

- `GET /admin/key-migration/prepare` - Returns encrypted data for decryption
- `POST /admin/key-migration/execute` - Submits decrypted data with new pubkey

#### Security Properties

- **Atomic transaction**: All data migrated or none (no partial state)
- **Authorization required**: Signed Nostr event proves current admin consent
- **Audit logged**: Migration recorded with old/new pubkey timestamps
- **Session invalidated**: Must re-authenticate with new key

#### What Migrates vs What Doesn't

| Data | Migrates? | Notes |
| ---- | --------- | ----- |
| `encrypted_email` | Yes | Re-encrypted to new pubkey |
| `encrypted_name` | Yes | Re-encrypted to new pubkey |
| `encrypted_value` (fields) | Yes | Re-encrypted to new pubkey |
| `email_blind_index` | No | Derived from SECRET_KEY, unchanged |
| `admins.pubkey` | Yes | Updated to new pubkey |

#### Accessing the Migration UI

1. Log in as admin
2. Navigate to Admin → Deployment Configuration
3. Scroll to "Admin Key Migration" section
4. Click "Migrate to New Key"
5. Follow the multi-step wizard

## Reference Files

Backend:
- `backend/app/encryption.py`
- `backend/app/nostr_keys.py`
- `backend/app/database.py`
- `backend/app/main.py`
- `backend/app/key_migration.py` - Admin key migration endpoints

Frontend:
- `frontend/src/utils/encryption.ts`
- `frontend/src/utils/nostrKeys.ts`
- `frontend/src/pages/TestDashboard.tsx`
- `frontend/src/pages/AdminDatabaseExplorer.tsx`
