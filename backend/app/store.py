"""
Sanctum Store Module
Handles storing extracted entities and relationships to Neo4j and Qdrant.
"""

import os
import uuid
import logging
from typing import Any

from neo4j import GraphDatabase
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

# Configure logging
logger = logging.getLogger("sanctum.store")

# Configuration
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "sanctum_dev_password")
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))

# =============================================================================
# EMBEDDING PROVIDER CONFIGURATION
# =============================================================================
# Set EMBEDDING_PROVIDER to switch between local and API-based embeddings:
#   - "local" (default): Uses sentence-transformers on CPU (slow but free)
#   - "openai": Uses OpenAI API (fast but costs money, requires OPENAI_API_KEY)
#
# For OpenAI, set these env vars:
#   EMBEDDING_PROVIDER=openai
#   OPENAI_API_KEY=sk-...
#   EMBEDDING_MODEL=text-embedding-3-small  (or text-embedding-ada-002)
#   EMBEDDING_DIMENSIONS=768  (to match local model, or 1536 for full quality)
# =============================================================================
EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "local")  # "local" or "openai"
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "intfloat/multilingual-e5-base")
EMBEDDING_DIMENSIONS = int(os.getenv("EMBEDDING_DIMENSIONS", "768"))

# Collection name for knowledge base
COLLECTION_NAME = "sanctum_knowledge"

# Lazy-loaded resources
_neo4j_driver = None
_qdrant_client = None
_embedding_model = None
_openai_client = None


def get_neo4j_driver():
    """Get or create Neo4j driver"""
    global _neo4j_driver
    if _neo4j_driver is None:
        _neo4j_driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    return _neo4j_driver


def get_qdrant_client():
    """Get or create Qdrant client"""
    global _qdrant_client
    if _qdrant_client is None:
        _qdrant_client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
    return _qdrant_client


def get_embedding_model():
    """Get or create local embedding model (sentence-transformers)"""
    global _embedding_model
    if _embedding_model is None:
        from sentence_transformers import SentenceTransformer
        _embedding_model = SentenceTransformer(EMBEDDING_MODEL)
    return _embedding_model


def get_openai_client():
    """Get or create OpenAI client"""
    global _openai_client
    if _openai_client is None:
        from openai import OpenAI
        _openai_client = OpenAI()  # Uses OPENAI_API_KEY env var
    return _openai_client


def embed_texts(texts: list[str]) -> list[list[float]]:
    """
    Embed a list of texts using the configured provider.
    Returns list of embedding vectors.
    """
    if EMBEDDING_PROVIDER == "openai":
        return _embed_texts_openai(texts)
    else:
        return _embed_texts_local(texts)


def _embed_texts_local(texts: list[str]) -> list[list[float]]:
    """Embed using local sentence-transformers model (slow on CPU)"""
    model = get_embedding_model()
    embeddings = model.encode(texts, show_progress_bar=False)
    return [emb.tolist() for emb in embeddings]


def _embed_texts_openai(texts: list[str]) -> list[list[float]]:
    """Embed using OpenAI API (fast, requires API key)"""
    client = get_openai_client()
    
    # OpenAI embedding API
    # text-embedding-3-small supports dimensions parameter
    # text-embedding-ada-002 does not (always 1536)
    model = EMBEDDING_MODEL if EMBEDDING_MODEL.startswith("text-embedding") else "text-embedding-3-small"
    
    response = client.embeddings.create(
        model=model,
        input=texts,
        dimensions=EMBEDDING_DIMENSIONS if "text-embedding-3" in model else None,
    )
    
    # Extract embeddings in order
    embeddings = [item.embedding for item in response.data]
    return embeddings


def get_embedding_dimension() -> int:
    """Get the dimension of embeddings from current provider"""
    if EMBEDDING_PROVIDER == "openai":
        return EMBEDDING_DIMENSIONS
    else:
        model = get_embedding_model()
        return model.get_sentence_embedding_dimension()


def ensure_qdrant_collection():
    """Ensure the knowledge collection exists in Qdrant"""
    client = get_qdrant_client()
    
    collections = client.get_collections().collections
    collection_exists = any(c.name == COLLECTION_NAME for c in collections)
    
    if not collection_exists:
        vector_dim = get_embedding_dimension()
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(
                size=vector_dim,
                distance=Distance.COSINE
            )
        )
        logger.info(f"Created Qdrant collection: {COLLECTION_NAME} (dim={vector_dim})")


def generate_entity_id(entity_type: str, entity_name: str) -> str:
    """Generate a deterministic UUID for an entity"""
    content = f"{entity_type}:{entity_name}".lower()
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, content))


async def store_extraction_to_graph(
    chunk_id: str,
    extraction: dict,
    source_text: str,
    source_file: str,
    ontology_id: str,
) -> dict[str, Any]:
    """
    Store extracted entities and relationships to Neo4j and Qdrant.
    
    Returns summary of what was stored.
    """
    logger.info(f"[{chunk_id}] Storing extraction to graph...")
    entities = extraction.get("entities", [])
    relationships = extraction.get("relationships", [])
    logger.debug(f"[{chunk_id}] Entities: {len(entities)}, Relationships: {len(relationships)}")
    
    neo4j_result = {"nodes_created": 0, "relationships_created": 0}
    qdrant_result = {"points_inserted": 0}
    
    logger.debug(f"[{chunk_id}] Getting Neo4j driver...")
    driver = get_neo4j_driver()
    logger.debug(f"[{chunk_id}] Getting Qdrant client...")
    client = get_qdrant_client()
    
    # Ensure Qdrant collection exists
    logger.debug(f"[{chunk_id}] Ensuring Qdrant collection exists...")
    ensure_qdrant_collection()
    
    # Store entities in Neo4j
    with driver.session() as session:
        for entity in entities:
            entity_type = entity.get("type", "Entity")
            entity_name = entity.get("name", "Unknown")
            properties = entity.get("properties", {})
            
            # Generate deterministic ID
            entity_id = generate_entity_id(entity_type, entity_name)
            
            # Build properties dict
            props = {
                "id": entity_id,
                "name": entity_name,
                "ontology_id": ontology_id,
                "source_file": source_file,
                "chunk_id": chunk_id,
                **properties,
            }
            
            # Create or merge node (MERGE to avoid duplicates)
            # Use dynamic label based on entity type
            query = f"""
                MERGE (n:{entity_type} {{id: $id}})
                SET n += $props
                RETURN n.id as id
            """
            
            result = session.run(query, id=entity_id, props=props)
            if result.single():
                neo4j_result["nodes_created"] += 1
        
        # Store relationships in Neo4j
        for rel in relationships:
            rel_type = rel.get("type", "RELATED_TO")
            from_entity = rel.get("from_entity", "")
            to_entity = rel.get("to_entity", "")
            evidence = rel.get("evidence", "")
            
            if not from_entity or not to_entity:
                continue
            
            # We need to find the nodes - try to match by name
            query = """
                MATCH (a) WHERE toLower(a.name) = toLower($from_name)
                MATCH (b) WHERE toLower(b.name) = toLower($to_name)
                MERGE (a)-[r:""" + rel_type + """ {chunk_id: $chunk_id}]->(b)
                SET r.evidence = $evidence,
                    r.source_file = $source_file
                RETURN type(r) as rel_type
            """
            
            result = session.run(
                query,
                from_name=from_entity,
                to_name=to_entity,
                chunk_id=chunk_id,
                evidence=evidence,
                source_file=source_file,
            )
            if result.single():
                neo4j_result["relationships_created"] += 1
    
    # =========================================================================
    # EMBEDDING STRATEGY OPTIONS (Current: Option A - Chunks + Facts)
    # =========================================================================
    # 
    # Option A: Chunks + Facts (CURRENT - Best for action-oriented queries)
    #   - Embed chunks for grounding/citation
    #   - Embed facts as statements: "Legal counsel PROTECTS_AGAINST coerced confession"
    #   - Skip entity embeddings (entities searchable via Neo4j)
    #   - Typically 1 chunk + 8-20 facts per chunk
    #   - Best for "what should I do?" style queries
    #
    # Option B: Chunks Only (Fastest, ~10-40x speedup)
    #   - Embed only the source text chunk
    #   - Rely on Neo4j graph traversal for entity/relationship queries
    #   - 1 embedding per chunk (~0.3s vs 2-13s)
    #   - Retrieval: embed query → find chunks → traverse graph from chunks
    #
    # Option C: Full (Original - Slowest but most comprehensive)
    #   - Embed chunks + all entities + optionally facts
    #   - 11-50+ embeddings per chunk
    #   - Best retrieval quality but 2-13+ seconds per chunk
    #
    # To switch strategies, modify the embedding loop below.
    # =========================================================================
    
    # OPTION A: Chunks + Facts - embed source text and each relationship as a fact
    # Entities are stored in Neo4j and can be queried directly by name
    points_to_insert = []
    texts_to_embed = []
    
    # 1. Chunk text (for grounding/citation retrieval)
    texts_to_embed.append(f"passage: {source_text}")
    
    # 2. Facts as statements (for "what should I do?" style queries)
    # Format: "Subject RELATIONSHIP Object: evidence"
    fact_metadata = []
    for rel in relationships:
        from_entity = rel.get("from_entity", "")
        to_entity = rel.get("to_entity", "")
        rel_type = rel.get("type", "RELATED_TO")
        evidence = rel.get("evidence", "")
        
        if not from_entity or not to_entity:
            continue
        
        # Create natural language fact statement
        fact_text = f"{from_entity} {rel_type} {to_entity}"
        if evidence:
            fact_text += f": {evidence}"
        
        texts_to_embed.append(f"passage: {fact_text}")
        fact_metadata.append({
            "from_entity": from_entity,
            "to_entity": to_entity,
            "rel_type": rel_type,
            "evidence": evidence,
            "fact_text": fact_text,
        })
    
    # Batch encode all texts at once using configured provider
    logger.debug(f"[{chunk_id}] Encoding 1 chunk + {len(fact_metadata)} facts (provider={EMBEDDING_PROVIDER})...")
    all_embeddings = embed_texts(texts_to_embed)
    logger.debug(f"[{chunk_id}] Encoding complete")
    
    # Create chunk point
    chunk_point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"chunk:{chunk_id}"))
    points_to_insert.append(
        PointStruct(
            id=chunk_point_id,
            vector=all_embeddings[0],  # Already a list from embed_texts()
            payload={
                "type": "chunk",
                "chunk_id": chunk_id,
                "text": source_text[:1000],  # Truncate for payload size
                "source_file": source_file,
                "ontology_id": ontology_id,
                "entity_count": len(entities),
                "relationship_count": len(relationships),
            }
        )
    )
    
    # Create fact points
    for i, meta in enumerate(fact_metadata):
        fact_point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"fact:{chunk_id}:{i}"))
        points_to_insert.append(
            PointStruct(
                id=fact_point_id,
                vector=all_embeddings[i + 1],  # Already a list from embed_texts()
                payload={
                    "type": "fact",
                    "chunk_id": chunk_id,
                    "source_file": source_file,
                    "ontology_id": ontology_id,
                    "from_entity": meta["from_entity"],
                    "to_entity": meta["to_entity"],
                    "rel_type": meta["rel_type"],
                    "evidence": meta["evidence"][:500] if meta["evidence"] else "",
                    "fact_text": meta["fact_text"],
                }
            )
        )
    
    # Insert to Qdrant
    if points_to_insert:
        client.upsert(
            collection_name=COLLECTION_NAME,
            points=points_to_insert
        )
        qdrant_result["points_inserted"] = len(points_to_insert)
    
    return {
        "neo4j": neo4j_result,
        "qdrant": qdrant_result,
    }
