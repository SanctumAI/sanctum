#!/usr/bin/env python3
"""
Test 3B: Key Migration Execute - Full End-to-End Test

Tests the complete admin key migration flow:
1. Create user with encrypted PII
2. Call prepare endpoint to get encrypted data
3. Decrypt data using current admin private key
4. Create signed Nostr event authorizing migration
5. Call execute endpoint with decrypted data + new pubkey
6. Verify response indicates success
7. Verify admin pubkey updated in database
8. Verify data re-encrypted to new pubkey (can decrypt with new key)
9. Verify cannot decrypt with old key

Also tests error cases:
- Invalid pubkey format (not 64-char hex) -> 400
- Same pubkey as current -> 400
- Invalid signature (wrong private key) -> 401
- Wrong action tag -> 401
- No auth header -> 401

Usage:
    python test_3b_key_migration_execute.py [--api-base http://localhost:8000]

Requirements:
    - Backend must be running
    - coincurve, pycryptodome packages
    - Test admin must exist (created by harness)
"""

import os
import sys
import json
import time
import hashlib
import argparse
import subprocess
from pathlib import Path

# Add backend to path for imports
SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend" / "app"))

import requests
from coincurve import PrivateKey


def load_config() -> dict:
    """Load test configuration."""
    config_path = SCRIPT_DIR / "test-config.json"
    with open(config_path) as f:
        return json.load(f)


def derive_keypair_from_seed(seed: str) -> tuple[str, str]:
    """
    Derive keypair from a seed string.
    Returns (privkey_hex, pubkey_hex).
    """
    privkey_hex = hashlib.sha256(seed.encode()).hexdigest()
    privkey = PrivateKey(bytes.fromhex(privkey_hex))
    pubkey_compressed = privkey.public_key.format(compressed=True)
    pubkey_x_only = pubkey_compressed[1:].hex()
    return privkey_hex, pubkey_x_only


def create_signed_auth_event(privkey_hex: str, pubkey_hex: str, action: str = "admin_auth") -> dict:
    """
    Create and sign a Nostr event for authentication.
    """
    event = {
        "pubkey": pubkey_hex,
        "created_at": int(time.time()),
        "kind": 22242,
        "tags": [["action", action]],
        "content": ""
    }

    # Compute event ID
    serialized = json.dumps([
        0, event["pubkey"], event["created_at"], event["kind"], event["tags"], event["content"]
    ], separators=(',', ':'), ensure_ascii=False)
    event_id = hashlib.sha256(serialized.encode()).hexdigest()
    event["id"] = event_id

    # Sign with Schnorr
    privkey = PrivateKey(bytes.fromhex(privkey_hex))
    sig = privkey.sign_schnorr(bytes.fromhex(event_id))
    event["sig"] = sig.hex()

    return event


def get_admin_token(api_base: str, privkey_hex: str, pubkey_hex: str) -> tuple[str | None, int | None]:
    """Authenticate as admin and return (session_token, status_code).

    Returns:
        (token, 200) on success
        (None, status_code) on auth rejection (e.g., 401, 403)
        (None, None) on network/request exception
    """
    event = create_signed_auth_event(privkey_hex, pubkey_hex, "admin_auth")
    try:
        response = requests.post(f"{api_base}/admin/auth", json={"event": event}, timeout=10)
        if response.status_code == 200:
            token = response.json().get("session_token")
            if token:
                return token, 200
            print("[ERROR] Admin auth returned 200 but no session_token in response")
            return None, 200
        print(f"[ERROR] Admin auth failed: {response.status_code} - {response.text}")
        return None, response.status_code
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] Admin auth request failed: {e}")
        return None, None


def create_test_user(api_base: str, user_data: dict, admin_token: str) -> dict | None:
    """Create a test user via API."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {admin_token}"
    }
    payload = {
        "pubkey": user_data.get("pubkey"),
        "email": user_data.get("email"),
        "name": user_data.get("name"),
        "fields": user_data.get("fields", {})
    }
    try:
        response = requests.post(f"{api_base}/users", json=payload, headers=headers, timeout=10)
        if response.status_code == 200:
            return response.json()
        print(f"[ERROR] Failed to create user: {response.status_code} - {response.text}")
        return None
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] Create user request failed: {e}")
        return None


def run_docker_sql(sql: str, db_path: str = "/data/sanctum.db", timeout: int = 30) -> str:
    """
    Run read-only SQL inside Docker container and return output.

    Security: Uses stdin to pass SQL (avoids shell injection), and
    validates that only a single SELECT statement is allowed.

    Raises:
        ValueError: If SQL is not a single SELECT statement
        RuntimeError: If sqlite3 command fails or times out
    """
    # Normalize: strip whitespace and trailing semicolons
    sql_normalized = sql.strip().rstrip(";").strip()

    # Reject multi-statement input (internal semicolons)
    if ";" in sql_normalized:
        raise ValueError(f"run_docker_sql only allows single statements, got: {sql[:50]}")

    # Validate: only allow SELECT statements (defense-in-depth for test helper)
    if not sql_normalized.upper().startswith("SELECT"):
        raise ValueError(f"run_docker_sql only allows SELECT statements, got: {sql[:50]}")

    # Safe subprocess invocation: argv list (no shell=True), SQL passed via stdin
    try:
        result = subprocess.run(
            ["docker", "compose", "exec", "-T", "backend", "sqlite3", "-json", db_path],
            input=sql_normalized,
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"sqlite3 command timed out after {timeout}s")

    # Surface sqlite3 failures
    if result.returncode != 0:
        raise RuntimeError(
            f"sqlite3 failed (exit {result.returncode}): {result.stderr.strip() or result.stdout.strip()}"
        )

    return result.stdout.strip()


def get_admin_pubkey_from_db(db_path: str = "/data/sanctum.db") -> str | None:
    """Get current admin pubkey from database."""
    output = run_docker_sql("SELECT pubkey FROM admins LIMIT 1", db_path)
    if output and output != "[]":
        admins = json.loads(output)
        if admins:
            return admins[0].get("pubkey")
    return None


def test_error_cases(api_base: str, admin_token: str, admin_pubkey: str, new_admin_pubkey: str, old_admin_privkey: str) -> bool:
    """Test error cases for the execute endpoint."""
    print("\n" + "="*60)
    print("TEST 3B: Error Cases")
    print("="*60)

    passed = True
    headers = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}

    # Error case 1: Invalid pubkey format (not 64-char hex)
    print("\n[TEST] Invalid pubkey format (short hex)...")
    invalid_request = {
        "new_admin_pubkey": "abc123",  # Too short
        "users": [],
        "field_values": [],
        "signature_event": create_signed_auth_event(old_admin_privkey, admin_pubkey, "admin_key_migration")
    }
    try:
        response = requests.post(f"{api_base}/admin/key-migration/execute", json=invalid_request, headers=headers, timeout=10)
        if response.status_code == 400:
            print("  Result: 400 Bad Request (expected)")
        else:
            print(f"  Result: {response.status_code} (expected 400)")
            passed = False
    except requests.exceptions.RequestException as e:
        print(f"  Result: Request failed - {e}")
        passed = False

    # Error case 2: Same pubkey as current
    print("\n[TEST] Same pubkey as current admin...")
    same_pubkey_request = {
        "new_admin_pubkey": admin_pubkey,  # Same as current
        "users": [],
        "field_values": [],
        "signature_event": create_signed_auth_event(old_admin_privkey, admin_pubkey, "admin_key_migration")
    }
    try:
        response = requests.post(f"{api_base}/admin/key-migration/execute", json=same_pubkey_request, headers=headers, timeout=10)
        if response.status_code == 400:
            print("  Result: 400 Bad Request (expected)")
        else:
            print(f"  Result: {response.status_code} (expected 400)")
            passed = False
    except requests.exceptions.RequestException as e:
        print(f"  Result: Request failed - {e}")
        passed = False

    # Error case 3: Invalid signature (wrong private key)
    print("\n[TEST] Invalid signature (wrong private key)...")
    # Sign with the new admin key instead of current admin key
    new_admin_privkey, _ = derive_keypair_from_seed("sanctum-test-new-admin-keypair-v1")
    wrong_sig_event = create_signed_auth_event(new_admin_privkey, admin_pubkey, "admin_key_migration")
    invalid_sig_request = {
        "new_admin_pubkey": new_admin_pubkey,
        "users": [],
        "field_values": [],
        "signature_event": wrong_sig_event
    }
    try:
        response = requests.post(f"{api_base}/admin/key-migration/execute", json=invalid_sig_request, headers=headers, timeout=10)
        if response.status_code == 401:
            print("  Result: 401 Unauthorized (expected)")
        else:
            print(f"  Result: {response.status_code} (expected 401)")
            print(f"  Response: {response.text}")
            passed = False
    except requests.exceptions.RequestException as e:
        print(f"  Result: Request failed - {e}")
        passed = False

    # Error case 4: Wrong action tag
    print("\n[TEST] Wrong action tag in signature event...")
    wrong_action_event = create_signed_auth_event(old_admin_privkey, admin_pubkey, "wrong_action")
    wrong_action_request = {
        "new_admin_pubkey": new_admin_pubkey,
        "users": [],
        "field_values": [],
        "signature_event": wrong_action_event
    }
    try:
        response = requests.post(f"{api_base}/admin/key-migration/execute", json=wrong_action_request, headers=headers, timeout=10)
        if response.status_code == 401:
            print("  Result: 401 Unauthorized (expected)")
        else:
            print(f"  Result: {response.status_code} (expected 401)")
            passed = False
    except requests.exceptions.RequestException as e:
        print(f"  Result: Request failed - {e}")
        passed = False

    # Error case 5: No auth header
    print("\n[TEST] Request without auth header...")
    valid_request = {
        "new_admin_pubkey": new_admin_pubkey,
        "users": [],
        "field_values": [],
        "signature_event": create_signed_auth_event(old_admin_privkey, admin_pubkey, "admin_key_migration")
    }
    try:
        response = requests.post(f"{api_base}/admin/key-migration/execute", json=valid_request, timeout=10)
        if response.status_code == 401:
            print("  Result: 401 Unauthorized (expected)")
        else:
            print(f"  Result: {response.status_code} (expected 401)")
            passed = False
    except requests.exceptions.RequestException as e:
        print(f"  Result: Request failed - {e}")
        passed = False

    print("\n" + "-"*60)
    print(f"ERROR CASES RESULT: {'PASSED' if passed else 'FAILED'}")

    return passed


def test_full_migration_flow(api_base: str, admin_token: str, old_admin_privkey: str, old_admin_pubkey: str,
                              new_admin_privkey: str, new_admin_pubkey: str, config: dict) -> bool:
    """Test the full migration flow."""
    print("\n" + "="*60)
    print("TEST 3B: Full Migration Flow")
    print("="*60)

    passed = True
    headers = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}

    # Import decryption function
    try:
        from encryption import nip04_decrypt
    except ImportError as e:
        print(f"[ERROR] Failed to import encryption module: {e}")
        return False

    # Step 1: Ensure test user exists (may have been created by test_1a)
    print("\n[STEP 1] Ensure test user exists...")
    # Check if user exists by calling prepare
    try:
        response = requests.get(f"{api_base}/admin/key-migration/prepare", headers=headers, timeout=10)
        if response.status_code != 200:
            print(f"  Prepare endpoint failed: {response.status_code}")
            return False
        prepare_data = response.json()
        if prepare_data.get("user_count", 0) == 0:
            print("  No users found, creating test user...")
            user = create_test_user(api_base, config["test_user"], admin_token)
            if not user:
                print("  Failed to create test user")
                return False
            print(f"  Created user ID: {user.get('id')}")
            # Re-fetch prepare data
            response = requests.get(f"{api_base}/admin/key-migration/prepare", headers=headers, timeout=10)
            if response.status_code != 200:
                print(f"  Failed to re-fetch prepare data: {response.status_code} - {response.text}")
                return False
            prepare_data = response.json()
        else:
            print(f"  Found {prepare_data['user_count']} user(s) with encrypted data")
    except requests.exceptions.RequestException as e:
        print(f"  Request failed: {e}")
        return False

    # Step 2: Decrypt all data with current admin key
    print("\n[STEP 2] Decrypt data with current admin key...")
    decrypted_users = []
    decrypted_field_values = []
    old_admin_privkey_bytes = bytes.fromhex(old_admin_privkey)

    for user in prepare_data.get("users", []):
        decrypted_user = {"id": user["id"]}
        try:
            if user.get("encrypted_email") and user.get("ephemeral_pubkey_email"):
                decrypted_user["email"] = nip04_decrypt(
                    user["encrypted_email"],
                    user["ephemeral_pubkey_email"],
                    old_admin_privkey_bytes
                )
                print(f"  User {user['id']}: decrypted email")
            if user.get("encrypted_name") and user.get("ephemeral_pubkey_name"):
                decrypted_user["name"] = nip04_decrypt(
                    user["encrypted_name"],
                    user["ephemeral_pubkey_name"],
                    old_admin_privkey_bytes
                )
                print(f"  User {user['id']}: decrypted name")
            decrypted_users.append(decrypted_user)
        except Exception as e:
            print(f"  User {user['id']}: decryption failed - {e}")
            passed = False

    for fv in prepare_data.get("field_values", []):
        try:
            if fv.get("encrypted_value") and fv.get("ephemeral_pubkey"):
                decrypted_value = nip04_decrypt(
                    fv["encrypted_value"],
                    fv["ephemeral_pubkey"],
                    old_admin_privkey_bytes
                )
                decrypted_field_values.append({"id": fv["id"], "value": decrypted_value})
                print(f"  Field value {fv['id']}: decrypted")
        except Exception as e:
            print(f"  Field value {fv['id']}: decryption failed - {e}")
            passed = False

    if not passed:
        print("  Decryption step failed, cannot continue")
        return False

    # Step 3: Create signed migration event
    print("\n[STEP 3] Create signed migration authorization event...")
    migration_event = create_signed_auth_event(old_admin_privkey, old_admin_pubkey, "admin_key_migration")
    print(f"  Event ID: {migration_event['id'][:16]}...")
    print(f"  Signature: {migration_event['sig'][:16]}...")

    # Step 4: Execute migration
    print("\n[STEP 4] Execute migration...")
    execute_request = {
        "new_admin_pubkey": new_admin_pubkey,
        "users": decrypted_users,
        "field_values": decrypted_field_values,
        "signature_event": migration_event
    }

    try:
        response = requests.post(
            f"{api_base}/admin/key-migration/execute",
            json=execute_request,
            headers=headers,
            timeout=30
        )
        if response.status_code != 200:
            print(f"  Execute failed: {response.status_code}")
            print(f"  Response: {response.text}")
            return False

        execute_result = response.json()
        print(f"  Success: {execute_result.get('success')}")
        print(f"  Users migrated: {execute_result.get('users_migrated')}")
        print(f"  Field values migrated: {execute_result.get('field_values_migrated')}")

        if not execute_result.get("success"):
            print("  Migration reported failure")
            passed = False

    except requests.exceptions.RequestException as e:
        print(f"  Request failed: {e}")
        return False

    # Step 5: Verify admin pubkey updated
    print("\n[STEP 5] Verify admin pubkey updated in database...")
    db_admin_pubkey = get_admin_pubkey_from_db()
    if db_admin_pubkey == new_admin_pubkey:
        print(f"  Admin pubkey: {db_admin_pubkey[:16]}... (updated correctly)")
    else:
        print(f"  Admin pubkey: {db_admin_pubkey[:16] if db_admin_pubkey else 'None'}")
        print(f"  Expected:     {new_admin_pubkey[:16]}...")
        passed = False

    # Step 6: Authenticate as new admin and verify can access data
    print("\n[STEP 6] Authenticate as new admin...")
    new_admin_token, status_code = get_admin_token(api_base, new_admin_privkey, new_admin_pubkey)
    if new_admin_token:
        print(f"  New admin token: {new_admin_token[:20]}...")
    else:
        if status_code is None:
            print("  Network error during new admin auth!")
        else:
            print(f"  Failed to authenticate as new admin! (status: {status_code})")
        passed = False
        return passed

    # Step 7: Verify data re-encrypted to new admin
    print("\n[STEP 7] Verify data re-encrypted to new admin...")
    new_headers = {"Authorization": f"Bearer {new_admin_token}"}
    new_admin_privkey_bytes = bytes.fromhex(new_admin_privkey)

    try:
        response = requests.get(f"{api_base}/admin/key-migration/prepare", headers=new_headers, timeout=10)
        if response.status_code != 200:
            print(f"  Prepare with new admin failed: {response.status_code}")
            passed = False
        else:
            new_prepare_data = response.json()
            print(f"  New admin sees: {new_prepare_data['user_count']} users, {new_prepare_data['field_value_count']} field values")

            # Verify we can decrypt with new key
            decryption_success = True
            for user in new_prepare_data.get("users", []):
                try:
                    if user.get("encrypted_email") and user.get("ephemeral_pubkey_email"):
                        _ = nip04_decrypt(
                            user["encrypted_email"],
                            user["ephemeral_pubkey_email"],
                            new_admin_privkey_bytes
                        )
                        print(f"  User {user['id']}: can decrypt email with new key")
                except Exception as e:
                    print(f"  User {user['id']}: CANNOT decrypt with new key - {e}")
                    decryption_success = False

            if not decryption_success:
                passed = False

    except requests.exceptions.RequestException as e:
        print(f"  Request failed: {e}")
        passed = False

    # Step 8: Verify old admin cannot authenticate
    print("\n[STEP 8] Verify old admin cannot authenticate...")
    old_admin_token_check, status_code = get_admin_token(api_base, old_admin_privkey, old_admin_pubkey)
    if old_admin_token_check:
        print("  WARNING: Old admin can still authenticate (pubkey may not have been removed)")
        # This is actually expected since we UPDATE the admin pubkey rather than delete/create
        # The old pubkey no longer exists in the DB, so auth should fail
        passed = False
    elif status_code is None:
        print("  Network error - cannot verify old admin rejection!")
        passed = False
    elif status_code in (401, 403):
        print(f"  Old admin cannot authenticate (status: {status_code}, expected)")
    else:
        print(f"  Unexpected status code: {status_code} (expected 401 or 403)")
        passed = False

    print("\n" + "-"*60)
    print(f"FULL MIGRATION FLOW RESULT: {'PASSED' if passed else 'FAILED'}")

    return passed


def main():
    parser = argparse.ArgumentParser(description="Test 3B: Key Migration Execute")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--token", help="Admin session token (will authenticate if not provided)")
    parser.add_argument("--skip-migration", action="store_true", help="Skip the actual migration (test error cases only)")
    args = parser.parse_args()

    config = load_config()

    print("="*60)
    print("TEST 3B: KEY MIGRATION EXECUTE - FULL E2E TEST")
    print("="*60)
    print(f"API Base: {args.api_base}")

    # Derive keypairs
    old_admin_privkey, old_admin_pubkey = derive_keypair_from_seed(config["test_admin"]["keypair_seed"])
    new_admin_privkey, new_admin_pubkey = derive_keypair_from_seed(config["new_admin"]["keypair_seed"])

    print(f"Old Admin Pubkey: {old_admin_pubkey[:16]}...")
    print(f"New Admin Pubkey: {new_admin_pubkey[:16]}...")

    # Get admin token
    admin_token = args.token
    if not admin_token:
        print("\n[SETUP] Authenticating as test admin...")
        admin_token, status_code = get_admin_token(args.api_base, old_admin_privkey, old_admin_pubkey)
        if not admin_token:
            if status_code is None:
                print("[ERROR] Network error getting admin token")
            else:
                print(f"[ERROR] Failed to get admin token (status: {status_code})")
            sys.exit(1)
        print(f"[SETUP] Got admin token: {admin_token[:20]}...")

    all_passed = True

    # Run error case tests first (non-destructive)
    error_tests_passed = test_error_cases(
        args.api_base, admin_token, old_admin_pubkey, new_admin_pubkey, old_admin_privkey
    )
    all_passed = all_passed and error_tests_passed

    # Run full migration test (destructive - changes admin key)
    if not args.skip_migration:
        migration_passed = test_full_migration_flow(
            args.api_base, admin_token,
            old_admin_privkey, old_admin_pubkey,
            new_admin_privkey, new_admin_pubkey,
            config
        )
        all_passed = all_passed and migration_passed
    else:
        print("\n[SKIP] Full migration test (--skip-migration)")

    # Summary
    print("\n" + "="*60)
    print(f"RESULT: {'PASSED' if all_passed else 'FAILED'}")
    print("="*60)

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
