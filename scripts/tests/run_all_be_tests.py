#!/usr/bin/env python3
"""
Master Test Runner for Sanctum Backend Integration Tests

Dynamically discovers and runs all test_*.py files in subdirectories.

Usage:
    python run_all_be_tests.py [--api-base URL] [--verbose] [--pattern GLOB]

Example:
    python run_all_be_tests.py --api-base http://localhost:8000 --verbose
"""

import os
import sys
import re
import glob
import argparse
import subprocess
import time
from pathlib import Path
from datetime import datetime
from typing import List, Tuple


SCRIPT_DIR = Path(__file__).parent

# Domain mapping: test number -> domain name
DOMAIN_MAP = {
    "1": "CRM",
    "2": "RAG",
    "3": "AUTH",
    "4": "TOOLS",
}


def discover_tests(pattern: str = "test_*.py") -> List[Path]:
    """
    Discover all test files matching pattern in subdirectories.
    
    Returns list of test file paths sorted by test ID (1a, 1b, 2a...).
    """
    tests = []
    
    for subdir in SCRIPT_DIR.iterdir():
        if subdir.is_dir() and not subdir.name.startswith("__"):
            test_files = list(subdir.glob(pattern))
            tests.extend(test_files)
    
    # Sort by test ID extracted from filename (test_1a_*, test_2a_*, etc.)
    def sort_key(path: Path) -> str:
        match = re.search(r'test_(\d+[a-z])_', path.name)
        if match:
            test_id = match.group(1)
            # Convert to sortable: "1a" -> "1a", "2a" -> "2a", "10a" -> "10a"
            num_match = re.match(r'(\d+)([a-z])', test_id)
            if num_match:
                return f"{int(num_match.group(1)):03d}{num_match.group(2)}"
        return 'zzz'
    
    return sorted(tests, key=sort_key)


def parse_test_name(test_path: Path) -> dict:
    """
    Parse test filename to extract metadata.
    
    Expected format: test_{number}{letter}_{description}.py
    Examples: test_1a_verify_encryption.py, test_2a_document_persistence.py
    """
    name = test_path.stem  # Remove .py
    
    # Match pattern: test_1a_verify_encryption
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
    """
    Run a single test file.
    
    Returns: (passed: bool, duration: float, output: str)
    """
    cmd = [sys.executable, str(test_path), "--api-base", api_base]
    
    if extra_args:
        cmd.extend(extra_args)
    
    start_time = time.time()
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout per test
            cwd=test_path.parent  # Run from test's directory
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


def print_header():
    """Print test run header."""
    print()
    print("╔" + "═"*62 + "╗")
    print("║" + "SANCTUM BACKEND INTEGRATION TESTS".center(62) + "║")
    print("╚" + "═"*62 + "╝")
    print()
    print(f"  Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Runner:    {Path(__file__).name}")
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
    status_color = "\033[92m" if passed else "\033[91m"  # Green or Red
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


def main():
    parser = argparse.ArgumentParser(
        description="Run Sanctum backend integration tests",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_all_be_tests.py                          # Run all tests
  python run_all_be_tests.py --verbose                # Show all output
  python run_all_be_tests.py --pattern "test_1*"     # Run all CRM tests (1x)
  python run_all_be_tests.py --pattern "test_2a_*"   # Run only test 2A
  python run_all_be_tests.py --list                   # List tests without running
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
    
    args = parser.parse_args()
    
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
    
    # Run mode
    print_header()
    print(f"  API Base:  {args.api_base}")
    print(f"  Pattern:   {args.pattern}")
    print(f"  Tests:     {len(tests)} discovered")
    
    results = []
    extra_args = []
    
    if args.token:
        extra_args.extend(["--token", args.token])
    
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
    
    # Exit with error if any test failed
    all_passed = all(p for _, p, _ in results)
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
