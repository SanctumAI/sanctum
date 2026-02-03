#!/usr/bin/env python3
import argparse
import os
import sqlite3
from typing import Iterable


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def mask_email(email: str) -> str:
    """Mask email for logging to avoid PII exposure."""
    at_idx = email.find('@')
    if at_idx > 2:
        return email[:2] + '***' + email[at_idx:]
    elif at_idx >= 0:
        return '***' + email[at_idx:]
    return '***'


def is_missing(value) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    return False


def fetch_duplicate_blind_indexes(cur: sqlite3.Cursor) -> list[str]:
    cur.execute(
        """
        SELECT email_blind_index, COUNT(*) AS count
        FROM users
        WHERE email_blind_index IS NOT NULL
        GROUP BY email_blind_index
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC
        """
    )
    return [row["email_blind_index"] for row in cur.fetchall()]


def fetch_duplicate_plain_emails(cur: sqlite3.Cursor) -> list[str]:
    cur.execute(
        """
        SELECT LOWER(email) AS email_norm, COUNT(*) AS count
        FROM users
        WHERE email_blind_index IS NULL
          AND email IS NOT NULL
          AND TRIM(email) != ''
        GROUP BY LOWER(email)
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC
        """
    )
    return [row["email_norm"] for row in cur.fetchall()]


def fetch_users_by_blind_index(cur: sqlite3.Cursor, blind_index: str) -> list[sqlite3.Row]:
    cur.execute(
        "SELECT * FROM users WHERE email_blind_index = ? ORDER BY id",
        (blind_index,)
    )
    return cur.fetchall()


def fetch_users_by_plain_email(cur: sqlite3.Cursor, email_norm: str) -> list[sqlite3.Row]:
    cur.execute(
        "SELECT * FROM users WHERE LOWER(email) = ? AND email_blind_index IS NULL ORDER BY id",
        (email_norm,)
    )
    return cur.fetchall()


def move_user_fields(cur: sqlite3.Cursor, keep_id: int, dup_id: int, apply: bool) -> int:
    cur.execute("SELECT field_id FROM user_field_values WHERE user_id = ?", (keep_id,))
    keep_fields = {row["field_id"] for row in cur.fetchall()}

    cur.execute(
        "SELECT id, field_id FROM user_field_values WHERE user_id = ?",
        (dup_id,)
    )
    dup_rows = cur.fetchall()

    moved = 0
    for row in dup_rows:
        if row["field_id"] in keep_fields:
            continue
        moved += 1
        if apply:
            cur.execute(
                "UPDATE user_field_values SET user_id = ? WHERE id = ?",
                (keep_id, row["id"])
            )

    return moved


def merge_user_rows(cur: sqlite3.Cursor, keep: sqlite3.Row, dup: sqlite3.Row, apply: bool) -> dict:
    keep_id = keep["id"]
    dup_id = dup["id"]
    updates = {}

    # Prefer existing keep values; fill gaps from duplicate
    if is_missing(keep["pubkey"]) and not is_missing(dup["pubkey"]):
        updates["pubkey"] = dup["pubkey"]

    if keep["user_type_id"] is None and dup["user_type_id"] is not None:
        updates["user_type_id"] = dup["user_type_id"]

    keep_approved = int(keep["approved"] or 0)
    dup_approved = int(dup["approved"] or 0)
    if dup_approved > keep_approved:
        updates["approved"] = dup_approved

    if is_missing(keep["encrypted_email"]) and not is_missing(dup["encrypted_email"]):
        updates["encrypted_email"] = dup["encrypted_email"]
        updates["ephemeral_pubkey_email"] = dup["ephemeral_pubkey_email"]
        if is_missing(keep["email_blind_index"]) and not is_missing(dup["email_blind_index"]):
            updates["email_blind_index"] = dup["email_blind_index"]

    if (
        is_missing(keep["email_blind_index"])
        and is_missing(keep["encrypted_email"])
        and is_missing(keep["email"])
        and not is_missing(dup["email"])
    ):
        updates["email"] = dup["email"]

    if is_missing(keep["encrypted_name"]) and not is_missing(dup["encrypted_name"]):
        updates["encrypted_name"] = dup["encrypted_name"]
        updates["ephemeral_pubkey_name"] = dup["ephemeral_pubkey_name"]

    if is_missing(keep["encrypted_name"]) and is_missing(keep["name"]) and not is_missing(dup["name"]):
        updates["name"] = dup["name"]

    moved_fields = move_user_fields(cur, keep_id, dup_id, apply)

    if apply and updates:
        columns = ", ".join([f"{key} = ?" for key in updates.keys()])
        values = list(updates.values()) + [keep_id]
        cur.execute(f"UPDATE users SET {columns} WHERE id = ?", values)

    if apply:
        cur.execute("DELETE FROM user_field_values WHERE user_id = ?", (dup_id,))
        cur.execute("DELETE FROM users WHERE id = ?", (dup_id,))

    return {
        "keep_id": keep_id,
        "dup_id": dup_id,
        "updated_columns": list(updates.keys()),
        "moved_fields": moved_fields,
    }


def group_pairs(users: Iterable[sqlite3.Row]) -> tuple[sqlite3.Row | None, list[sqlite3.Row]]:
    users = list(users)
    if not users:
        return None, []
    keep = users[-1]
    dups = users[:-1]
    return keep, dups


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Merge duplicate users by email/email_blind_index.",
    )
    parser.add_argument(
        "--db",
        default=os.getenv("SQLITE_PATH", "/data/sanctum.db"),
        help="Path to sanctum SQLite database (default: $SQLITE_PATH or /data/sanctum.db).",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes (default is dry-run).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit number of duplicate groups processed.",
    )
    args = parser.parse_args()

    if not os.path.exists(args.db):
        print(f"Database not found: {args.db}")
        return 1

    conn = connect(args.db)
    cur = conn.cursor()

    summary = []
    try:
        blind_groups = fetch_duplicate_blind_indexes(cur)
        plain_groups = fetch_duplicate_plain_emails(cur)

        groups_processed = 0

        def process_group(users: list[sqlite3.Row], label: str):
            nonlocal groups_processed
            if args.limit is not None and groups_processed >= args.limit:
                return
            keep, dups = group_pairs(users)
            if not keep or not dups:
                return
            groups_processed += 1
            for dup in dups:
                info = merge_user_rows(cur, keep, dup, args.apply)
                info["group"] = label
                summary.append(info)

        for blind_index in blind_groups:
            users = fetch_users_by_blind_index(cur, blind_index)
            process_group(users, f"blind:{blind_index[:12]}...")

        for email_norm in plain_groups:
            users = fetch_users_by_plain_email(cur, email_norm)
            process_group(users, f"email:{mask_email(email_norm)}")

        if args.apply:
            conn.commit()

    except Exception:
        if args.apply:
            conn.rollback()
        raise
    finally:
        conn.close()

    total_groups = len({item["group"] for item in summary})
    total_dups = len(summary)
    total_fields = sum(item["moved_fields"] for item in summary)

    print(f"Groups processed: {total_groups}")
    print(f"Duplicate users merged: {total_dups}")
    print(f"Field rows moved: {total_fields}")
    if not args.apply:
        print("Dry-run only. Re-run with --apply to make changes.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
