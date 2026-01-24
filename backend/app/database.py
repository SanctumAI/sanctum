"""
Sanctum Database Module
Handles SQLite connection and schema for user/admin management.
"""

import os
import sqlite3
import logging
from contextlib import contextmanager
from datetime import datetime

# Configure logging
logger = logging.getLogger("sanctum.database")

# Configuration
SQLITE_PATH = os.getenv("SQLITE_PATH", "/data/sanctum.db")

# Lazy-loaded connection
_connection = None


def get_connection():
    """Get or create SQLite connection"""
    global _connection
    if _connection is None:
        # Ensure directory exists
        db_dir = os.path.dirname(SQLITE_PATH)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)

        _connection = sqlite3.connect(SQLITE_PATH, check_same_thread=False)
        _connection.row_factory = sqlite3.Row  # Enable dict-like access
        _connection.execute("PRAGMA foreign_keys = ON")  # Enable FK constraints
        logger.info(f"Connected to SQLite database: {SQLITE_PATH}")
    return _connection


@contextmanager
def get_cursor():
    """Context manager for database cursor with auto-commit"""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        yield cursor
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cursor.close()


def init_schema():
    """Initialize database schema"""
    conn = get_connection()
    cursor = conn.cursor()

    # Admins table - stores Nostr pubkeys
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pubkey TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Instance settings - key-value store for admin configuration
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS instance_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # User types - groups of users with different question sets
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT,
            display_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # User field definitions - admin-defined custom fields for users
    # user_type_id: NULL = global field (shown for all types), non-NULL = type-specific
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_field_definitions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            field_name TEXT NOT NULL,
            field_type TEXT NOT NULL,
            required INTEGER DEFAULT 0,
            display_order INTEGER DEFAULT 0,
            user_type_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_type_id) REFERENCES user_types(id) ON DELETE CASCADE,
            UNIQUE(field_name, user_type_id)
        )
    """)

    # Users table
    # Note: email and name are encrypted using NIP-04
    # - encrypted_email/encrypted_name: NIP-04 ciphertext
    # - ephemeral_pubkey_email/name: pubkey for decryption
    # - email_blind_index: HMAC hash for email lookups
    # Original email/name columns kept for migration (will be removed later)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pubkey TEXT UNIQUE,
            email TEXT,
            name TEXT,
            encrypted_email TEXT,
            ephemeral_pubkey_email TEXT,
            email_blind_index TEXT,
            encrypted_name TEXT,
            ephemeral_pubkey_name TEXT,
            user_type_id INTEGER,
            approved INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_type_id) REFERENCES user_types(id)
        )
    """)

    # User field values - dynamic field storage (EAV pattern)
    # Note: values are encrypted using NIP-04
    # - encrypted_value: NIP-04 ciphertext
    # - ephemeral_pubkey: pubkey for decryption
    # Original value column kept for migration (will be removed later)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_field_values (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            field_id INTEGER NOT NULL,
            value TEXT,
            encrypted_value TEXT,
            ephemeral_pubkey TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (field_id) REFERENCES user_field_definitions(id) ON DELETE CASCADE,
            UNIQUE(user_id, field_id)
        )
    """)

    # Create indexes for performance
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_field_values_user ON user_field_values(user_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_field_values_field ON user_field_values(field_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_field_definitions_type ON user_field_definitions(user_type_id)")
    cursor.execute("DROP INDEX IF EXISTS idx_users_email_blind_index")
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_blind_index ON users(email_blind_index)")

    conn.commit()
    logger.info("SQLite schema initialized")

    # Run migrations for existing tables
    _migrate_add_approved_column()
    _migrate_add_encryption_columns()


def _migrate_add_approved_column():
    """Add approved column to users table if it doesn't exist (for existing deployments)"""
    conn = get_connection()
    cursor = conn.cursor()

    # Check if column exists
    cursor.execute("PRAGMA table_info(users)")
    columns = [row[1] for row in cursor.fetchall()]

    if 'approved' not in columns:
        cursor.execute("ALTER TABLE users ADD COLUMN approved INTEGER DEFAULT 1")
        conn.commit()
        logger.info("Migration: Added 'approved' column to users table")

    cursor.close()


def _migrate_add_encryption_columns():
    """Add encryption columns to users and user_field_values tables if they don't exist"""
    conn = get_connection()
    cursor = conn.cursor()

    # Check users table columns
    cursor.execute("PRAGMA table_info(users)")
    user_columns = [row[1] for row in cursor.fetchall()]

    # Add encryption columns to users table
    user_encryption_columns = [
        ("encrypted_email", "TEXT"),
        ("ephemeral_pubkey_email", "TEXT"),
        ("email_blind_index", "TEXT"),
        ("encrypted_name", "TEXT"),
        ("ephemeral_pubkey_name", "TEXT"),
    ]

    for col_name, col_type in user_encryption_columns:
        if col_name not in user_columns:
            cursor.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}")
            logger.info(f"Migration: Added '{col_name}' column to users table")

    # Check user_field_values table columns
    cursor.execute("PRAGMA table_info(user_field_values)")
    field_columns = [row[1] for row in cursor.fetchall()]

    # Add encryption columns to user_field_values table
    field_encryption_columns = [
        ("encrypted_value", "TEXT"),
        ("ephemeral_pubkey", "TEXT"),
    ]

    for col_name, col_type in field_encryption_columns:
        if col_name not in field_columns:
            cursor.execute(f"ALTER TABLE user_field_values ADD COLUMN {col_name} {col_type}")
            logger.info(f"Migration: Added '{col_name}' column to user_field_values table")

    conn.commit()

    # Enforce unique blind index for email lookups
    try:
        cursor.execute("DROP INDEX IF EXISTS idx_users_email_blind_index")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_blind_index ON users(email_blind_index)")
        conn.commit()
    except sqlite3.IntegrityError as e:
        logger.error(f"Migration: Duplicate email_blind_index values detected: {e}")
        raise

    cursor.close()


def seed_default_settings():
    """Seed default instance settings if not present"""
    defaults = {
        "instance_name": "Sanctum",
        "primary_color": "#3B82F6",
        "description": "A privacy-first RAG knowledge base",
        "auto_approve_users": "true",  # true = auto-approve, false = require manual approval
    }

    with get_cursor() as cursor:
        for key, value in defaults.items():
            cursor.execute("""
                INSERT OR IGNORE INTO instance_settings (key, value)
                VALUES (?, ?)
            """, (key, value))

    logger.info("Default instance settings seeded")


# --- Admin Operations ---

def add_admin(pubkey: str) -> int:
    """Add an admin by pubkey. Returns admin id."""
    with get_cursor() as cursor:
        cursor.execute(
            "INSERT INTO admins (pubkey) VALUES (?)",
            (pubkey,)
        )
        return cursor.lastrowid


def get_admin_by_pubkey(pubkey: str) -> dict | None:
    """Get admin by pubkey"""
    with get_cursor() as cursor:
        cursor.execute("SELECT * FROM admins WHERE pubkey = ?", (pubkey,))
        row = cursor.fetchone()
        return dict(row) if row else None


def is_admin(pubkey: str) -> bool:
    """Check if pubkey is an admin"""
    return get_admin_by_pubkey(pubkey) is not None


def list_admins() -> list[dict]:
    """List all admins"""
    with get_cursor() as cursor:
        cursor.execute("SELECT * FROM admins ORDER BY created_at")
        return [dict(row) for row in cursor.fetchall()]


def remove_admin(pubkey: str) -> bool:
    """Remove admin by pubkey. Returns True if removed."""
    with get_cursor() as cursor:
        cursor.execute("DELETE FROM admins WHERE pubkey = ?", (pubkey,))
        return cursor.rowcount > 0


# --- Instance Settings Operations ---

def get_setting(key: str) -> str | None:
    """Get a single setting value"""
    with get_cursor() as cursor:
        cursor.execute("SELECT value FROM instance_settings WHERE key = ?", (key,))
        row = cursor.fetchone()
        return row["value"] if row else None


def get_all_settings() -> dict:
    """Get all instance settings as a dict"""
    with get_cursor() as cursor:
        cursor.execute("SELECT key, value FROM instance_settings")
        return {row["key"]: row["value"] for row in cursor.fetchall()}


def update_setting(key: str, value: str):
    """Update or insert a setting"""
    with get_cursor() as cursor:
        cursor.execute("""
            INSERT INTO instance_settings (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
        """, (key, value))


def update_settings(settings: dict):
    """Update multiple settings at once"""
    for key, value in settings.items():
        update_setting(key, value)


def get_auto_approve_users() -> bool:
    """Get whether new users should be auto-approved"""
    setting = get_setting("auto_approve_users")
    return setting != "false"  # Default to true if not set or not "false"


# --- User Type Operations ---

def create_user_type(
    name: str,
    description: str | None = None,
    display_order: int = 0
) -> int:
    """Create a user type. Returns type id."""
    with get_cursor() as cursor:
        cursor.execute("""
            INSERT INTO user_types (name, description, display_order)
            VALUES (?, ?, ?)
        """, (name, description, display_order))
        return cursor.lastrowid


def get_user_type(type_id: int) -> dict | None:
    """Get a user type by id"""
    with get_cursor() as cursor:
        cursor.execute("SELECT * FROM user_types WHERE id = ?", (type_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def get_user_type_by_name(name: str) -> dict | None:
    """Get a user type by name"""
    with get_cursor() as cursor:
        cursor.execute("SELECT * FROM user_types WHERE name = ?", (name,))
        row = cursor.fetchone()
        return dict(row) if row else None


def list_user_types() -> list[dict]:
    """List all user types ordered by display_order"""
    with get_cursor() as cursor:
        cursor.execute("""
            SELECT * FROM user_types
            ORDER BY display_order, id
        """)
        return [dict(row) for row in cursor.fetchall()]


def update_user_type(
    type_id: int,
    name: str | None = None,
    description: str | None = None,
    display_order: int | None = None
) -> bool:
    """Update a user type. Returns True if updated."""
    updates = []
    values = []

    if name is not None:
        updates.append("name = ?")
        values.append(name)
    if description is not None:
        updates.append("description = ?")
        values.append(description)
    if display_order is not None:
        updates.append("display_order = ?")
        values.append(display_order)

    if not updates:
        return False

    values.append(type_id)

    with get_cursor() as cursor:
        cursor.execute(
            f"UPDATE user_types SET {', '.join(updates)} WHERE id = ?",
            values
        )
        return cursor.rowcount > 0


def delete_user_type(type_id: int) -> bool:
    """Delete a user type. Returns True if deleted. Cascades to field definitions."""
    with get_cursor() as cursor:
        cursor.execute("DELETE FROM user_types WHERE id = ?", (type_id,))
        return cursor.rowcount > 0


# --- User Field Definition Operations ---

def create_field_definition(
    field_name: str,
    field_type: str,
    required: bool = False,
    display_order: int = 0,
    user_type_id: int | None = None
) -> int:
    """Create a user field definition. Returns field id.
    user_type_id: None = global field (shown for all types)
    """
    with get_cursor() as cursor:
        cursor.execute("""
            INSERT INTO user_field_definitions (field_name, field_type, required, display_order, user_type_id)
            VALUES (?, ?, ?, ?, ?)
        """, (field_name, field_type, int(required), display_order, user_type_id))
        return cursor.lastrowid


def get_field_definitions(user_type_id: int | None = None, include_global: bool = True) -> list[dict]:
    """Get field definitions, optionally filtered by type.

    Args:
        user_type_id: If provided, filter to this type's fields
        include_global: If True and user_type_id provided, also include global fields (user_type_id IS NULL)
    """
    with get_cursor() as cursor:
        if user_type_id is None:
            # Return all fields
            cursor.execute("""
                SELECT * FROM user_field_definitions
                ORDER BY display_order, id
            """)
        elif include_global:
            # Return global fields + type-specific fields
            cursor.execute("""
                SELECT * FROM user_field_definitions
                WHERE user_type_id IS NULL OR user_type_id = ?
                ORDER BY user_type_id NULLS FIRST, display_order, id
            """, (user_type_id,))
        else:
            # Return only type-specific fields
            cursor.execute("""
                SELECT * FROM user_field_definitions
                WHERE user_type_id = ?
                ORDER BY display_order, id
            """, (user_type_id,))
        return [dict(row) for row in cursor.fetchall()]


def get_field_definition_by_name(field_name: str, user_type_id: int | None = None) -> dict | None:
    """Get a field definition by name, optionally scoped to a type"""
    with get_cursor() as cursor:
        if user_type_id is None:
            # Look for global field first
            cursor.execute(
                "SELECT * FROM user_field_definitions WHERE field_name = ? AND user_type_id IS NULL",
                (field_name,)
            )
        else:
            # Look for type-specific field first, then global
            cursor.execute(
                """SELECT * FROM user_field_definitions
                   WHERE field_name = ? AND (user_type_id = ? OR user_type_id IS NULL)
                   ORDER BY user_type_id DESC NULLS LAST LIMIT 1""",
                (field_name, user_type_id)
            )
        row = cursor.fetchone()
        return dict(row) if row else None


def get_field_definition_by_id(field_id: int) -> dict | None:
    """Get a field definition by id"""
    with get_cursor() as cursor:
        cursor.execute("SELECT * FROM user_field_definitions WHERE id = ?", (field_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def update_field_definition(
    field_id: int,
    field_name: str | None = None,
    field_type: str | None = None,
    required: bool | None = None,
    display_order: int | None = None,
    user_type_id: int | None = ...  # Use ... as sentinel for "not provided"
) -> bool:
    """Update a field definition. Returns True if updated."""
    updates = []
    values = []

    if field_name is not None:
        updates.append("field_name = ?")
        values.append(field_name)
    if field_type is not None:
        updates.append("field_type = ?")
        values.append(field_type)
    if required is not None:
        updates.append("required = ?")
        values.append(int(required))
    if display_order is not None:
        updates.append("display_order = ?")
        values.append(display_order)
    if user_type_id is not ...:
        updates.append("user_type_id = ?")
        values.append(user_type_id)

    if not updates:
        return False

    values.append(field_id)

    with get_cursor() as cursor:
        cursor.execute(
            f"UPDATE user_field_definitions SET {', '.join(updates)} WHERE id = ?",
            values
        )
        return cursor.rowcount > 0


def delete_field_definition(field_id: int) -> bool:
    """Delete a field definition and all associated values. Returns True if deleted."""
    with get_cursor() as cursor:
        cursor.execute("DELETE FROM user_field_definitions WHERE id = ?", (field_id,))
        return cursor.rowcount > 0


# --- User Operations ---

def create_user(
    pubkey: str | None = None,
    email: str | None = None,
    name: str | None = None,
    user_type_id: int | None = None
) -> int:
    """Create a user. Returns user id.
    Approval status is based on auto_approve_users instance setting.
    Email and name are encrypted using NIP-04 if an admin exists.
    """
    # Import here to avoid circular imports
    from encryption import encrypt_for_admin_required, compute_blind_index
    from nostr_keys import normalize_pubkey

    approved = 1 if get_auto_approve_users() else 0

    # Normalize pubkey if provided
    if pubkey:
        pubkey = normalize_pubkey(pubkey)

    # Encrypt email if provided (strip whitespace first)
    encrypted_email = None
    ephemeral_pubkey_email = None
    email_blind_index = None
    trimmed_email = email.strip() if email else None
    if trimmed_email:
        encrypted_email, ephemeral_pubkey_email = encrypt_for_admin_required(trimmed_email)
        email_blind_index = compute_blind_index(trimmed_email)

    # Encrypt name if provided (strip whitespace first)
    encrypted_name = None
    ephemeral_pubkey_name = None
    trimmed_name = name.strip() if name else None
    if trimmed_name:
        encrypted_name, ephemeral_pubkey_name = encrypt_for_admin_required(trimmed_name)

    with get_cursor() as cursor:
        cursor.execute(
            """INSERT INTO users (
                pubkey, email, name, user_type_id, approved,
                encrypted_email, ephemeral_pubkey_email, email_blind_index,
                encrypted_name, ephemeral_pubkey_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                pubkey,
                None,  # Never store plaintext email
                None,  # Never store plaintext name
                user_type_id,
                approved,
                encrypted_email,
                ephemeral_pubkey_email,
                email_blind_index,
                encrypted_name,
                ephemeral_pubkey_name,
            )
        )
        return cursor.lastrowid


def get_user(user_id: int) -> dict | None:
    """Get user by id with all field values.

    Returns encrypted fields with their ephemeral pubkeys for frontend decryption.
    If data is not encrypted (legacy or no admin), returns plaintext in email/name fields.
    """
    with get_cursor() as cursor:
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        user_row = cursor.fetchone()
        if not user_row:
            return None

        user = dict(user_row)

        # Structure encrypted data for frontend decryption
        # If encrypted_email exists, frontend will decrypt; otherwise use plaintext
        if user.get("encrypted_email"):
            user["email_encrypted"] = {
                "ciphertext": user["encrypted_email"],
                "ephemeral_pubkey": user["ephemeral_pubkey_email"]
            }
        if user.get("encrypted_name"):
            user["name_encrypted"] = {
                "ciphertext": user["encrypted_name"],
                "ephemeral_pubkey": user["ephemeral_pubkey_name"]
            }

        # Get field values with encryption info
        cursor.execute("""
            SELECT fd.field_name, ufv.value, ufv.encrypted_value, ufv.ephemeral_pubkey
            FROM user_field_values ufv
            JOIN user_field_definitions fd ON fd.id = ufv.field_id
            WHERE ufv.user_id = ?
        """, (user_id,))

        user["fields"] = {}
        user["fields_encrypted"] = {}
        for row in cursor.fetchall():
            field_name = row["field_name"]
            if row["encrypted_value"]:
                # Encrypted field - frontend will decrypt
                user["fields_encrypted"][field_name] = {
                    "ciphertext": row["encrypted_value"],
                    "ephemeral_pubkey": row["ephemeral_pubkey"]
                }
                user["fields"][field_name] = None  # Placeholder
            else:
                # Legacy unencrypted field
                user["fields"][field_name] = row["value"]

        # Get user type info if set
        if user.get("user_type_id"):
            user_type = get_user_type(user["user_type_id"])
            user["user_type"] = user_type
        else:
            user["user_type"] = None

        return user


def get_user_by_pubkey(pubkey: str) -> dict | None:
    """Get user by pubkey"""
    from nostr_keys import normalize_pubkey

    try:
        pubkey = normalize_pubkey(pubkey)
    except ValueError:
        return None

    with get_cursor() as cursor:
        cursor.execute("SELECT id FROM users WHERE pubkey = ?", (pubkey,))
        row = cursor.fetchone()
        if row:
            return get_user(row["id"])
        return None


def get_user_by_email(email: str) -> dict | None:
    """Get user by email.

    Uses blind index for encrypted emails, falls back to plaintext for legacy data.
    """
    from encryption import compute_blind_index

    # Compute blind index for the email
    blind_index = compute_blind_index(email)

    with get_cursor() as cursor:
        # Try blind index first (encrypted emails)
        cursor.execute(
            "SELECT id FROM users WHERE email_blind_index = ?",
            (blind_index,)
        )
        row = cursor.fetchone()
        if row:
            return get_user(row["id"])

        # Fall back to plaintext email (legacy/unencrypted data)
        cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
        row = cursor.fetchone()
        if row:
            return get_user(row["id"])

        return None


def list_users() -> list[dict]:
    """List all users with their field values"""
    with get_cursor() as cursor:
        cursor.execute("SELECT id FROM users ORDER BY created_at")
        return [get_user(row["id"]) for row in cursor.fetchall()]


def set_user_field(user_id: int, field_name: str, value: object, user_type_id: int | None = None):
    """Set a field value for a user.

    Values are encrypted using NIP-04 if an admin exists.
    """
    from encryption import encrypt_for_admin_required, serialize_field_value

    field_def = get_field_definition_by_name(field_name, user_type_id)
    if not field_def:
        raise ValueError(f"Unknown field: {field_name}")

    # Encrypt the value
    serialized = serialize_field_value(value)
    encrypted_value, ephemeral_pubkey = encrypt_for_admin_required(serialized)

    # Store encrypted - clear plaintext
    with get_cursor() as cursor:
        cursor.execute("""
            INSERT INTO user_field_values (user_id, field_id, value, encrypted_value, ephemeral_pubkey)
            VALUES (?, ?, NULL, ?, ?)
            ON CONFLICT(user_id, field_id) DO UPDATE SET
                value = NULL,
                encrypted_value = excluded.encrypted_value,
                ephemeral_pubkey = excluded.ephemeral_pubkey
        """, (user_id, field_def["id"], encrypted_value, ephemeral_pubkey))


def set_user_fields(user_id: int, fields: dict, user_type_id: int | None = None):
    """Set multiple field values for a user"""
    for field_name, value in fields.items():
        set_user_field(user_id, field_name, value, user_type_id)


def delete_user(user_id: int) -> bool:
    """Delete a user and all their field values. Returns True if deleted."""
    with get_cursor() as cursor:
        cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
        return cursor.rowcount > 0


# --- Migration: Encrypt Existing Plaintext Data ---

def migrate_encrypt_existing_data():
    """
    Encrypt existing plaintext data that was stored before an admin was configured.

    This should be called after the first admin is added to encrypt any
    pre-existing user data. It encrypts:
    - users.email → encrypted_email
    - users.name → encrypted_name
    - user_field_values.value → encrypted_value

    This is idempotent - it only encrypts data that hasn't been encrypted yet.
    """
    from encryption import encrypt_for_admin, compute_blind_index, get_admin_pubkey

    admin_pubkey = get_admin_pubkey()
    if not admin_pubkey:
        logger.warning("migrate_encrypt_existing_data: No admin pubkey found, skipping")
        return

    logger.info("Starting encryption migration for existing plaintext data...")

    conn = get_connection()
    cursor = conn.cursor()

    # Migrate users table
    cursor.execute("""
        SELECT id, email, name FROM users
        WHERE (email IS NOT NULL AND encrypted_email IS NULL)
           OR (name IS NOT NULL AND encrypted_name IS NULL)
    """)
    users_to_migrate = cursor.fetchall()

    migrated_users = 0
    for row in users_to_migrate:
        user_id = row[0]
        email = row[1]
        name = row[2]

        updates = []
        values = []

        # Encrypt email if not already encrypted
        if email:
            encrypted_email, ephemeral_pubkey_email = encrypt_for_admin(email)
            if encrypted_email:
                updates.append("encrypted_email = ?")
                values.append(encrypted_email)
                updates.append("ephemeral_pubkey_email = ?")
                values.append(ephemeral_pubkey_email)
                updates.append("email_blind_index = ?")
                values.append(compute_blind_index(email))
                updates.append("email = NULL")  # Clear plaintext

        # Encrypt name if not already encrypted
        if name:
            encrypted_name, ephemeral_pubkey_name = encrypt_for_admin(name)
            if encrypted_name:
                updates.append("encrypted_name = ?")
                values.append(encrypted_name)
                updates.append("ephemeral_pubkey_name = ?")
                values.append(ephemeral_pubkey_name)
                updates.append("name = NULL")  # Clear plaintext

        if updates:
            values.append(user_id)
            cursor.execute(
                f"UPDATE users SET {', '.join(updates)} WHERE id = ?",
                values
            )
            migrated_users += 1

    # Migrate user_field_values table
    cursor.execute("""
        SELECT id, value FROM user_field_values
        WHERE value IS NOT NULL AND encrypted_value IS NULL
    """)
    fields_to_migrate = cursor.fetchall()

    migrated_fields = 0
    for row in fields_to_migrate:
        field_value_id = row[0]
        value = row[1]

        encrypted_value, ephemeral_pubkey = encrypt_for_admin(value)
        if encrypted_value:
            cursor.execute("""
                UPDATE user_field_values
                SET encrypted_value = ?, ephemeral_pubkey = ?, value = NULL
                WHERE id = ?
            """, (encrypted_value, ephemeral_pubkey, field_value_id))
            migrated_fields += 1

    conn.commit()
    cursor.close()

    logger.info(f"Encryption migration complete: {migrated_users} users, {migrated_fields} field values encrypted")
