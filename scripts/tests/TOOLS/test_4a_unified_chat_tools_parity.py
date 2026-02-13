#!/usr/bin/env python3
"""
Test 4A: Unified Admin Chat Tool Parity

Verifies that the two admin entry-point payload shapes sent to /llm/chat
produce the same tools_used behavior:

1) Full chat page style: no tool_context override
2) Admin config bubble style: tool_context + client_executed_tools=[]

Also verifies client-executed db-query reporting (no duplicate execution) when:
tool_context + client_executed_tools=["db-query"].

Usage:
  python test_4a_unified_chat_tools_parity.py --admin-token <token>

Auth options:
  --admin-token <token>     Uses Authorization: Bearer <token>
  --cookie-header "<raw>"   Uses Cookie: <raw> (for browser-exported admin cookie)
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest
from urllib.parse import urlparse


DEFAULT_MESSAGE = "How many users are in the system?"
DEFAULT_TOOL_CONTEXT = "ADMIN CONFIG SNAPSHOT TEST CONTEXT"


@dataclass
class CaseResult:
    name: str
    ok: bool
    status_code: int
    tool_ids: list[str]
    error: str | None = None
    raw_tools_used: list[dict[str, Any]] | None = None


def _post_chat(api_base: str, headers: dict[str, str], payload: dict[str, Any], timeout: float) -> CaseResult:
    name = payload.get("_case_name", "unnamed")
    payload = {k: v for k, v in payload.items() if not k.startswith("_")}
    body = json.dumps(payload).encode("utf-8")
    req = urlrequest.Request(
        url=f"{api_base.rstrip('/')}/llm/chat",
        data=body,
        headers=headers,
        method="POST",
    )

    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            status_code = int(resp.getcode() or 0)
            raw = resp.read().decode("utf-8", errors="replace")
    except urlerror.HTTPError as exc:
        status_code = int(exc.code or 0)
        raw = exc.read().decode("utf-8", errors="replace")
    except (urlerror.URLError, TimeoutError, OSError) as exc:
        return CaseResult(name=name, ok=False, status_code=0, tool_ids=[], error=f"Request failed: {exc}")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        if status_code == 200:
            return CaseResult(
                name=name,
                ok=False,
                status_code=status_code,
                tool_ids=[],
                error=f"Invalid JSON in 200 response: {raw}",
            )
        data = {"detail": raw}

    if status_code != 200:
        detail = data.get("detail") if isinstance(data, dict) else str(data)
        return CaseResult(name=name, ok=False, status_code=status_code, tool_ids=[], error=f"HTTP {status_code}: {detail}")

    tools_used = data.get("tools_used", []) if isinstance(data, dict) else []
    tool_ids = sorted({str(t.get("tool_id")) for t in tools_used if isinstance(t, dict) and t.get("tool_id")})
    return CaseResult(
        name=name,
        ok=True,
        status_code=status_code,
        tool_ids=tool_ids,
        raw_tools_used=tools_used if isinstance(tools_used, list) else [],
    )


def _print_case(result: CaseResult) -> None:
    if result.ok:
        print(f"[PASS] {result.name}")
        print(f"       tools_used={result.tool_ids}")
        if result.raw_tools_used is not None and len(result.raw_tools_used) != len({t.get('tool_id') for t in result.raw_tools_used if isinstance(t, dict)}):
            print("       note: duplicate tool_id entries detected in tools_used")
    else:
        print(f"[FAIL] {result.name}")
        print(f"       {result.error}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Test 4A: Unified admin chat tools parity")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL (default: http://localhost:8000)")
    parser.add_argument("--admin-token", help="Admin bearer token")
    parser.add_argument("--cookie-header", help="Raw Cookie header value")
    parser.add_argument("--message", default=DEFAULT_MESSAGE, help="Prompt sent to /llm/chat")
    parser.add_argument("--timeout", type=float, default=90.0, help="HTTP timeout seconds")
    args = parser.parse_args()

    if not args.admin_token and not args.cookie_header:
        print("[ERROR] Provide either --admin-token or --cookie-header")
        return 2

    parsed = urlparse(args.api_base)
    if parsed.scheme not in ("http", "https"):
        print(f"[ERROR] api_base must use http or https scheme, got: {args.api_base}")
        return 2

    headers = {"Content-Type": "application/json"}
    if args.admin_token:
        headers["Authorization"] = f"Bearer {args.admin_token}"
    if args.cookie_header:
        headers["Cookie"] = args.cookie_header

    print("=" * 72)
    print("TEST 4A: UNIFIED ADMIN CHAT TOOL PARITY")
    print("=" * 72)
    print(f"API Base: {args.api_base.rstrip('/')}")
    print(f"Message: {args.message}")
    print("")

    failures = 0

    parity_tool_sets = [
        ("web-search", ["web-search"]),
        ("db-query", ["db-query"]),
        ("web-search + db-query", ["web-search", "db-query"]),
    ]

    for label, tools in parity_tool_sets:
        full_case = {
            "_case_name": f"full-chat payload ({label})",
            "message": args.message,
            "tools": tools,
        }
        bubble_case = {
            "_case_name": f"bubble payload ({label})",
            "message": args.message,
            "tools": tools,
            "tool_context": DEFAULT_TOOL_CONTEXT,
            "client_executed_tools": [],
        }

        full_res = _post_chat(args.api_base, headers, full_case, args.timeout)
        bubble_res = _post_chat(args.api_base, headers, bubble_case, args.timeout)

        _print_case(full_res)
        _print_case(bubble_res)

        if not full_res.ok:
            failures += 1
        if not bubble_res.ok:
            failures += 1

        if full_res.ok and bubble_res.ok:
            if full_res.tool_ids == bubble_res.tool_ids:
                print(f"[PASS] parity check ({label})")
            else:
                failures += 1
                print(f"[FAIL] parity check ({label})")
                print(f"       full-chat tools_used={full_res.tool_ids}")
                print(f"       bubble   tools_used={bubble_res.tool_ids}")
        print("")

    preexec_case = {
        "_case_name": "bubble payload with client-executed db-query",
        "message": args.message,
        "tools": ["db-query", "web-search"],
        "tool_context": "DB QUERY DECRYPTED CONTEXT TEST",
        "client_executed_tools": ["db-query"],
    }
    preexec_res = _post_chat(args.api_base, headers, preexec_case, args.timeout)
    _print_case(preexec_res)
    if not preexec_res.ok:
        failures += 1
    else:
        expected = ["db-query", "web-search"]
        if preexec_res.tool_ids == expected:
            print("[PASS] client-executed db-query reporting (no missing tools)")
        else:
            failures += 1
            print("[FAIL] client-executed db-query reporting")
            print(f"       expected={expected}")
            print(f"       got={preexec_res.tool_ids}")

    print("")
    print("-" * 72)
    if failures == 0:
        print("TEST 4A RESULT: PASSED")
        return 0

    print(f"TEST 4A RESULT: FAILED ({failures} issue(s))")
    return 1


if __name__ == "__main__":
    sys.exit(main())
