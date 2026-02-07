#!/usr/bin/env python3
"""
Master Test Runner for Sanctum Backend Integration Tests

Includes integrated test harness that:
1. Backs up current database
2. Resets to clean test state
3. Creates test admin with minimal schema
4. Runs all tests
5. Restores original database (default)

Usage:
    python run_all_be_tests.py                    # Full run with harness
    python run_all_be_tests.py --no-harness       # Skip harness, run tests only
    python run_all_be_tests.py --no-restore       # Keep test state after run
    python run_all_be_tests.py --reset-only       # Just reset, don't run tests
    python run_all_be_tests.py --restore          # Restore from backup
    python run_all_be_tests.py --list             # List tests without running
"""

import os
import sys
import re
import json
import shutil
import hashlib
import argparse
import subprocess
import time
from pathlib import Path
from datetime import datetime
from typing import List, Tuple, Optional

from coincurve import PrivateKey


SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent.parent
COMPOSE_CMD = "docker compose -f docker-compose.infra.yml -f docker-compose.app.yml"

# Paths
DOCKER_DB_PATH = "/data/sanctum.db"
LOCAL_BACKUP_DIR = SCRIPT_DIR / "backups"

# Domain mapping: test number -> domain name
DOMAIN_MAP = {
    "1": "CRM",
    "2": "RAG",
    "3": "AUTH",
    "4": "TOOLS",
}

# Config paths
CRM_CONFIG_PATH = SCRIPT_DIR / "CRM" / "test-config.json"


def load_crm_config() -> dict:
    """Load CRM test configuration (source of truth for test admin)."""
    with open(CRM_CONFIG_PATH) as f:
        return json.load(f)


# =============================================================================
# HARNESS FUNCTIONS
# =============================================================================

def run_docker_cmd(cmd: str, container: str = "backend") -> Tuple[int, str]:
    """Run a command inside the Docker container."""
    full_cmd = f"{COMPOSE_CMD} exec -T {container} {cmd}"
    result = subprocess.run(
        full_cmd,
        shell=True,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT
    )
    return result.returncode, result.stdout + result.stderr


def run_sql(sql: str) -> Tuple[int, str]:
    """Run SQL against the SQLite database in Docker."""
    escaped_sql = sql.replace("'", "'\\''")
    return run_docker_cmd(f"sqlite3 {DOCKER_DB_PATH} '{escaped_sql}'")


def check_docker_running() -> bool:
    """Check if Docker backend is accessible."""
    code, _ = run_docker_cmd("echo ok")
    return code == 0


def backup_database() -> Optional[Path]:
    """Backup the current database state."""
    LOCAL_BACKUP_DIR.mkdir(exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = LOCAL_BACKUP_DIR / f"sanctum_backup_{timestamp}.db"
    
    print(f"  [HARNESS] Backing up database...")
    
    cmd = f"{COMPOSE_CMD} cp backend:{DOCKER_DB_PATH} {backup_path}"
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=REPO_ROOT)
    
    if result.returncode != 0:
        print(f"  [HARNESS] ✗ Backup failed: {result.stderr}")
        return None
    
    print(f"  [HARNESS] ✓ Backed up ({backup_path.stat().st_size} bytes)")
    return backup_path


def restore_database(backup_path: Path) -> bool:
    """Restore database from a backup."""
    if not backup_path or not backup_path.exists():
        print(f"  [HARNESS] ✗ Backup not found")
        return False
    
    print(f"  [HARNESS] Restoring database...")
    
    cmd = f"{COMPOSE_CMD} cp {backup_path} backend:{DOCKER_DB_PATH}"
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=REPO_ROOT)
    
    if result.returncode != 0:
        print(f"  [HARNESS] ✗ Restore failed: {result.stderr}")
        return False
    
    print(f"  [HARNESS] ✓ Database restored")
    return True


def get_latest_backup() -> Optional[Path]:
    """Get the most recent backup file."""
    if not LOCAL_BACKUP_DIR.exists():
        return None
    backups = sorted(LOCAL_BACKUP_DIR.glob("sanctum_backup_*.db"), reverse=True)
    return backups[0] if backups else None


def reset_database() -> bool:
    """Reset the database to a clean state."""
    print(f"  [HARNESS] Resetting database...")

    # Delete from tables that definitely exist, ignore errors for optional tables
    core_tables_sql = """
    DELETE FROM user_field_values;
    DELETE FROM user_field_definitions;
    DELETE FROM users;
    DELETE FROM admins;
    DELETE FROM ingest_jobs;
    """

    code, output = run_sql(core_tables_sql)
    if code != 0:
        print(f"  [HARNESS] ✗ Reset failed: {output}")
        return False

    # Try optional tables (may not exist in all deployments)
    for optional_table in ["pending_users", "magic_links"]:
        run_sql(f"DELETE FROM {optional_table};")  # Ignore errors

    # Reset auto-increment counters
    run_sql("DELETE FROM sqlite_sequence WHERE name IN ('users', 'admins', 'user_field_definitions', 'user_field_values', 'ingest_jobs');")

    print(f"  [HARNESS] ✓ Tables cleared")
    return True


def derive_pubkey_from_seed(seed: str) -> str:
    """Derive x-only public key from a seed string."""
    privkey_hex = hashlib.sha256(seed.encode()).hexdigest()
    privkey = PrivateKey(bytes.fromhex(privkey_hex))
    pubkey_compressed = privkey.public_key.format(compressed=True)
    return pubkey_compressed[1:].hex()  # x-only (32 bytes)


def create_test_admin() -> bool:
    """Create a test admin using keypair derived from seed in CRM config."""
    print(f"  [HARNESS] Creating test admin...")

    config = load_crm_config()
    seed = config["test_admin"]["keypair_seed"]
    pubkey = derive_pubkey_from_seed(seed)

    sql = f"""
    INSERT OR REPLACE INTO admins (pubkey, created_at)
    VALUES ('{pubkey}', datetime('now'));
    """

    code, output = run_sql(sql)

    if code != 0:
        print(f"  [HARNESS] ✗ Admin creation failed: {output}")
        return False

    print(f"  [HARNESS] ✓ Test admin created ({pubkey[:16]}...)")
    return True


def create_user_fields_from_config() -> bool:
    """Create user field definitions based on CRM test config."""
    print(f"  [HARNESS] Creating user fields from config...")

    config = load_crm_config()
    test_fields = config.get("test_user", {}).get("fields", {})

    if not test_fields:
        print(f"  [HARNESS] ✗ No fields defined in CRM test-config.json")
        return False

    # Clear existing and insert fields from config
    sql_parts = ["DELETE FROM user_field_definitions;"]

    for i, field_name in enumerate(test_fields.keys(), start=1):
        # First field is required, rest are optional
        required = 1 if i == 1 else 0
        # Escape single quotes in field names for SQL safety
        escaped_name = field_name.replace("'", "''")
        sql_parts.append(
            f"INSERT INTO user_field_definitions (field_name, field_type, required, display_order) "
            f"VALUES ('{escaped_name}', 'text', {required}, {i});"
        )
    
    sql = " ".join(sql_parts)
    code, output = run_sql(sql)
    
    if code != 0:
        print(f"  [HARNESS] ✗ Field creation failed: {output}")
        return False
    
    print(f"  [HARNESS] ✓ Created {len(test_fields)} fields: {', '.join(test_fields.keys())}")
    return True


def restart_backend() -> bool:
    """Restart the backend container to pick up database changes."""
    print(f"  [HARNESS] Restarting backend to apply changes...")
    
    result = subprocess.run(
        f"{COMPOSE_CMD} restart backend",
        shell=True,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT
    )
    
    if result.returncode != 0:
        print(f"  [HARNESS] ✗ Restart failed: {result.stderr}")
        return False
    
    # Wait for backend to be healthy
    import time
    for i in range(30):
        time.sleep(1)
        check = subprocess.run(
            f"{COMPOSE_CMD} exec -T backend curl -sf http://localhost:8000/health",
            shell=True,
            capture_output=True,
            text=True,
            cwd=REPO_ROOT
        )
        if check.returncode == 0:
            print(f"  [HARNESS] ✓ Backend restarted and healthy")
            return True
    
    print(f"  [HARNESS] ✗ Backend did not become healthy")
    return False


def setup_test_environment() -> bool:
    """Full test environment setup (reads from CRM/test-config.json)."""
    if not reset_database():
        return False
    if not create_test_admin():
        return False
    if not create_user_fields_from_config():
        return False
    # Restart backend to pick up the database changes
    if not restart_backend():
        return False
    return True


# =============================================================================
# TEST DISCOVERY & RUNNING
# =============================================================================

def discover_tests(pattern: str = "test_*.py") -> List[Path]:
    """Discover all test files matching pattern in subdirectories."""
    tests = []
    
    for subdir in SCRIPT_DIR.iterdir():
        if subdir.is_dir() and not subdir.name.startswith(("__", "backups")):
            test_files = list(subdir.glob(pattern))
            tests.extend(test_files)
    
    def sort_key(path: Path) -> str:
        match = re.search(r'test_(\d+[a-z])_', path.name)
        if match:
            test_id = match.group(1)
            num_match = re.match(r'(\d+)([a-z])', test_id)
            if num_match:
                return f"{int(num_match.group(1)):03d}{num_match.group(2)}"
        return 'zzz'
    
    return sorted(tests, key=sort_key)


def parse_test_name(test_path: Path) -> dict:
    """Parse test filename to extract metadata."""
    name = test_path.stem
    match = re.match(r'test_(\d+)([a-z])_(.+)', name)
    
    if match:
        num = match.group(1)
        letter = match.group(2)
        description = match.group(3)
        
        return {
            "test_id": f"{num}{letter.upper()}",
            "number": num,
            "letter": letter.upper(),
            "domain": DOMAIN_MAP.get(num, test_path.parent.name.upper()),
            "description": description.replace("_", " ").title(),
            "full_name": name
        }
    
    return {
        "test_id": "?",
        "number": "?",
        "letter": "?",
        "domain": test_path.parent.name.upper(),
        "description": name,
        "full_name": name
    }


def run_test(test_path: Path, api_base: str, verbose: bool = False, extra_args: List[str] = None) -> Tuple[bool, float, str]:
    """Run a single test file."""
    cmd = [sys.executable, str(test_path), "--api-base", api_base]
    
    if extra_args:
        cmd.extend(extra_args)
    
    start_time = time.time()
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
            cwd=test_path.parent
        )
        
        duration = time.time() - start_time
        output = result.stdout + result.stderr
        passed = result.returncode == 0
        
        return passed, duration, output
        
    except subprocess.TimeoutExpired:
        duration = time.time() - start_time
        return False, duration, "TEST TIMEOUT (>5 minutes)"
        
    except Exception as e:
        duration = time.time() - start_time
        return False, duration, f"TEST ERROR: {e}"


# =============================================================================
# OUTPUT FORMATTING
# =============================================================================

def print_header(use_harness: bool):
    """Print test run header."""
    print()
    print("╔" + "═"*62 + "╗")
    print("║" + "SANCTUM BACKEND INTEGRATION TESTS".center(62) + "║")
    if use_harness:
        print("║" + "(with test harness)".center(62) + "║")
    print("╚" + "═"*62 + "╝")
    print()
    print(f"  Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()


def print_test_start(test_info: dict, test_path: Path):
    """Print test start banner."""
    test_id = test_info["test_id"]
    domain = test_info["domain"]
    desc = test_info["description"]
    
    print("─"*64)
    print(f"  TEST {test_id} [{domain}]: {desc}")
    print(f"  File: {test_path.relative_to(SCRIPT_DIR)}")
    print("─"*64)


def print_test_result(passed: bool, duration: float, output: str, verbose: bool):
    """Print test result."""
    status = "✓ PASSED" if passed else "✗ FAILED"
    status_color = "\033[92m" if passed else "\033[91m"
    reset_color = "\033[0m"
    
    print(f"\n  Result: {status_color}{status}{reset_color} ({duration:.1f}s)")
    
    if verbose or not passed:
        print()
        print("  Output:")
        for line in output.strip().split("\n"):
            print(f"    {line}")
    
    print()


def print_summary(results: List[Tuple[dict, bool, float]]):
    """Print final summary."""
    total = len(results)
    passed = sum(1 for _, p, _ in results if p)
    failed = total - passed
    total_time = sum(d for _, _, d in results)
    
    print()
    print("╔" + "═"*62 + "╗")
    print("║" + "TEST SUMMARY".center(62) + "║")
    print("╠" + "═"*62 + "╣")
    
    for info, p, duration in results:
        status = "✓" if p else "✗"
        test_id = info["test_id"]
        domain = info["domain"]
        desc = info["description"][:28]
        
        line = f"  {status} Test {test_id} [{domain}]: {desc}"
        line = line.ljust(50) + f"{duration:>6.1f}s"
        print("║" + line.ljust(62) + "║")
    
    print("╠" + "═"*62 + "╣")
    
    summary_line = f"  Total: {total} | Passed: {passed} | Failed: {failed} | Time: {total_time:.1f}s"
    print("║" + summary_line.ljust(62) + "║")
    
    print("╚" + "═"*62 + "╝")
    
    if failed > 0:
        print()
        print("\033[91m  ⚠ SOME TESTS FAILED\033[0m")
    else:
        print()
        print("\033[92m  ✓ ALL TESTS PASSED\033[0m")
    
    print()


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Run Sanctum backend integration tests with optional test harness",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_all_be_tests.py                    # Full run (harness + tests + restore)
  python run_all_be_tests.py --no-harness       # Run tests without harness
  python run_all_be_tests.py --no-restore       # Keep test state after run
  python run_all_be_tests.py --reset-only       # Just reset DB, don't run tests
  python run_all_be_tests.py --restore          # Restore from last backup
  python run_all_be_tests.py --pattern "test_2*" # Only RAG tests
  python run_all_be_tests.py --list             # List tests without running
        """
    )
    parser.add_argument(
        "--api-base", 
        default="http://localhost:8000",
        help="Backend API base URL (default: http://localhost:8000)"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show full test output even for passing tests"
    )
    parser.add_argument(
        "--pattern", "-p",
        default="test_*.py",
        help="Glob pattern to filter tests (default: test_*.py)"
    )
    parser.add_argument(
        "--list", "-l",
        action="store_true",
        help="List discovered tests without running them"
    )
    parser.add_argument(
        "--token",
        help="Admin session token to pass to tests requiring auth"
    )
    # Harness options
    parser.add_argument(
        "--no-harness",
        action="store_true",
        help="Skip test harness (don't reset DB)"
    )
    parser.add_argument(
        "--no-restore",
        action="store_true",
        help="Don't restore original database after tests"
    )
    parser.add_argument(
        "--reset-only",
        action="store_true",
        help="Only reset database, don't run tests"
    )
    parser.add_argument(
        "--restore",
        action="store_true",
        help="Restore database from most recent backup"
    )
    
    args = parser.parse_args()
    
    # Handle restore-only mode
    if args.restore:
        backup = get_latest_backup()
        if backup:
            print(f"\n  Restoring from: {backup.name}")
            restore_database(backup)
            sys.exit(0)
        else:
            print("\n  [ERROR] No backups found in backups/")
            sys.exit(1)
    
    # Discover tests
    tests = discover_tests(args.pattern)
    
    if not tests:
        print(f"No tests found matching pattern: {args.pattern}")
        sys.exit(1)
    
    # List mode
    if args.list:
        print(f"\nDiscovered {len(tests)} test(s):\n")
        for test_path in tests:
            info = parse_test_name(test_path)
            print(f"  Test {info['test_id']} [{info['domain']}]: {info['description']}")
            print(f"        → {test_path.relative_to(SCRIPT_DIR)}")
            print()
        sys.exit(0)
    
    use_harness = not args.no_harness
    backup_path = None
    
    # Print header
    print_header(use_harness)
    print(f"  API Base:  {args.api_base}")
    print(f"  Pattern:   {args.pattern}")
    print(f"  Tests:     {len(tests)} discovered")
    print(f"  Harness:   {'enabled' if use_harness else 'disabled'}")
    
    if use_harness:
        print()
        print("─"*64)
        print("  HARNESS: Setting up test environment")
        print("─"*64)
        
        # Check Docker
        if not check_docker_running():
            print("  [HARNESS] ✗ Cannot connect to Docker backend")
            print(f"  [HARNESS]   Run: {COMPOSE_CMD} up -d")
            sys.exit(1)
        
        # Backup
        backup_path = backup_database()
        if not backup_path:
            print("  [HARNESS] ✗ Backup failed, aborting")
            sys.exit(1)
        
        # Setup
        if not setup_test_environment():
            print("  [HARNESS] ✗ Setup failed, restoring backup...")
            restore_database(backup_path)
            sys.exit(1)
        
        print("  [HARNESS] ✓ Test environment ready")
        print()
        
        if args.reset_only:
            print("  [INFO] --reset-only specified, skipping tests")
            print(f"  [INFO] To restore: python {Path(__file__).name} --restore")
            sys.exit(0)
    
    # Run tests
    results = []
    extra_args = []
    
    if args.token:
        extra_args.extend(["--token", args.token])
    
    try:
        for test_path in tests:
            info = parse_test_name(test_path)
            
            print_test_start(info, test_path)
            
            passed, duration, output = run_test(
                test_path, 
                args.api_base, 
                args.verbose,
                extra_args
            )
            
            print_test_result(passed, duration, output, args.verbose)
            
            results.append((info, passed, duration))
        
        print_summary(results)
        
    except KeyboardInterrupt:
        print("\n\n  [INTERRUPTED] Cleaning up...")
    
    finally:
        # Restore database (default behavior)
        if use_harness and backup_path and not args.no_restore:
            print("─"*64)
            print("  HARNESS: Restoring original database")
            print("─"*64)
            restore_database(backup_path)
        elif use_harness and args.no_restore:
            print()
            print(f"  [INFO] --no-restore specified, keeping test state")
            print(f"  [INFO] To restore: python {Path(__file__).name} --restore")
    
    # Exit with error if any test failed
    all_passed = all(p for _, p, _ in results) if results else False
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
