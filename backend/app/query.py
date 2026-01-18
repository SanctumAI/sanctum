"""
Sanctum RAG Query Module

Empathetic, session-aware RAG for human rights crisis support.
Pipeline: Query → Embed → Vector Search → 2-hop Graph → LLM → Answer

Key principles:
- Person is under duress: be calm, empathetic, don't overwhelm
- Law varies by jurisdiction: ask clarifying questions
- Capture facts early, handle nuance carefully
- Weight recommendations based on evidence strength
"""

import os
import logging
import uuid
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import httpx

from store import (
    embed_texts,
    get_neo4j_driver,
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
    jurisdiction: Optional[str] = None  # e.g., "Venezuela", "Belarus"
    situation_details: Optional[str] = None  # Any facts they share


class QueryResponse(BaseModel):
    answer: str
    session_id: str  # Return for continuity
    sources: list[dict]
    graph_context: dict
    clarifying_questions: list[str]  # Questions we need answered
    # Debug/trace info
    context_used: str  # The actual context passed to LLM (for debugging)
    temperature: float  # Temperature used


@router.post("", response_model=QueryResponse)
async def query(request: QueryRequest):
    """
    Empathetic RAG query with session support.
    
    1. Load/create session for conversation history
    2. Embed query with conversation context
    3. Vector search for relevant chunks/facts
    4. 2-hop graph traversal from matched entities
    5. Send context + history + query to LLM
    6. Return answer with clarifying questions if needed
    """
    question = request.question
    top_k = request.top_k or TOP_K_VECTORS
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
        
        # Extract sources and entity names
        sources, entity_names, chunk_texts = _process_search_results(search_results)
        
        # 3. Graph traversal (2 hops from matched entities)
        graph_context = _traverse_graph(list(entity_names)[:10], hops)
        
        # 4. Build context and call LLM with empathetic prompt
        context = _build_context(chunk_texts, graph_context, sources)
        answer, clarifying_questions, full_prompt = _call_llm_empathetic(
            question, context, session
        )
        
        # Add assistant response to history
        session["messages"].append({
            "role": "assistant", 
            "content": answer,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        # Track what we still need to know
        if clarifying_questions:
            session["pending_questions"] = clarifying_questions
        
        logger.info(f"RAG complete. Answer: {len(answer)} chars, {len(clarifying_questions)} clarifying Qs")
        
        return QueryResponse(
            answer=answer,
            session_id=session_id,
            sources=sources,
            graph_context=graph_context,
            clarifying_questions=clarifying_questions,
            context_used=full_prompt,  # For debugging - see exactly what LLM received
            temperature=0.1,
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


def _traverse_graph(entity_names: list[str], hops: int) -> dict:
    """Traverse Neo4j graph from entry point entities."""
    if not entity_names:
        return {"actions": [], "risks": [], "guidance": [], "warnings": [], "resources": [], "preconditions": []}
    
    driver = get_neo4j_driver()
    
    cypher = """
    UNWIND $names AS name
    MATCH (entry)
    WHERE toLower(entry.name) CONTAINS toLower(name)
    MATCH path = (entry)-[*1..%d]-(related)
    WITH DISTINCT related, labels(related)[0] AS type
    RETURN type, collect(DISTINCT related.name)[0..5] AS names
    ORDER BY type
    """ % hops
    
    with driver.session() as session:
        result = session.run(cypher, names=entity_names)
        
        context = {
            "actions": [], "risks": [], "guidance": [],
            "warnings": [], "resources": [], "preconditions": [],
        }
        
        type_map = {
            "Action": "actions", "Risk": "risks", "Guidance": "guidance",
            "Contraindication": "warnings", "Pitfall": "warnings",
            "Resource": "resources", "Precondition": "preconditions",
        }
        
        for record in result:
            node_type = record["type"]
            names = record["names"] or []
            key = type_map.get(node_type)
            if key:
                context[key].extend(names)
        
        for key in context:
            context[key] = list(set(context[key]))[:10]
        
        return context


def _build_context(chunk_texts: list[str], graph_context: dict, sources: list[dict]) -> str:
    """Build context string with source relevance scores."""
    parts = []
    
    # Include full chunk texts with relevance scores
    if chunk_texts:
        parts.append("=== RELEVANT PASSAGES FROM HANDBOOK ===")
        for i, text in enumerate(chunk_texts[:6], 1):
            score = sources[i-1]["score"] if i <= len(sources) else 0
            # Higher score = more relevant, note this for the LLM
            relevance = "HIGH" if score > 0.55 else "MEDIUM" if score > 0.45 else "LOW"
            parts.append(f"[{relevance} relevance] {text[:600]}")
            parts.append("")
    
    # Graph context
    if graph_context.get("actions"):
        parts.append("=== RECOMMENDED ACTIONS ===")
        parts.extend(f"• {a}" for a in graph_context["actions"])
        parts.append("")
    
    if graph_context.get("risks"):
        parts.append("=== RISKS TO BE AWARE OF ===")
        parts.extend(f"• {r}" for r in graph_context["risks"])
        parts.append("")
    
    if graph_context.get("warnings"):
        parts.append("=== CAUTIONS ===")
        parts.extend(f"⚠️ {w}" for w in graph_context["warnings"])
        parts.append("")
    
    return "\n".join(parts)


def _call_llm_empathetic(question: str, context: str, session: dict) -> tuple[str, list[str], str]:
    """
    Call LLM with empathetic, nuanced prompt.
    Returns (answer, list of clarifying questions, full_prompt for debugging).
    """
    llm = get_provider()
    
    # Build conversation history for context
    history_str = ""
    if session["messages"]:
        recent = session["messages"][-6:]  # Last 3 exchanges
        history_str = "\n".join([
            f"{'User' if m['role']=='user' else 'Assistant'}: {m['content'][:300]}"
            for m in recent[:-1]  # Exclude current message
        ])
    
    jurisdiction_note = ""
    if session.get("jurisdiction"):
        jurisdiction_note = f"User is in: {session['jurisdiction']}. Tailor advice to this context where possible."
    else:
        jurisdiction_note = "IMPORTANT: We don't know the user's jurisdiction yet. Laws vary widely. Ask about their location."
    
    prompt = f"""You are a compassionate crisis counselor helping someone whose loved one may have been detained for political reasons.

=== CRITICAL GUIDELINES ===

1. EMPATHY FIRST: This person is under extreme stress. Be warm, calm, and reassuring. Don't overwhelm them with information. Focus on ONE OR TWO immediate priorities.

2. ASK CLARIFYING QUESTIONS: Before giving detailed advice, gather essential facts:
   - What country/jurisdiction are they in?
   - When did the detention happen? (hours, days, weeks ago?)
   - Do they know where the person is being held?
   - Has there been any official communication?

3. **NEVER INVENT ORGANIZATION NAMES**: Do NOT make up names of NGOs, legal aid groups, or human rights organizations. Organizations change, get shut down, or may never have existed.
   - WRONG: "Contact the Nicaraguan Center for Human Rights"
   - RIGHT: "Search for a local human rights organization or legal aid group in your area. Verify they are currently operating before sharing sensitive information."
   - If the user needs a referral, tell them to search for "human rights legal aid [their country]" and verify the organization is active and trustworthy.

4. **PERSONAL DECISIONS ARE THEIRS TO MAKE**: For deeply personal questions like "should I leave the country?" or "should I go public?":
   - Present the pros and cons from the knowledge base
   - Offer emotional support
   - DO NOT push them toward either option
   - Say something like: "This is a deeply personal decision that only you can make. Here are some considerations..."
   - Acknowledge the weight of the decision and validate their feelings

5. NUANCED RECOMMENDATIONS: The handbook contains guidance that may seem contradictory. When this happens:
   - Acknowledge the nuance explicitly
   - Explain the trade-offs
   - For factual guidance (documentation, timing), give clear recommendations
   - For personal choices (leaving, publicizing), present options without pushing
   
6. JURISDICTION MATTERS: {jurisdiction_note}

7. ONE STEP AT A TIME: Don't give a 10-step plan. Give the FIRST thing they should do, then offer to continue.

8. VERIFY BEFORE TRUSTING: When suggesting the user contact organizations, remind them:
   - "Verify any organization is currently active before sharing details"
   - "Political situations change - groups that existed years ago may be shut down"

=== CONVERSATION HISTORY ===
{history_str if history_str else "(This is the start of the conversation)"}

=== KNOWLEDGE BASE CONTEXT (from handbook) ===
{context}

=== CURRENT QUESTION ===
{question}

=== YOUR RESPONSE ===
Respond with empathy. If you need more information before giving specific advice, ask 1-2 clarifying questions. 
End your response with any clarifying questions on their own lines starting with "?" so they can be extracted.

Remember: This person needs calm support, not a wall of text. Be concise but warm.
NEVER invent organization names. For personal decisions, support but don't push."""

    response = llm.complete(prompt, temperature=0.1)
    answer = response.content
    
    # Extract clarifying questions (lines starting with ?)
    clarifying_questions = []
    lines = answer.split("\n")
    
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("?"):
            clarifying_questions.append(stripped[1:].strip())
    
    # Return answer, questions, and full prompt for debugging
    return answer, clarifying_questions, prompt


@router.get("/session/{session_id}")
async def get_session(session_id: str):
    """Get session history and state."""
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    return _sessions[session_id]


@router.delete("/session/{session_id}")
async def delete_session(session_id: str):
    """Delete a session."""
    if session_id in _sessions:
        del _sessions[session_id]
    return {"status": "deleted"}
