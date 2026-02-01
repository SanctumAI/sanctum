#!/usr/bin/env python3
"""
Test 1B: Decrypt and Verify Data Fidelity

Tests that encrypted user PII can be decrypted and matches original:
- Decrypt email with admin key, compare to original
- Decrypt name with admin key, compare to original
- Decrypt custom field values, compare to original

Usage:
    python test_1b_decrypt_fidelity.py [--api-base http://localhost:8000]

Requirements:
    - Backend must be running
    - coincurve, pycryptodome packages (same as backend)
    - User must already exist (run test_1a first or use --user-id)
"""

import os
import sys
import json
import sqlite3
import hashlib
import argparse
import subprocess
from pathlib import Path

# Add backend to path for imports
SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend" / "app"))

from coincurve import PrivateKey


def load_config() -> dict:
    """Load test configuration."""
    config_path = SCRIPT_DIR / "test-config.json"
    with open(config_path) as f:
        return json.load(f)


def generate_test_admin_keypair(seed: str) -> tuple[str, str]:
    """
    Generate admin keypair from a seed string.

    Derives private key deterministically from seed (not stored in VCS).
    """
    # Derive 32-byte private key from seed
    privkey_hex = hashlib.sha256(seed.encode()).hexdigest()
    privkey_bytes = bytes.fromhex(privkey_hex)
    privkey = PrivateKey(privkey_bytes)

    # Get x-only public key (32 bytes)
    pubkey_compressed = privkey.public_key.format(compressed=True)
    pubkey_x_only = pubkey_compressed[1:].hex()

    return privkey_hex, pubkey_x_only


def inspect_raw_database(db_path: str, user_id: int) -> dict:
    """
    Directly inspect the SQLite database via docker exec.

    Returns raw column values for the user.
    """
    # Validate user_id is an integer to prevent SQL injection
    user_id = int(user_id)

    repo_root = SCRIPT_DIR.parent.parent.parent

    # Get user record with -json flag for structured output
    # Use shlex.quote for db_path to handle paths with spaces/special chars
    cmd = f"docker compose exec -T backend sqlite3 -json {shlex.quote(db_path)} 'SELECT * FROM users WHERE id = {user_id}'"
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=repo_root)

    if not result.stdout.strip() or result.stdout.strip() == "[]":
        return None

    users = json.loads(result.stdout.strip())
    if not users:
        return None

    user_data = users[0]

    # Get field values
    cmd = f"docker compose exec -T backend sqlite3 -json {shlex.quote(db_path)} 'SELECT fd.field_name, ufv.value, ufv.encrypted_value, ufv.ephemeral_pubkey FROM user_field_values ufv JOIN user_field_definitions fd ON fd.id = ufv.field_id WHERE ufv.user_id = {user_id}'"
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=repo_root)

    user_data["field_values"] = json.loads(result.stdout.strip()) if result.stdout.strip() else []

    return user_data


def test_decrypt_and_verify(db_path: str, user_id: int, admin_privkey: str, original_data: dict) -> bool:
    """
    Test 1B: Decrypt data with admin key and verify fidelity.
    
    Uses NIP-04 decryption to recover plaintext and compare with original.
    """
    print("\n" + "="*60)
    print("TEST 1B: Decrypt and Verify Data Fidelity")
    print("="*60)
    
    # Import decryption function
    try:
        from encryption import nip04_decrypt
    except ImportError as e:
        print(f"[ERROR] Failed to import encryption module: {e}")
        print("  Make sure backend/app is in PYTHONPATH")
        return False
    
    raw_data = inspect_raw_database(db_path, user_id)
    
    if not raw_data:
        print(f"[FAIL] User ID {user_id} not found in database")
        return False
    
    admin_privkey_bytes = bytes.fromhex(admin_privkey)
    
    passed = True
    
    # Decrypt email
    print("\n[DECRYPT] Email:")
    try:
        encrypted_email = raw_data.get("encrypted_email")
        ephemeral_pubkey = raw_data.get("ephemeral_pubkey_email")
        
        if encrypted_email and ephemeral_pubkey:
            decrypted_email = nip04_decrypt(encrypted_email, ephemeral_pubkey, admin_privkey_bytes)
            expected_email = original_data["email"]
            
            if decrypted_email == expected_email:
                print(f"  Original:  {expected_email}")
                print(f"  Decrypted: {decrypted_email}")
                print(f"  Match: ✓")
            else:
                print(f"  Original:  {expected_email}")
                print(f"  Decrypted: {decrypted_email}")
                print(f"  Match: ✗ MISMATCH")
                passed = False
        else:
            print(f"  ✗ Missing encrypted data or ephemeral pubkey")
            passed = False
    except Exception as e:
        print(f"  ✗ Decryption failed: {e}")
        passed = False
    
    # Decrypt name
    print("\n[DECRYPT] Name:")
    try:
        encrypted_name = raw_data.get("encrypted_name")
        ephemeral_pubkey = raw_data.get("ephemeral_pubkey_name")
        
        if encrypted_name and ephemeral_pubkey:
            decrypted_name = nip04_decrypt(encrypted_name, ephemeral_pubkey, admin_privkey_bytes)
            expected_name = original_data["name"]
            
            if decrypted_name == expected_name:
                print(f"  Original:  {expected_name}")
                print(f"  Decrypted: {decrypted_name}")
                print(f"  Match: ✓")
            else:
                print(f"  Original:  {expected_name}")
                print(f"  Decrypted: {decrypted_name}")
                print(f"  Match: ✗ MISMATCH")
                passed = False
        else:
            print(f"  ✗ Missing encrypted data or ephemeral pubkey")
            passed = False
    except Exception as e:
        print(f"  ✗ Decryption failed: {e}")
        passed = False
    
    # Decrypt field values
    print("\n[DECRYPT] Custom Fields:")
    field_values = raw_data.get("field_values", [])
    
    if not field_values:
        print("  (no custom fields to decrypt)")
    
    for field in field_values:
        fname = field["field_name"]
        try:
            encrypted_value = field["encrypted_value"]
            ephemeral_pubkey = field["ephemeral_pubkey"]
            
            if encrypted_value and ephemeral_pubkey:
                decrypted_value = nip04_decrypt(encrypted_value, ephemeral_pubkey, admin_privkey_bytes)
                expected_value = original_data.get("fields", {}).get(fname)
                
                if decrypted_value == expected_value:
                    print(f"  {fname}: ✓ '{decrypted_value}'")
                else:
                    print(f"  {fname}: ✗ Expected '{expected_value}', got '{decrypted_value}'")
                    passed = False
            else:
                print(f"  {fname}: ✗ Missing encrypted data or ephemeral pubkey")
                passed = False
        except Exception as e:
            print(f"  {fname}: ✗ Decryption failed: {e}")
            passed = False
    
    print("\n" + "-"*60)
    print(f"TEST 1B RESULT: {'PASSED ✓' if passed else 'FAILED ✗'}")
    
    return passed


def run_docker_sql(sql: str, db_path: str = "/data/sanctum.db") -> str:
    """
    Run read-only SQL inside Docker container and return output.

    Security: Uses stdin to pass SQL (avoids shell injection), and
    validates that only a single SELECT statement is allowed.

    Raises:
        ValueError: If SQL is not a single SELECT statement
        RuntimeError: If sqlite3 command fails
    """
    repo_root = SCRIPT_DIR.parent.parent.parent

    # Normalize: strip whitespace and trailing semicolons
    sql_normalized = sql.strip().rstrip(";").strip()

    # Reject multi-statement input (internal semicolons)
    if ";" in sql_normalized:
        raise ValueError(f"run_docker_sql only allows single statements, got: {sql[:50]}")

    # Validate: only allow SELECT statements (defense-in-depth for test helper)
    if not sql_normalized.upper().startswith("SELECT"):
        raise ValueError(f"run_docker_sql only allows SELECT statements, got: {sql[:50]}")

    # Use list argv with stdin for SQL (no shell=True, no escaping needed)
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "backend", "sqlite3", db_path],
        input=sql_normalized,
        capture_output=True,
        text=True,
        cwd=repo_root,
    )

    # Surface sqlite3 failures
    if result.returncode != 0:
        raise RuntimeError(
            f"sqlite3 failed (exit {result.returncode}): {result.stderr.strip() or result.stdout.strip()}"
        )

    return result.stdout.strip()


def compute_blind_index_in_docker(email: str) -> str | None:
    """
    Compute blind index inside Docker container where SECRET_KEY is available.

    The blind index key is derived from SECRET_KEY, which only exists inside
    the container (via env var or /data/.secret_key). Running compute_blind_index
    on the host would use a different (randomly generated) key.
    """
    # Escape for Python string inside shell
    escaped_email = email.replace("\\", "\\\\").replace("'", "\\'")

    script = f"from encryption import compute_blind_index; print(compute_blind_index('{escaped_email}'))"
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "backend", "python", "-c", script],
        capture_output=True, text=True, cwd=REPO_ROOT
    )

    if result.returncode != 0:
        return None
    return result.stdout.strip()


def find_test_user(db_path: str, test_email: str) -> int | None:
    """
    Find a test user by email blind index or most recent user.

    First attempts to find the user by blind index lookup using the provided
    test_email. If that fails, falls back to plaintext email lookup (for legacy
    data). If both fail, returns the most recent user. Returns None if no user
    is found.

    Args:
        db_path: Path to SQLite database file
        test_email: Email address to search for

    Returns:
        User ID if found, None otherwise
    """
    # Normalize email: lowercase and strip whitespace
    normalized_email = test_email.strip().lower() if test_email else ""
    if not normalized_email:
        # If no email provided, fall back to most recent user
        output = run_docker_sql("SELECT id FROM users ORDER BY id DESC LIMIT 1", db_path)
        return int(output) if output else None

    # Compute blind index inside Docker where SECRET_KEY is available
    blind_index = compute_blind_index_in_docker(normalized_email)
    if blind_index:
        # Escape single quotes in blind_index for SQL
        escaped_blind_index = blind_index.replace("'", "''")
        output = run_docker_sql(
            f"SELECT id FROM users WHERE email_blind_index = '{escaped_blind_index}' LIMIT 1",
            db_path
        )
        if output:
            return int(output)

    # Fall back to plaintext email lookup (for legacy/unencrypted data)
    escaped_email = normalized_email.replace("'", "''")
    output = run_docker_sql(
        f"SELECT id FROM users WHERE LOWER(email) = '{escaped_email}' LIMIT 1",
        db_path
    )
    if output:
        return int(output)

    # Final fallback: most recent user
    output = run_docker_sql("SELECT id FROM users ORDER BY id DESC LIMIT 1", db_path)
    return int(output) if output else None


def main():
    parser = argparse.ArgumentParser(description="Test 1B: Decrypt and Verify Fidelity")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL (unused, for compatibility)")
    parser.add_argument("--db-path", default="/data/sanctum.db", help="Path to SQLite database")
    parser.add_argument("--user-id", type=int, help="User ID to test (auto-detected if not provided)")
    parser.add_argument("--token", help="Admin session token (unused, for compatibility)")
    args = parser.parse_args()
    
    config = load_config()
    
    print("="*60)
    print("TEST 1B: DECRYPT AND VERIFY DATA FIDELITY")
    print("="*60)
    print(f"DB Path: {args.db_path}")
    
    # Auto-detect user ID if not provided
    user_id = args.user_id
    if not user_id:
        user_id = find_test_user(args.db_path, config["test_user"]["email"])
        if user_id:
            print(f"User ID: {user_id} (auto-detected)")
        else:
            print("[ERROR] No users found in database. Run Test 1A first.")
            sys.exit(1)
    else:
        print(f"User ID: {user_id}")
    
    # Generate test admin keypair from seed
    admin_privkey, admin_pubkey = generate_test_admin_keypair(
        config["test_admin"]["keypair_seed"]
    )
    print(f"Test Admin Pubkey: {admin_pubkey}")
    
    # Run test
    passed = test_decrypt_and_verify(
        args.db_path, 
        user_id, 
        admin_privkey, 
        config["test_user"]
    )
    
    # Summary
    print("\n" + "="*60)
    print(f"RESULT: {'PASSED ✓' if passed else 'FAILED ✗'}")
    print("="*60)
    
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
