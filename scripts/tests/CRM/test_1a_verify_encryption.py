#!/usr/bin/env python3
"""
Test 1A: Verify Encryption in Raw Database

Tests that user PII is properly encrypted in SQLite:
- email/name columns are NULL (plaintext cleared)
- encrypted_email/encrypted_name contain NIP-04 ciphertext
- email_blind_index exists for lookups
- Custom field values are encrypted

Usage:
    python test_1a_verify_encryption.py [--api-base http://localhost:8000]

Requirements:
    - Backend must be running
    - coincurve package
"""

import os
import sys
import json
import sqlite3
import hashlib
import argparse
import subprocess
import requests
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


def create_test_user(api_base: str, user_data: dict, admin_token: str = None) -> dict:
    """Create a test user via API."""
    headers = {"Content-Type": "application/json"}
    if admin_token:
        headers["Authorization"] = f"Bearer {admin_token}"
    
    payload = {
        "pubkey": user_data.get("pubkey"),
        "email": user_data.get("email"),
        "name": user_data.get("name"),
        "fields": user_data.get("fields", {})
    }
    
    try:
        response = requests.post(
            f"{api_base}/users",
            json=payload,
            headers=headers,
            timeout=10
        )
    except requests.exceptions.Timeout as e:
        print(f"[ERROR] Request timed out: {e}")
        return None
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] Request failed: {e}")
        return None
    
    if response.status_code != 200:
        print(f"[ERROR] Failed to create user: {response.status_code}")
        print(response.text)
        return None
    
    return response.json()


def run_docker_sql(sql: str, db_path: str = "/data/sanctum.db") -> str:
    """
    Run read-only SQL inside Docker container and return output.

    Security: Uses stdin to pass SQL (avoids shell injection), and
    validates that only a single SELECT statement is allowed.

    Raises:
        ValueError: If SQL is not a single SELECT statement or db_path is invalid
        RuntimeError: If sqlite3 command fails
    """
    repo_root = SCRIPT_DIR.parent.parent.parent

    # Validate db_path to prevent option injection (paths starting with "-")
    if not db_path or db_path.startswith("-"):
        raise ValueError(f"Invalid db_path: {db_path!r}")

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
        ["docker", "compose", "exec", "-T", "backend", "sqlite3", "-json", db_path],
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


def inspect_raw_database(db_path: str, user_id: int) -> dict:
    """
    Directly inspect the SQLite database to verify encryption.
    Uses docker exec to query the DB inside the container.

    Returns raw column values for the user.
    """
    # Validate user_id is an integer to prevent SQL injection
    user_id = int(user_id)

    # Get user record via docker
    user_json = run_docker_sql(f"SELECT * FROM users WHERE id = {user_id}", db_path)

    if not user_json or user_json == "[]":
        return None

    users = json.loads(user_json)
    if not users:
        return None

    user_data = users[0]

    # Get field values
    fields_json = run_docker_sql(
        f"SELECT fd.field_name, ufv.value, ufv.encrypted_value, ufv.ephemeral_pubkey "
        f"FROM user_field_values ufv "
        f"JOIN user_field_definitions fd ON fd.id = ufv.field_id "
        f"WHERE ufv.user_id = {user_id}",
        db_path
    )

    user_data["field_values"] = json.loads(fields_json) if fields_json else []

    return user_data


def test_verify_encryption(db_path: str, user_id: int, config: dict) -> bool:
    """
    Test 1A: Verify that sensitive data is encrypted in the database.
    
    Checks:
    - email column is NULL (plaintext cleared)
    - name column is NULL (plaintext cleared)
    - encrypted_email contains NIP-04 ciphertext
    - encrypted_name contains NIP-04 ciphertext
    - email_blind_index exists for lookups
    """
    print("\n" + "="*60)
    print("TEST 1A: Verify Encryption in Raw Database")
    print("="*60)
    
    raw_data = inspect_raw_database(db_path, user_id)
    
    if not raw_data:
        print("[FAIL] User not found in database")
        return False
    
    passed = True
    
    # Check plaintext columns are NULL
    print("\n[CHECK] Plaintext columns should be NULL:")
    for col in ["email", "name"]:
        value = raw_data.get(col)
        status = "✓ NULL" if value is None else f"✗ HAS VALUE: {value[:20]}..."
        print(f"  {col}: {status}")
        if value is not None:
            passed = False
    
    # Check encrypted columns exist and look like NIP-04
    print("\n[CHECK] Encrypted columns should contain ciphertext:")
    for col in ["encrypted_email", "encrypted_name"]:
        value = raw_data.get(col)
        if value and "?iv=" in value:
            print(f"  {col}: ✓ NIP-04 format ({len(value)} chars)")
        else:
            print(f"  {col}: ✗ Missing or invalid format")
            passed = False
    
    # Check blind index exists
    print("\n[CHECK] Blind index should exist:")
    blind_index = raw_data.get("email_blind_index")
    if blind_index and len(blind_index) == 64:
        print(f"  email_blind_index: ✓ {blind_index[:16]}...")
    else:
        print(f"  email_blind_index: ✗ Missing or invalid")
        passed = False
    
    # Check field values encryption
    print("\n[CHECK] Field values should be encrypted:")
    for field in raw_data.get("field_values", []):
        fname = field["field_name"]
        plaintext = field["value"]
        encrypted = field["encrypted_value"]
        
        if plaintext is None and encrypted and "?iv=" in encrypted:
            print(f"  {fname}: ✓ Encrypted")
        elif plaintext is not None:
            print(f"  {fname}: ✗ Plaintext exposed: {plaintext}")
            passed = False
        else:
            print(f"  {fname}: ✗ No encrypted value")
            passed = False
    
    print("\n" + "-"*60)
    print(f"TEST 1A RESULT: {'PASSED ✓' if passed else 'FAILED ✗'}")
    
    return passed


def main():
    parser = argparse.ArgumentParser(description="Test 1A: Verify Encryption")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--db-path", default="/data/sanctum.db", help="Path to SQLite database")
    parser.add_argument("--skip-create", action="store_true", help="Skip user creation (use existing)")
    parser.add_argument("--user-id", type=int, help="Existing user ID to test")
    parser.add_argument("--token", help="Admin session token")
    args = parser.parse_args()
    
    config = load_config()
    
    print("="*60)
    print("TEST 1A: VERIFY ENCRYPTION IN RAW DATABASE")
    print("="*60)
    print(f"API Base: {args.api_base}")
    print(f"DB Path: {args.db_path}")
    
    # Generate test admin keypair from seed
    admin_privkey, admin_pubkey = generate_test_admin_keypair(
        config["test_admin"]["keypair_seed"]
    )
    print(f"Test Admin Pubkey: {admin_pubkey}")
    
    user_id = args.user_id
    
    if not args.skip_create:
        print("\n[SETUP] Creating test user...")
        result = create_test_user(args.api_base, config["test_user"], args.token)
        if result:
            user_id = result.get("id")
            print(f"[SETUP] Created user ID: {user_id}")
        else:
            print("[SETUP] Failed to create user. Tests may fail.")
    
    if not user_id:
        print("[ERROR] No user ID available. Use --user-id or allow creation.")
        sys.exit(1)
    
    # Run test
    passed = test_verify_encryption(args.db_path, user_id, config)
    
    # Summary
    print("\n" + "="*60)
    print(f"RESULT: {'PASSED ✓' if passed else 'FAILED ✗'}")
    print("="*60)
    
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
