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

import sys
import csv
import json
import io
import hashlib
import argparse
import subprocess
from pathlib import Path

# Add backend to path for imports
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR.parent.parent.parent / "backend" / "app"))

from coincurve import PrivateKey

from test_helpers import run_docker_sql, REPO_ROOT


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

    Uses run_docker_sql() helper to avoid shell injection vulnerabilities.
    """
    # Validate user_id is an integer to prevent SQL injection
    user_id = int(user_id)

    # Get user record using the hardened run_docker_sql() helper with CSV output
    try:
        user_output = run_docker_sql(
            f"SELECT id, pubkey, email, encrypted_email, ephemeral_pubkey_email, "  # noqa: S608
            f"name, encrypted_name, ephemeral_pubkey_name, email_blind_index, "
            f"user_type_id, approved, created_at FROM users WHERE id = {user_id}",
            db_path,
            csv_mode=True,
        )
    except RuntimeError:
        return None

    if not user_output.strip():
        return None

    # Parse CSV output using csv.reader (handles embedded commas/quotes/newlines)
    columns = [
        "id", "pubkey", "email", "encrypted_email", "ephemeral_pubkey_email",
        "name", "encrypted_name", "ephemeral_pubkey_name", "email_blind_index",
        "user_type_id", "approved", "created_at"
    ]

    reader = csv.reader(io.StringIO(user_output))
    try:
        values = next(reader)
    except StopIteration:
        return None

    if len(values) != len(columns):
        return None

    user_data = {}
    for col, val in zip(columns, values, strict=True):
        user_data[col] = val if val else None

    # Get field values using the hardened helper with CSV output
    try:
        fields_output = run_docker_sql(
            f"SELECT fd.field_name, ufv.value, ufv.encrypted_value, ufv.ephemeral_pubkey "  # noqa: S608
            f"FROM user_field_values ufv "
            f"JOIN user_field_definitions fd ON fd.id = ufv.field_id "
            f"WHERE ufv.user_id = {user_id}",
            db_path,
            csv_mode=True,
        )
    except RuntimeError:
        fields_output = ""

    field_values = []
    if fields_output.strip():
        reader = csv.reader(io.StringIO(fields_output))
        for row in reader:
            if len(row) >= 4:
                field_values.append({
                    "field_name": row[0] or None,
                    "value": row[1] or None,
                    "encrypted_value": row[2] or None,
                    "ephemeral_pubkey": row[3] or None,
                })

    user_data["field_values"] = field_values

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
        ["docker", "compose", "exec", "-T", "backend", "python", "-c", script],  # noqa: S607
        capture_output=True, text=True, cwd=REPO_ROOT, timeout=30
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
