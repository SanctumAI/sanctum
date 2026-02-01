"""
Sanctum Database Module
Handles SQLite connection and schema for user/admin management.
"""

import json
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

    # Admins table - stores single Nostr pubkey (max 1 admin per instance)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pubkey TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Instance state - tracks setup completion and governance
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS instance_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Initialize instance state if not exists
    cursor.execute("""
        INSERT OR IGNORE INTO instance_state (key, value) 
        VALUES ('setup_complete', 'false')
    """)
    cursor.execute("""
        INSERT OR IGNORE INTO instance_state (key, value) 
        VALUES ('admin_initialized', 'false')
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
    # encryption_enabled: 1 = encrypt field values (default), 0 = store plaintext
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_field_definitions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            field_name TEXT NOT NULL,
            field_type TEXT NOT NULL,
            required INTEGER DEFAULT 0,
            display_order INTEGER DEFAULT 0,
            user_type_id INTEGER,
            encryption_enabled INTEGER DEFAULT 1,
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

    # Create indexes for performance (note: email_blind_index index created in migration)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_field_values_user ON user_field_values(user_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_field_values_field ON user_field_values(field_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_field_definitions_type ON user_field_definitions(user_type_id)")
    # Note: idx_user_field_definitions_encryption created in _migrate_add_encryption_enabled_column()

    # AI Configuration table - stores AI/LLM settings
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ai_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            value TEXT NOT NULL,
            value_type TEXT NOT NULL DEFAULT 'string',
            category TEXT NOT NULL,
            description TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Document defaults table - controls document availability and default state
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS document_defaults (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL UNIQUE,
            is_available INTEGER DEFAULT 1,
            is_default_active INTEGER DEFAULT 1,
            display_order INTEGER DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (job_id) REFERENCES ingest_jobs(job_id) ON DELETE CASCADE
        )
    """)

    # Deployment configuration table - manages environment settings
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS deployment_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            value TEXT,
            is_secret INTEGER DEFAULT 0,
            requires_restart INTEGER DEFAULT 0,
            category TEXT NOT NULL,
            description TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Config audit log table - tracks all configuration changes
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS config_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            config_key TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            changed_by TEXT NOT NULL,
            changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # AI config user-type overrides - stores per-user-type AI config overrides
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ai_config_user_type_overrides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ai_config_key TEXT NOT NULL,
            user_type_id INTEGER NOT NULL,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_type_id) REFERENCES user_types(id) ON DELETE CASCADE,
            UNIQUE(ai_config_key, user_type_id)
        )
    """)

    # Document defaults user-type overrides - stores per-user-type document defaults
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS document_defaults_user_type_overrides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            user_type_id INTEGER NOT NULL,
            is_available INTEGER,
            is_default_active INTEGER,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (job_id) REFERENCES ingest_jobs(job_id) ON DELETE CASCADE,
            FOREIGN KEY (user_type_id) REFERENCES user_types(id) ON DELETE CASCADE,
            UNIQUE(job_id, user_type_id)
        )
    """)

    # Indexes for user-type override tables
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ai_config_overrides_type ON ai_config_user_type_overrides(user_type_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ai_config_overrides_key ON ai_config_user_type_overrides(ai_config_key)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_doc_defaults_overrides_type ON document_defaults_user_type_overrides(user_type_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_doc_defaults_overrides_job ON document_defaults_user_type_overrides(job_id)")

    conn.commit()
    logger.info("SQLite schema initialized")

    # Run migrations for existing tables (must run BEFORE creating indexes on new columns)
    _migrate_add_approved_column()
    _migrate_add_encryption_columns()  # This adds email_blind_index column AND creates its index
    _migrate_add_field_metadata_columns()  # Add placeholder and options columns
    _migrate_add_encryption_enabled_column()  # Add encryption_enabled column for optional field encryption

    # Initialize ingest job tables
    from ingest_db import init_ingest_schema
    init_ingest_schema()

    # Seed default AI config values
    _seed_default_ai_config()


def _migrate_add_approved_column() -> None:
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


def _migrate_add_encryption_columns() -> None:
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


def _migrate_add_field_metadata_columns() -> None:
    """Add placeholder and options columns to user_field_definitions if they don't exist"""
    conn = get_connection()
    cursor = conn.cursor()

    # Check existing columns
    cursor.execute("PRAGMA table_info(user_field_definitions)")
    columns = [row[1] for row in cursor.fetchall()]

    if 'placeholder' not in columns:
        cursor.execute("ALTER TABLE user_field_definitions ADD COLUMN placeholder TEXT")
        logger.info("Migration: Added 'placeholder' column to user_field_definitions table")

    if 'options' not in columns:
        cursor.execute("ALTER TABLE user_field_definitions ADD COLUMN options TEXT")  # JSON array
        logger.info("Migration: Added 'options' column to user_field_definitions table")

    conn.commit()
    cursor.close()


def _migrate_add_encryption_enabled_column() -> None:
    """Add encryption_enabled column to user_field_definitions if it doesn't exist"""
    conn = get_connection()
    cursor = conn.cursor()

    # Check existing columns
    cursor.execute("PRAGMA table_info(user_field_definitions)")
    columns = [row[1] for row in cursor.fetchall()]

    if 'encryption_enabled' not in columns:
        # Add column with secure default (1 = encrypted)
        cursor.execute("ALTER TABLE user_field_definitions ADD COLUMN encryption_enabled INTEGER DEFAULT 1")
        logger.info("Migration: Added 'encryption_enabled' column to user_field_definitions table (default: encrypted)")

    # Always ensure index exists (idempotent via IF NOT EXISTS)
    # This runs after column is guaranteed to exist (either from CREATE TABLE or ALTER TABLE above)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_field_definitions_encryption ON user_field_definitions(encryption_enabled)")

    conn.commit()
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
    """
    Add the single admin by pubkey. Enforces single admin constraint.
    Returns admin id if successful.
    
    Raises:
        ValueError: If an admin already exists
    """
    with get_cursor() as cursor:
        # Atomic INSERT that only succeeds if no admin exists
        cursor.execute("""
            INSERT INTO admins (pubkey) 
            SELECT ? WHERE NOT EXISTS (SELECT 1 FROM admins)
        """, (pubkey,))
        
        # Check if the insert succeeded
        if cursor.rowcount == 0:
            raise ValueError("Instance already has an admin. Only one admin per instance is allowed.")
        
        admin_id = cursor.lastrowid
        
        # Mark admin as initialized
        cursor.execute("""
            INSERT OR REPLACE INTO instance_state (key, value, updated_at)
            VALUES ('admin_initialized', 'true', CURRENT_TIMESTAMP)
        """)
        
        return admin_id


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
        removed = cursor.rowcount > 0
        
        # Check if any admins remain after deletion
        if removed:
            cursor.execute("SELECT COUNT(*) FROM admins")
            remaining_admins = cursor.fetchone()[0]
            
            # If no admins remain, reset instance state
            if remaining_admins == 0:
                cursor.execute("""
                    INSERT OR REPLACE INTO instance_state (key, value, updated_at)
                    VALUES ('admin_initialized', 'false', CURRENT_TIMESTAMP)
                """)
                cursor.execute("""
                    INSERT OR REPLACE INTO instance_state (key, value, updated_at)
                    VALUES ('setup_complete', 'false', CURRENT_TIMESTAMP)
                """)
        
        return removed


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


# --- Instance State Operations ---

def get_instance_state(key: str) -> str | None:
    """Get instance state value by key"""
    with get_cursor() as cursor:
        cursor.execute("SELECT value FROM instance_state WHERE key = ?", (key,))
        row = cursor.fetchone()
        return row["value"] if row else None


def set_instance_state(key: str, value: str) -> None:
    """Set instance state value"""
    with get_cursor() as cursor:
        cursor.execute("""
            INSERT OR REPLACE INTO instance_state (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        """, (key, value))


def is_instance_setup_complete() -> bool:
    """Check if instance setup is complete"""
    admin_initialized = get_instance_state('admin_initialized') == 'true'
    setup_complete = get_instance_state('setup_complete') == 'true'
    return admin_initialized and setup_complete


def mark_instance_setup_complete() -> None:
    """Mark instance setup as complete (called after admin authentication)"""
    set_instance_state('setup_complete', 'true')


def has_admin() -> bool:
    """Check if instance has an admin configured"""
    with get_cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM admins")
        return cursor.fetchone()[0] > 0


def get_single_admin() -> dict | None:
    """Get the single admin for this instance"""
    with get_cursor() as cursor:
        cursor.execute("SELECT * FROM admins LIMIT 1")
        row = cursor.fetchone()
        return dict(row) if row else None


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
    user_type_id: int | None = None,
    placeholder: str | None = None,
    options: list[str] | None = None,
    encryption_enabled: bool = True
) -> int:
    """Create a user field definition. Returns field id.
    user_type_id: None = global field (shown for all types)
    placeholder: Placeholder text for the field input
    options: List of options for select fields (stored as JSON)
    encryption_enabled: True = encrypt field values (secure default), False = store plaintext
    """
    options_json = json.dumps(options) if options is not None else None
    with get_cursor() as cursor:
        cursor.execute("""
            INSERT INTO user_field_definitions (field_name, field_type, required, display_order, user_type_id, placeholder, options, encryption_enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (field_name, field_type, int(required), display_order, user_type_id, placeholder, options_json, int(encryption_enabled)))
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

        results = []
        for row in cursor.fetchall():
            field = dict(row)
            # Parse options JSON if present
            if field.get("options"):
                try:
                    field["options"] = json.loads(field["options"])
                except json.JSONDecodeError:
                    field["options"] = None
            results.append(field)
        return results


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
    user_type_id: int | None = ...,  # Use ... as sentinel for "not provided"
    placeholder: str | None = ...,
    options: list[str] | None = ...,
    encryption_enabled: bool | None = None
) -> bool:
    """Update a field definition. Returns True if updated.
    
    WARNING: Changing encryption_enabled may require data migration for existing field values.
    """
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
    if placeholder is not ...:
        updates.append("placeholder = ?")
        values.append(placeholder)
    if options is not ...:
        updates.append("options = ?")
        values.append(json.dumps(options) if options is not None else None)
    if encryption_enabled is not None:
        updates.append("encryption_enabled = ?")
        values.append(int(encryption_enabled))

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
        # Blind index uses lowercased email for case-insensitive lookups (matches get_user_by_email)
        email_blind_index = compute_blind_index(trimmed_email.lower())

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

    # Normalize email: strip whitespace and lowercase
    normalized_email = email.strip().lower() if email else ""
    if not normalized_email:
        return None

    # Compute blind index for the normalized email
    blind_index = compute_blind_index(normalized_email)

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
        # Use normalized email for consistent matching
        cursor.execute("SELECT id FROM users WHERE LOWER(email) = ?", (normalized_email,))
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

    Values are encrypted using NIP-04 if the field definition has encryption_enabled=True
    and an admin exists. Otherwise, stored as plaintext.
    """
    from encryption import encrypt_for_admin_required, serialize_field_value

    field_def = get_field_definition_by_name(field_name, user_type_id)
    if not field_def:
        raise ValueError(f"Unknown field: {field_name}")

    # Serialize value to string
    serialized = serialize_field_value(value)

    # Check if encryption is enabled for this field
    if field_def.get("encryption_enabled", 1):  # Default to encrypted for backward compatibility
        # ENCRYPTED PATH - encrypt the value
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
    else:
        # PLAINTEXT PATH - store value directly
        with get_cursor() as cursor:
            cursor.execute("""
                INSERT INTO user_field_values (user_id, field_id, value, encrypted_value, ephemeral_pubkey)
                VALUES (?, ?, ?, NULL, NULL)
                ON CONFLICT(user_id, field_id) DO UPDATE SET
                    value = excluded.value,
                    encrypted_value = NULL,
                    ephemeral_pubkey = NULL
            """, (user_id, field_def["id"], serialized))


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

    Note: This function creates its own database connection to be thread-safe
    when called via asyncio.to_thread(). Do not use the global connection here.
    """
    from encryption import encrypt_for_admin, compute_blind_index, get_admin_pubkey

    admin_pubkey = get_admin_pubkey()
    if not admin_pubkey:
        logger.warning("migrate_encrypt_existing_data: No admin pubkey found, skipping")
        return

    logger.info("Starting encryption migration for existing plaintext data...")

    # Create a dedicated connection for thread-safety (this runs via asyncio.to_thread)
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    migrated_users = 0
    migrated_fields = 0

    try:
        # Migrate users table
        cursor.execute("""
            SELECT id, email, name FROM users
            WHERE (email IS NOT NULL AND encrypted_email IS NULL)
               OR (name IS NOT NULL AND encrypted_name IS NULL)
        """)
        users_to_migrate = cursor.fetchall()

        for row in users_to_migrate:
            user_id = row[0]
            email = row[1]
            name = row[2]

            updates = []
            values = []

            # Encrypt email if not already encrypted (strip whitespace first)
            # Handle non-string values by serializing to JSON
            email_str = email if isinstance(email, str) else json.dumps(email, separators=(",", ":"), ensure_ascii=False) if email is not None else None
            trimmed_email = email_str.strip() if email_str else None
            if email_str is not None:
                # Always clear plaintext; only encrypt if non-whitespace
                if trimmed_email:
                    encrypted_email, ephemeral_pubkey_email = encrypt_for_admin(trimmed_email)
                    if encrypted_email:
                        updates.append("encrypted_email = ?")
                        values.append(encrypted_email)
                        updates.append("ephemeral_pubkey_email = ?")
                        values.append(ephemeral_pubkey_email)
                        updates.append("email_blind_index = ?")
                        values.append(compute_blind_index(trimmed_email.lower()))
                updates.append("email = NULL")  # Clear plaintext (even if whitespace-only)

            # Encrypt name if not already encrypted (strip whitespace first)
            name_str = name if isinstance(name, str) else json.dumps(name, separators=(",", ":"), ensure_ascii=False) if name is not None else None
            trimmed_name = name_str.strip() if name_str else None
            if name_str is not None:
                # Always clear plaintext; only encrypt if non-whitespace
                if trimmed_name:
                    encrypted_name, ephemeral_pubkey_name = encrypt_for_admin(trimmed_name)
                    if encrypted_name:
                        updates.append("encrypted_name = ?")
                        values.append(encrypted_name)
                        updates.append("ephemeral_pubkey_name = ?")
                        values.append(ephemeral_pubkey_name)
                updates.append("name = NULL")  # Clear plaintext (even if whitespace-only)

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

        for row in fields_to_migrate:
            field_value_id = row[0]
            value = row[1]

            # Handle non-string values by serializing to JSON, then strip whitespace
            value_str = value if isinstance(value, str) else json.dumps(value, separators=(",", ":"), ensure_ascii=False) if value is not None else None
            trimmed_value = value_str.strip() if value_str else None
            if value_str is not None:
                # Always clear plaintext; only encrypt if non-whitespace
                if trimmed_value:
                    encrypted_value, ephemeral_pubkey = encrypt_for_admin(trimmed_value)
                    if encrypted_value:
                        cursor.execute("""
                            UPDATE user_field_values
                            SET encrypted_value = ?, ephemeral_pubkey = ?, value = NULL
                            WHERE id = ?
                        """, (encrypted_value, ephemeral_pubkey, field_value_id))
                        migrated_fields += 1
                    else:
                        # Encryption failed but still clear plaintext
                        cursor.execute(
                            "UPDATE user_field_values SET value = NULL WHERE id = ?",
                            (field_value_id,)
                        )
                else:
                    # Whitespace-only value: just clear plaintext, no encryption
                    cursor.execute(
                        "UPDATE user_field_values SET value = NULL WHERE id = ?",
                        (field_value_id,)
                    )

        conn.commit()
        logger.info(f"Encryption migration complete: {migrated_users} users, {migrated_fields} field values encrypted")

    except Exception as e:
        conn.rollback()
        logger.error(f"Encryption migration failed, rolled back: {e}")
        raise

    finally:
        cursor.close()
        conn.close()


# --- AI Configuration Operations ---

def _seed_default_ai_config() -> None:
    """Seed default AI configuration values if not present"""
    defaults = [
        # Prompt sections
        ("prompt_tone", "Be helpful, concise, and professional. Acknowledge the user's question before answering.", "string", "prompt_section", "Voice and personality instructions"),
        ("prompt_rules", '["ONE action per response when providing step-by-step guidance", "NEVER invent sources, organization names, or contact information", "If asked about topics outside your knowledge base, acknowledge limitations"]', "json", "prompt_section", "Array of behavioral rules"),
        ("prompt_forbidden", '[]', "json", "prompt_section", "Topics to avoid or redirect"),
        ("prompt_greeting", "greeting_style", "string", "prompt_section", "Initial response style"),
        # LLM Parameters
        ("temperature", "0.1", "number", "parameter", "LLM temperature (0.0-1.0)"),
        ("top_k", "8", "number", "parameter", "RAG retrieval count"),
        # Session defaults
        ("web_search_default", "false", "boolean", "default", "Web search active by default for new sessions"),
    ]

    with get_cursor() as cursor:
        for key, value, value_type, category, description in defaults:
            cursor.execute("""
                INSERT OR IGNORE INTO ai_config (key, value, value_type, category, description)
                VALUES (?, ?, ?, ?, ?)
            """, (key, value, value_type, category, description))

    logger.info("Default AI configuration seeded")


def get_ai_config(key: str) -> dict | None:
    """Get a single AI config value"""
    with get_cursor() as cursor:
        cursor.execute("SELECT * FROM ai_config WHERE key = ?", (key,))
        row = cursor.fetchone()
        return dict(row) if row else None


def get_all_ai_config() -> list[dict]:
    """Get all AI config values"""
    with get_cursor() as cursor:
        cursor.execute("SELECT * FROM ai_config ORDER BY category, key")
        return [dict(row) for row in cursor.fetchall()]


def get_ai_config_by_category(category: str) -> list[dict]:
    """Get AI config values for a specific category"""
    with get_cursor() as cursor:
        cursor.execute("SELECT * FROM ai_config WHERE category = ? ORDER BY key", (category,))
        return [dict(row) for row in cursor.fetchall()]


def update_ai_config(key: str, value: str, changed_by: str) -> bool:
    """Update an AI config value with audit logging"""
    with get_cursor() as cursor:
        # Get old value inside transaction to avoid TOCTOU race
        cursor.execute("SELECT value FROM ai_config WHERE key = ?", (key,))
        row = cursor.fetchone()
        old_value = row["value"] if row else None

        cursor.execute("""
            UPDATE ai_config SET value = ?, updated_at = CURRENT_TIMESTAMP
            WHERE key = ?
        """, (value, key))

        if cursor.rowcount > 0:
            # Log the change
            cursor.execute("""
                INSERT INTO config_audit_log (table_name, config_key, old_value, new_value, changed_by)
                VALUES (?, ?, ?, ?, ?)
            """, ("ai_config", key, old_value, value, changed_by))
            return True
        return False


# --- AI Config User-Type Override Operations ---

def get_ai_config_override(key: str, user_type_id: int) -> dict | None:
    """Get a single AI config override for a user type"""
    with get_cursor() as cursor:
        cursor.execute("""
            SELECT * FROM ai_config_user_type_overrides
            WHERE ai_config_key = ? AND user_type_id = ?
        """, (key, user_type_id))
        row = cursor.fetchone()
        return dict(row) if row else None


def get_ai_config_overrides_by_type(user_type_id: int) -> list[dict]:
    """Get all AI config overrides for a user type"""
    with get_cursor() as cursor:
        cursor.execute("""
            SELECT * FROM ai_config_user_type_overrides
            WHERE user_type_id = ?
            ORDER BY ai_config_key
        """, (user_type_id,))
        return [dict(row) for row in cursor.fetchall()]


def upsert_ai_config_override(key: str, user_type_id: int, value: str, changed_by: str) -> bool:
    """Create or update an AI config override for a user type"""
    with get_cursor() as cursor:
        # Get old value for audit log
        cursor.execute("""
            SELECT value FROM ai_config_user_type_overrides
            WHERE ai_config_key = ? AND user_type_id = ?
        """, (key, user_type_id))
        old_row = cursor.fetchone()
        old_value = old_row["value"] if old_row else None

        cursor.execute("""
            INSERT INTO ai_config_user_type_overrides (ai_config_key, user_type_id, value)
            VALUES (?, ?, ?)
            ON CONFLICT(ai_config_key, user_type_id) DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
        """, (key, user_type_id, value))

        # Log the change (only if changed_by is provided)
        if changed_by:
            cursor.execute("""
                INSERT INTO config_audit_log (table_name, config_key, old_value, new_value, changed_by)
                VALUES (?, ?, ?, ?, ?)
            """, ("ai_config_user_type_overrides", f"{key}:type_{user_type_id}", old_value, value, changed_by))

        return True


def delete_ai_config_override(key: str, user_type_id: int, changed_by: str = "") -> bool:
    """Delete an AI config override (revert to global). Returns True if deleted."""
    with get_cursor() as cursor:
        # Get old value for audit log
        cursor.execute("""
            SELECT value FROM ai_config_user_type_overrides
            WHERE ai_config_key = ? AND user_type_id = ?
        """, (key, user_type_id))
        old_row = cursor.fetchone()
        old_value = old_row["value"] if old_row else None

        cursor.execute("""
            DELETE FROM ai_config_user_type_overrides
            WHERE ai_config_key = ? AND user_type_id = ?
        """, (key, user_type_id))

        deleted = cursor.rowcount > 0

        # Log the change if something was deleted
        if deleted and changed_by:
            cursor.execute("""
                INSERT INTO config_audit_log (table_name, config_key, old_value, new_value, changed_by)
                VALUES (?, ?, ?, ?, ?)
            """, ("ai_config_user_type_overrides", f"{key}:type_{user_type_id}", old_value, "(reverted to global)", changed_by))

        return deleted


def get_effective_ai_config(user_type_id: int | None = None) -> list[dict]:
    """
    Get all AI config values with inheritance applied.

    If user_type_id is provided, returns global config merged with user-type overrides.
    Override values replace global values for matching keys.
    Each item includes is_override flag and override_user_type_id if applicable.
    """
    # Start with global config
    all_config = get_all_ai_config()

    if user_type_id is None:
        # No user type, return global config with is_override=False
        for config in all_config:
            config["is_override"] = False
            config["override_user_type_id"] = None
        return all_config

    # Get overrides for this user type
    overrides = get_ai_config_overrides_by_type(user_type_id)
    overrides_by_key = {o["ai_config_key"]: o for o in overrides}

    # Merge: overrides win
    for config in all_config:
        key = config["key"]
        if key in overrides_by_key:
            override = overrides_by_key[key]
            config["value"] = override["value"]
            config["is_override"] = True
            config["override_user_type_id"] = user_type_id
            config["updated_at"] = override["updated_at"]
        else:
            config["is_override"] = False
            config["override_user_type_id"] = None

    return all_config


# --- Document Defaults Operations ---

def get_document_defaults(job_id: str) -> dict | None:
    """Get document defaults for a specific job"""
    with get_cursor() as cursor:
        cursor.execute("SELECT * FROM document_defaults WHERE job_id = ?", (job_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def list_document_defaults() -> list[dict]:
    """List all document defaults"""
    with get_cursor() as cursor:
        cursor.execute("""
            SELECT dd.*, ij.filename, ij.status, ij.total_chunks
            FROM document_defaults dd
            JOIN ingest_jobs ij ON dd.job_id = ij.job_id
            ORDER BY dd.display_order, ij.created_at DESC
        """)
        return [dict(row) for row in cursor.fetchall()]


def upsert_document_defaults(
    job_id: str,
    is_available: bool = True,
    is_default_active: bool = True,
    display_order: int = 0,
    changed_by: str = ""
) -> bool:
    """Create or update document defaults"""
    with get_cursor() as cursor:
        # Get old value inside transaction to avoid TOCTOU race
        cursor.execute("SELECT is_available, is_default_active FROM document_defaults WHERE job_id = ?", (job_id,))
        old_row = cursor.fetchone()
        old_value = json.dumps({"is_available": bool(old_row["is_available"]), "is_default_active": bool(old_row["is_default_active"])}) if old_row else None

        cursor.execute("""
            INSERT INTO document_defaults (job_id, is_available, is_default_active, display_order)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(job_id) DO UPDATE SET
                is_available = excluded.is_available,
                is_default_active = excluded.is_default_active,
                display_order = excluded.display_order,
                updated_at = CURRENT_TIMESTAMP
        """, (job_id, int(is_available), int(is_default_active), display_order))

        # Log the change
        new_value = json.dumps({"is_available": is_available, "is_default_active": is_default_active})
        if changed_by:
            cursor.execute("""
                INSERT INTO config_audit_log (table_name, config_key, old_value, new_value, changed_by)
                VALUES (?, ?, ?, ?, ?)
            """, ("document_defaults", job_id, old_value, new_value, changed_by))

        return True


def get_default_active_documents() -> list[str]:
    """Get list of job_ids that are default active"""
    with get_cursor() as cursor:
        cursor.execute("""
            SELECT job_id FROM document_defaults
            WHERE is_available = 1 AND is_default_active = 1
            ORDER BY display_order
        """)
        return [row["job_id"] for row in cursor.fetchall()]


def get_available_documents() -> list[str]:
    """Get list of job_ids that are available for use"""
    with get_cursor() as cursor:
        cursor.execute("""
            SELECT job_id FROM document_defaults
            WHERE is_available = 1
            ORDER BY display_order
        """)
        return [row["job_id"] for row in cursor.fetchall()]


# --- Document Defaults User-Type Override Operations ---

def get_document_defaults_override(job_id: str, user_type_id: int) -> dict | None:
    """Get document defaults override for a specific job and user type"""
    with get_cursor() as cursor:
        cursor.execute("""
            SELECT * FROM document_defaults_user_type_overrides
            WHERE job_id = ? AND user_type_id = ?
        """, (job_id, user_type_id))
        row = cursor.fetchone()
        return dict(row) if row else None


def get_document_defaults_overrides_by_type(user_type_id: int) -> list[dict]:
    """Get all document defaults overrides for a user type"""
    with get_cursor() as cursor:
        cursor.execute("""
            SELECT * FROM document_defaults_user_type_overrides
            WHERE user_type_id = ?
            ORDER BY job_id
        """, (user_type_id,))
        return [dict(row) for row in cursor.fetchall()]


def upsert_document_defaults_override(
    job_id: str,
    user_type_id: int,
    is_available: bool | None = None,
    is_default_active: bool | None = None,
    changed_by: str = ""
) -> bool:
    """Create or update document defaults override for a user type"""
    with get_cursor() as cursor:
        # Get old value for audit log
        cursor.execute("""
            SELECT is_available, is_default_active FROM document_defaults_user_type_overrides
            WHERE job_id = ? AND user_type_id = ?
        """, (job_id, user_type_id))
        old_row = cursor.fetchone()
        old_value = json.dumps({
            "is_available": bool(old_row["is_available"]) if old_row and old_row["is_available"] is not None else None,
            "is_default_active": bool(old_row["is_default_active"]) if old_row and old_row["is_default_active"] is not None else None
        }) if old_row else None

        # Handle None values - only update fields that are provided
        if old_row:
            # Merge with existing values
            final_available = is_available if is_available is not None else (
                bool(old_row["is_available"]) if old_row["is_available"] is not None else None
            )
            final_active = is_default_active if is_default_active is not None else (
                bool(old_row["is_default_active"]) if old_row["is_default_active"] is not None else None
            )
        else:
            final_available = is_available
            final_active = is_default_active

        cursor.execute("""
            INSERT INTO document_defaults_user_type_overrides (job_id, user_type_id, is_available, is_default_active)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(job_id, user_type_id) DO UPDATE SET
                is_available = excluded.is_available,
                is_default_active = excluded.is_default_active,
                updated_at = CURRENT_TIMESTAMP
        """, (
            job_id,
            user_type_id,
            int(final_available) if final_available is not None else None,
            int(final_active) if final_active is not None else None
        ))

        # Log the change
        new_value = json.dumps({"is_available": final_available, "is_default_active": final_active})
        if changed_by:
            cursor.execute("""
                INSERT INTO config_audit_log (table_name, config_key, old_value, new_value, changed_by)
                VALUES (?, ?, ?, ?, ?)
            """, ("document_defaults_user_type_overrides", f"{job_id}:type_{user_type_id}", old_value, new_value, changed_by))

        return True


def delete_document_defaults_override(job_id: str, user_type_id: int, changed_by: str = "") -> bool:
    """Delete document defaults override (revert to global). Returns True if deleted."""
    with get_cursor() as cursor:
        # Get old value for audit log
        cursor.execute("""
            SELECT is_available, is_default_active FROM document_defaults_user_type_overrides
            WHERE job_id = ? AND user_type_id = ?
        """, (job_id, user_type_id))
        old_row = cursor.fetchone()
        old_value = json.dumps({
            "is_available": bool(old_row["is_available"]) if old_row and old_row["is_available"] is not None else None,
            "is_default_active": bool(old_row["is_default_active"]) if old_row and old_row["is_default_active"] is not None else None
        }) if old_row else None

        cursor.execute("""
            DELETE FROM document_defaults_user_type_overrides
            WHERE job_id = ? AND user_type_id = ?
        """, (job_id, user_type_id))

        deleted = cursor.rowcount > 0

        if deleted and changed_by:
            cursor.execute("""
                INSERT INTO config_audit_log (table_name, config_key, old_value, new_value, changed_by)
                VALUES (?, ?, ?, ?, ?)
            """, ("document_defaults_user_type_overrides", f"{job_id}:type_{user_type_id}", old_value, "(reverted to global)", changed_by))

        return deleted


def get_effective_document_defaults(user_type_id: int | None = None) -> list[dict]:
    """
    Get all document defaults with inheritance applied.

    If user_type_id is provided, returns global defaults merged with user-type overrides.
    Override values replace global values for matching job_ids.
    Each item includes is_override flag if applicable.

    Note: This only processes documents that have global defaults set.
    """
    # Get global defaults
    defaults = list_document_defaults()

    if user_type_id is None:
        # No user type, return global with is_override=False
        for doc in defaults:
            doc["is_override"] = False
            doc["override_user_type_id"] = None
        return defaults

    # Get overrides for this user type
    overrides = get_document_defaults_overrides_by_type(user_type_id)
    overrides_by_job = {o["job_id"]: o for o in overrides}

    # Merge: overrides win for is_available and is_default_active
    for doc in defaults:
        job_id = doc["job_id"]
        if job_id in overrides_by_job:
            override = overrides_by_job[job_id]
            # Only override if the override has a non-None value
            if override["is_available"] is not None:
                doc["is_available"] = bool(override["is_available"])
            if override["is_default_active"] is not None:
                doc["is_default_active"] = bool(override["is_default_active"])
            doc["is_override"] = True
            doc["override_user_type_id"] = user_type_id
            doc["override_updated_at"] = override["updated_at"]
        else:
            doc["is_override"] = False
            doc["override_user_type_id"] = None

    return defaults


def get_active_documents_for_user_type(user_type_id: int | None = None) -> list[str]:
    """
    Get list of job_ids that should be default active for a user type.

    Uses inheritance: user-type overrides take precedence over global defaults.
    """
    if user_type_id is None:
        return get_default_active_documents()

    effective = get_effective_document_defaults(user_type_id)
    return [doc["job_id"] for doc in effective if doc.get("is_available") and doc.get("is_default_active")]


def get_available_documents_for_user_type(user_type_id: int | None = None) -> list[str]:
    """
    Get list of job_ids that are available for a user type.

    Uses inheritance: user-type overrides take precedence over global defaults.
    """
    if user_type_id is None:
        return get_available_documents()

    effective = get_effective_document_defaults(user_type_id)
    return [doc["job_id"] for doc in effective if doc.get("is_available")]


# --- Deployment Configuration Operations ---

def get_deployment_config(key: str) -> dict | None:
    """Get a single deployment config value"""
    with get_cursor() as cursor:
        cursor.execute("SELECT * FROM deployment_config WHERE key = ?", (key,))
        row = cursor.fetchone()
        if row:
            result = dict(row)
            # Mask secret values only when a value exists
            if result.get("is_secret") and result.get("value"):
                result["value"] = "********"
            return result
        return None


def get_all_deployment_config() -> list[dict]:
    """Get all deployment config values (secrets masked)"""
    with get_cursor() as cursor:
        cursor.execute("SELECT * FROM deployment_config ORDER BY category, key")
        results = []
        for row in cursor.fetchall():
            result = dict(row)
            if result.get("is_secret") and result.get("value"):
                result["value"] = "********"
            results.append(result)
        return results


def get_deployment_config_by_category(category: str) -> list[dict]:
    """Get deployment config values for a specific category (secrets masked)"""
    with get_cursor() as cursor:
        cursor.execute("SELECT * FROM deployment_config WHERE category = ? ORDER BY key", (category,))
        results = []
        for row in cursor.fetchall():
            result = dict(row)
            if result.get("is_secret") and result.get("value"):
                result["value"] = "********"
            results.append(result)
        return results


def update_deployment_config(key: str, value: str, changed_by: str) -> bool:
    """Update a deployment config value with audit logging"""
    # Get old value for audit log
    with get_cursor() as cursor:
        cursor.execute("SELECT value, is_secret FROM deployment_config WHERE key = ?", (key,))
        row = cursor.fetchone()
        if not row:
            return False
        old_value = "********" if row["is_secret"] else row["value"]

        cursor.execute("""
            UPDATE deployment_config SET value = ?, updated_at = CURRENT_TIMESTAMP
            WHERE key = ?
        """, (value, key))

        if cursor.rowcount > 0:
            # Log the change (mask secrets in log too)
            new_value_logged = "********" if row["is_secret"] else value
            cursor.execute("""
                INSERT INTO config_audit_log (table_name, config_key, old_value, new_value, changed_by)
                VALUES (?, ?, ?, ?, ?)
            """, ("deployment_config", key, old_value, new_value_logged, changed_by))
            return True
        return False


def upsert_deployment_config(
    key: str,
    value: str,
    is_secret: bool = False,
    requires_restart: bool = False,
    category: str = "general",
    description: str = "",
    changed_by: str = ""
) -> bool:
    """Create or update deployment config"""
    with get_cursor() as cursor:
        # Get old value inside transaction to avoid TOCTOU race
        cursor.execute("SELECT value, is_secret FROM deployment_config WHERE key = ?", (key,))
        old_row = cursor.fetchone()
        old_value = "********" if (old_row and old_row["is_secret"]) else (old_row["value"] if old_row else None)

        cursor.execute("""
            INSERT INTO deployment_config (key, value, is_secret, requires_restart, category, description)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                is_secret = excluded.is_secret,
                requires_restart = excluded.requires_restart,
                category = excluded.category,
                description = excluded.description,
                updated_at = CURRENT_TIMESTAMP
        """, (key, value, int(is_secret), int(requires_restart), category, description))

        # Log the change
        if changed_by:
            new_value_logged = "********" if is_secret else value
            cursor.execute("""
                INSERT INTO config_audit_log (table_name, config_key, old_value, new_value, changed_by)
                VALUES (?, ?, ?, ?, ?)
            """, ("deployment_config", key, old_value, new_value_logged, changed_by))

        return True


def get_restart_required_keys() -> list[str]:
    """Get list of config keys that require restart when changed"""
    with get_cursor() as cursor:
        cursor.execute("SELECT key FROM deployment_config WHERE requires_restart = 1")
        return [row["key"] for row in cursor.fetchall()]


def get_deployment_config_value(key: str) -> str | None:
    """Get the actual deployment config value (for internal system use only).

    WARNING: This returns unmasked secret values. Do not expose via API.
    """
    with get_cursor() as cursor:
        cursor.execute("SELECT value FROM deployment_config WHERE key = ?", (key,))
        row = cursor.fetchone()
        return row["value"] if row else None


# --- Audit Log Operations ---

def get_config_audit_log(limit: int = 100, table_name: str | None = None) -> list[dict]:
    """Get recent config audit log entries"""
    with get_cursor() as cursor:
        if table_name:
            cursor.execute("""
                SELECT * FROM config_audit_log
                WHERE table_name = ?
                ORDER BY changed_at DESC LIMIT ?
            """, (table_name, limit))
        else:
            cursor.execute("""
                SELECT * FROM config_audit_log
                ORDER BY changed_at DESC LIMIT ?
            """, (limit,))
        return [dict(row) for row in cursor.fetchall()]
