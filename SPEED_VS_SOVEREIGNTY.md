# Speed vs. Sovereignty: Hackathon Trade-offs

## The Core Tension

Sanctum is designed as a **privacy-first, sovereignty-first** RAG system. In production, all processing happens on-device or on infrastructure the user controls. No data leaves the user's environment.

However, during this hackathon, we face a hard constraint: **time**.

## What We're Trading Off

### Full Sovereignty Mode (Production)
| Component | Provider | Location | Speed |
|-----------|----------|----------|-------|
| PDF Extraction | Docling | Local CPU | ~2-3 min/100 pages |
| Embeddings | SentenceTransformer | Local CPU | ~2-13 sec/chunk |
| LLM Extraction | Local LLM / Maple | Self-hosted | ~10-30 sec/chunk |
| Vector Store | Qdrant | Local container | Fast |
| Database | SQLite | Local container | Fast |

**Total for 150-chunk document: 30-60+ minutes**

### Hackathon Mode (Current)
| Component | Provider | Location | Speed |
|-----------|----------|----------|-------|
| PDF Extraction | PyMuPDF | Local | ~1 sec total |
| Embeddings | SentenceTransformer | Local CPU | ~2-13 sec/chunk |
| LLM Extraction | Maple Proxy | HRF-hosted | ~10-20 sec/chunk |
| Vector Store | Qdrant | Local container | Fast |
| Database | SQLite | Local container | Fast |

**Total for 15-chunk sample: ~2.5 minutes**

## What Data Leaves the Environment?

### In Hackathon Mode:
1. **Maple Proxy** (HRF-controlled) receives:
   - Chunk text for entity/relationship extraction
   - ✅ This stays within HRF infrastructure

### In Production Mode:
- **Nothing leaves the user's device/infrastructure**
- All models run locally
- Full data sovereignty maintained

## Why This Trade-off Is Acceptable for Hackathon

1. **Test Data Only**: We're using public documents (guides, whitepapers) - no sensitive data
2. **One-Time Ingestion**: This is a build/demo phase, not production use
3. **Reversible**: Switching embedding models is a single env var change:
   ```
   EMBEDDING_MODEL=intfloat/multilingual-e5-base
   ```
4. **Architecture Unchanged**: The sovereignty-first design remains intact; we're just swapping providers

## Configuration Quick Reference

```bash
# .env file

# HACKATHON MODE (current default) — smaller model, faster PDF parsing
EMBEDDING_MODEL=intfloat/multilingual-e5-base
PDF_EXTRACT_MODE=fast

# PRODUCTION MODE — larger model for better accuracy, quality PDF parsing
# Both modes use local SentenceTransformer; the trade-off is speed vs. accuracy.
# EMBEDDING_MODEL=intfloat/multilingual-e5-large
# PDF_EXTRACT_MODE=quality
```

## Post-Hackathon: Restoring Full Sovereignty

To return to full privacy mode:

1. Switch to the larger embedding model for better accuracy: `EMBEDDING_MODEL=intfloat/multilingual-e5-large`
2. Set `PDF_EXTRACT_MODE=quality` for better document parsing
3. Configure a local or self-hosted LLM (remove reliance on the HRF Maple proxy)
4. Consider GPU acceleration for acceptable local performance

## The Bottom Line

> **For a hackathon demo with test data, speed wins.**
> **For production with real sensitive data, sovereignty is non-negotiable.**

The architecture supports both. We're just choosing the fast path today.
