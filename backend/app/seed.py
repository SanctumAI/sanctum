"""
Sanctum Seed Script
Seeds Qdrant with a test embedding.
Uses intfloat/multilingual-e5-base for CPU-friendly, Spanish-capable embeddings.
Also initializes SQLite database for user/admin management.
"""

import os
import sys
import time
import uuid
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
# SQLite database module
import database

# Use unified embedding from store.py
from store import get_embedding_model, embed_texts

# Configuration
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))

COLLECTION_NAME = "sanctum_smoke_test"

# Seed data - Spanish sentence about knowledge
SEED_CLAIM = {
    "id": "claim_knowledge_sharing",
    "text": "El conocimiento es poder cuando se comparte de manera segura.",
    "text_english": "Knowledge is power when shared securely.",
    "language": "es",
    "type": "general_fact"
}


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


def seed_qdrant(client):
    """Seed Qdrant with the claim embedding"""
    print("\nSeeding Qdrant...")
    
    # Determine vector dimension based on provider
    provider = os.getenv("EMBEDDING_PROVIDER", "local")
    print(f"  Embedding provider: {provider}")
    
    if provider == "openai":
        vector_dim = int(os.getenv("EMBEDDING_DIMENSIONS", "1536"))
    else:
        model = get_embedding_model()
        vector_dim = model.get_sentence_embedding_dimension()
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
    
    # Generate embedding using unified embed_texts
    print(f"  Generating embedding for: '{SEED_CLAIM['text']}'")
    embedding = embed_texts([f"passage: {SEED_CLAIM['text']}"])[0]
    
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
                    "type": "chunk"
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

    # Initialize Qdrant client
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)

    # Wait for Qdrant
    if not wait_for_qdrant(client):
        print("ERROR: Qdrant did not become ready in time")
        sys.exit(1)

    # Seed data
    try:
        seed_qdrant(client)

        print("\n" + "=" * 60)
        print("Seeding complete!")
        print("Test with: curl http://localhost:8000/test")
        print("=" * 60)

    except Exception as e:
        print(f"ERROR during seeding: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
