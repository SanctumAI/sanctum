#!/usr/bin/env python3
"""
Sanctum Lo-Fi Benchmark Runner

Usage:
    python run_benchmark.py              # Run all 5 sessions
    python run_benchmark.py 1            # Run session 1 only
    python run_benchmark.py 1 3 5        # Run sessions 1, 3, and 5
    python run_benchmark.py --list       # List available sessions

Configuration:
    Edit benchmark_config.json to control:
    - enable_web_search: Include web-search tool in queries
    - enable_auto_search_followup: Auto-call LLM search when recommended
    - grading: GPT-4o grading settings
"""

import os
import sys
import json
import time
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx


# ============================================================================
# PATHS & CONFIG
# ============================================================================

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
CONFIG_PATH = SCRIPT_DIR / "benchmark_config.json"
SESSIONS_PATH = SCRIPT_DIR / "benchmark_sessions.json"
EVALS_DIR = SCRIPT_DIR / "evals"


def load_dotenv():
    """Load environment variables from .env file."""
    env_file = PROJECT_ROOT / ".env"
    if env_file.exists():
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, _, value = line.partition('=')
                    key, value = key.strip(), value.strip()
                    if value and value[0] in ('"', "'") and value[-1] == value[0]:
                        value = value[1:-1]
                    if key not in os.environ:
                        os.environ[key] = value


def load_config() -> dict:
    """Load benchmark configuration."""
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            return json.load(f)
    return {
        "backend_url": "http://localhost:8000",
        "top_k": 8,
        "enable_web_search": False,
        "enable_auto_search_followup": False,
        "grading": {"enabled": True, "model": "gpt-4o", "temperature": 0.1},
        "design_principles": []
    }


def load_sessions() -> dict:
    """Load session data from JSON."""
    with open(SESSIONS_PATH) as f:
        data = json.load(f)
    return data.get("sessions", {})


# Initialize on import
load_dotenv()
CONFIG = load_config()
SESSIONS = load_sessions()
BACKEND_URL = os.getenv("BACKEND_URL", CONFIG.get("backend_url", "http://localhost:8000"))
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
DEV_TOKEN = "dev-mode-mock-token"


# ============================================================================
# HELPERS
# ============================================================================

def get_design_principles_str() -> str:
    return "\n".join(f"{i+1}. {p}" for i, p in enumerate(CONFIG.get("design_principles", [])))


def get_git_info() -> dict:
    info = {"commit_hash": None, "commit_short": None, "branch": None, "dirty": None}
    try:
        result = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=PROJECT_ROOT)
        if result.returncode == 0:
            info["commit_hash"] = result.stdout.strip()
            info["commit_short"] = info["commit_hash"][:8]
        result = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True, cwd=PROJECT_ROOT)
        if result.returncode == 0:
            info["branch"] = result.stdout.strip()
        result = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, cwd=PROJECT_ROOT)
        if result.returncode == 0:
            info["dirty"] = len(result.stdout.strip()) > 0
    except Exception as e:
        info["error"] = str(e)
    return info


def get_backend_config() -> dict:
    config = {}
    try:
        response = httpx.get(f"{BACKEND_URL}/llm/test", timeout=30.0)
        if response.status_code == 200:
            data = response.json()
            config["llm_provider"] = data.get("provider")
            config["llm_model"] = data.get("model")
            config["llm_health"] = data.get("health")
    except Exception:
        pass
    return config


def get_metadata() -> dict:
    return {
        "timestamp": datetime.now().isoformat(),
        "backend_url": BACKEND_URL,
        "web_search_enabled": CONFIG.get("enable_web_search", False),
        "auto_search_followup": CONFIG.get("enable_auto_search_followup", False),
        "grading_enabled": bool(OPENAI_API_KEY) and CONFIG.get("grading", {}).get("enabled", True),
        "git": get_git_info(),
        "config": get_backend_config(),
    }


# ============================================================================
# API CALLS
# ============================================================================

def call_query_endpoint(question: str, session_id: Optional[str] = None) -> dict:
    """Call the /query endpoint."""
    tools = ["web-search"] if CONFIG.get("enable_web_search", False) else []
    payload = {"question": question, "top_k": CONFIG.get("top_k", 8), "tools": tools}
    if session_id:
        payload["session_id"] = session_id
    
    response = httpx.post(
        f"{BACKEND_URL}/query",
        json=payload,
        headers={"Authorization": f"Bearer {DEV_TOKEN}", "Content-Type": "application/json"},
        timeout=120.0
    )
    if response.status_code != 200:
        raise Exception(f"Query failed: {response.status_code} - {response.text}")
    return response.json()


def call_auto_search(search_term: str) -> dict:
    """Call /llm/chat with search - mimics frontend auto-search flow."""
    search_prompt = f"""Search for: {search_term}

IMPORTANT: Return a CONDENSED response:
- A brief table (3-5 rows max) with Name, Contact, and Notes columns
- 2-3 sentences of practical advice
- NO lengthy explanations or backgrounds
- Focus on actionable contacts and next steps"""

    response = httpx.post(
        f"{BACKEND_URL}/llm/chat",
        json={"message": search_prompt, "tools": ["web-search"]},
        headers={"Authorization": f"Bearer {DEV_TOKEN}", "Content-Type": "application/json"},
        timeout=120.0
    )
    if response.status_code != 200:
        return {"error": f"Search failed: {response.status_code}", "message": ""}
    return response.json()


def grade_response(turn_num: int, user_msg: str, actual: str, expected: str, history: list, search_results: str = None) -> dict:
    """Grade response with GPT-4o."""
    if not OPENAI_API_KEY or not CONFIG.get("grading", {}).get("enabled", True):
        return {"score": -1, "reasoning": "Grading disabled"}
    
    history_str = "\n".join([
        f"Turn {i+1}: User: {h['user'][:100]}... | Actual: {h['actual'][:100]}..."
        for i, h in enumerate(history[:-1])
    ]) if history[:-1] else "(Start)"
    
    search_ctx = f"\n\n**Auto-Search Results:**\n{search_results[:500]}..." if search_results else ""
    
    prompt = f"""Grade this knowledge assistant response (0-100).

## Design Principles
{get_design_principles_str()}

## History
{history_str}

## Turn {turn_num}
**User:** {user_msg}
**Expected:** {expected[:500]}...
**Actual:** {actual}{search_ctx}

Grade on: Empathy (25), Brevity (20), Single Action (20), Clarifying Questions (15), Safety (20)

JSON only:
{{"score": <0-100>, "reasoning": "<2 sentences>", "strengths": ["..."], "weaknesses": ["..."]}}"""

    try:
        response = httpx.post(
            "https://api.openai.com/v1/chat/completions",
            json={
                "model": CONFIG.get("grading", {}).get("model", "gpt-4o"),
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
                "response_format": {"type": "json_object"}
            },
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            timeout=60.0
        )
        if response.status_code == 200:
            return json.loads(response.json()["choices"][0]["message"]["content"])
    except Exception as e:
        return {"score": -1, "reasoning": str(e)}
    return {"score": -1, "reasoning": "API error"}


# ============================================================================
# MAIN RUNNER
# ============================================================================

def run_session(session_key: str, session_data: dict) -> list:
    """Run a single benchmark session."""
    name = session_data["name"]
    prefix = session_data["filename_prefix"]
    turns = session_data["turns"]
    
    print(f"\n{'=' * 70}")
    print(f"SESSION {session_key}: {name}")
    print("=" * 70)
    
    session_id = None
    results = []
    history = []
    
    for turn_data in turns:
        turn_num = turn_data["turn"]
        user_msg = turn_data["user_message"]
        expected = turn_data["expected_response"]
        
        print(f"\n--- Turn {turn_num} ---")
        print(f"📤 USER: {user_msg[:80]}...")
        
        try:
            start = time.time()
            response = call_query_endpoint(user_msg, session_id)
            elapsed = time.time() - start
            
            session_id = response.get("session_id")
            actual = response.get("answer", "")
            sources = response.get("sources", [])
            search_term = response.get("search_term")
            
            print(f"📥 SANCTUM ({elapsed:.1f}s): {actual[:100]}...")
            print(f"   Sources: {len(sources)}")
            
            # Auto-search if enabled
            search_results = None
            if search_term and CONFIG.get("enable_auto_search_followup"):
                print(f"🔍 AUTO-SEARCH: {search_term[:50]}...")
                search_resp = call_auto_search(search_term)
                search_results = search_resp.get("message", "")
                if search_results:
                    print(f"   Search returned {len(search_results)} chars")
            
            history.append({"user": user_msg, "expected": expected, "actual": actual})
            
            # Grade
            grade = grade_response(turn_num, user_msg, actual, expected, history, search_results)
            score = grade.get("score", -1)
            if score >= 0:
                print(f"🎯 SCORE: {score}/100 - {grade.get('reasoning', '')[:60]}...")
            
            results.append({
                "turn": turn_num,
                "user_message": user_msg,
                "expected_response": expected,
                "actual_response": actual,
                "sources_count": len(sources),
                "sources": [{"file": s.get("source_file"), "score": s.get("score")} for s in sources[:5]],
                "search_term": search_term,
                "search_results": search_results,
                "elapsed_seconds": elapsed,
                "grade": grade
            })
            
        except Exception as e:
            print(f"✗ Error: {e}")
            results.append({"turn": turn_num, "error": str(e)})
        
        time.sleep(0.5)
    
    return results


def main():
    # Parse args
    args = sys.argv[1:]
    
    if "--list" in args:
        print("\nAvailable sessions:")
        for key, data in SESSIONS.items():
            print(f"  {key}: {data['name']}")
        return
    
    if args:
        session_keys = []
        for arg in args:
            if arg in SESSIONS:
                session_keys.append(arg)
            else:
                print(f"Unknown session: {arg}. Use --list to see available sessions.")
                return
    else:
        session_keys = list(SESSIONS.keys())
    
    # Header
    print("\n" + "=" * 70)
    print("SANCTUM LO-FI BENCHMARK")
    print("=" * 70)
    
    metadata = get_metadata()
    git = metadata.get("git", {})
    print(f"  Git: {git.get('commit_short', 'N/A')} {'(dirty)' if git.get('dirty') else ''}")
    print(f"  Backend: {BACKEND_URL}")
    print(f"  Web Search: {'ON' if CONFIG.get('enable_web_search') else 'OFF'}")
    print(f"  Auto-Search: {'ON' if CONFIG.get('enable_auto_search_followup') else 'OFF'}")
    print(f"  Grading: {'ON' if OPENAI_API_KEY else 'OFF'}")
    print(f"  Sessions: {session_keys}")
    
    # Health check
    try:
        health = httpx.get(f"{BACKEND_URL}/health", timeout=10.0)
        if health.status_code == 200:
            print("  ✓ Backend healthy")
        else:
            print(f"  ⚠ Backend returned {health.status_code}")
    except Exception as e:
        print(f"  ✗ Backend unreachable: {e}")
        print("\nRun: docker compose up --build")
        return
    
    # Run sessions
    all_results = {}
    for key in session_keys:
        results = run_session(key, SESSIONS[key])
        all_results[key] = results
    
    # Summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    
    total_score = 0
    total_graded = 0
    
    for key, results in all_results.items():
        scores = [r["grade"]["score"] for r in results if r.get("grade", {}).get("score", -1) >= 0]
        if scores:
            avg = sum(scores) / len(scores)
            print(f"  Session {key}: {avg:.1f}/100 ({len(scores)} turns)")
            total_score += sum(scores)
            total_graded += len(scores)
    
    if total_graded:
        print(f"\n  OVERALL: {total_score/total_graded:.1f}/100 ({total_graded} turns)")
    
    # Save
    EVALS_DIR.mkdir(exist_ok=True)
    git_short = git.get("commit_short", "unknown")
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    for key, results in all_results.items():
        prefix = SESSIONS[key]["filename_prefix"]
        outfile = EVALS_DIR / f"{prefix}_{ts}_{git_short}.json"
        report = {
            "benchmark": {"name": SESSIONS[key]["name"], "session": key},
            "metadata": metadata,
            "results": results,
            "summary": {
                "average_score": sum(r["grade"]["score"] for r in results if r.get("grade", {}).get("score", -1) >= 0) / max(1, len([r for r in results if r.get("grade", {}).get("score", -1) >= 0])) if any(r.get("grade", {}).get("score", -1) >= 0 for r in results) else None,
                "turns": len(results)
            }
        }
        with open(outfile, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\n💾 Saved: {outfile.name}")


if __name__ == "__main__":
    main()
