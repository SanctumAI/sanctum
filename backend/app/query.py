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
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

import httpx

import auth
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
    Empathetic RAG query with session support.
    Requires authenticated admin OR approved user.
    
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
        session["_last_sources"] = sources  # For dynamic citation
        answer, clarifying_questions, full_prompt, search_term = _call_llm_empathetic(
            question, context, session, tools=request.tools
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
        
        logger.info(f"RAG complete. Answer: {len(answer)} chars, {len(clarifying_questions)} clarifying Qs, search_term={search_term}")
        
        return QueryResponse(
            answer=answer,
            session_id=session_id,
            sources=sources,
            graph_context=graph_context,
            clarifying_questions=clarifying_questions,
            search_term=search_term,  # Auto-search trigger (if web-search tool enabled)
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
    
    # Urgent relationship patterns - these indicate time-sensitivity or escalation
    URGENT_PATTERNS = ['WORSENS', 'TIME_SENSITIVE', 'REQUIRES_FIRST', 'ESCALATES_TO', 'BLOCKED_BY']
    
    # Extract urgent facts FIRST (put at top of context for emphasis)
    urgent_facts = []
    regular_facts = []
    for src in sources:
        text = src.get("text", "")
        if src.get("type") == "fact" and any(p in text for p in URGENT_PATTERNS):
            urgent_facts.append(text)
        elif src.get("type") == "fact":
            regular_facts.append(text)
    
    # Put urgent/timing facts at the TOP
    if urgent_facts:
        parts.append("=== IMPORTANT TIMING ===")
        parts.append("(Address these points calmly but make sure the user understands their importance)")
        for fact in urgent_facts[:3]:
            parts.append(f"• {fact[:200]}")
        parts.append("")
    
    # Include full chunk texts with relevance scores
    if chunk_texts:
        parts.append("=== RELEVANT PASSAGES ===")
        for i, text in enumerate(chunk_texts[:4], 1):
            parts.append(f"{text[:500]}")
            parts.append("")
    
    # Graph context
    if graph_context.get("actions"):
        parts.append("=== ACTIONS ===")
        parts.extend(f"• {a}" for a in graph_context["actions"][:5])
        parts.append("")
    
    if graph_context.get("risks"):
        parts.append("=== RISKS ===")
        parts.extend(f"• {r}" for r in graph_context["risks"][:5])
        parts.append("")
    
    return "\n".join(parts)


def _call_llm_empathetic(question: str, context: str, session: dict, tools: list[str] = None) -> tuple[str, list[str], str, Optional[str]]:
    """
    Call LLM with empathetic, nuanced prompt.
    Returns (answer, list of clarifying questions, full_prompt for debugging, search_term or None).
    """
    import re
    llm = get_provider()
    tools = tools or []
    
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
    
    # Extract source files from context for citation
    source_files = set()
    for src in session.get("_last_sources", []):
        sf = src.get("source_file", "")
        if sf and "Pathway" in sf:
            source_files.add("Pathway to Freedom Handbook (World Liberty Congress)")
        elif sf:
            source_files.add(sf.replace(".pdf", "").replace("-", " ").replace("_", " "))
    source_citation = ", ".join(source_files) if source_files else "human rights guidance materials"
    
    # Auto-search instruction if web-search tool is enabled
    search_instruction = ""
    if "web-search" in tools:
        search_instruction = """
=== AUTO-SEARCH ===
You can trigger a web search by adding [SEARCH: term] at the END of your response.

TRIGGER A SEARCH when the user:
- Says they don't know any lawyers/contacts/resources
- Asks "where can I find..." or "how do I contact..."
- Needs specific local contacts (lawyers, NGOs, embassies, hotlines)
- Needs help with secure tools (VPN, Signal, encrypted messaging)
- Is in a location and needs local resources

DO NOT search when:
- User asks "what should I say/do" (answer from knowledge base)
- You're still gathering basic info about their situation
- The question is about advice/guidance, not finding contacts

Example: If user says "I don't know any lawyers here" → [SEARCH: Venezuela human rights lawyers Caracas]
Make search terms specific with location: "Venezuela human rights lawyers Caracas" not just "lawyers"
"""
    
    prompt = f"""You are a calm, caring helper for someone in crisis. They may be scared, exhausted, or overwhelmed.

=== STYLE - THIS IS CRITICAL ===
- VERY SHORT. 5 sentences max per idea. Max 2 short paragraphs + questions.
- Plain words. No jargon. Talk like a trusted friend, not a lawyer.
- ONE thing to do first. Then offer to continue.

=== RULES ===
1. Warmth first. Acknowledge their feelings in ONE sentence.
2. If you see "IMPORTANT TIMING" in context, calmly but clearly explain why timing matters. Don't alarm them - just help them understand it's worth acting soon.
3. Give ONE clear next step.
4. If you need more info, ask 1-2 questions at the end. Put each question on its own line, like a normal sentence. Do NOT start with "?" symbol.
5. NEVER invent organization names or contacts.
6. Personal choices (leave? go public?): brief pros/cons, then "Only you can decide."
7. {jurisdiction_note}
{search_instruction}
=== SOURCE ===
This advice draws from: {source_citation}

=== CONVERSATION ===
{history_str if history_str else "(Start)"}

=== CONTEXT ===
{context}

=== QUESTION ===
{question}

=== RESPOND (keep it short!) ==="""

    response = llm.complete(prompt, temperature=0.1)
    answer = response.content
    
    # Extract search term if present
    search_term = None
    search_match = re.search(r'\[SEARCH:\s*([^\]]+)\]', answer)
    if search_match:
        search_term = search_match.group(1).strip()
        # Remove the search tag from the visible answer
        answer = re.sub(r'\s*\[SEARCH:\s*[^\]]+\]\s*', '', answer).strip()
    
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
