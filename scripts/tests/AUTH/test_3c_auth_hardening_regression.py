#!/usr/bin/env python3
"""
Test 3C: Auth Hardening Regression Suite

Validates recent auth/security hardening behavior:
1. Ingest + vector-search auth gates
2. Query session ownership enforcement (cross-user access denied)
3. Cookie + CSRF middleware behavior for unsafe requests

Usage:
    python test_3c_auth_hardening_regression.py [--api-base http://localhost:8000]

Requirements:
    - Backend stack running
    - Test admin exists (run via scripts/tests/run_all_be_tests.py harness)
    - requests, coincurve, itsdangerous packages
"""

import os
import sys
import json
import uuid
import time
import hashlib
import argparse
import subprocess
import secrets
from pathlib import Path
from urllib.parse import urlparse

import requests
from itsdangerous import URLSafeTimedSerializer
try:
    from coincurve import PrivateKey
except Exception:
    PrivateKey = None


SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent.parent.parent
COMPOSE_ARGS = [
    "docker", "compose",
    "-f", "docker-compose.infra.yml",
    "-f", "docker-compose.app.yml",
]
DEFAULT_DB_PATH = "/data/sanctum.db"
DEFAULT_SECRET_KEY = "dev-secret-change-in-production"
ADMIN_SESSION_SALT = "admin-session"


def load_config() -> dict:
    config_path = SCRIPT_DIR / "test-config.json"
    with open(config_path) as f:
        return json.load(f)


def load_repo_env() -> dict[str, str]:
    """Parse repo .env (best-effort) for shared settings used by tests."""
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return {}

    values: dict[str, str] = {}
    for line in env_path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, raw_value = stripped.split("=", 1)
        key = key.strip()
        value = raw_value.strip()
        if value.startswith(("'", '"')) and value.endswith(("'", '"')) and len(value) >= 2:
            value = value[1:-1]
        values[key] = value
    return values


def load_backend_container_env() -> dict[str, str]:
    """
    Read backend container environment via `docker compose exec backend env`.
    Best-effort only; returns empty dict on failure.
    """
    try:
        result = subprocess.run(
            [*COMPOSE_ARGS, "exec", "-T", "backend", "env"],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            timeout=20,
        )
    except Exception:
        return {}

    if result.returncode != 0:
        return {}

    values: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values


def env_setting(
    key: str,
    fallback: str,
    backend_env_values: dict[str, str],
    env_file_values: dict[str, str],
) -> str:
    return os.getenv(key) or backend_env_values.get(key) or env_file_values.get(key) or fallback


def resolve_runtime_secret_key(
    backend_env_values: dict[str, str],
    env_file_values: dict[str, str],
    db_path: str,
) -> str:
    """
    Resolve backend runtime SECRET_KEY for offline token generation.

    Priority:
    1) Explicit SECRET_KEY from process/backend/.env
    2) Persisted key file next to SQLITE_PATH (e.g. /data/.secret_key)
    3) Legacy default (last resort)
    """
    explicit = os.getenv("SECRET_KEY") or backend_env_values.get("SECRET_KEY") or env_file_values.get("SECRET_KEY")
    if explicit:
        return explicit

    sqlite_path = (
        backend_env_values.get("SQLITE_PATH")
        or env_file_values.get("SQLITE_PATH")
        or db_path
        or DEFAULT_DB_PATH
    )
    secret_key_path = str(Path(sqlite_path).parent / ".secret_key")

    try:
        result = subprocess.run(
            [
                *COMPOSE_ARGS,
                "exec",
                "-T",
                "backend",
                "python",
                "-c",
                "import pathlib,sys; p=pathlib.Path(sys.argv[1]); print(p.read_text().strip() if p.exists() else '')",
                secret_key_path,
            ],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            timeout=20,
        )
    except Exception:
        result = None

    if result and result.returncode == 0:
        persisted = result.stdout.strip()
        if persisted:
            return persisted

    print(
        f"[WARN] SECRET_KEY not found in environment and persisted key unreadable at {secret_key_path}; "
        "falling back to default test key."
    )
    return DEFAULT_SECRET_KEY


def sql_quote(value: str) -> str:
    """Escape single quotes for sqlite string literals."""
    return value.replace("'", "''")


def run_sqlite(sql: str, db_path: str, *, readonly: bool = False, json_mode: bool = False) -> str:
    """Execute SQL inside backend container."""
    if not db_path or db_path.startswith("-"):
        raise ValueError(f"Invalid db_path: {db_path!r}")

    cmd = [*COMPOSE_ARGS, "exec", "-T", "backend", "sqlite3"]
    if readonly:
        cmd.append("-readonly")
    if json_mode:
        cmd.append("-json")
    cmd.append(db_path)

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


def run_sqlite_json(sql: str, db_path: str) -> list[dict]:
    output = run_sqlite(sql, db_path, readonly=True, json_mode=True)
    if not output:
        return []
    try:
        return json.loads(output)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to parse sqlite JSON output: {e}") from e


def derive_keypair_from_seed(seed: str) -> tuple[str, str]:
    """Return deterministic (privkey_hex, x_only_pubkey_hex)."""
    if PrivateKey is None:
        raise RuntimeError("coincurve is unavailable")
    privkey_hex = hashlib.sha256(seed.encode()).hexdigest()
    privkey = PrivateKey(bytes.fromhex(privkey_hex))
    pubkey_compressed = privkey.public_key.format(compressed=True)
    pubkey_x_only = pubkey_compressed[1:].hex()
    return privkey_hex, pubkey_x_only


def create_signed_auth_event(privkey_hex: str, pubkey_hex: str, action: str = "admin_auth") -> dict:
    if PrivateKey is None:
        raise RuntimeError("coincurve is unavailable")
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


def auth_admin(api_base: str, privkey_hex: str, pubkey_hex: str, session: requests.Session | None = None) -> tuple[str | None, requests.Response | None]:
    client = session if session is not None else requests
    try:
        response = client.post(
            f"{api_base}/admin/auth",
            json={"event": create_signed_auth_event(privkey_hex, pubkey_hex)},
            timeout=15,
        )
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] Admin auth request failed: {e}")
        return None, None

    if response.status_code != 200:
        print(f"[ERROR] Admin auth failed: {response.status_code} {response.text}")
        return None, response

    try:
        token = response.json().get("session_token")
    except Exception:
        token = None
    if not token:
        print("[ERROR] Admin auth succeeded but no session_token in response")
        return None, response

    return token, response


def normalize_origin(raw_origin: str) -> str:
    raw = (raw_origin or "").strip()
    if not raw or raw == "*":
        return ""
    parsed = urlparse(raw)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return raw.rstrip("/")


def resolve_allowed_origin(env_values: dict[str, str]) -> str:
    configured = env_values.get("CORS_ALLOW_ORIGINS") or env_values.get("CORS_ORIGINS") or ""
    candidates = [normalize_origin(part) for part in configured.split(",")]
    candidates = [c for c in candidates if c]
    if candidates:
        return candidates[0]

    frontend = normalize_origin(env_values.get("FRONTEND_URL", ""))
    if frontend:
        return frontend

    return "http://localhost:5173"


def user_session_token(secret_key: str, user_id: int, email: str) -> str:
    serializer = URLSafeTimedSerializer(secret_key)
    return serializer.dumps({"user_id": user_id, "email": email}, salt="session")


def admin_session_token(secret_key: str, admin_id: int, pubkey: str, session_nonce: int = 0) -> str:
    """Generate an admin bearer token without Nostr signing (offline fallback)."""
    serializer = URLSafeTimedSerializer(secret_key)
    return serializer.dumps(
        {
            "admin_id": admin_id,
            "pubkey": pubkey,
            "type": "admin",
            "session_nonce": session_nonce,
        },
        salt=ADMIN_SESSION_SALT,
    )


def offline_admin_token(secret_key: str, db_path: str) -> str | None:
    """
    Build a valid admin token directly from SQLite state.
    Useful when coincurve is unavailable in local test environments.
    """
    columns = run_sqlite_json("PRAGMA table_info(admins);", db_path)
    has_session_nonce = any(str(col.get("name")) == "session_nonce" for col in columns)
    select_sql = (
        "SELECT id, pubkey, COALESCE(session_nonce, 0) AS session_nonce FROM admins ORDER BY id ASC LIMIT 1;"
        if has_session_nonce
        else "SELECT id, pubkey, 0 AS session_nonce FROM admins ORDER BY id ASC LIMIT 1;"
    )
    rows = run_sqlite_json(select_sql, db_path)
    if not rows:
        return None
    row = rows[0]
    return admin_session_token(
        secret_key,
        admin_id=int(row["id"]),
        pubkey=str(row["pubkey"]),
        session_nonce=int(row.get("session_nonce", 0) or 0),
    )


def check_status(label: str, response: requests.Response, expected: set[int]) -> bool:
    ok = response.status_code in expected
    if ok:
        print(f"  [OK] {label}: {response.status_code}")
        return True

    detail = ""
    try:
        body = response.json()
        detail = str(body.get("detail") or body)[:180]
    except Exception:
        detail = response.text[:180]
    print(f"  [FAIL] {label}: got {response.status_code}, expected {sorted(expected)}; detail={detail!r}")
    return False


def create_approved_test_users(db_path: str) -> tuple[dict, dict]:
    suffix = uuid.uuid4().hex[:10]
    user_a = {
        "email": f"auth-owner-a-{suffix}@example.com",
        "name": "Owner A",
    }
    user_b = {
        "email": f"auth-owner-b-{suffix}@example.com",
        "name": "Owner B",
    }

    for user in (user_a, user_b):
        sql = (
            "INSERT INTO users (email, name, approved, created_at) "
            f"VALUES ('{sql_quote(user['email'])}', '{sql_quote(user['name'])}', 1, datetime('now'));"
        )
        run_sqlite(sql, db_path)

    rows = run_sqlite_json(
        "SELECT id, email FROM users "
        f"WHERE email IN ('{sql_quote(user_a['email'])}', '{sql_quote(user_b['email'])}') "
        "ORDER BY id ASC;",
        db_path,
    )
    if len(rows) != 2:
        raise RuntimeError(f"Expected 2 seeded users, found {len(rows)}")

    rows_by_email = {row["email"]: row for row in rows}
    user_a["id"] = int(rows_by_email[user_a["email"]]["id"])
    user_b["id"] = int(rows_by_email[user_b["email"]]["id"])
    return user_a, user_b


def test_ingest_vector_auth(api_base: str, admin_token: str) -> bool:
    print("\n" + "=" * 70)
    print("TEST 3C.1: Ingest + Vector Auth Gates")
    print("=" * 70)
    passed = True

    # Unauthenticated should be denied.
    try:
        passed &= check_status(
            "GET /ingest/pending (unauth)",
            requests.get(f"{api_base}/ingest/pending", timeout=10),
            {401},
        )
        passed &= check_status(
            "GET /ingest/stats (unauth)",
            requests.get(f"{api_base}/ingest/stats", timeout=10),
            {401},
        )
        passed &= check_status(
            "GET /ingest/status/{id} (unauth)",
            requests.get(f"{api_base}/ingest/status/not-a-real-job", timeout=10),
            {401},
        )
        passed &= check_status(
            "POST /vector-search (unauth)",
            requests.post(
                f"{api_base}/vector-search",
                json={"query": "auth regression", "top_k": 1},
                timeout=15,
            ),
            {401},
        )
    except requests.exceptions.RequestException as e:
        print(f"  [FAIL] Unauthenticated auth-gate checks request failure: {e}")
        return False

    headers = {"Authorization": f"Bearer {admin_token}"}
    try:
        passed &= check_status(
            "GET /ingest/pending (admin bearer)",
            requests.get(f"{api_base}/ingest/pending", headers=headers, timeout=10),
            {200},
        )
        passed &= check_status(
            "GET /ingest/stats (admin bearer)",
            requests.get(f"{api_base}/ingest/stats", headers=headers, timeout=10),
            {200},
        )
        passed &= check_status(
            "GET /ingest/status/{id} (admin bearer)",
            requests.get(f"{api_base}/ingest/status/not-a-real-job", headers=headers, timeout=10),
            {404},
        )

        vector_response = requests.post(
            f"{api_base}/vector-search",
            headers=headers,
            json={"query": "auth regression", "top_k": 1},
            timeout=20,
        )
        if vector_response.status_code in {401, 403}:
            print(f"  [FAIL] POST /vector-search (admin bearer): unexpected auth rejection {vector_response.status_code}")
            passed = False
        else:
            print(f"  [OK] POST /vector-search (admin bearer): auth passed with status {vector_response.status_code}")
    except requests.exceptions.RequestException as e:
        print(f"  [FAIL] Authenticated auth-gate checks request failure: {e}")
        return False

    print(f"\nTEST 3C.1 RESULT: {'PASSED' if passed else 'FAILED'}")
    return passed


def test_query_session_ownership(api_base: str, secret_key: str, db_path: str) -> bool:
    print("\n" + "=" * 70)
    print("TEST 3C.2: Query Session Ownership")
    print("=" * 70)
    passed = True

    user_a, user_b = create_approved_test_users(db_path)
    token_a = user_session_token(secret_key, user_a["id"], user_a["email"])
    token_b = user_session_token(secret_key, user_b["id"], user_b["email"])
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    session_id = f"ownership-{uuid.uuid4().hex[:12]}"
    print(f"  Seeded users: A(id={user_a['id']}), B(id={user_b['id']}); session_id={session_id}")

    try:
        create_response = requests.post(
            f"{api_base}/query",
            headers=headers_a,
            json={"question": "session ownership bootstrap", "session_id": session_id, "top_k": 1},
            timeout=30,
        )
    except requests.exceptions.RequestException as e:
        print(f"  [FAIL] POST /query bootstrap request failed: {e}")
        return False

    # Session is created before downstream LLM/vector work, so 200 or 500 both imply ownership state created.
    if create_response.status_code not in {200, 500}:
        print(f"  [FAIL] POST /query bootstrap: got {create_response.status_code}, expected 200/500")
        if create_response.status_code == 401:
            print("         Hint: generated user bearer token may not match backend SECRET_KEY.")
        return False
    print(f"  [OK] POST /query bootstrap: {create_response.status_code}")

    try:
        passed &= check_status(
            "GET /query/session/{id} by owner",
            requests.get(f"{api_base}/query/session/{session_id}", headers=headers_a, timeout=10),
            {200},
        )
        passed &= check_status(
            "GET /query/session/{id} by different user",
            requests.get(f"{api_base}/query/session/{session_id}", headers=headers_b, timeout=10),
            {403},
        )
        passed &= check_status(
            "POST /query with reused foreign session_id",
            requests.post(
                f"{api_base}/query",
                headers=headers_b,
                json={"question": "attempt hijack", "session_id": session_id, "top_k": 1},
                timeout=15,
            ),
            {403},
        )
        passed &= check_status(
            "DELETE /query/session/{id} by different user",
            requests.delete(f"{api_base}/query/session/{session_id}", headers=headers_b, timeout=10),
            {403},
        )
        passed &= check_status(
            "DELETE /query/session/{id} by owner",
            requests.delete(f"{api_base}/query/session/{session_id}", headers=headers_a, timeout=10),
            {200},
        )
        passed &= check_status(
            "GET /query/session/{id} after owner delete",
            requests.get(f"{api_base}/query/session/{session_id}", headers=headers_a, timeout=10),
            {404},
        )
    except requests.exceptions.RequestException as e:
        print(f"  [FAIL] Ownership assertions request failure: {e}")
        return False

    print(f"\nTEST 3C.2 RESULT: {'PASSED' if passed else 'FAILED'}")
    return passed


def test_cookie_csrf(
    api_base: str,
    admin_token: str,
    allowed_origin: str,
    csrf_cookie_name: str,
    admin_cookie_name: str,
    secret_key: str,
    db_path: str,
) -> bool:
    print("\n" + "=" * 70)
    print("TEST 3C.3: Cookie + CSRF Enforcement")
    print("=" * 70)
    passed = True

    # Always use a fresh bearer token derived from current admin DB nonce so
    # CSRF checks are independent from potentially stale caller-provided tokens.
    active_admin_token = offline_admin_token(secret_key, db_path) or admin_token
    if active_admin_token != admin_token:
        print("  [OK] Refreshed admin bearer token for CSRF/bearer assertions")

    admin_session = requests.Session()
    csrf_token = secrets.token_urlsafe(32)
    admin_session.cookies.set(admin_cookie_name, active_admin_token)
    admin_session.cookies.set(csrf_cookie_name, csrf_token)
    print(f"  [OK] Seeded cookie session ({admin_cookie_name}) and CSRF token ({csrf_cookie_name})")

    # Missing token -> blocked
    try:
        passed &= check_status(
            "POST /admin/logout cookie-auth + origin, missing CSRF header",
            admin_session.post(
                f"{api_base}/admin/logout",
                headers={"Origin": allowed_origin},
                timeout=10,
            ),
            {403},
        )

        passed &= check_status(
            "POST /admin/logout cookie-auth + wrong CSRF token",
            admin_session.post(
                f"{api_base}/admin/logout",
                headers={
                    "Origin": allowed_origin,
                    "X-CSRF-Token": "invalid-token",
                },
                timeout=10,
            ),
            {403},
        )

        passed &= check_status(
            "POST /admin/logout cookie-auth + wrong origin",
            admin_session.post(
                f"{api_base}/admin/logout",
                headers={
                    "Origin": "http://evil.example",
                    "X-CSRF-Token": csrf_token,
                },
                timeout=10,
            ),
            {403},
        )

        # Bearer requests should not require CSRF header.
        bearer_response = requests.post(
            f"{api_base}/vector-search",
            headers={"Authorization": f"Bearer {active_admin_token}"},
            json={"query": "csrf bearer bypass check", "top_k": 1},
            timeout=20,
        )
        if bearer_response.status_code in {401, 403}:
            print(f"  [FAIL] POST /vector-search bearer (no CSRF) rejected with {bearer_response.status_code}")
            passed = False
        else:
            print(f"  [OK] POST /vector-search bearer (no CSRF) status {bearer_response.status_code}")

        passed &= check_status(
            "POST /admin/logout cookie-auth + valid origin + valid CSRF token",
            admin_session.post(
                f"{api_base}/admin/logout",
                headers={
                    "Origin": allowed_origin,
                    "X-CSRF-Token": csrf_token,
                },
                timeout=10,
            ),
            {200},
        )

        passed &= check_status(
            "GET /ingest/pending with revoked admin bearer token",
            requests.get(
                f"{api_base}/ingest/pending",
                headers={"Authorization": f"Bearer {active_admin_token}"},
                timeout=10,
            ),
            {401},
        )
    except requests.exceptions.RequestException as e:
        print(f"  [FAIL] Cookie/CSRF checks request failure: {e}")
        return False

    print(f"\nTEST 3C.3 RESULT: {'PASSED' if passed else 'FAILED'}")
    return passed


def main() -> None:
    parser = argparse.ArgumentParser(description="Test 3C: Auth hardening regression")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--token", help="Optional pre-authenticated admin bearer token")
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH, help="SQLite path inside backend container")
    args = parser.parse_args()

    repo_env_values = load_repo_env()
    backend_env_values = load_backend_container_env()
    merged_env_values = {**repo_env_values, **backend_env_values}

    secret_key = resolve_runtime_secret_key(backend_env_values, repo_env_values, args.db_path)
    csrf_cookie_name = env_setting("CSRF_COOKIE_NAME", "sanctum_csrf", backend_env_values, repo_env_values)
    admin_cookie_name = env_setting("ADMIN_SESSION_COOKIE_NAME", "sanctum_admin_session", backend_env_values, repo_env_values)
    allowed_origin = resolve_allowed_origin(merged_env_values)

    print("=" * 70)
    print("TEST 3C: AUTH HARDENING REGRESSION")
    print("=" * 70)
    print(f"API Base: {args.api_base}")
    print(f"Allowed Origin (for CSRF test): {allowed_origin}")
    print(f"CSRF Cookie Name: {csrf_cookie_name}")
    print(f"Admin Cookie Name: {admin_cookie_name}")

    admin_token = args.token
    if not admin_token:
        if PrivateKey is not None:
            config = load_config()
            admin_privkey, admin_pubkey = derive_keypair_from_seed(config["test_admin"]["keypair_seed"])
            print("\n[SETUP] Authenticating as test admin...")
            admin_token, response = auth_admin(args.api_base, admin_privkey, admin_pubkey)
            if not admin_token:
                if response is None:
                    print("[WARN] Could not reach backend for signed admin auth")
                else:
                    print("[WARN] Signed admin auth failed. Trying offline token fallback.")

        if not admin_token:
            print("\n[SETUP] Building offline admin token from DB + SECRET_KEY...")
            admin_token = offline_admin_token(secret_key, args.db_path)
            if not admin_token:
                print("[ERROR] Could not derive admin token (no admin row found?)")
                sys.exit(1)

        print(f"[SETUP] Admin token acquired ({admin_token[:20]}...)")

    results: list[tuple[str, bool]] = []
    results.append(("3C.1 Ingest + vector auth", test_ingest_vector_auth(args.api_base, admin_token)))
    results.append(("3C.2 Query session ownership", test_query_session_ownership(args.api_base, secret_key, args.db_path)))
    results.append((
        "3C.3 Cookie + CSRF",
        test_cookie_csrf(
            args.api_base,
            admin_token,
            allowed_origin,
            csrf_cookie_name,
            admin_cookie_name,
            secret_key,
            args.db_path,
        ),
    ))

    print("\n" + "=" * 70)
    print("TEST 3C SUMMARY")
    print("=" * 70)
    for name, passed in results:
        status = "PASSED" if passed else "FAILED"
        print(f"  - {name}: {status}")

    all_passed = all(p for _, p in results)
    print(f"\nOVERALL RESULT: {'PASSED' if all_passed else 'FAILED'}")
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
