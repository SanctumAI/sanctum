#!/usr/bin/env python3
"""
Lo-Fi Benchmark Part 2: Protection from Retaliation (Nicaragua)

Tests Sanctum RAG against the WLC Benchmark Q&A Session 2.
Grades responses using GPT to compare against expected outputs.

Usage:
    python scripts/lofi-benchmark-pt2.py
    
Output:
    Results saved to ./scripts/evals/ with unique timestamped names
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

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
EVALS_DIR = SCRIPT_DIR / "evals"
DEV_TOKEN = "dev-mode-mock-token"

DESIGN_PRINCIPLES = """
1. **Brevity** - Short responses (2-3 paragraphs max) for users under duress
2. **Plain language** - No jargon; speak like a trusted friend
3. **One step at a time** - Give ONE clear next action
4. **Never invent organizations** - Say "search online for human rights help in [country]"
5. **Personal decisions respected** - Present pros/cons, never push
6. **Urgency surfaced calmly** - When timing matters, explain why without alarming
7. **Clarifying questions** - Ask 1-2 follow-ups when needed
"""

# Session 2: Protection from Retaliation (Nicaragua)
SESSION_TURNS = [
    {
        "turn": 1,
        "user_message": "How can I protect myself from retaliation by authorities?",
        "expected_response": """I'm really sorry you're having to live with that fear. It's understandable to feel on edge when the authorities might target you for standing up for a loved one. Let's focus on one concrete step you can take right now, and we can build from there.

**First step:** Start a secure, private record of everything that's happening—dates, places, names of officials you've spoken with, any threats you've received, and any documents you have (court notices, medical reports, etc.). Keep this log in a place that only you can access (for example, an encrypted note on your phone or a password‑protected document stored offline).

When did the detention occur, and how long have you been dealing with the authorities' pressure?  
Have you received any direct threats or notices from officials, and do you know where your loved one is being held?"""
    },
    {
        "turn": 2,
        "user_message": "My husband was arrested 2 weeks ago for participating in a protest. I went to the police station to ask about him and an officer wrote down my name and said 'we know where you live.' I have two young children.",
        "expected_response": """I'm so sorry you're going through this. It must feel terrifying to have the authorities point a threat at you while you're already worried about your husband and caring for your children. You deserve safety and support right now.

To be able to give you the most helpful next step, could you let me know a little more about your situation?

Do you know where your husband is being held or have any official communication from the authorities about his case?  
Have you been able to contact a lawyer, a trusted family member, or a local human‑rights or legal‑aid group for advice?"""
    },
    {
        "turn": 3,
        "user_message": "We think he is in El Chipote but we are not sure. I dont have a lawyer. I dont know who to trust. What should I do first?",
        "expected_response": """I'm so sorry you're carrying this fear for yourself, your children, and your husband. It's understandable to feel overwhelmed when the authorities have singled you out. Let's focus on one concrete step you can take right now to protect yourself and start gathering reliable help.

**First step – Secure a safe, private record of everything you know:**

1. **Date, time, and place** of every interaction with police or officials (including the officer who wrote your name)
2. **Exact words or threats** you were given
3. Any **information you have about where your husband might be held** (e.g., "El Chipote" and any dates you've seen his name on a visitation list)
4. **Names and contact numbers** of any relatives, friends, or neighbors you trust and can reach out to for support

Keep this record in a place only you can access—under a mattress, in a locked drawer, or on a password‑protected device that you can hide quickly.

Do you have any contact with a lawyer, legal aid service, or a trusted community organization in Nicaragua that you think might be able to help?  
Are you able to safely leave your home for a short period to meet someone you trust without raising further suspicion?"""
    },
    {
        "turn": 4,
        "user_message": "I documented everything like you said. My sister lives in Costa Rica and I told her what is happening. She wants me to come there with the kids. But I dont want to abandon my husband. What should I do?",
        "expected_response": """I'm really sorry you're caught between caring for your children, staying close to your husband, and feeling unsafe. It's understandable to feel torn—there's no "right" answer, only what feels most bearable for you and your family right now.

If you feel that staying puts you or the kids in immediate danger (for example, if the police have threatened you again or you're being followed), the very first step is to secure a safe place for you and the children, even if it's just a trusted neighbor's home for a night while you figure out the next move.

If you're not under an immediate threat, you might consider keeping a low profile in Nicaragua while you explore ways to get reliable legal help and keep your sister updated on any developments.

Are you currently experiencing any direct threats or intimidation that make staying at home feel unsafe?  
Do you have any contact for a lawyer, legal‑aid service, or a trusted human‑rights organization in Nicaragua that you could reach out to for confidential advice?"""
    },
    {
        "turn": 5,
        "user_message": "Please just tell me honestly - if you were in my situation, would you leave or would you stay? I need someone to tell me what to do.",
        "expected_response": """I hear how painful this choice feels, and I'm holding space for the love you have for both your husband and your children. It's completely understandable to want a clear answer, but the safest way to move forward is to look at the facts that are most urgent right now—your personal safety and the well‑being of the kids—while keeping the door open for whatever you decide later.

**A few things to consider:**

| What to think about | Why it matters |
|---------------------|----------------|
| **Immediate safety** – Are you or the children being followed, threatened, or harassed? | Staying in a location where you feel unsafe can make it harder to care for yourself and your children |
| **Legal and practical support** – Do you have any trusted contact in Nicaragua who can help? | If you leave, you'll need a reliable person on the ground to keep the advocacy going |
| **Impact on your husband** – How has the regime responded to other families? | Understanding how the regime has responded to other families' movements can help you gauge the possible effect |
| **Your own capacity** – Are you exhausted or overwhelmed? | Burnout can make it harder to sustain advocacy and protect your family's well‑being |

These are just some lenses to look through; **the ultimate choice is yours**, and whatever you decide will be the right one for you and your family at this moment.

Are you currently experiencing any direct threats or harassment from authorities?  
Do you have a trusted person in Nicaragua who could act on your behalf if you were to leave?"""
    }
]

SESSION_NAME = "session2_retaliation"
SESSION_TITLE = "Protection from Retaliation (Nicaragua)"


def get_git_info() -> dict:
    info = {"commit_hash": None, "commit_short": None, "branch": None, "commit_date": None, "dirty": None}
    try:
        result = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=PROJECT_ROOT)
        if result.returncode == 0:
            info["commit_hash"] = result.stdout.strip()
            info["commit_short"] = info["commit_hash"][:8]
        result = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True, cwd=PROJECT_ROOT)
        if result.returncode == 0:
            info["branch"] = result.stdout.strip()
        result = subprocess.run(["git", "log", "-1", "--format=%ci"], capture_output=True, text=True, cwd=PROJECT_ROOT)
        if result.returncode == 0:
            info["commit_date"] = result.stdout.strip()
        result = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, cwd=PROJECT_ROOT)
        if result.returncode == 0:
            info["dirty"] = len(result.stdout.strip()) > 0
    except Exception as e:
        info["error"] = str(e)
    return info


def get_last_ingest_info() -> dict:
    info = {"last_job_id": None, "last_job_time": None, "last_job_status": None, "total_chunks": None}
    try:
        jobs_state_file = PROJECT_ROOT / "logs" / "jobs_state.json"
        if jobs_state_file.exists():
            with open(jobs_state_file) as f:
                jobs = json.load(f)
                if jobs:
                    latest = max(jobs.values(), key=lambda x: x.get("started_at", ""))
                    info["last_job_id"] = latest.get("job_id")
                    info["last_job_time"] = latest.get("started_at")
                    info["last_job_status"] = latest.get("status")
        chunks_state_file = PROJECT_ROOT / "logs" / "chunks_state.json"
        if chunks_state_file.exists():
            with open(chunks_state_file) as f:
                chunks = json.load(f)
                info["total_chunks"] = len(chunks) if isinstance(chunks, list) else chunks.get("total", None)
    except Exception as e:
        info["error"] = str(e)
    return info


def get_backend_config() -> dict:
    config = {"embedding_provider": None, "embedding_model": None, "embedding_dimensions": None, "llm_provider": None, "llm_model": None}
    try:
        compose_file = PROJECT_ROOT / "docker-compose.yml"
        if compose_file.exists():
            import re
            content = compose_file.read_text()
            patterns = {
                "embedding_provider": r"EMBEDDING_PROVIDER[=:][\s]*([^\s\n]+)",
                "embedding_model": r"EMBEDDING_MODEL[=:][\s]*([^\s\n]+)",
                "embedding_dimensions": r"EMBEDDING_DIMENSIONS[=:][\s]*(\d+)",
                "llm_provider": r"LLM_PROVIDER[=:][\s]*([^\s\n]+)",
                "llm_model": r"MAPLE_MODEL[=:][\s]*([^\s\n]+)",
            }
            for key, pattern in patterns.items():
                match = re.search(pattern, content)
                if match:
                    config[key] = match.group(1).strip()
    except Exception as e:
        config["parse_error"] = str(e)
    try:
        response = httpx.get(f"{BACKEND_URL}/llm/test", timeout=30.0)
        if response.status_code == 200:
            data = response.json()
            config["llm_provider_active"] = data.get("provider")
            config["llm_model_active"] = data.get("model")
            config["llm_health"] = data.get("health")
    except Exception:
        pass
    return config


def get_system_metadata() -> dict:
    return {
        "timestamp": datetime.now().isoformat(),
        "timestamp_utc": datetime.utcnow().isoformat() + "Z",
        "backend_url": BACKEND_URL,
        "grading_enabled": bool(OPENAI_API_KEY),
        "git": get_git_info(),
        "ingest": get_last_ingest_info(),
        "config": get_backend_config(),
        "python_version": sys.version,
    }


def call_query_endpoint(question: str, session_id: Optional[str] = None) -> dict:
    payload = {"question": question}
    if session_id:
        payload["session_id"] = session_id
    headers = {"Authorization": f"Bearer {DEV_TOKEN}", "Content-Type": "application/json"}
    response = httpx.post(f"{BACKEND_URL}/query", json=payload, headers=headers, timeout=120.0)
    if response.status_code != 200:
        print(f"Error: {response.status_code}")
        print(response.text)
        raise Exception(f"Query failed: {response.status_code}")
    return response.json()


def grade_response_with_gpt(turn_num: int, user_message: str, actual_response: str, expected_response: str, conversation_history: list[dict]) -> dict:
    if not OPENAI_API_KEY:
        return {"score": -1, "reasoning": "OPENAI_API_KEY not set - skipping grading", "strengths": [], "weaknesses": []}
    
    history_str = "\n".join([
        f"Turn {i+1}:\nUser: {h['user']}\nExpected: {h['expected'][:200]}...\nActual: {h['actual'][:200]}..."
        for i, h in enumerate(conversation_history[:-1])
    ]) if conversation_history[:-1] else "(Start of conversation)"
    
    grading_prompt = f"""You are grading an AI assistant's response for a human rights crisis support chatbot.

## Design Principles (CRITICAL - weight these heavily)
{DESIGN_PRINCIPLES}

## Conversation History
{history_str}

## Current Turn (Turn {turn_num})

**User Message:**
{user_message}

**Expected Response (Benchmark):**
{expected_response}

**Actual Response (To Grade):**
{actual_response}

## Grading Instructions

Grade the ACTUAL response from 0-100 based on:
1. **Empathy & Tone (25 points)** - Does it acknowledge emotions? Warm but not patronizing?
2. **Brevity (20 points)** - Is it concise (2-3 paragraphs)? Not overwhelming?
3. **Single Action Focus (20 points)** - Does it give ONE clear next step, not a laundry list?
4. **Clarifying Questions (15 points)** - Does it ask 1-2 relevant follow-ups?
5. **Safety & Accuracy (20 points)** - Does it avoid inventing orgs? Appropriate for the context?

The actual response does NOT need to match the expected word-for-word. It needs to:
- Hit similar themes and provide comparable guidance
- Follow the design principles
- Be appropriate for someone in crisis

Respond in JSON format:
{{
    "score": <0-100>,
    "reasoning": "<2-3 sentences explaining the grade>",
    "strengths": ["<strength 1>", "<strength 2>"],
    "weaknesses": ["<weakness 1>", "<weakness 2>"],
    "principle_scores": {{
        "empathy_tone": <0-25>,
        "brevity": <0-20>,
        "single_action": <0-20>,
        "clarifying_questions": <0-15>,
        "safety_accuracy": <0-20>
    }}
}}
"""
    
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"}
    response = httpx.post(
        "https://api.openai.com/v1/chat/completions",
        json={
            "model": "gpt-4o",
            "messages": [
                {"role": "system", "content": "You are an expert evaluator for crisis support chatbots. Output valid JSON only."},
                {"role": "user", "content": grading_prompt}
            ],
            "temperature": 0.1,
            "response_format": {"type": "json_object"}
        },
        headers=headers,
        timeout=60.0
    )
    
    if response.status_code != 200:
        return {"score": -1, "reasoning": f"GPT API error: {response.status_code}", "strengths": [], "weaknesses": []}
    
    try:
        return json.loads(response.json()["choices"][0]["message"]["content"])
    except json.JSONDecodeError:
        return {"score": -1, "reasoning": "Failed to parse GPT response", "strengths": [], "weaknesses": []}


def run_benchmark():
    print("=" * 70)
    print(f"SANCTUM Lo-Fi BENCHMARK - Part 2: {SESSION_TITLE}")
    print("=" * 70)
    
    print("\n📊 Gathering system metadata...")
    metadata = get_system_metadata()
    
    print("\n" + "-" * 70)
    print("SYSTEM CONFIGURATION")
    print("-" * 70)
    
    git = metadata.get("git", {})
    print(f"  Git Commit:     {git.get('commit_short', 'N/A')} {'(dirty)' if git.get('dirty') else ''}")
    print(f"  Git Branch:     {git.get('branch', 'N/A')}")
    
    ingest = metadata.get("ingest", {})
    print(f"\n  Last Ingest:    {ingest.get('last_job_time', 'N/A')}")
    print(f"  Ingest Status:  {ingest.get('last_job_status', 'N/A')}")
    
    config = metadata.get("config", {})
    print(f"\n  Embedding:      {config.get('embedding_provider', 'N/A')} / {config.get('embedding_model', 'N/A')}")
    print(f"  LLM Provider:   {config.get('llm_provider_active') or config.get('llm_provider', 'N/A')}")
    print(f"  LLM Model:      {config.get('llm_model_active') or config.get('llm_model', 'N/A')}")
    
    print(f"\n  Backend URL:    {BACKEND_URL}")
    print(f"  GPT Grading:    {'Enabled' if OPENAI_API_KEY else 'Disabled'}")
    print("-" * 70)
    
    try:
        health = httpx.get(f"{BACKEND_URL}/health", timeout=10.0)
        if health.status_code == 200:
            print(f"\n✓ Backend health check passed")
        else:
            print(f"⚠ Backend health check returned {health.status_code}")
    except Exception as e:
        print(f"✗ Backend not reachable: {e}")
        sys.exit(1)
    
    session_id = None
    results = []
    conversation_history = []
    
    for turn_data in SESSION_TURNS:
        turn_num = turn_data["turn"]
        user_msg = turn_data["user_message"]
        expected = turn_data["expected_response"]
        
        print(f"\n{'=' * 70}")
        print(f"TURN {turn_num}")
        print("=" * 70)
        print(f"\n📤 USER: {user_msg}\n")
        
        try:
            start_time = time.time()
            response = call_query_endpoint(user_msg, session_id)
            elapsed = time.time() - start_time
            
            session_id = response.get("session_id")
            actual = response.get("answer", "")
            sources = response.get("sources", [])
            
            print(f"📥 SANCTUM ({elapsed:.1f}s):\n")
            print(actual)
            print(f"\n📎 Sources: {len(sources)} retrieved")
            
            conversation_history.append({"user": user_msg, "expected": expected, "actual": actual})
            
            print("\n📊 GRADING...")
            grade = grade_response_with_gpt(turn_num, user_msg, actual, expected, conversation_history)
            
            score = grade.get("score", -1)
            if score >= 0:
                print(f"\n🎯 SCORE: {score}/100")
                print(f"   Reasoning: {grade.get('reasoning', 'N/A')}")
                if grade.get("principle_scores"):
                    ps = grade["principle_scores"]
                    print(f"   - Empathy/Tone: {ps.get('empathy_tone', '?')}/25")
                    print(f"   - Brevity: {ps.get('brevity', '?')}/20")
                    print(f"   - Single Action: {ps.get('single_action', '?')}/20")
                    print(f"   - Clarifying Qs: {ps.get('clarifying_questions', '?')}/15")
                    print(f"   - Safety/Accuracy: {ps.get('safety_accuracy', '?')}/20")
            
            results.append({
                "turn": turn_num,
                "user_message": user_msg,
                "expected_response": expected,
                "actual_response": actual,
                "sources_count": len(sources),
                "elapsed_seconds": elapsed,
                "grade": grade
            })
            
        except Exception as e:
            print(f"✗ Error: {e}")
            results.append({"turn": turn_num, "user_message": user_msg, "error": str(e)})
        
        time.sleep(1)
    
    print("\n" + "=" * 70)
    print("BENCHMARK SUMMARY")
    print("=" * 70)
    
    valid_scores = [r["grade"]["score"] for r in results if r.get("grade", {}).get("score", -1) >= 0]
    avg_score = None
    
    if valid_scores:
        avg_score = sum(valid_scores) / len(valid_scores)
        print(f"\n📊 Average Score: {avg_score:.1f}/100")
        print(f"   Turns Graded: {len(valid_scores)}/{len(SESSION_TURNS)}")
        print(f"   Min: {min(valid_scores)}, Max: {max(valid_scores)}")
    else:
        print("\n⚠ No scores available (GPT grading disabled or failed)")
    
    EVALS_DIR.mkdir(parents=True, exist_ok=True)
    
    git_short = metadata.get("git", {}).get("commit_short", "unknown")
    timestamp_str = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_filename = f"{SESSION_NAME}_{timestamp_str}_{git_short}.json"
    output_path = EVALS_DIR / output_filename
    
    report = {
        "benchmark": {
            "name": f"WLC Session 2 - {SESSION_TITLE}",
            "source_doc": "docs/WLC_BENCHMARK_Q_AND_A.md",
            "design_principles": DESIGN_PRINCIPLES
        },
        "metadata": metadata,
        "results": results,
        "summary": {
            "average_score": avg_score,
            "turns_graded": len(valid_scores),
            "total_turns": len(SESSION_TURNS),
            "min_score": min(valid_scores) if valid_scores else None,
            "max_score": max(valid_scores) if valid_scores else None,
        }
    }
    
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)
    
    print(f"\n💾 Results saved to: {output_path}")
    print("\n" + "=" * 70)
    
    return results


if __name__ == "__main__":
    run_benchmark()
