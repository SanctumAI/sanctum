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
import argparse
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


def generate_test_admin_keypair(privkey_hex: str) -> tuple[str, str]:
    """Generate admin keypair from private key hex."""
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
    import json
    
    # Get user record via docker
    user_json = run_docker_sql(f"SELECT * FROM users WHERE id = {user_id}")
    
    # sqlite3 without -json returns plain text, try to parse
    if not user_json:
        return None
    
    # Run with -json flag for structured output
    repo_root = SCRIPT_DIR.parent.parent.parent
    import subprocess
    
    cmd = f"docker compose exec -T backend sqlite3 -json {db_path} 'SELECT * FROM users WHERE id = {user_id}'"
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=repo_root)
    
    if not result.stdout.strip() or result.stdout.strip() == "[]":
        return None
    
    users = json.loads(result.stdout.strip())
    if not users:
        return None
    
    user_data = users[0]
    
    # Get field values
    cmd = f"""docker compose exec -T backend sqlite3 -json {db_path} 'SELECT fd.field_name, ufv.value, ufv.encrypted_value, ufv.ephemeral_pubkey FROM user_field_values ufv JOIN user_field_definitions fd ON fd.id = ufv.field_id WHERE ufv.user_id = {user_id}'"""
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
    """Run SQL inside Docker container and return output."""
    import subprocess
    
    repo_root = SCRIPT_DIR.parent.parent.parent
    escaped_sql = sql.replace("'", "'\\''")
    cmd = f"docker compose exec -T backend sqlite3 {db_path} '{escaped_sql}'"
    
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=repo_root)
    return result.stdout.strip()


def find_test_user(db_path: str, test_email: str) -> int:
    """Find a test user by email blind index or most recent user."""
    output = run_docker_sql("SELECT id FROM users ORDER BY id DESC LIMIT 1")
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
    
    # Generate test admin keypair
    admin_privkey, admin_pubkey = generate_test_admin_keypair(
        config["test_admin"]["private_key_hex"]
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
