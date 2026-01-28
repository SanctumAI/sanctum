"""
Sanctum Ingest Router
Handles document upload, chunking, and storage to Qdrant.

Job state is persisted to SQLite (via ingest_db module) to survive container restarts.
Chunks remain in-memory during processing for performance.
"""

import os
import uuid
import json
import hashlib
import logging
import math
import random
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel

import ingest_db

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("sanctum.ingest")

router = APIRouter(prefix="/ingest", tags=["ingest"])

# Processing configuration
MAX_CONCURRENT_CHUNKS = int(os.getenv("MAX_CONCURRENT_CHUNKS", "3"))

# Configuration
UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", "/uploads"))
CHUNKS_DIR = UPLOADS_DIR / "chunks"
PROCESSED_DIR = UPLOADS_DIR / "processed"

# Ensure directories exist
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
CHUNKS_DIR.mkdir(parents=True, exist_ok=True)
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

# In-memory state for active processing
# Jobs are persisted to SQLite; CHUNKS remain in-memory during processing
JOBS: dict = {}  # Loaded from SQLite on startup
CHUNKS: dict = {}  # In-memory only (not persisted for now)


def _load_jobs_from_db() -> dict:
    """Load all jobs from SQLite into memory."""
    jobs = {}
    for job in ingest_db.list_jobs(limit=1000):
        jobs[job["job_id"]] = {
            "job_id": job["job_id"],
            "filename": job["filename"],
            "file_path": job["file_path"],
            "status": job["status"],
            "ontology_id": job.get("ontology_id", "general"),
            "sample_percent": job.get("sample_percent", 100.0),
            "created_at": job["created_at"],
            "updated_at": job["updated_at"],
            "total_chunks": job["total_chunks"],
            "processed_chunks": job["processed_chunks"],
            "failed_chunks": job["failed_chunks"],
            "error": job["error"],
        }
    return jobs


def _sync_job_to_db(job_id: str) -> None:
    """Sync a single job's state to SQLite."""
    job = JOBS.get(job_id)
    if not job:
        return
    
    # Check if job exists in DB
    if not ingest_db.job_exists(job_id):
        # Create new job
        ingest_db.create_job(
            job_id=job_id,
            filename=job["filename"],
            file_path=job["file_path"],
            ontology_id=job.get("ontology_id", "general"),
            sample_percent=job.get("sample_percent", 100.0),
        )
    
    # Update status
    ingest_db.update_job_status(
        job_id=job_id,
        status=job["status"],
        total_chunks=job.get("total_chunks"),
        processed_chunks=job.get("processed_chunks"),
        failed_chunks=job.get("failed_chunks"),
        error=job.get("error"),
    )


def _clear_job_chunks(job_id: str) -> None:
    """Remove in-memory chunks for a job (used on resume)."""
    to_delete = [cid for cid, c in CHUNKS.items() if c.get("job_id") == job_id]
    for cid in to_delete:
        CHUNKS.pop(cid, None)


@router.on_event("startup")
async def load_jobs_and_resume():
    """Load jobs from SQLite on startup, migrate JSON if needed, and resume incomplete jobs."""
    global JOBS
    
    # One-time migration: import from legacy JSON file if exists and DB is empty
    json_file = Path(os.getenv("LOGS_DIR", "/logs")) / "jobs_state.json"
    if json_file.exists():
        existing_jobs = ingest_db.list_jobs(limit=1)
        if len(existing_jobs) == 0:
            logger.info("SQLite empty, migrating from legacy JSON file...")
            try:
                legacy_jobs = json.loads(json_file.read_text(encoding="utf-8"))
                migrated = ingest_db.migrate_from_json(legacy_jobs)
                logger.info(f"Migrated {migrated} jobs from JSON to SQLite")
            except Exception as e:
                logger.error(f"Failed to migrate from JSON: {e}")
    
    # Load from SQLite
    JOBS = _load_jobs_from_db()
    logger.info(f"Loaded {len(JOBS)} jobs from SQLite")
    
    # Resume incomplete jobs
    for job_id, job in list(JOBS.items()):
        status = job.get("status")
        if status in ("pending", "processing"):
            file_path = Path(job.get("file_path", ""))
            if not file_path.exists():
                job["status"] = "failed"
                job["error"] = "Source file missing; cannot resume"
                job["updated_at"] = datetime.utcnow().isoformat()
                _sync_job_to_db(job_id)
                continue
            logger.warning(f"[{job_id}] Resuming job after restart")
            _clear_job_chunks(job_id)
            asyncio.create_task(
                process_document(
                    job_id=job_id,
                    file_path=file_path,
                    sample_percent=float(job.get("sample_percent", 100.0)),
                )
            )


# =============================================================================
# MODELS
# =============================================================================

class UploadResponse(BaseModel):
    job_id: str
    filename: str
    status: str
    message: str


class JobStatus(BaseModel):
    job_id: str
    filename: str
    status: str  # pending, processing, completed, failed
    created_at: str
    updated_at: str
    total_chunks: int
    processed_chunks: int
    error: Optional[str] = None


class ChunkInfo(BaseModel):
    chunk_id: str
    job_id: str
    index: int
    text: str
    char_count: int
    status: str  # pending, stored
    source_file: str


class ChunkListResponse(BaseModel):
    total: int
    pending: int
    extracted: int
    stored: int
    chunks: list[ChunkInfo]


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def generate_job_id(filename: str) -> str:
    """Generate a unique job ID"""
    timestamp = datetime.utcnow().isoformat()
    content = f"{filename}:{timestamp}:{uuid.uuid4()}"
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def generate_chunk_id(job_id: str, index: int) -> str:
    """Generate a unique chunk ID"""
    return f"{job_id}_chunk_{index:04d}"


def chunk_text(text: str, chunk_size: int = 1500, overlap: int = 200) -> list[str]:
    """
    Simple chunking by character count with overlap.
    In production, use semantic chunking based on document structure.
    """
    chunks = []
    start = 0
    
    while start < len(text):
        end = start + chunk_size
        
        # Try to break at paragraph or sentence boundary
        if end < len(text):
            # Look for paragraph break
            para_break = text.rfind('\n\n', start, end)
            if para_break > start + chunk_size // 2:
                end = para_break
            else:
                # Look for sentence break
                for sep in ['. ', '.\n', '? ', '?\n', '! ', '!\n']:
                    sent_break = text.rfind(sep, start, end)
                    if sent_break > start + chunk_size // 2:
                        end = sent_break + len(sep)
                        break
        
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        
        # Move start with overlap
        start = end - overlap if end < len(text) else len(text)
    
    return chunks


async def store_chunk(chunk_id: str, chunk_text_content: str, source_file: str) -> dict:
    """Store chunk directly to Qdrant."""
    from store import store_chunks_to_qdrant

    result = await store_chunks_to_qdrant(
        chunk_id=chunk_id,
        source_text=chunk_text_content,
        source_file=source_file,
    )
    return result


async def process_document(job_id: str, file_path: Path, sample_percent: float):
    """
    Process an uploaded document: convert to text, chunk, and store to Qdrant.
    This runs as a background task.
    """
    logger.info(f"[{job_id}] Starting document processing: {file_path}")
    try:
        JOBS[job_id]["status"] = "processing"
        JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()
        _sync_job_to_db(job_id)

        # Get file extension
        suffix = file_path.suffix.lower()
        logger.debug(f"[{job_id}] File type: {suffix}")

        # Extract text based on file type
        if suffix == ".pdf":
            logger.info(f"[{job_id}] Extracting text from PDF...")
            text = await asyncio.to_thread(extract_pdf_text, file_path)
        elif suffix == ".txt":
            logger.info(f"[{job_id}] Reading text file...")
            text = file_path.read_text(encoding="utf-8")
        elif suffix == ".md":
            logger.info(f"[{job_id}] Reading markdown file...")
            text = file_path.read_text(encoding="utf-8")
        else:
            raise ValueError(f"Unsupported file type: {suffix}")

        logger.info(f"[{job_id}] Extracted {len(text)} characters")

        # Chunk the text
        logger.info(f"[{job_id}] Chunking text...")
        chunks = chunk_text(text)
        logger.info(f"[{job_id}] Created {len(chunks)} chunks")

        # Optionally sample a percentage of chunks for faster testing
        if sample_percent < 100:
            target_count = max(1, math.ceil(len(chunks) * (sample_percent / 100.0)))
            chunks = random.sample(chunks, k=min(target_count, len(chunks)))
            logger.info(
                f"[{job_id}] Sampling {sample_percent}% -> {len(chunks)} chunks selected"
            )

        # Store chunks metadata
        for i, chunk_text_content in enumerate(chunks):
            chunk_id = generate_chunk_id(job_id, i)
            CHUNKS[chunk_id] = {
                "chunk_id": chunk_id,
                "job_id": job_id,
                "index": i,
                "text": chunk_text_content,
                "char_count": len(chunk_text_content),
                "status": "pending",
                "source_file": file_path.name,
                "created_at": datetime.utcnow().isoformat(),
            }

        # Update job status
        JOBS[job_id]["total_chunks"] = len(chunks)
        JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()
        _sync_job_to_db(job_id)
        logger.info(f"[{job_id}] Chunking complete: {len(chunks)} chunks created, starting storage...")

        # Process chunks with limited concurrency
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_CHUNKS)
        processed = 0
        failed = 0

        async def run_chunk(chunk_id: str):
            nonlocal processed, failed
            async with semaphore:
                chunk = CHUNKS[chunk_id]
                try:
                    result = await store_chunk(
                        chunk_id=chunk_id,
                        chunk_text_content=chunk["text"],
                        source_file=chunk["source_file"],
                    )
                    chunk["status"] = "stored"
                    chunk["store_result"] = result
                    processed += 1
                except Exception as e:
                    chunk["status"] = "failed"
                    chunk["error"] = str(e)
                    failed += 1
                JOBS[job_id]["processed_chunks"] = processed
                JOBS[job_id]["failed_chunks"] = failed
                JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()
                # Sync every 10 chunks to reduce DB writes
                if processed % 10 == 0:
                    _sync_job_to_db(job_id)

        await asyncio.gather(*(run_chunk(cid) for cid in list(CHUNKS.keys()) if CHUNKS[cid]["job_id"] == job_id))
        JOBS[job_id]["status"] = "completed_with_errors" if failed > 0 else "completed"
        JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()
        _sync_job_to_db(job_id)

    except Exception as e:
        logger.error(f"[{job_id}] Document processing failed: {e}", exc_info=True)
        JOBS[job_id]["status"] = "failed"
        JOBS[job_id]["error"] = str(e)
        JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()
        _sync_job_to_db(job_id)


# PDF extraction mode: "fast" (PyMuPDF) or "quality" (Docling)
# Docling gives better structure but is VERY slow on CPU (~2-3 min for 100 pages)
# PyMuPDF is ~100x faster but loses some formatting
PDF_EXTRACT_MODE = os.getenv("PDF_EXTRACT_MODE", "fast")


def extract_pdf_text(file_path: Path) -> str:
    """
    Extract text from PDF.
    Mode controlled by PDF_EXTRACT_MODE env var:
      - "fast": PyMuPDF (~1 second for 100 pages)
      - "quality": Docling (~2-3 minutes for 100 pages on CPU)
    """
    logger.debug(f"Extracting PDF text from: {file_path} (mode={PDF_EXTRACT_MODE})")
    
    if PDF_EXTRACT_MODE == "fast":
        return _extract_pdf_pymupdf(file_path)
    else:
        return _extract_pdf_docling(file_path)


def _extract_pdf_pymupdf(file_path: Path) -> str:
    """Fast PDF extraction using PyMuPDF (~1 second for 100 pages)"""
    import fitz  # PyMuPDF
    
    logger.debug("Using PyMuPDF extraction (fast mode)...")
    doc = fitz.open(str(file_path))
    text_parts = []
    for page in doc:
        text_parts.append(page.get_text())
    doc.close()
    text = "\n\n".join(text_parts)
    logger.info(f"PyMuPDF extraction successful: {len(text)} chars")
    return text


def _extract_pdf_docling(file_path: Path) -> str:
    """Quality PDF extraction using Docling (slow on CPU, ~2-3 min for 100 pages)"""
    try:
        logger.debug("Attempting Docling extraction...")
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.datamodel.base_models import InputFormat
        
        # Use lightweight pipeline - no OCR, no table structure
        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = False
        pipeline_options.do_table_structure = False
        logger.debug("Docling config: do_ocr=False, do_table_structure=False")
        
        converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
            }
        )
        
        logger.debug("Running Docling converter...")
        result = converter.convert(str(file_path))
        markdown = result.document.export_to_markdown()
        logger.info(f"Docling extraction successful: {len(markdown)} chars")
        return markdown
        
    except Exception as e:
        # Fallback to PyMuPDF
        logger.warning(f"Docling failed ({e}), falling back to PyMuPDF", exc_info=True)
        return _extract_pdf_pymupdf(file_path)


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.post("/wipe")
async def wipe_datastores():
    """
    Wipe all entries in Qdrant collections.
    This is destructive and intended for local development resets.
    """
    logger.warning("Wipe requested: clearing Qdrant data")
    result = {
        "qdrant": {"status": "pending"},
    }

    # Qdrant: delete collections if they exist
    try:
        from store import get_qdrant_client, COLLECTION_NAME
        client = get_qdrant_client()
        collections = {c.name for c in client.get_collections().collections}
        deleted = []
        for name in (COLLECTION_NAME, "sanctum_smoke_test"):
            if name in collections:
                client.delete_collection(name)
                deleted.append(name)
        result["qdrant"] = {"status": "ok", "deleted_collections": deleted}
        logger.info(f"Qdrant wipe complete: {deleted}")
    except Exception as e:
        result["qdrant"] = {"status": "error", "message": str(e)}
        logger.error(f"Qdrant wipe failed: {e}")

    return result


@router.get("/stats")
async def get_datastore_stats():
    """
    Get quick stats for Qdrant.
    """
    stats = {
        "qdrant": {"status": "pending"},
    }

    # Qdrant: count points per collection
    try:
        from store import get_qdrant_client
        client = get_qdrant_client()
        collections = client.get_collections().collections
        collection_stats = {}
        for c in collections:
            info = client.get_collection(c.name)
            collection_stats[c.name] = {
                "points": info.points_count,
                "status": info.status,
                "vector_size": info.config.params.vectors.size if info.config and info.config.params else None,
            }
        stats["qdrant"] = {
            "status": "ok",
            "collections": collection_stats,
        }
    except Exception as e:
        stats["qdrant"] = {"status": "error", "message": str(e)}

    return stats


@router.post("/upload", response_model=UploadResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    sample_percent: float = Form(default=100.0),
):
    """
    Upload a document for processing.

    - Accepts PDF, TXT, MD files
    - Converts to text (PyMuPDF for PDFs)
    - Chunks and stores embeddings to Qdrant
    - Returns job_id to track progress
    """
    # Validate file type
    allowed_extensions = {".pdf", ".txt", ".md"}
    suffix = Path(file.filename).suffix.lower()

    if suffix not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {suffix}. Allowed: {allowed_extensions}"
        )

    # Validate sample percent
    if sample_percent <= 0 or sample_percent > 100:
        raise HTTPException(
            status_code=400,
            detail="sample_percent must be > 0 and <= 100"
        )

    # Generate job ID and save file
    job_id = generate_job_id(file.filename)
    file_path = UPLOADS_DIR / f"{job_id}_{file.filename}"

    # Save uploaded file
    content = await file.read()
    file_path.write_bytes(content)

    # Create job record (in memory and SQLite)
    JOBS[job_id] = {
        "job_id": job_id,
        "filename": file.filename,
        "file_path": str(file_path),
        "status": "pending",
        "ontology_id": "general",  # Default ontology
        "sample_percent": sample_percent,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
        "total_chunks": 0,
        "processed_chunks": 0,
        "failed_chunks": 0,
        "error": None,
    }
    _sync_job_to_db(job_id)

    # Process document in background (fire-and-forget)
    asyncio.create_task(process_document(job_id, file_path, sample_percent))

    return UploadResponse(
        job_id=job_id,
        filename=file.filename,
        status="pending",
        message="Document queued for processing"
    )


@router.get("/status/{job_id}", response_model=JobStatus)
async def get_job_status(job_id: str):
    """Get the status of an ingest job"""
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")

    job = JOBS[job_id]

    # Count processed chunks
    job_chunks = [c for c in CHUNKS.values() if c["job_id"] == job_id]
    processed = sum(1 for c in job_chunks if c["status"] == "stored")

    return JobStatus(
        job_id=job["job_id"],
        filename=job["filename"],
        status=job["status"],
        created_at=job["created_at"],
        updated_at=job["updated_at"],
        total_chunks=job["total_chunks"],
        processed_chunks=processed,
        error=job.get("error"),
    )


@router.get("/jobs")
async def list_jobs():
    """List all ingest jobs (from SQLite for persistence across restarts)"""
    # Read directly from SQLite to ensure we get persisted data
    jobs_from_db = ingest_db.list_jobs(limit=500)
    return {
        "total": len(jobs_from_db),
        "jobs": [
            {
                "job_id": j["job_id"],
                "filename": j["filename"],
                "status": j["status"],
                "total_chunks": j["total_chunks"],
                "created_at": j["created_at"],
            }
            for j in jobs_from_db
        ]
    }


@router.get("/pending", response_model=ChunkListResponse)
async def list_pending_chunks(job_id: Optional[str] = None):
    """
    List chunks and their storage status.
    Optionally filter by job_id.
    """
    chunks = list(CHUNKS.values())

    if job_id:
        chunks = [c for c in chunks if c["job_id"] == job_id]

    pending = [c for c in chunks if c["status"] == "pending"]
    stored = [c for c in chunks if c["status"] == "stored"]

    return ChunkListResponse(
        total=len(chunks),
        pending=len(pending),
        extracted=0,  # No longer used
        stored=len(stored),
        chunks=[
            ChunkInfo(
                chunk_id=c["chunk_id"],
                job_id=c["job_id"],
                index=c["index"],
                text=c["text"],
                char_count=c["char_count"],
                status=c["status"],
                source_file=c["source_file"],
            )
            for c in chunks
        ]
    )


@router.get("/chunk/{chunk_id}")
async def get_chunk(chunk_id: str):
    """
    Get a specific chunk details.
    """
    if chunk_id not in CHUNKS:
        raise HTTPException(status_code=404, detail=f"Chunk not found: {chunk_id}")

    chunk = CHUNKS[chunk_id]

    return {
        "chunk_id": chunk["chunk_id"],
        "job_id": chunk["job_id"],
        "index": chunk["index"],
        "source_file": chunk["source_file"],
        "status": chunk["status"],
        "text": chunk["text"],
        "char_count": chunk["char_count"],
    }


@router.get("/pipeline-stats")
async def get_ingest_pipeline_stats():
    """Get overall ingest pipeline statistics"""
    total_jobs = len(JOBS)
    total_chunks = len(CHUNKS)

    job_statuses = {}
    for j in JOBS.values():
        status = j["status"]
        job_statuses[status] = job_statuses.get(status, 0) + 1

    chunk_statuses = {}
    for c in CHUNKS.values():
        status = c["status"]
        chunk_statuses[status] = chunk_statuses.get(status, 0) + 1

    return {
        "jobs": {
            "total": total_jobs,
            "by_status": job_statuses,
        },
        "chunks": {
            "total": total_chunks,
            "by_status": chunk_statuses,
        },
    }
