#!/usr/bin/env python3
"""
Test 3A: Key Migration Prepare Endpoint

Tests the /admin/key-migration/prepare endpoint:
- Returns 200 for authenticated admin
- Response includes admin_pubkey matching current admin
- Response includes users array with encrypted data
- Response includes field_values array
- user_count and field_value_count match array lengths
- Encrypted data has valid NIP-04 format
- Returns 401 without auth token

Usage:
    python test_3a_key_migration_prepare.py [--api-base http://localhost:8000]

Requirements:
    - Backend must be running
    - coincurve package
    - Test admin must exist (created by harness)
    - At least one user with encrypted data (created by test_1a)
"""

import os
import sys
import json
import time
import hashlib
import argparse
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

    Args:
        privkey_hex: Private key as hex string
        pubkey_hex: Public key as hex string
        action: Action tag value (default: "admin_auth")

    Returns:
        Signed Nostr event dict
    """
    event = {
        "pubkey": pubkey_hex,
        "created_at": int(time.time()),
        "kind": 22242,
        "tags": [["action", action]],
        "content": ""
    }

    # Compute event ID (sha256 of serialized event)
    serialized = json.dumps([
        0,
        event["pubkey"],
        event["created_at"],
        event["kind"],
        event["tags"],
        event["content"]
    ], separators=(',', ':'), ensure_ascii=False)
    event_id = hashlib.sha256(serialized.encode()).hexdigest()
    event["id"] = event_id

    # Sign with Schnorr (BIP-340)
    privkey = PrivateKey(bytes.fromhex(privkey_hex))
    sig = privkey.sign_schnorr(bytes.fromhex(event_id))
    event["sig"] = sig.hex()

    return event


def get_admin_token(api_base: str, privkey_hex: str, pubkey_hex: str) -> str | None:
    """
    Authenticate as admin and return session token.

    Signs an admin_auth event and submits to /admin/auth endpoint.
    """
    event = create_signed_auth_event(privkey_hex, pubkey_hex, "admin_auth")

    try:
        response = requests.post(
            f"{api_base}/admin/auth",
            json={"event": event},
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            return data.get("session_token")
        else:
            print(f"[ERROR] Admin auth failed: {response.status_code}")
            print(f"  Response: {response.text}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] Admin auth request failed: {e}")
        return None


def test_prepare_endpoint(api_base: str, admin_token: str, admin_pubkey: str) -> tuple[bool, dict]:
    """
    Test 3A: Test the prepare endpoint.

    Returns (passed, prepare_response) for use by subsequent tests.
    """
    print("\n" + "="*60)
    print("TEST 3A: Key Migration Prepare Endpoint")
    print("="*60)

    passed = True
    prepare_response = {}

    # Test 1: Without auth token (should fail)
    print("\n[TEST] Request without auth token...")
    try:
        response = requests.get(f"{api_base}/admin/key-migration/prepare", timeout=10)
        if response.status_code == 401:
            print("  Result: 401 Unauthorized (expected)")
        else:
            print(f"  Result: {response.status_code} (expected 401)")
            passed = False
    except requests.exceptions.RequestException as e:
        print(f"  Result: Request failed - {e}")
        passed = False

    # Test 2: With valid auth token
    print("\n[TEST] Request with valid auth token...")
    headers = {"Authorization": f"Bearer {admin_token}"}

    try:
        response = requests.get(
            f"{api_base}/admin/key-migration/prepare",
            headers=headers,
            timeout=10
        )

        if response.status_code != 200:
            print(f"  Result: {response.status_code} (expected 200)")
            print(f"  Response: {response.text}")
            passed = False
            return passed, prepare_response

        print("  Result: 200 OK")
        prepare_response = response.json()

    except requests.exceptions.RequestException as e:
        print(f"  Result: Request failed - {e}")
        passed = False
        return passed, prepare_response

    # Test 3: Verify response schema
    print("\n[CHECK] Response schema validation...")

    required_fields = ["admin_pubkey", "users", "field_values", "user_count", "field_value_count"]
    for field in required_fields:
        if field in prepare_response:
            print(f"  {field}: present")
        else:
            print(f"  {field}: MISSING")
            passed = False

    # Test 4: Verify admin_pubkey matches
    print("\n[CHECK] Admin pubkey matches current admin...")
    response_pubkey = prepare_response.get("admin_pubkey", "")
    if response_pubkey == admin_pubkey:
        print(f"  admin_pubkey: {response_pubkey[:16]}... (matches)")
    else:
        print(f"  admin_pubkey: {response_pubkey[:16]}... (MISMATCH)")
        print(f"  Expected:     {admin_pubkey[:16]}...")
        passed = False

    # Test 5: Verify counts match array lengths
    print("\n[CHECK] Counts match array lengths...")
    users = prepare_response.get("users", [])
    field_values = prepare_response.get("field_values", [])
    user_count = prepare_response.get("user_count", -1)
    field_value_count = prepare_response.get("field_value_count", -1)

    if user_count == len(users):
        print(f"  user_count: {user_count} (matches)")
    else:
        print(f"  user_count: {user_count} (MISMATCH, array has {len(users)})")
        passed = False

    if field_value_count == len(field_values):
        print(f"  field_value_count: {field_value_count} (matches)")
    else:
        print(f"  field_value_count: {field_value_count} (MISMATCH, array has {len(field_values)})")
        passed = False

    # Test 6: Verify encrypted data format (NIP-04)
    print("\n[CHECK] Encrypted data has valid NIP-04 format...")

    def is_nip04_format(value: str | None) -> bool:
        """Check if value looks like NIP-04 ciphertext."""
        if not value:
            return False
        return "?iv=" in value and len(value) > 30

    encrypted_fields_checked = 0
    encrypted_fields_valid = 0

    for user in users:
        for field_name in ["encrypted_email", "encrypted_name"]:
            value = user.get(field_name)
            if value:
                encrypted_fields_checked += 1
                if is_nip04_format(value):
                    encrypted_fields_valid += 1

    for fv in field_values:
        value = fv.get("encrypted_value")
        if value:
            encrypted_fields_checked += 1
            if is_nip04_format(value):
                encrypted_fields_valid += 1

    if encrypted_fields_checked == 0:
        print("  WARNING: No encrypted fields found (test may need user data)")
        passed = False
    elif encrypted_fields_valid == encrypted_fields_checked:
        print(f"  {encrypted_fields_valid}/{encrypted_fields_checked} encrypted fields have valid NIP-04 format")
    else:
        print(f"  {encrypted_fields_valid}/{encrypted_fields_checked} encrypted fields have valid NIP-04 format (SOME INVALID)")
        passed = False

    # Summary
    print("\n" + "-"*60)
    print(f"TEST 3A RESULT: {'PASSED' if passed else 'FAILED'}")

    return passed, prepare_response


def main():
    parser = argparse.ArgumentParser(description="Test 3A: Key Migration Prepare")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--token", help="Admin session token (will authenticate if not provided)")
    args = parser.parse_args()

    config = load_config()

    print("="*60)
    print("TEST 3A: KEY MIGRATION PREPARE ENDPOINT")
    print("="*60)
    print(f"API Base: {args.api_base}")

    # Derive test admin keypair
    admin_privkey, admin_pubkey = derive_keypair_from_seed(config["test_admin"]["keypair_seed"])
    print(f"Test Admin Pubkey: {admin_pubkey[:16]}...")

    # Get admin token
    admin_token = args.token
    if not admin_token:
        print("\n[SETUP] Authenticating as test admin...")
        admin_token = get_admin_token(args.api_base, admin_privkey, admin_pubkey)
        if not admin_token:
            print("[ERROR] Failed to get admin token")
            sys.exit(1)
        print("[SETUP] Obtained admin token")

    # Run test
    passed, _ = test_prepare_endpoint(args.api_base, admin_token, admin_pubkey)

    # Summary
    print("\n" + "="*60)
    print(f"RESULT: {'PASSED' if passed else 'FAILED'}")
    print("="*60)

    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
