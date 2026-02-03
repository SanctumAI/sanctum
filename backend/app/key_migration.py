"""
Sanctum Admin Key Migration Module
Handles migration of admin private key by re-encrypting all user PII.
"""

import logging
import time
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import database
import auth
from nostr import verify_event_signature, AUTH_EVENT_KIND, MAX_EVENT_AGE_SECONDS
from models import NostrEvent, SuccessResponse
from encryption import nip04_encrypt

logger = logging.getLogger("sanctum.key_migration")

router = APIRouter(prefix="/admin/key-migration", tags=["key-migration"])


# --- Request/Response Models ---

class EncryptedUserData(BaseModel):
    """Encrypted data for a single user"""
    id: int
    encrypted_email: Optional[str] = None
    ephemeral_pubkey_email: Optional[str] = None
    encrypted_name: Optional[str] = None
    ephemeral_pubkey_name: Optional[str] = None


class EncryptedFieldValue(BaseModel):
    """Encrypted data for a single field value"""
    id: int
    user_id: int
    field_id: int
    encrypted_value: Optional[str] = None
    ephemeral_pubkey: Optional[str] = None


class MigrationPrepareResponse(BaseModel):
    """Response from prepare endpoint with all encrypted data"""
    admin_pubkey: str
    users: list[EncryptedUserData]
    field_values: list[EncryptedFieldValue]
    user_count: int
    field_value_count: int


class DecryptedUserData(BaseModel):
    """Decrypted data for a single user"""
    id: int
    email: Optional[str] = None
    name: Optional[str] = None


class DecryptedFieldValue(BaseModel):
    """Decrypted data for a single field value"""
    id: int
    value: Optional[str] = None


class MigrationExecuteRequest(BaseModel):
    """Request to execute migration with decrypted data"""
    new_admin_pubkey: str
    users: list[DecryptedUserData]
    field_values: list[DecryptedFieldValue]
    signature_event: NostrEvent


class MigrationExecuteResponse(BaseModel):
    """Response from execute endpoint"""
    success: bool
    message: str
    users_migrated: int
    field_values_migrated: int


# --- Helper Functions ---

def validate_pubkey_format(pubkey: str) -> bool:
    """Validate pubkey is 64-character hex string"""
    if len(pubkey) != 64:
        return False
    try:
        bytes.fromhex(pubkey)
        return True
    except ValueError:
        return False


def verify_migration_authorization(event: NostrEvent, current_admin_pubkey: str) -> tuple[bool, str]:
    """
    Verify that the migration is authorized by the current admin.

    Checks:
    1. Event is signed by current admin
    2. Event kind is AUTH_EVENT_KIND (22242)
    3. Timestamp is within MAX_EVENT_AGE_SECONDS
    4. Has action tag = "admin_key_migration"
    5. Signature is valid
    """
    event_dict = event.model_dump()

    # Check pubkey matches current admin
    if event_dict.get("pubkey") != current_admin_pubkey:
        return False, "Event not signed by current admin"

    # Check event kind
    if event_dict.get("kind") != AUTH_EVENT_KIND:
        return False, f"Invalid event kind: expected {AUTH_EVENT_KIND}"

    # Check timestamp (prevent replay attacks)
    now = int(time.time())
    created_at = event_dict.get("created_at", 0)
    age = abs(now - created_at)
    if age > MAX_EVENT_AGE_SECONDS:
        return False, f"Event timestamp out of range: {age}s old (max {MAX_EVENT_AGE_SECONDS}s)"

    # Check action tag
    tags = event_dict.get("tags", [])
    action_tag = None
    for tag in tags:
        if len(tag) >= 2 and tag[0] == "action":
            action_tag = tag[1]
            break

    if action_tag != "admin_key_migration":
        return False, f"Invalid action tag: expected 'admin_key_migration', got '{action_tag}'"

    # Verify signature
    if not verify_event_signature(event_dict):
        return False, "Invalid signature"

    return True, ""


# --- Endpoints ---

@router.get("/prepare", response_model=MigrationPrepareResponse)
async def prepare_migration(admin: dict = Depends(auth.require_admin)) -> MigrationPrepareResponse:
    """
    Prepare for key migration by returning all encrypted data.

    The frontend will use NIP-07 to decrypt this data, then submit it back
    to the execute endpoint along with the new admin pubkey.
    """
    conn = database.get_connection()
    cursor = conn.cursor()

    try:
        # Get current admin pubkey
        admin_pubkey = admin.get("pubkey")
        if not admin_pubkey:
            raise HTTPException(status_code=500, detail="Admin pubkey not found")

        # Get all users with encrypted data
        cursor.execute("""
            SELECT id, encrypted_email, ephemeral_pubkey_email,
                   encrypted_name, ephemeral_pubkey_name
            FROM users
            WHERE encrypted_email IS NOT NULL OR encrypted_name IS NOT NULL
        """)

        users = []
        for row in cursor.fetchall():
            users.append(EncryptedUserData(
                id=row[0],
                encrypted_email=row[1],
                ephemeral_pubkey_email=row[2],
                encrypted_name=row[3],
                ephemeral_pubkey_name=row[4],
            ))

        # Get all encrypted field values
        cursor.execute("""
            SELECT id, user_id, field_id, encrypted_value, ephemeral_pubkey
            FROM user_field_values
            WHERE encrypted_value IS NOT NULL
        """)

        field_values = []
        for row in cursor.fetchall():
            field_values.append(EncryptedFieldValue(
                id=row[0],
                user_id=row[1],
                field_id=row[2],
                encrypted_value=row[3],
                ephemeral_pubkey=row[4],
            ))

        return MigrationPrepareResponse(
            admin_pubkey=admin_pubkey,
            users=users,
            field_values=field_values,
            user_count=len(users),
            field_value_count=len(field_values),
        )

    finally:
        cursor.close()


@router.post("/execute", response_model=MigrationExecuteResponse)
async def execute_migration(
    request: MigrationExecuteRequest,
    admin: dict = Depends(auth.require_admin)
) -> MigrationExecuteResponse:
    """
    Execute key migration by re-encrypting all data to the new admin pubkey.

    This is an atomic operation - either all data is migrated or none.
    """
    current_admin_pubkey = admin.get("pubkey")
    if not current_admin_pubkey:
        raise HTTPException(status_code=500, detail="Current admin pubkey not found")

    # Validate new pubkey format
    new_pubkey = request.new_admin_pubkey
    if not validate_pubkey_format(new_pubkey):
        raise HTTPException(
            status_code=400,
            detail="Invalid new pubkey format: expected 64-character hex string"
        )

    # Prevent migrating to same key
    if new_pubkey == current_admin_pubkey:
        raise HTTPException(
            status_code=400,
            detail="New pubkey must be different from current admin pubkey"
        )

    # Verify authorization
    valid, error = verify_migration_authorization(
        request.signature_event,
        current_admin_pubkey
    )
    if not valid:
        raise HTTPException(status_code=401, detail=f"Authorization failed: {error}")

    conn = database.get_connection()
    cursor = conn.cursor()

    users_migrated = 0
    field_values_migrated = 0

    try:
        # Start transaction
        cursor.execute("BEGIN EXCLUSIVE TRANSACTION")

        # Validate all records are included to prevent partial migration
        # Fetch actual IDs and per-field encryption flags from database
        cursor.execute("""
            SELECT id,
                   encrypted_email IS NOT NULL AS has_email,
                   encrypted_name IS NOT NULL AS has_name
            FROM users
            WHERE encrypted_email IS NOT NULL OR encrypted_name IS NOT NULL
        """)
        user_rows = cursor.fetchall()
        expected_user_ids = {row[0] for row in user_rows}
        # Track which fields each user has encrypted
        user_encrypted_fields = {
            row[0]: {"has_email": bool(row[1]), "has_name": bool(row[2])}
            for row in user_rows
        }

        cursor.execute("""
            SELECT id, encrypted_value IS NOT NULL AS has_value
            FROM user_field_values
            WHERE encrypted_value IS NOT NULL
        """)
        field_rows = cursor.fetchall()
        expected_field_ids = {row[0] for row in field_rows}
        # Track which field values have encryption
        field_has_value = {row[0]: bool(row[1]) for row in field_rows}

        # Check for duplicates in request
        request_user_ids = [u.id for u in request.users]
        request_field_ids = [f.id for f in request.field_values]

        if len(request_user_ids) != len(set(request_user_ids)):
            raise HTTPException(
                status_code=400,
                detail="Duplicate user IDs in request. Each user must appear exactly once."
            )
        if len(request_field_ids) != len(set(request_field_ids)):
            raise HTTPException(
                status_code=400,
                detail="Duplicate field value IDs in request. Each field value must appear exactly once."
            )

        request_user_ids_set = set(request_user_ids)
        request_field_ids_set = set(request_field_ids)

        # Check for missing or extra IDs
        missing_users = expected_user_ids - request_user_ids_set
        extra_users = request_user_ids_set - expected_user_ids
        if missing_users or extra_users:
            detail_parts = []
            if missing_users:
                detail_parts.append(f"missing user IDs: {sorted(missing_users)}")
            if extra_users:
                detail_parts.append(f"extra user IDs: {sorted(extra_users)}")
            raise HTTPException(
                status_code=400,
                detail=f"User ID mismatch: {'; '.join(detail_parts)}. All users with encrypted data must be included."
            )

        missing_fields = expected_field_ids - request_field_ids_set
        extra_fields = request_field_ids_set - expected_field_ids
        if missing_fields or extra_fields:
            detail_parts = []
            if missing_fields:
                detail_parts.append(f"missing field IDs: {sorted(missing_fields)}")
            if extra_fields:
                detail_parts.append(f"extra field IDs: {sorted(extra_fields)}")
            raise HTTPException(
                status_code=400,
                detail=f"Field value ID mismatch: {'; '.join(detail_parts)}. All encrypted field values must be included."
            )

        # Validate plaintexts are provided for all encrypted data
        # This prevents leaving old ciphertext encrypted under the old key
        missing_plaintexts = []

        # Build lookup for request data
        request_users_by_id = {u.id: u for u in request.users}
        request_fields_by_id = {f.id: f for f in request.field_values}

        # Check users have required plaintexts
        for user_id, flags in user_encrypted_fields.items():
            user_data = request_users_by_id.get(user_id)
            if user_data:
                if flags["has_email"] and user_data.email is None:
                    missing_plaintexts.append(f"user {user_id}: missing email plaintext")
                if flags["has_name"] and user_data.name is None:
                    missing_plaintexts.append(f"user {user_id}: missing name plaintext")

        # Check field values have required plaintexts
        for field_id, has_value in field_has_value.items():
            field_data = request_fields_by_id.get(field_id)
            if field_data and has_value and field_data.value is None:
                missing_plaintexts.append(f"field value {field_id}: missing value plaintext")

        if missing_plaintexts:
            raise HTTPException(
                status_code=400,
                detail=f"Plaintext data missing for encrypted records (would leave old ciphertext undecryptable): {missing_plaintexts}"
            )

        # Re-encrypt users
        for user_data in request.users:
            updates = []
            values = []

            # Re-encrypt email if provided
            if user_data.email is not None:
                encrypted_email, ephemeral_pubkey_email = nip04_encrypt(
                    user_data.email,
                    new_pubkey
                )
                updates.extend([
                    "encrypted_email = ?",
                    "ephemeral_pubkey_email = ?"
                ])
                values.extend([encrypted_email, ephemeral_pubkey_email])

            # Re-encrypt name if provided
            if user_data.name is not None:
                encrypted_name, ephemeral_pubkey_name = nip04_encrypt(
                    user_data.name,
                    new_pubkey
                )
                updates.extend([
                    "encrypted_name = ?",
                    "ephemeral_pubkey_name = ?"
                ])
                values.extend([encrypted_name, ephemeral_pubkey_name])

            if updates:
                values.append(user_data.id)
                cursor.execute(
                    f"UPDATE users SET {', '.join(updates)} WHERE id = ?",
                    values
                )
                if cursor.rowcount > 0:
                    users_migrated += 1

        # Re-encrypt field values
        for field_data in request.field_values:
            if field_data.value is not None:
                encrypted_value, ephemeral_pubkey = nip04_encrypt(
                    field_data.value,
                    new_pubkey
                )
                cursor.execute(
                    """UPDATE user_field_values
                       SET encrypted_value = ?, ephemeral_pubkey = ?
                       WHERE id = ?""",
                    (encrypted_value, ephemeral_pubkey, field_data.id)
                )
                if cursor.rowcount > 0:
                    field_values_migrated += 1

        # Update admin pubkey
        cursor.execute(
            "UPDATE admins SET pubkey = ? WHERE id = ?",
            (new_pubkey, admin["id"])
        )

        if cursor.rowcount == 0:
            raise HTTPException(status_code=500, detail="Failed to update admin pubkey")

        # Log the migration in audit log
        cursor.execute("""
            INSERT INTO config_audit_log
            (table_name, config_key, old_value, new_value, changed_by)
            VALUES (?, ?, ?, ?, ?)
        """, (
            "admins",
            "admin_key_migration",
            current_admin_pubkey[:16] + "...",  # Truncate for log
            new_pubkey[:16] + "...",
            f"admin:{current_admin_pubkey[:16]}"
        ))

        # Commit transaction
        conn.commit()

        logger.info(
            f"Admin key migration completed: {users_migrated} users, "
            f"{field_values_migrated} field values migrated. "
            f"Old admin: {current_admin_pubkey[:16]}..., "
            f"New admin: {new_pubkey[:16]}..."
        )

        return MigrationExecuteResponse(
            success=True,
            message="Migration completed successfully",
            users_migrated=users_migrated,
            field_values_migrated=field_values_migrated,
        )

    except HTTPException:
        conn.rollback()
        raise

    except Exception as e:
        conn.rollback()
        logger.error(f"Key migration failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Migration failed due to an internal error"
        )

    finally:
        cursor.close()
