#!/usr/bin/env python3
"""
Shared test helpers for CRM encryption tests.

Provides common utilities for running SQL queries against the SQLite database
inside Docker containers.
"""

import subprocess
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent.parent.parent


def run_docker_sql(
    sql: str,
    db_path: str = "/data/sanctum.db",
    timeout: int = 30,
    csv_mode: bool = False,
) -> str:
    """
    Run read-only SQL inside Docker container and return output.

    Security: Uses stdin to pass SQL (avoids shell injection), and
    validates that only a single SELECT (or WITH...SELECT) statement is allowed.

    Args:
        sql: SELECT or WITH...SELECT statement to execute
        db_path: Path to SQLite database file
        timeout: Command timeout in seconds
        csv_mode: If True, output in CSV format (handles embedded commas/quotes/newlines).
                  If False, uses JSON format for structured output.

    Returns:
        Query output as a string (JSON array or CSV rows depending on mode)

    Raises:
        ValueError: If SQL is not a single SELECT/WITH statement or db_path is invalid
        RuntimeError: If sqlite3 command fails or times out
    """
    # Validate db_path to prevent option injection (paths starting with "-")
    if not db_path or db_path.startswith("-"):
        raise ValueError(f"Invalid db_path: {db_path!r}")

    # Normalize: strip whitespace and trailing semicolons
    sql_normalized = sql.strip().rstrip(";").strip()

    # Reject multi-statement input (internal semicolons)
    if ";" in sql_normalized:
        raise ValueError(f"run_docker_sql only allows single statements, got: {sql[:50]}")

    # Validate: only allow SELECT or WITH (CTE) statements (defense-in-depth for test helper)
    sql_upper = sql_normalized.upper()
    if not (sql_upper.startswith("SELECT") or sql_upper.startswith("WITH")):
        raise ValueError(f"run_docker_sql only allows SELECT/WITH statements, got: {sql[:50]}")

    # Build command arguments based on output mode
    # Use -readonly flag to enforce read-only at the file handle level (defense-in-depth)
    if csv_mode:
        # CSV mode: pass .mode csv pragma via stdin
        sql_input = f".mode csv\n{sql_normalized}"
        cmd = ["docker", "compose", "exec", "-T", "backend", "sqlite3", "-readonly", db_path]
    else:
        # JSON mode: use -json flag
        sql_input = sql_normalized
        cmd = ["docker", "compose", "exec", "-T", "backend", "sqlite3", "-readonly", "-json", db_path]

    # Use list argv with stdin for SQL (no shell=True, no escaping needed)
    try:
        result = subprocess.run(  # noqa: S603
            cmd,
            input=sql_input,
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"sqlite3 command timed out after {timeout}s") from e

    # Surface sqlite3 failures
    if result.returncode != 0:
        raise RuntimeError(
            f"sqlite3 failed (exit {result.returncode}): {result.stderr.strip() or result.stdout.strip()}"
        )

    return result.stdout.strip()
