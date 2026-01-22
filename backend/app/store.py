"""
Sanctum Store Module
Handles storing document chunks and embeddings to Qdrant.
"""

import os
import uuid
import logging
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

# Configure logging
logger = logging.getLogger("sanctum.store")

# Configuration
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
_qdrant_client = None
_embedding_model = None
_openai_client = None


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


async def store_chunks_to_qdrant(
    chunk_id: str,
    source_text: str,
    source_file: str,
) -> dict[str, Any]:
    """
    Store a text chunk and its embedding to Qdrant.

    This is a simple storage function that embeds the raw text chunk.

    Returns summary of what was stored.
    """
    logger.info(f"[{chunk_id}] Storing chunk to Qdrant...")
    qdrant_result = {"points_inserted": 0}

    client = get_qdrant_client()

    # Ensure Qdrant collection exists
    ensure_qdrant_collection()

    # Embed the chunk text
    logger.debug(f"[{chunk_id}] Encoding chunk (provider={EMBEDDING_PROVIDER})...")
    embedding = embed_texts([f"passage: {source_text}"])[0]
    logger.debug(f"[{chunk_id}] Encoding complete")

    # Create chunk point
    chunk_point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"chunk:{chunk_id}"))
    point = PointStruct(
        id=chunk_point_id,
        vector=embedding,
        payload={
            "type": "chunk",
            "chunk_id": chunk_id,
            "text": source_text[:2000],  # Store more text for context
            "source_file": source_file,
        }
    )

    # Insert to Qdrant
    client.upsert(
        collection_name=COLLECTION_NAME,
        points=[point]
    )
    qdrant_result["points_inserted"] = 1

    logger.info(f"[{chunk_id}] Chunk stored successfully")
    return {
        "qdrant": qdrant_result,
    }
