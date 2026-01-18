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
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pubkey TEXT UNIQUE,
            email TEXT UNIQUE,
            name TEXT,
            user_type_id INTEGER,
            approved INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_type_id) REFERENCES user_types(id)
        )
    """)

    # User field values - dynamic field storage (EAV pattern)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_field_values (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            field_id INTEGER NOT NULL,
            value TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (field_id) REFERENCES user_field_definitions(id) ON DELETE CASCADE,
            UNIQUE(user_id, field_id)
        )
    """)

    # Create indexes for performance
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_field_values_user ON user_field_values(user_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_field_values_field ON user_field_values(field_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_field_definitions_type ON user_field_definitions(user_type_id)")

    conn.commit()
    logger.info("SQLite schema initialized")

    # Run migrations for existing tables
    _migrate_add_approved_column()


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
    """
    approved = 1 if get_auto_approve_users() else 0

    with get_cursor() as cursor:
        cursor.execute(
            "INSERT INTO users (pubkey, email, name, user_type_id, approved) VALUES (?, ?, ?, ?, ?)",
            (pubkey, email, name, user_type_id, approved)
        )
        return cursor.lastrowid


def get_user(user_id: int) -> dict | None:
    """Get user by id with all field values"""
    with get_cursor() as cursor:
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        user_row = cursor.fetchone()
        if not user_row:
            return None

        user = dict(user_row)

        # Get field values
        cursor.execute("""
            SELECT fd.field_name, ufv.value
            FROM user_field_values ufv
            JOIN user_field_definitions fd ON fd.id = ufv.field_id
            WHERE ufv.user_id = ?
        """, (user_id,))

        user["fields"] = {row["field_name"]: row["value"] for row in cursor.fetchall()}

        # Get user type info if set
        if user.get("user_type_id"):
            user_type = get_user_type(user["user_type_id"])
            user["user_type"] = user_type
        else:
            user["user_type"] = None

        return user


def get_user_by_pubkey(pubkey: str) -> dict | None:
    """Get user by pubkey"""
    with get_cursor() as cursor:
        cursor.execute("SELECT id FROM users WHERE pubkey = ?", (pubkey,))
        row = cursor.fetchone()
        if row:
            return get_user(row["id"])
        return None


def get_user_by_email(email: str) -> dict | None:
    """Get user by email"""
    with get_cursor() as cursor:
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


def set_user_field(user_id: int, field_name: str, value: str, user_type_id: int | None = None):
    """Set a field value for a user"""
    field_def = get_field_definition_by_name(field_name, user_type_id)
    if not field_def:
        raise ValueError(f"Unknown field: {field_name}")

    with get_cursor() as cursor:
        cursor.execute("""
            INSERT INTO user_field_values (user_id, field_id, value)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, field_id) DO UPDATE SET value = excluded.value
        """, (user_id, field_def["id"], value))


def set_user_fields(user_id: int, fields: dict, user_type_id: int | None = None):
    """Set multiple field values for a user"""
    for field_name, value in fields.items():
        set_user_field(user_id, field_name, value, user_type_id)


def delete_user(user_id: int) -> bool:
    """Delete a user and all their field values. Returns True if deleted."""
    with get_cursor() as cursor:
        cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
        return cursor.rowcount > 0
