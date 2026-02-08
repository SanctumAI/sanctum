#!/usr/bin/env python3
"""
Test 3D: Phase 3 Config Security Regression

Validates Phase 3 hardening behavior:
1. Deployment secret values are encrypted at rest in SQLite
2. Secret reveal endpoint returns decrypted values correctly
3. Audit hash-chain verification remains valid with interleaved table events

Usage:
    python test_3d_phase3_config_integrity.py [--api-base http://localhost:8000]
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import requests
from coincurve import PrivateKey


SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent.parent.parent
COMPOSE_ARGS = [
    "docker", "compose",
    "-f", "docker-compose.infra.yml",
    "-f", "docker-compose.app.yml",
]
DEFAULT_DB_PATH = "/data/sanctum.db"
SECRET_PREFIX = "enc::v1::"


def load_config() -> dict:
    config_path = SCRIPT_DIR / "test-config.json"
    with open(config_path) as f:
        return json.load(f)


def derive_keypair_from_seed(seed: str) -> tuple[str, str]:
    privkey_hex = hashlib.sha256(seed.encode()).hexdigest()
    privkey = PrivateKey(bytes.fromhex(privkey_hex))
    pubkey_compressed = privkey.public_key.format(compressed=True)
    pubkey_x_only = pubkey_compressed[1:].hex()
    return privkey_hex, pubkey_x_only


def create_signed_auth_event(privkey_hex: str, pubkey_hex: str, action: str = "admin_auth") -> dict:
    event = {
        "pubkey": pubkey_hex,
        "created_at": int(time.time()),
        "kind": 22242,
        "tags": [["action", action]],
        "content": "",
    }
    serialized = json.dumps(
        [0, event["pubkey"], event["created_at"], event["kind"], event["tags"], event["content"]],
        separators=(",", ":"),
        ensure_ascii=False,
    )
    event_id = hashlib.sha256(serialized.encode()).hexdigest()
    event["id"] = event_id
    signer = PrivateKey(bytes.fromhex(privkey_hex))
    event["sig"] = signer.sign_schnorr(bytes.fromhex(event_id)).hex()
    return event


def auth_admin(api_base: str, privkey_hex: str, pubkey_hex: str) -> str | None:
    try:
        response = requests.post(
            f"{api_base}/admin/auth",
            json={"event": create_signed_auth_event(privkey_hex, pubkey_hex)},
            timeout=15,
        )
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] Admin auth request failed: {e}")
        return None

    if response.status_code != 200:
        print(f"[ERROR] Admin auth failed: {response.status_code} {response.text}")
        return None

    try:
        token = response.json().get("session_token")
    except Exception:
        token = None

    if not token:
        print("[ERROR] Admin auth response missing session_token")
        return None

    return token


def run_sqlite(sql: str, db_path: str) -> str:
    cmd = [*COMPOSE_ARGS, "exec", "-T", "backend", "sqlite3", "-readonly", db_path]
    result = subprocess.run(
        cmd,
        input=sql.strip(),
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"sqlite3 failed (exit {result.returncode}): {result.stderr.strip() or result.stdout.strip()}"
        )
    return result.stdout.strip()


def get_raw_config_value_from_db(key: str, db_path: str) -> str | None:
    escaped_key = key.replace("'", "''")
    output = run_sqlite(
        f"""
        SELECT value
        FROM deployment_config
        WHERE key = '{escaped_key}'
        LIMIT 1;
        """,
        db_path,
    )
    return output if output else None


def test_secret_encrypted_at_rest(api_base: str, headers: dict[str, str], db_path: str) -> bool:
    print("\n[TEST 3D.1] Secret-at-rest encryption")
    secret_key = "SMTP_PASS"
    test_secret = f"phase3-secret-{uuid.uuid4().hex}"

    try:
        update_response = requests.put(
            f"{api_base}/admin/deployment/config/{secret_key}",
            headers=headers,
            json={"value": test_secret},
            timeout=20,
        )
    except requests.exceptions.RequestException as e:
        print(f"  [FAIL] Update secret request failed: {e}")
        return False

    if update_response.status_code != 200:
        print(f"  [FAIL] Secret update failed: {update_response.status_code} {update_response.text}")
        return False

    try:
        reveal_response = requests.get(
            f"{api_base}/admin/deployment/config/{secret_key}/reveal",
            headers=headers,
            timeout=20,
        )
    except requests.exceptions.RequestException as e:
        print(f"  [FAIL] Reveal secret request failed: {e}")
        return False

    if reveal_response.status_code != 200:
        print(f"  [FAIL] Secret reveal failed: {reveal_response.status_code} {reveal_response.text}")
        return False

    try:
        revealed = reveal_response.json().get("value")
    except (ValueError, Exception):
        print(f"  [FAIL] Could not parse reveal response: {reveal_response.text}")
        return False
    if revealed != test_secret:
        print("  [FAIL] Revealed secret does not match updated value")
        return False

    try:
        raw_db_value = get_raw_config_value_from_db(secret_key, db_path)
    except Exception as e:
        print(f"  [FAIL] Could not read raw secret value from SQLite: {e}")
        return False

    if not raw_db_value:
        print("  [FAIL] Raw deployment_config value not found")
        return False

    if not raw_db_value.startswith(SECRET_PREFIX):
        print("  [FAIL] Raw value is not encrypted with expected prefix")
        return False

    if test_secret in raw_db_value:
        print("  [FAIL] Plaintext secret leaked in raw SQLite value")
        return False

    print("  [OK] Secret is encrypted at rest and reveal endpoint decrypts correctly")
    return True


def test_audit_chain_with_interleaved_tables(api_base: str, headers: dict[str, str]) -> bool:
    print("\n[TEST 3D.2] Audit chain verification with interleaved tables")
    deployment_key = "SMTP_HOST"
    deployment_value_a = f"audit-a-{uuid.uuid4().hex[:10]}.example.com"
    deployment_value_b = f"audit-b-{uuid.uuid4().hex[:10]}.example.com"

    try:
        ai_current = requests.get(
            f"{api_base}/admin/ai-config/temperature",
            headers=headers,
            timeout=20,
        )
    except requests.exceptions.RequestException as e:
        print(f"  [FAIL] Read AI config failed: {e}")
        return False

    if ai_current.status_code != 200:
        print(f"  [FAIL] Could not read AI config temperature: {ai_current.status_code} {ai_current.text}")
        return False

    current_temp = str(ai_current.json().get("value", "0.1"))
    temp_override = "0.2" if current_temp != "0.2" else "0.3"

    restore_temp = current_temp
    try:
        r1 = requests.put(
            f"{api_base}/admin/deployment/config/{deployment_key}",
            headers=headers,
            json={"value": deployment_value_a},
            timeout=20,
        )
        if r1.status_code != 200:
            print(f"  [FAIL] First deployment update failed: {r1.status_code} {r1.text}")
            return False

        r2 = requests.put(
            f"{api_base}/admin/ai-config/temperature",
            headers=headers,
            json={"value": temp_override},
            timeout=20,
        )
        if r2.status_code != 200:
            print(f"  [FAIL] AI config update failed: {r2.status_code} {r2.text}")
            return False

        r3 = requests.put(
            f"{api_base}/admin/deployment/config/{deployment_key}",
            headers=headers,
            json={"value": deployment_value_b},
            timeout=20,
        )
        if r3.status_code != 200:
            print(f"  [FAIL] Second deployment update failed: {r3.status_code} {r3.text}")
            return False

        verify_response = requests.get(
            f"{api_base}/admin/deployment/audit-log/verify",
            params={"table_name": "deployment_config"},
            headers=headers,
            timeout=20,
        )
        if verify_response.status_code != 200:
            print(f"  [FAIL] Audit verify endpoint failed: {verify_response.status_code} {verify_response.text}")
            return False

        payload = verify_response.json()
        if not payload.get("valid"):
            print(f"  [FAIL] Audit hash verification reported invalid chain: {payload}")
            return False

        if int(payload.get("checked_entries", 0)) <= 0:
            print(f"  [FAIL] Audit verify returned no checked deployment entries: {payload}")
            return False

        print(f"  [OK] Audit hash-chain verification passed: {payload}")
        return True
    finally:
        # Best-effort cleanup to reduce drift in local runs.
        try:
            requests.put(
                f"{api_base}/admin/ai-config/temperature",
                headers=headers,
                json={"value": restore_temp},
                timeout=20,
            )
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(description="Test 3D: Phase 3 config hardening regression")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--token", help="Optional pre-authenticated admin bearer token")
    parser.add_argument("--db-path", default=os.getenv("DB_PATH", DEFAULT_DB_PATH), help="SQLite path inside backend container")
    args = parser.parse_args()

    print("=" * 70)
    print("TEST 3D: PHASE 3 CONFIG SECURITY REGRESSION")
    print("=" * 70)
    print(f"API Base: {args.api_base}")
    print(f"DB Path: {args.db_path}")

    token = args.token
    if not token:
        config = load_config()
        admin_privkey, admin_pubkey = derive_keypair_from_seed(config["test_admin"]["keypair_seed"])
        print("\n[SETUP] Authenticating test admin...")
        token = auth_admin(args.api_base, admin_privkey, admin_pubkey)
        if not token:
            print("[ERROR] Could not authenticate admin. Run through harness or seed test admin first.")
            sys.exit(1)
        print(f"[SETUP] Admin token acquired ({token[:20]}...)")

    headers = {"Authorization": f"Bearer {token}"}

    results: list[tuple[str, bool]] = []
    results.append(("3D.1 Secret-at-rest encryption", test_secret_encrypted_at_rest(args.api_base, headers, args.db_path)))
    results.append(("3D.2 Scoped audit verify", test_audit_chain_with_interleaved_tables(args.api_base, headers)))

    print("\n" + "=" * 70)
    print("TEST 3D SUMMARY")
    print("=" * 70)
    for name, passed in results:
        print(f"  - {name}: {'PASSED' if passed else 'FAILED'}")

    all_passed = all(passed for _, passed in results)
    print(f"\nOVERALL RESULT: {'PASSED' if all_passed else 'FAILED'}")
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
