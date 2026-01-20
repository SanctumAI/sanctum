#!/usr/bin/env python3
"""
Lo-Fi Benchmark - Run All Sessions

Runs all 5 WLC benchmark sessions sequentially:
  1. Family Member Detained (Nicaragua)
  2. Protection from Retaliation (Nicaragua)
  3. Friend Taken for Social Media Post (Nicaragua)
  4. Brother Released with Silence Condition (Nicaragua)
  5. Son Taken by Armed Men (South Sudan)

Usage:
    python scripts/lofi-benchmark-all.py
    
Output:
    Results saved to ./scripts/evals/ with unique timestamped names
    Summary report saved to ./scripts/evals/summary_<timestamp>.json
"""

import os
import sys
import json
import time
import subprocess
from datetime import datetime
from pathlib import Path

import httpx


def load_dotenv():
    """Load environment variables from .env file in project root."""
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    env_file = project_root / ".env"
    
    if env_file.exists():
        print(f"📁 Loading environment from {env_file}")
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, _, value = line.partition('=')
                    key = key.strip()
                    value = value.strip()
                    if value and value[0] in ('"', "'") and value[-1] == value[0]:
                        value = value[1:-1]
                    if key not in os.environ:
                        os.environ[key] = value


load_dotenv()

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
EVALS_DIR = SCRIPT_DIR / "evals"
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

BENCHMARK_SCRIPTS = [
    ("lofi-benchmark-pt1.py", "Session 1: Family Member Detained (Nicaragua)"),
    ("lofi-benchmark-pt2.py", "Session 2: Protection from Retaliation (Nicaragua)"),
    ("lofi-benchmark-pt3.py", "Session 3: Friend Taken for Social Media Post (Nicaragua)"),
    ("lofi-benchmark-pt4.py", "Session 4: Brother Released with Silence Condition (Nicaragua)"),
    ("lofi-benchmark-pt5.py", "Session 5: Son Taken by Armed Men (South Sudan)"),
]


def check_backend_health() -> bool:
    """Check if the backend is healthy."""
    try:
        response = httpx.get(f"{BACKEND_URL}/health", timeout=10.0)
        return response.status_code == 200
    except Exception:
        return False


def get_git_info() -> dict:
    """Get git commit hash and branch info."""
    info = {"commit_short": None, "branch": None, "dirty": None}
    try:
        result = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=PROJECT_ROOT)
        if result.returncode == 0:
            info["commit_short"] = result.stdout.strip()
        result = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True, cwd=PROJECT_ROOT)
        if result.returncode == 0:
            info["branch"] = result.stdout.strip()
        result = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, cwd=PROJECT_ROOT)
        if result.returncode == 0:
            info["dirty"] = len(result.stdout.strip()) > 0
    except Exception:
        pass
    return info


def run_benchmark_script(script_name: str) -> tuple[bool, float, str]:
    """
    Run a single benchmark script and return (success, duration, output_file).
    """
    script_path = SCRIPT_DIR / script_name
    
    if not script_path.exists():
        return False, 0, f"Script not found: {script_path}"
    
    start_time = time.time()
    
    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True,
            text=True,
            cwd=PROJECT_ROOT,
            timeout=600  # 10 minute timeout per benchmark
        )
        
        elapsed = time.time() - start_time
        
        # Extract output file from stdout if present
        output_file = None
        for line in result.stdout.split('\n'):
            if 'Results saved to:' in line or '💾' in line:
                # Try to extract the path
                if 'evals/' in line:
                    parts = line.split('evals/')
                    if len(parts) > 1:
                        output_file = parts[1].split()[0].strip()
        
        if result.returncode == 0:
            return True, elapsed, output_file or "completed"
        else:
            return False, elapsed, result.stderr or result.stdout or "Unknown error"
            
    except subprocess.TimeoutExpired:
        return False, 600, "Timeout after 10 minutes"
    except Exception as e:
        return False, 0, str(e)


def run_all_benchmarks():
    """Run all benchmark scripts and generate a summary."""
    print("╔══════════════════════════════════════════════════════════════════╗")
    print("║     SANCTUM Lo-Fi BENCHMARK - All Sessions                       ║")
    print("╚══════════════════════════════════════════════════════════════════╝")
    print("")
    
    # Get git info
    git = get_git_info()
    print(f"📍 Git: {git.get('commit_short', 'N/A')} @ {git.get('branch', 'N/A')} {'(dirty)' if git.get('dirty') else ''}")
    print(f"🔗 Backend: {BACKEND_URL}")
    print(f"📊 GPT Grading: {'Enabled' if OPENAI_API_KEY else 'Disabled'}")
    print("")
    
    # Check backend health
    print("🔍 Checking backend health...")
    if not check_backend_health():
        print("❌ Backend not reachable at", BACKEND_URL)
        print("")
        print("Start the backend first:")
        print("   docker compose up --build")
        sys.exit(1)
    print("✅ Backend is healthy")
    print("")
    
    # Ensure evals directory exists
    EVALS_DIR.mkdir(parents=True, exist_ok=True)
    
    # Run each benchmark
    results = []
    total_start = time.time()
    
    for i, (script_name, description) in enumerate(BENCHMARK_SCRIPTS, 1):
        print("━" * 70)
        print(f"  [{i}/5] {description}")
        print("━" * 70)
        
        success, duration, output = run_benchmark_script(script_name)
        
        results.append({
            "session": i,
            "script": script_name,
            "description": description,
            "success": success,
            "duration_seconds": round(duration, 1),
            "output_file": output if success else None,
            "error": output if not success else None
        })
        
        if success:
            print(f"✅ Completed in {duration:.1f}s")
        else:
            print(f"❌ Failed: {output}")
        
        print("")
        
        # Small delay between sessions
        if i < len(BENCHMARK_SCRIPTS):
            time.sleep(2)
    
    total_duration = time.time() - total_start
    
    # Summary
    print("╔══════════════════════════════════════════════════════════════════╗")
    print("║     ALL BENCHMARKS COMPLETE                                      ║")
    print("╚══════════════════════════════════════════════════════════════════╝")
    print("")
    
    successful = sum(1 for r in results if r["success"])
    print(f"📊 Results: {successful}/{len(BENCHMARK_SCRIPTS)} sessions completed")
    print(f"⏱️  Total time: {total_duration:.1f}s")
    print("")
    
    # Print per-session summary
    print("Session Results:")
    for r in results:
        status = "✅" if r["success"] else "❌"
        print(f"  {status} Session {r['session']}: {r['duration_seconds']}s")
    print("")
    
    # Save summary report
    timestamp_str = datetime.now().strftime('%Y%m%d_%H%M%S')
    summary_file = EVALS_DIR / f"summary_{timestamp_str}_{git.get('commit_short', 'unknown')}.json"
    
    summary = {
        "benchmark_run": {
            "timestamp": datetime.now().isoformat(),
            "git_commit": git.get("commit_short"),
            "git_branch": git.get("branch"),
            "total_duration_seconds": round(total_duration, 1),
            "sessions_completed": successful,
            "sessions_total": len(BENCHMARK_SCRIPTS),
            "grading_enabled": bool(OPENAI_API_KEY)
        },
        "sessions": results
    }
    
    with open(summary_file, "w") as f:
        json.dump(summary, f, indent=2)
    
    print(f"💾 Summary saved to: {summary_file}")
    print("")
    
    # List recent eval files
    print("📁 Recent eval files:")
    eval_files = sorted(EVALS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:6]
    for f in eval_files:
        print(f"   {f.name}")
    
    return results


if __name__ == "__main__":
    run_all_benchmarks()
