"""
Sanctum Seed Script
Seeds Neo4j with a Spanish claim/fact and Qdrant with its embedding.
Uses the configured embedding provider (local or OpenAI).
"""

import os
import sys
import time
import uuid
from neo4j import GraphDatabase
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

# Import embedding functions from store module
from store import embed_texts, get_embedding_dimension, EMBEDDING_PROVIDER

# SQLite database module
import database

# Configuration
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "sanctum_dev_password")
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))

COLLECTION_NAME = "sanctum_smoke_test"

# Seed data - Spanish sentence about the UDHR
SEED_CLAIM = {
    "id": "claim_udhr_1948",
    "text": "La Declaración Universal de Derechos Humanos fue adoptada en 1948.",
    "text_english": "The Universal Declaration of Human Rights was adopted in 1948.",
    "language": "es",
    "type": "historical_fact"
}

SEED_SOURCE = {
    "id": "source_un_udhr",
    "title": "United Nations - Universal Declaration of Human Rights",
    "url": "https://www.un.org/en/about-us/universal-declaration-of-human-rights",
    "type": "official_document"
}


def wait_for_neo4j(driver, max_retries=30, delay=2):
    """Wait for Neo4j to be ready"""
    print("Waiting for Neo4j to be ready...")
    for i in range(max_retries):
        try:
            with driver.session() as session:
                session.run("RETURN 1")
            print("Neo4j is ready!")
            return True
        except Exception as e:
            print(f"  Attempt {i+1}/{max_retries}: Neo4j not ready yet...")
            time.sleep(delay)
    return False


def wait_for_qdrant(client, max_retries=30, delay=2):
    """Wait for Qdrant to be ready"""
    print("Waiting for Qdrant to be ready...")
    for i in range(max_retries):
        try:
            client.get_collections()
            print("Qdrant is ready!")
            return True
        except Exception as e:
            print(f"  Attempt {i+1}/{max_retries}: Qdrant not ready yet...")
            time.sleep(delay)
    return False


def seed_neo4j(driver):
    """Seed Neo4j with the claim and source nodes"""
    print("\nSeeding Neo4j...")
    
    with driver.session() as session:
        # Clear existing seed data (idempotent)
        session.run("""
            MATCH (c:Claim {id: $claim_id})
            DETACH DELETE c
        """, claim_id=SEED_CLAIM["id"])
        
        session.run("""
            MATCH (s:Source {id: $source_id})
            DETACH DELETE s
        """, source_id=SEED_SOURCE["id"])
        
        # Create Source node
        session.run("""
            CREATE (s:Source {
                id: $id,
                title: $title,
                url: $url,
                type: $type
            })
        """, **SEED_SOURCE)
        print(f"  Created Source: {SEED_SOURCE['id']}")
        
        # Create Claim node
        session.run("""
            CREATE (c:Claim {
                id: $id,
                text: $text,
                text_english: $text_english,
                language: $language,
                type: $type
            })
        """, **SEED_CLAIM)
        print(f"  Created Claim: {SEED_CLAIM['id']}")
        
        # Create relationship: Claim -[:SUPPORTED_BY]-> Source
        session.run("""
            MATCH (c:Claim {id: $claim_id})
            MATCH (s:Source {id: $source_id})
            CREATE (c)-[:SUPPORTED_BY]->(s)
        """, claim_id=SEED_CLAIM["id"], source_id=SEED_SOURCE["id"])
        print(f"  Created relationship: Claim -[:SUPPORTED_BY]-> Source")
    
    print("Neo4j seeding complete!")


def seed_qdrant(client, embedding_model=None):
    """Seed Qdrant with the claim embedding"""
    print("\nSeeding Qdrant...")
    
    # Use the configured embedding provider
    print(f"  Embedding provider: {EMBEDDING_PROVIDER}")
    
    # Get vector dimension from configured provider
    vector_dim = get_embedding_dimension()
    print(f"  Vector dimension: {vector_dim}")
    
    # Create collection if it doesn't exist
    collections = client.get_collections().collections
    collection_exists = any(c.name == COLLECTION_NAME for c in collections)
    
    if collection_exists:
        print(f"  Deleting existing collection: {COLLECTION_NAME}")
        client.delete_collection(COLLECTION_NAME)
    
    print(f"  Creating collection: {COLLECTION_NAME}")
    client.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(
            size=vector_dim,
            distance=Distance.COSINE
        )
    )
    
    # Generate embedding for the Spanish claim
    text_to_embed = f"passage: {SEED_CLAIM['text']}"
    print(f"  Generating embedding for: '{SEED_CLAIM['text']}'")
    embeddings = embed_texts([text_to_embed])
    embedding = embeddings[0]
    
    # Insert into Qdrant - use UUID derived from claim ID
    point_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, SEED_CLAIM["id"]))
    client.upsert(
        collection_name=COLLECTION_NAME,
        points=[
            PointStruct(
                id=point_uuid,
                vector=embedding,
                payload={
                    "claim_id": SEED_CLAIM["id"],
                    "text": SEED_CLAIM["text"],
                    "language": SEED_CLAIM["language"],
                    "source_id": SEED_SOURCE["id"],
                    "type": "claim"
                }
            )
        ]
    )
    print(f"  Inserted point: {SEED_CLAIM['id']} (UUID: {point_uuid})")
    
    print("Qdrant seeding complete!")


def seed_sqlite():
    """Initialize SQLite database and seed default settings"""
    print("\nInitializing SQLite database...")
    database.init_schema()
    print("  Schema initialized")
    database.seed_default_settings()
    print("  Default settings seeded")
    print("SQLite initialization complete!")


def main():
    """Main seeding function"""
    print("=" * 60)
    print("Sanctum Seed Script")
    print("=" * 60)

    # Initialize SQLite first (no external service to wait for)
    try:
        seed_sqlite()
    except Exception as e:
        print(f"ERROR initializing SQLite: {e}")
        sys.exit(1)

    # Initialize clients
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)

    # Wait for services
    if not wait_for_neo4j(driver):
        print("ERROR: Neo4j did not become ready in time")
        sys.exit(1)

    if not wait_for_qdrant(client):
        print("ERROR: Qdrant did not become ready in time")
        sys.exit(1)

    # Seed data
    try:
        seed_neo4j(driver)
        seed_qdrant(client, EMBEDDING_MODEL)

        print("\n" + "=" * 60)
        print("Seeding complete!")
        print("Test with: curl http://localhost:8000/test")
        print("=" * 60)

    except Exception as e:
        print(f"ERROR during seeding: {e}")
        sys.exit(1)
    finally:
        driver.close()


if __name__ == "__main__":
    main()
