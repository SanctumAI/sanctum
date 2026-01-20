#!/usr/bin/env python3
"""
Lo-Fi Benchmark Part 4: Brother Released with Silence Condition (Nicaragua)

Tests Sanctum RAG against the WLC Benchmark Q&A Session 4.
Grades responses using GPT to compare against expected outputs.

Usage:
    python scripts/lofi-benchmark-pt4.py
    
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

# Session 4: Brother Released with Silence Condition (Nicaragua)
SESSION_TURNS = [
    {
        "turn": 1,
        "user_message": "My brother was released but they told him not to talk. What now?",
        "expected_response": """I'm really glad to hear your brother is out, and I can hear how heavy it feels to be told to stay silent. It's normal to feel unsure about what to do next, especially when the pressure to keep quiet is still there.

First, can you tell me a bit about his current situation? Is he living at home, under any kind of house‑arrest or monitoring, and does he have any way to talk to family or friends safely? Knowing that will help us pick the safest first step.

If he's free to move but still feels unsafe speaking, the safest immediate thing is to create a private, written record of what happened—just a notebook he keeps hidden or a note on his phone that only he can see. This can be useful later if he decides to share his story or needs it for legal help, and it doesn't expose him right now."""
    },
    {
        "turn": 2,
        "user_message": "He is home but he has to check in with police every week. He is scared and barely talks to anyone. He was in El Chipote for 6 months. He looks different.",
        "expected_response": """I'm really glad your brother is home, but I can hear how heavy the fear and silence feel right now. Being told not to talk and having to check in with police every week can make anyone feel isolated and on edge.

Can you tell me if he has any trusted family member or friend he feels safe talking to, even just for a few minutes?  
Is he experiencing any physical health problems or strong anxiety that feels hard to manage on his own?

A good first step is to create a tiny "safe space" for him to let out what's inside—maybe a private notebook, a voice memo on his phone, or a short chat with someone he trusts. Even writing a few lines about how he feels each day can help break the pressure of keeping everything inside.

At the same time, it's wise to keep a simple record of any police check‑ins: date, time, what was asked, and how he felt. This can be useful later if he needs legal advice."""
    },
    {
        "turn": 3,
        "user_message": "He talks to me but not much. He has nightmares. I want to help him but I also want the world to know what happened to him. He says no. What do I do?",
        "expected_response": """I'm really sorry you're both carrying this weight. It sounds like your brother is still feeling the fear and the trauma from his time in El Chipote, and you want to protect him while also making sure his story isn't lost.

First, can you tell me if there's anyone he trusts—a close family member, a friend, or a counselor—who could be a safe ear for him when he's ready to talk?

If he's not ready to speak publicly, a gentle way to start is to help him keep a private record of what happened—like a notebook he can lock away or a password‑protected note on his phone. He can write in it whenever he feels up to it, and you can keep it safe for him. This gives him control over his story and creates a factual account you can use later if he decides to share it.

When you think about telling the world, weigh the pros and cons: sharing can bring pressure on the authorities, but it can also increase the risk of surveillance or more police check‑ins for him. **Only he can decide** which risk feels acceptable."""
    },
    {
        "turn": 4,
        "user_message": "I understand. But what if something happens to him again? I want there to be a record somewhere safe outside Nicaragua. Is that possible without him knowing?",
        "expected_response": """I hear how worried you are that something could happen again, and how important it feels to keep a record of what he went through in a place he can't reach. The first thing to do is to write down the key facts—dates, places, what he was told, any medical notes—on paper that only you can see. When you feel safe, make a copy (a photo or a scan) and store it in a personal cloud drive or email that only you can open.

Do you have regular internet access or a trusted device you can use for a private cloud or email?  
Is there anyone else you trust (a close friend or relative) who could help keep a backup if you need it?

If you decide to share the record later, you can search online for "human‑rights legal help in Nicaragua" and verify the groups are still active before sending anything."""
    },
    {
        "turn": 5,
        "user_message": "Yes I have internet and my cousin lives in Miami. One more thing - he was tortured. Should I write that down too? Will anyone believe us?",
        "expected_response": """I'm really sorry you're carrying this weight for both of you. It's understandable to want a record of what happened, especially when the pain is so real and the fear of it happening again is strong.

The first step is to write down the key facts—dates, places, what was said, and the torture you know about. Keep that paper in a safe spot only you can reach (a locked drawer, a hidden notebook, or a password‑protected file on a personal device). If you feel comfortable, give a copy to your cousin in Miami so there's a backup outside the country.

If you ever consider making the story public, think about two things:
- **Pros:** It can bring attention and pressure, and maybe help protect your brother by making the abuse harder to hide
- **Cons:** It could increase the risk of retaliation, especially if authorities see it as "spreading false information"

**Only you and your brother can decide what feels right.** What matters most right now is his safety and your own well‑being.

Do you have any medical notes or other paperwork that confirm what he endured?"""
    }
]

SESSION_NAME = "session4_silence_condition"
SESSION_TITLE = "Brother Released with Silence Condition (Nicaragua)"


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
    print(f"SANCTUM Lo-Fi BENCHMARK - Part 4: {SESSION_TITLE}")
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
            context_used = response.get("context_used", "")
            
            print(f"📥 SANCTUM ({elapsed:.1f}s):\n")
            print(actual)
            print(f"\n📎 Sources: {len(sources)} retrieved")
            
            # Show source files for visibility
            source_files = set(s.get("source_file", "") for s in sources if s.get("source_file"))
            if source_files:
                print(f"   Files: {', '.join(source_files)}")
            
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
            
            # Build condensed sources for output
            sources_summary = [
                {
                    "file": s.get("source_file", "unknown"),
                    "score": round(s.get("score", 0), 3),
                    "text_preview": s.get("text", "")[:200] + "..." if len(s.get("text", "")) > 200 else s.get("text", "")
                }
                for s in sources[:6]
            ]
            
            results.append({
                "turn": turn_num,
                "user_message": user_msg,
                "expected_response": expected,
                "actual_response": actual,
                "sources_count": len(sources),
                "sources": sources_summary,
                "rag_context_preview": context_used[-2000:] if len(context_used) > 2000 else context_used,
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
            "name": f"WLC Session 4 - {SESSION_TITLE}",
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
