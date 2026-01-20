#!/usr/bin/env python3
"""
Lo-Fi Benchmark Part 5: Son Taken by Armed Men (South Sudan)

Tests Sanctum RAG against the WLC Benchmark Q&A Session 5.
Grades responses using GPT to compare against expected outputs.

Usage:
    python scripts/lofi-benchmark-pt5.py
    
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

# Session 5: Son Taken by Armed Men (South Sudan)
SESSION_TURNS = [
    {
        "turn": 1,
        "user_message": "My son was taken by armed men 3 weeks ago. Someone told me he might be in a detention facility but I dont know which one. Where do I start?",
        "expected_response": """I'm so sorry you're going through this; it must feel terrifying and exhausting. Because the first hours after a detention are the most crucial, acting now can help prevent a forced disappearance and make it easier to locate him.

Your first step is to reach out to a trusted lawyer or a human‑rights group in South Sudan—call the nearest office or a local legal aid clinic and tell them everything you know.

Do you have any details about where the men took him or a name of the facility they mentioned?  
Have you spoken with any community leaders or relatives who might have heard more?"""
    },
    {
        "turn": 2,
        "user_message": "He was taken from our home in Bentiu. He is 22 years old. I went to the police but they said they dont have him. I dont believe them.",
        "expected_response": """I'm so sorry you're living with this fear and exhaustion. Because a missing detainee can quickly become an enforced disappearance, acting now makes it far easier to locate him and protect his rights.

Your first step is to get a trusted human‑rights lawyer or a reputable NGO to file a formal "missing detainee" report and register your son's case. You can search online for "human rights help in South Sudan" to find contacts.

Do you know any community leaders, churches, or NGOs in Bentiu who might already be helping families in similar situations?"""
    },
    {
        "turn": 3,
        "user_message": "They wore military uniforms but no badges. They spoke Nuer. A neighbor said she saw them take other young men too that week. I am afraid to ask too many questions.",
        "expected_response": """I'm so sorry you're living with this fear and exhaustion. Because a missing detainee can quickly become an enforced disappearance, acting now makes it far easier to locate him and protect his rights.

Your first step is to contact a trusted human‑rights lawyer or a reputable NGO (e.g., the International Committee of the Red Cross or a local human‑rights group) and ask them to file a formal missing‑person report and request a location check. Gather everything you know—date, place, description of the men, language spoken, and the neighbor's sighting—and give it to them.

You can search online for "human rights NGOs in South Sudan" to find contacts.

Do you already have a lawyer or NGO you trust, or need help finding one?  
Do you have any written notes or photos of the incident that you can share with them?"""
    },
    {
        "turn": 4,
        "user_message": "I dont have a written report. I am scared to make one because the men might come back. But my son has been gone 3 weeks and I am losing hope. What if he is dead?",
        "expected_response": """I'm so sorry you're living with this fear and hopelessness. **Because the first weeks are critical, writing down what you know now keeps the details fresh and makes it harder for evidence to disappear.**

Your next step is to write a short, factual note (date, time, description of the men, where they took your son) and give it to a trusted human‑rights lawyer, a local church leader, or an NGO; you can do this anonymously if you fear retaliation.

Do you have someone you trust who could receive the note for you, or a safe way to contact an organization online?"""
    },
    {
        "turn": 5,
        "user_message": "My neighbor can go with me. But what do I say when I get there? I have never talked to UN people before. Will they help someone like me?",
        "expected_response": """I'm so sorry you're feeling scared and exhausted. Because the first weeks are critical, letting the UN know now makes it easier for them to start looking and to protect you.

Your next step is to go with your neighbor to the nearest UN office (e.g., UNMISS headquarters in Juba or a local office in Bentiu) and hand them a short note with the date, time, description of the men in uniform, and that your son has been missing for three weeks. When you meet them, you can simply say: **"My son was taken by men in military uniforms three weeks ago; I need help finding him and keeping my family safe."** Bring the note and ask them what support they can offer.

Do you know which UN office is closest to you, or can you get the address today?  
Do you have any written details you can copy onto that note?"""
    }
]

SESSION_NAME = "session5_south_sudan"
SESSION_TITLE = "Son Taken by Armed Men (South Sudan)"


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
        raise Exception(f"Query failed: {response.status_code}")
    return response.json()


def grade_response_with_gpt(turn_num: int, user_message: str, actual_response: str, expected_response: str, conversation_history: list[dict]) -> dict:
    if not OPENAI_API_KEY:
        return {"score": -1, "reasoning": "OPENAI_API_KEY not set", "strengths": [], "weaknesses": []}
    
    history_str = "\n".join([
        f"Turn {i+1}:\nUser: {h['user']}\nExpected: {h['expected'][:200]}...\nActual: {h['actual'][:200]}..."
        for i, h in enumerate(conversation_history[:-1])
    ]) if conversation_history[:-1] else "(Start)"
    
    grading_prompt = f"""You are grading an AI assistant's response for a human rights crisis support chatbot.

## Design Principles
{DESIGN_PRINCIPLES}

## History
{history_str}

## Turn {turn_num}

**User:** {user_message}

**Expected:** {expected_response}

**Actual:** {actual_response}

Grade 0-100:
1. Empathy & Tone (25 pts)
2. Brevity (20 pts)
3. Single Action Focus (20 pts)
4. Clarifying Questions (15 pts)
5. Safety & Accuracy (20 pts)

JSON format:
{{"score": <0-100>, "reasoning": "<explanation>", "strengths": [], "weaknesses": [], "principle_scores": {{"empathy_tone": <0-25>, "brevity": <0-20>, "single_action": <0-20>, "clarifying_questions": <0-15>, "safety_accuracy": <0-20>}}}}
"""
    
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"}
    response = httpx.post(
        "https://api.openai.com/v1/chat/completions",
        json={
            "model": "gpt-4o",
            "messages": [{"role": "system", "content": "Expert evaluator. Output valid JSON only."}, {"role": "user", "content": grading_prompt}],
            "temperature": 0.1,
            "response_format": {"type": "json_object"}
        },
        headers=headers,
        timeout=60.0
    )
    
    if response.status_code != 200:
        return {"score": -1, "reasoning": f"GPT error: {response.status_code}", "strengths": [], "weaknesses": []}
    
    try:
        return json.loads(response.json()["choices"][0]["message"]["content"])
    except:
        return {"score": -1, "reasoning": "Parse error", "strengths": [], "weaknesses": []}


def run_benchmark():
    print("=" * 70)
    print(f"SANCTUM Lo-Fi BENCHMARK - Part 5: {SESSION_TITLE}")
    print("=" * 70)
    
    metadata = get_system_metadata()
    git = metadata.get("git", {})
    ingest = metadata.get("ingest", {})
    config = metadata.get("config", {})
    
    print(f"\n  Git: {git.get('commit_short', 'N/A')} {'(dirty)' if git.get('dirty') else ''} @ {git.get('branch', 'N/A')}")
    print(f"  Ingest: {ingest.get('last_job_time', 'N/A')} ({ingest.get('last_job_status', 'N/A')})")
    print(f"  Embedding: {config.get('embedding_provider', 'N/A')} / {config.get('embedding_model', 'N/A')}")
    print(f"  LLM: {config.get('llm_provider_active') or config.get('llm_provider', 'N/A')}")
    print(f"  Grading: {'Enabled' if OPENAI_API_KEY else 'Disabled'}")
    
    try:
        health = httpx.get(f"{BACKEND_URL}/health", timeout=10.0)
        if health.status_code == 200:
            print(f"\n✓ Backend healthy")
    except Exception as e:
        print(f"✗ Backend error: {e}")
        sys.exit(1)
    
    session_id = None
    results = []
    conversation_history = []
    
    for turn_data in SESSION_TURNS:
        turn_num = turn_data["turn"]
        user_msg = turn_data["user_message"]
        expected = turn_data["expected_response"]
        
        print(f"\n{'=' * 70}\nTURN {turn_num}\n{'=' * 70}")
        print(f"\n📤 USER: {user_msg}\n")
        
        try:
            start = time.time()
            response = call_query_endpoint(user_msg, session_id)
            elapsed = time.time() - start
            
            session_id = response.get("session_id")
            actual = response.get("answer", "")
            sources = response.get("sources", [])
            
            print(f"📥 SANCTUM ({elapsed:.1f}s):\n{actual}\n📎 Sources: {len(sources)}")
            
            conversation_history.append({"user": user_msg, "expected": expected, "actual": actual})
            
            grade = grade_response_with_gpt(turn_num, user_msg, actual, expected, conversation_history)
            score = grade.get("score", -1)
            if score >= 0:
                print(f"\n🎯 SCORE: {score}/100 - {grade.get('reasoning', 'N/A')}")
            
            results.append({"turn": turn_num, "user_message": user_msg, "expected_response": expected, "actual_response": actual, "sources_count": len(sources), "elapsed_seconds": elapsed, "grade": grade})
        except Exception as e:
            print(f"✗ Error: {e}")
            results.append({"turn": turn_num, "error": str(e)})
        
        time.sleep(1)
    
    valid_scores = [r["grade"]["score"] for r in results if r.get("grade", {}).get("score", -1) >= 0]
    avg_score = sum(valid_scores) / len(valid_scores) if valid_scores else None
    
    print(f"\n{'=' * 70}\nSUMMARY: {avg_score:.1f}/100 avg ({len(valid_scores)} turns)\n{'=' * 70}")
    
    EVALS_DIR.mkdir(parents=True, exist_ok=True)
    git_short = metadata.get("git", {}).get("commit_short", "unknown")
    output_path = EVALS_DIR / f"{SESSION_NAME}_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{git_short}.json"
    
    with open(output_path, "w") as f:
        json.dump({"benchmark": {"name": f"WLC Session 5 - {SESSION_TITLE}", "source_doc": "docs/WLC_BENCHMARK_Q_AND_A.md", "design_principles": DESIGN_PRINCIPLES}, "metadata": metadata, "results": results, "summary": {"average_score": avg_score, "turns_graded": len(valid_scores), "total_turns": len(SESSION_TURNS)}}, f, indent=2)
    
    print(f"\n💾 Saved: {output_path}")
    return results


if __name__ == "__main__":
    run_benchmark()
