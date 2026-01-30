"""
Sanctum RAG Query Module

Session-aware RAG for querying knowledge bases.
Pipeline: Query → Embed → Vector Search → LLM → Answer

Key principles:
- Provide clear, helpful responses
- Ask clarifying questions when context is needed
- Cite sources accurately
"""

import os
import logging
import uuid
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

import httpx

import auth
from store import (
    embed_texts,
    COLLECTION_NAME,
    QDRANT_HOST,
    QDRANT_PORT,
)
from llm import get_provider

logger = logging.getLogger("sanctum.query")

router = APIRouter(prefix="/query", tags=["query"])

# Configuration
TOP_K_VECTORS = int(os.getenv("RAG_TOP_K", "8"))  # More context for nuance
GRAPH_HOPS = int(os.getenv("RAG_GRAPH_HOPS", "2"))

# Simple in-memory session store (replace with Redis/DB for production)
_sessions: dict[str, dict] = {}


class Message(BaseModel):
    role: str  # "user" or "assistant"
    content: str
    timestamp: Optional[str] = None


class QueryRequest(BaseModel):
    question: str
    session_id: Optional[str] = None  # For conversation continuity
    top_k: Optional[int] = None
    graph_hops: Optional[int] = None
    # Optional context the user provides upfront
    jurisdiction: Optional[str] = None  # e.g., "California", "Germany"
    situation_details: Optional[str] = None  # Any facts they share
    tools: list[str] = []  # Tool IDs enabled for this request


class QueryResponse(BaseModel):
    answer: str
    session_id: str  # Return for continuity
    sources: list[dict]
    graph_context: dict
    clarifying_questions: list[str]  # Questions we need answered
    search_term: Optional[str] = None  # Auto-search term (if search tool enabled)
    # Debug/trace info
    context_used: str  # The actual context passed to LLM (for debugging)
    temperature: float  # Temperature used


@router.post("", response_model=QueryResponse)
async def query(request: QueryRequest, user: dict = Depends(auth.require_admin_or_approved_user)):
    """
    RAG query with session support.
    Requires authenticated admin OR approved user.

    1. Load/create session for conversation history
    2. Embed query with conversation context
    3. Vector search for relevant chunks
    4. Send context + history + query to LLM
    5. Return answer with clarifying questions if needed
    """
    from ai_config import get_llm_parameters

    question = request.question
    llm_params = get_llm_parameters()

    # Get top_k from config if not specified in request
    if request.top_k is not None:
        top_k = request.top_k
    else:
        try:
            top_k = int(llm_params.get("top_k", TOP_K_VECTORS))
        except (ValueError, TypeError):
            top_k = TOP_K_VECTORS
    hops = min(request.graph_hops or GRAPH_HOPS, 2)
    
    # Session management
    session_id = request.session_id or str(uuid.uuid4())
    session = _get_or_create_session(session_id)
    
    # Add user context if provided
    if request.jurisdiction and not session.get("jurisdiction"):
        session["jurisdiction"] = request.jurisdiction
    if request.situation_details:
        session["situation_details"] = session.get("situation_details", "") + "\n" + request.situation_details
    
    # Add user message to history
    session["messages"].append({
        "role": "user",
        "content": question,
        "timestamp": datetime.utcnow().isoformat()
    })
    
    logger.info(f"RAG query (session={session_id[:8]}): '{question[:50]}...'")
    
    try:
        # 1. Embed the query (include conversation context for better retrieval)
        search_query = _build_search_query(question, session)
        query_embedding = embed_texts([f"query: {search_query}"])[0]
        
        # 2. Vector search in Qdrant
        qdrant_url = f"http://{QDRANT_HOST}:{QDRANT_PORT}/collections/{COLLECTION_NAME}/points/search"
        search_response = httpx.post(
            qdrant_url,
            json={
                "vector": query_embedding,
                "limit": top_k,
                "with_payload": True,
            },
            timeout=30.0,
        )
        search_response.raise_for_status()
        search_results = search_response.json().get("result", [])
        
        # Extract sources and chunk texts
        sources, entity_names, chunk_texts = _process_search_results(search_results)

        # Graph context no longer used - simple vector search only
        graph_context = {"actions": [], "risks": [], "guidance": [], "warnings": [], "resources": [], "preconditions": []}

        # 4. Build context and call LLM with context-aware prompt
        context = _build_context(chunk_texts, sources)
        session["_last_sources"] = sources  # For dynamic citation
        answer, clarifying_questions, full_prompt, search_term = _call_llm_contextual(
            question, context, session, tools=request.tools
        )
        
        # Add assistant response to history
        session["messages"].append({
            "role": "assistant", 
            "content": answer,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        # Run dedicated fact extraction after response (more reliable than in-response tags)
        session["facts_gathered"] = _extract_facts_from_conversation(session)
        
        # Update jurisdiction from extracted facts if we got location/country
        if not session.get("jurisdiction"):
            facts = session.get("facts_gathered", {})
            if facts.get("location"):
                session["jurisdiction"] = facts["location"]
        
        # Track what we still need to know
        if clarifying_questions:
            session["pending_questions"] = clarifying_questions
        
        # Get actual temperature for response (same logic as _call_llm_contextual)
        try:
            actual_temperature = float(llm_params.get("temperature", 0.1))
        except (ValueError, TypeError):
            actual_temperature = 0.1

        logger.info(f"RAG complete. Answer: {len(answer)} chars, {len(clarifying_questions)} clarifying Qs, search_term={search_term}, facts={session.get('facts_gathered', {})}")

        return QueryResponse(
            answer=answer,
            session_id=session_id,
            sources=sources,
            graph_context=graph_context,
            clarifying_questions=clarifying_questions,
            search_term=search_term,  # Auto-search trigger (if web-search tool enabled)
            context_used=full_prompt,  # For debugging - see exactly what LLM received
            temperature=actual_temperature,
        )
        
    except Exception as e:
        logger.error(f"RAG query failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


def _get_or_create_session(session_id: str) -> dict:
    """Get existing session or create new one."""
    if session_id not in _sessions:
        _sessions[session_id] = {
            "id": session_id,
            "created_at": datetime.utcnow().isoformat(),
            "messages": [],
            "jurisdiction": None,
            "situation_details": None,
            "facts_gathered": {},
            "pending_questions": [],
        }
    return _sessions[session_id]


def _extract_facts_from_conversation(session: dict) -> dict:
    """
    Dedicated fact extraction pass - runs after main response.
    Uses a focused prompt to reliably extract structured facts from conversation.
    """
    import json as json_module
    llm = get_provider()
    
    # Format conversation for fact extraction
    messages = session.get("messages", [])
    if not messages:
        return {}
    
    conversation_text = "\n".join([
        f"{'User' if m['role']=='user' else 'Assistant'}: {m['content']}"
        for m in messages[-8:]  # Last 4 exchanges max
    ])
    
    # Get existing facts to avoid overwriting with "unknown"
    existing_facts = session.get("facts_gathered", {})
    
    prompt = f"""Extract ONLY facts that are EXPLICITLY stated in this conversation.
Do NOT guess or infer. If something is not clearly stated, use null.

Conversation:
{conversation_text}

Extract these facts (use null if not explicitly mentioned):
- location: Where is the USER currently located? (city/country)
- topic: What is the main topic or subject of the query?
- context_details: Any relevant context provided by the user
- timeframe: When did relevant events happen? (e.g., "3 days ago", "last week")

Return ONLY valid JSON, no explanation:
{{"location": ..., "topic": ..., "context_details": ..., "timeframe": ...}}"""

    try:
        response = llm.complete(prompt, temperature=0.0)
        content = response.content.strip()
        
        # Try to extract JSON from response (handle markdown code blocks)
        if "```" in content:
            # Extract from code block
            import re
            json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', content, re.DOTALL)
            if json_match:
                content = json_match.group(1)
        
        # Parse JSON
        extracted = json_module.loads(content)
        
        # Merge with existing facts, only updating non-null values
        for key, value in extracted.items():
            if value is not None and value != "null" and value != "":
                existing_facts[key] = value
        
        logger.info(f"Fact extraction complete: {existing_facts}")
        return existing_facts
        
    except Exception as e:
        logger.warning(f"Fact extraction failed: {e}")
        return existing_facts


def _build_search_query(question: str, session: dict) -> str:
    """Build search query including relevant session context."""
    parts = [question]
    
    if session.get("jurisdiction"):
        parts.append(f"jurisdiction: {session['jurisdiction']}")
    
    if session.get("situation_details"):
        # Include recent situation details for better retrieval
        parts.append(session["situation_details"][-500:])
    
    return " ".join(parts)


def _process_search_results(search_results: list) -> tuple[list, set, list]:
    """Process Qdrant results into sources, entity names, and chunk texts."""
    sources = []
    entity_names = set()
    chunk_texts = []
    
    for result in search_results:
        payload = result.get("payload", {})
        score = result.get("score", 0)
        
        sources.append({
            "score": score,
            "type": payload.get("type", "unknown"),
            "text": payload.get("text") or payload.get("fact_text", ""),
            "chunk_id": payload.get("chunk_id", ""),
            "source_file": payload.get("source_file", ""),
        })
        
        if payload.get("type") == "fact":
            entity_names.add(payload.get("from_entity", ""))
            entity_names.add(payload.get("to_entity", ""))
        
        if payload.get("text"):
            chunk_texts.append(payload.get("text"))
        
        for name in payload.get("entity_names", []):
            entity_names.add(name)
    
    entity_names.discard("")
    return sources, entity_names, chunk_texts


def _build_context(chunk_texts: list[str], sources: list[dict]) -> str:
    """Build context string from retrieved chunks."""
    parts = []

    # Include full chunk texts
    if chunk_texts:
        parts.append("=== RELEVANT PASSAGES ===")
        for i, text in enumerate(chunk_texts[:6], 1):
            parts.append(f"[{i}] {text[:800]}")
            parts.append("")

    return "\n".join(parts)


def _call_llm_contextual(question: str, context: str, session: dict, tools: Optional[list[str]] = None) -> tuple[str, list[str], str, Optional[str]]:
    """
    Call LLM with context-aware prompt.
    Returns (answer, list of clarifying questions, full_prompt for debugging, search_term or None).
    """
    import re
    from ai_config import get_prompt_sections, get_llm_parameters
    llm = get_provider()
    tools = tools or []

    # Get prompt sections from database (with defensive fallbacks)
    prompt_sections = get_prompt_sections() or {}
    llm_params = get_llm_parameters() or {}

    # Get temperature from config (with fallback and type coercion)
    try:
        temperature = float(llm_params.get("temperature", 0.1))
    except (ValueError, TypeError):
        temperature = 0.1

    # Build conversation history for context
    history_str = ""
    if session["messages"]:
        recent = session["messages"][-6:]  # Last 3 exchanges
        history_str = "\n".join([
            f"{'User' if m['role']=='user' else 'Assistant'}: {m['content'][:300]}"
            for m in recent[:-1]  # Exclude current message
        ])

    # Extract source files from context for citation
    source_files = set()
    for src in session.get("_last_sources", []):
        sf = src.get("source_file", "")
        if sf:
            source_files.add(sf.replace(".pdf", "").replace("-", " ").replace("_", " "))
    source_citation = ", ".join(source_files) if source_files else "knowledge base documents"

    # Build known facts section - treat these as CONFIRMED, do not re-ask
    facts = session.get("facts_gathered", {})
    if facts:
        facts_lines = []
        for key, value in facts.items():
            if value:
                facts_lines.append(f"  - {key}: {value}")
        known_facts_section = "=== CONFIRMED FACTS (do NOT re-ask these) ===\n" + "\n".join(facts_lines)
        jurisdiction_note = "Use the confirmed facts above. Only ask clarifying questions about things NOT already known."
    else:
        known_facts_section = "=== NO FACTS CONFIRMED YET ===\nAsk about location and context early, but only once per conversation."
        jurisdiction_note = "We don't know location yet. Ask about it, but don't repeatedly ask if user doesn't answer."

    # Auto-search instruction if web-search tool is enabled
    search_instruction = ""
    if "web-search" in tools:
        search_instruction = """
=== AUTO-SEARCH (IMPORTANT!) ===
Add [SEARCH: specific term] at the END of your response when:
- User says "I don't know anyone/any lawyers/who to call" → SEARCH NOW
- User needs embassy, lawyer, NGO, or hotline contacts → SEARCH NOW
- User asks "who do I contact" or "where do I find" → SEARCH NOW

Do NOT tell them to "look up" or "search for" something - just trigger the search.
Make search terms specific: "[SEARCH: local library hours downtown]"
"""

    # Build style section from config
    prompt_tone = prompt_sections.get("prompt_tone", "Be helpful, concise, and professional.")
    style_section = f"=== STYLE ===\n{prompt_tone}"
    if search_instruction:
        style_section += f"\n{search_instruction}"

    # Build rules section from config
    prompt_rules = prompt_sections.get("prompt_rules", [])
    if isinstance(prompt_rules, list) and prompt_rules:
        rules_lines = [f"{i}. {rule}" for i, rule in enumerate(prompt_rules, 1)]
        rules_lines.append(f"{len(prompt_rules) + 1}. {jurisdiction_note}")
        rules_lines.append(f"{len(prompt_rules) + 2}. Do NOT repeat questions already answered in CONFIRMED FACTS above")
        rules_section = "=== RULES ===\n" + "\n".join(rules_lines)
    else:
        rules_section = f"""=== RULES ===
1. ONE action per response when providing step-by-step guidance
2. NEVER invent sources, organization names, or contact information
3. If asked about topics outside your knowledge base, acknowledge limitations
4. {jurisdiction_note}
5. Do NOT repeat questions already answered in CONFIRMED FACTS above"""

    # Build forbidden topics section from config (if any)
    prompt_forbidden = prompt_sections.get("prompt_forbidden", [])
    forbidden_section = ""
    if isinstance(prompt_forbidden, list) and prompt_forbidden:
        forbidden_section = "\n\n=== FORBIDDEN TOPICS ===\nIf asked about these topics, politely decline:\n"
        forbidden_section += "\n".join([f"- {topic}" for topic in prompt_forbidden])

    prompt = f"""You are a helpful, knowledgeable assistant.

{known_facts_section}

{style_section}

{rules_section}{forbidden_section}

=== SOURCE ===
{source_citation}

=== CONVERSATION ===
{history_str if history_str else "(Start)"}

=== CONTEXT ===
{context}

=== QUESTION ===
{question}

=== RESPOND ==="""

    response = llm.complete(prompt, temperature=temperature)
    answer = response.content
    
    # Extract search term if present
    search_term = None
    search_match = re.search(r'\[SEARCH:\s*([^\]]+)\]', answer)
    if search_match:
        search_term = search_match.group(1).strip()
        # Remove the search tag from the visible answer
        answer = re.sub(r'\s*\[SEARCH:\s*[^\]]+\]\s*', '', answer).strip()
    
    # Extract and store facts (always strip from visible answer)
    answer = re.sub(r'\s*\[FACTS:[^\]]*\]\s*', '', answer).strip()
    facts_match = re.search(r'\[FACTS:\s*([^\]]+)\]', response.content)
    if facts_match:
        facts_str = facts_match.group(1).strip()
        if facts_str:
            for pair in facts_str.split(','):
                if '=' in pair:
                    key, value = pair.split('=', 1)
                    key, value = key.strip(), value.strip()
                    if key and value:
                        if "facts_gathered" not in session:
                            session["facts_gathered"] = {}
                        session["facts_gathered"][key] = value
            logger.info(f"Session facts updated: {session.get('facts_gathered', {})}")
    
    # Extract clarifying questions (lines starting with ?)
    clarifying_questions = []
    lines = answer.split("\n")
    
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("?"):
            clarifying_questions.append(stripped[1:].strip())
    
    # Return answer, questions, full prompt for debugging, and search term
    return answer, clarifying_questions, prompt, search_term


@router.get("/session/{session_id}")
async def get_session(session_id: str, user: dict = Depends(auth.require_admin_or_approved_user)):
    """Get session history and state. Requires auth."""
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    return _sessions[session_id]


@router.delete("/session/{session_id}")
async def delete_session(session_id: str, user: dict = Depends(auth.require_admin_or_approved_user)):
    """Delete a session. Requires auth."""
    if session_id in _sessions:
        del _sessions[session_id]
    return {"status": "deleted"}
