# Admin Key Recovery and Migration Runbook

Last updated: 2026-02-08
Audience: Sanctum instance administrator

## Purpose

This runbook defines:
- how to back up admin key material safely
- what to do if the admin key is lost or suspected compromised
- how to run repeatable key migration drills

This complements technical notes in `docs/sqlite-encryption.md`.

## Critical Facts

- Encrypted PII in Sanctum requires the admin private key (Nostr `nsec`) for decryption.
- If the admin private key is permanently lost and no backup exists, encrypted PII is unrecoverable.
- Secret-at-rest encryption in `deployment_config` depends on stable `SECRET_KEY`; losing that key can also break config secret decryption.

## Required Backups

Maintain at least two secure, independent backup locations for:

1. Admin Nostr private key (`nsec`)
2. `SECRET_KEY` used by backend
3. SQLite data volume (`sanctum.db`)

Minimum policy:
- encrypted password manager + offline encrypted copy (for example hardware token or encrypted external drive)
- quarterly restore validation

## Incident Response

### Scenario A: Key lost, backup exists

1. Import backed-up `nsec` into trusted NIP-07 extension.
2. Authenticate as admin in Sanctum.
3. Validate decryption works for encrypted user fields.
4. If compromise is suspected, immediately run key migration to a new keypair.

### Scenario B: Key suspected compromised

1. Review access logs for unauthorized activity during the suspected compromise window.
2. Determine if encrypted data was potentially accessed.
3. Preserve forensic evidence (logs, database snapshots) before making changes.
4. Generate a new admin keypair in a trusted wallet/extension.
5. Run key migration from old key to new key.
6. Re-authenticate with new key and verify user-field decryption.
7. Securely destroy old key material (note: Nostr keys cannot be revoked from the network).
8. If user data may have been exposed, notify affected users per applicable policy.
9. Record incident details and timestamps.

### Scenario C: Key lost, no backup

1. Declare encrypted PII data unrecoverable.
2. Export what non-encrypted operational data is still accessible.
3. Notify stakeholders per policy.
4. Reinitialize admin key and require users to re-enter sensitive onboarding data.

## Key Migration Drill (Quarterly)

Run against staging (or an isolated clone of production data).

Prerequisites:
- backend running at `http://localhost:8000`
- seeded test data with encrypted user fields

Commands:

```bash
cd scripts/tests/AUTH
python test_3a_key_migration_prepare.py --api-base http://localhost:8000
python test_3b_key_migration_execute.py --api-base http://localhost:8000
python test_3c_auth_hardening_regression.py --api-base http://localhost:8000
python test_3d_phase3_config_integrity.py --api-base http://localhost:8000
```

Drill passes when:
- migration prepare and execute tests pass
- encrypted PII remains decryptable with new admin key
- auth hardening regression remains green
- deployment-config secret/audit integrity regression remains green

## Evidence to Record

For each drill or incident, store:
- date/time (UTC)
- operator identity
- environment (staging/prod clone)
- test command outputs
- verification screenshots or logs
- follow-up actions

## Production Safety Rules

- Never run key migration first in production.
- Run drill in staging before production rotation.
- Take a database backup immediately before production migration.
- Confirm `SECRET_KEY` continuity before restart/deploy.
