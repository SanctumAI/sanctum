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
from sentence_transformers import SentenceTransformer

# Configure logging
logger = logging.getLogger("sanctum.store")

# Configuration
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "sanctum_dev_password")
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "intfloat/multilingual-e5-base")

# Collection name for knowledge base
COLLECTION_NAME = "sanctum_knowledge"

# Lazy-loaded resources
_neo4j_driver = None
_qdrant_client = None
_embedding_model = None


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
    """Get or create embedding model"""
    global _embedding_model
    if _embedding_model is None:
        _embedding_model = SentenceTransformer(EMBEDDING_MODEL)
    return _embedding_model


def ensure_qdrant_collection():
    """Ensure the knowledge collection exists in Qdrant"""
    client = get_qdrant_client()
    model = get_embedding_model()
    
    collections = client.get_collections().collections
    collection_exists = any(c.name == COLLECTION_NAME for c in collections)
    
    if not collection_exists:
        vector_dim = model.get_sentence_embedding_dimension()
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(
                size=vector_dim,
                distance=Distance.COSINE
            )
        )
        print(f"Created Qdrant collection: {COLLECTION_NAME}")


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
    logger.debug(f"[{chunk_id}] Getting embedding model...")
    model = get_embedding_model()
    
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
    
    # Store embeddings in Qdrant - BATCH ALL EMBEDDINGS IN ONE CALL
    points_to_insert = []
    
    # Prepare all texts for batched embedding
    texts_to_embed = [f"passage: {source_text}"]  # Chunk text first
    entity_metadata = []  # Store metadata for each entity
    
    for entity in entities:
        entity_type = entity.get("type", "Entity")
        entity_name = entity.get("name", "Unknown")
        properties = entity.get("properties", {})
        
        entity_text = f"{entity_type}: {entity_name}"
        if "definition" in properties:
            entity_text += f" - {properties['definition']}"
        elif "description" in properties:
            entity_text += f" - {properties['description']}"
        
        texts_to_embed.append(f"passage: {entity_text}")
        entity_metadata.append({
            "type": entity_type,
            "name": entity_name,
            "text": entity_text,
            "id": generate_entity_id(entity_type, entity_name),
        })
    
    # BATCH ENCODE - much faster than one-at-a-time!
    logger.debug(f"[{chunk_id}] Batch encoding {len(texts_to_embed)} texts...")
    all_embeddings = model.encode(texts_to_embed, show_progress_bar=False)
    logger.debug(f"[{chunk_id}] Batch encoding complete")
    
    # First embedding is the chunk
    chunk_embedding = all_embeddings[0].tolist()
    chunk_point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"chunk:{chunk_id}"))
    
    points_to_insert.append(
        PointStruct(
            id=chunk_point_id,
            vector=chunk_embedding,
            payload={
                "type": "chunk",
                "chunk_id": chunk_id,
                "text": source_text[:1000],
                "source_file": source_file,
                "ontology_id": ontology_id,
                "entity_count": len(entities),
                "relationship_count": len(relationships),
            }
        )
    )
    
    # Remaining embeddings are entities
    for i, meta in enumerate(entity_metadata):
        entity_embedding = all_embeddings[i + 1].tolist()
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"entity:{meta['id']}"))
        
        points_to_insert.append(
            PointStruct(
                id=point_id,
                vector=entity_embedding,
                payload={
                    "type": "entity",
                    "entity_type": meta["type"],
                    "entity_id": meta["id"],
                    "name": meta["name"],
                    "text": meta["text"],
                    "source_file": source_file,
                    "chunk_id": chunk_id,
                    "ontology_id": ontology_id,
                }
            )
        )
    
    # Batch insert to Qdrant
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
