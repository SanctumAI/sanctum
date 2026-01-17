"""
Sanctum Ingest Router
Handles document upload, chunking, and manual LLM extraction workflow.
"""

import os
import uuid
import json
import hashlib
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel

from ontology import get_ontology, list_ontologies, Ontology

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("sanctum.ingest")

router = APIRouter(prefix="/ingest", tags=["ingest"])

# Configuration
UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", "/uploads"))
CHUNKS_DIR = UPLOADS_DIR / "chunks"
PROCESSED_DIR = UPLOADS_DIR / "processed"

# Ensure directories exist
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
CHUNKS_DIR.mkdir(parents=True, exist_ok=True)
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

# In-memory job tracking (would be Redis/DB in production)
JOBS: dict[str, dict] = {}
CHUNKS: dict[str, dict] = {}


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
    status: str  # pending, processing, chunked, completed, failed
    ontology_id: str
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
    status: str  # pending, extracted, stored
    ontology_id: str
    extraction_prompt: str
    source_file: str


class ChunkListResponse(BaseModel):
    total: int
    pending: int
    extracted: int
    stored: int
    chunks: list[ChunkInfo]


class ExtractionInput(BaseModel):
    """LLM extraction results submitted by user"""
    entities: list[dict]
    relationships: list[dict]


class ExtractionResponse(BaseModel):
    chunk_id: str
    status: str
    entities_count: int
    relationships_count: int
    message: str


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


def process_document(job_id: str, file_path: Path, ontology_id: str):
    """
    Process an uploaded document: convert to text and chunk.
    This runs as a background task.
    """
    logger.info(f"[{job_id}] Starting document processing: {file_path}")
    try:
        JOBS[job_id]["status"] = "processing"
        JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()
        
        # Get file extension
        suffix = file_path.suffix.lower()
        logger.debug(f"[{job_id}] File type: {suffix}")
        
        # Extract text based on file type
        if suffix == ".pdf":
            logger.info(f"[{job_id}] Extracting text from PDF...")
            text = extract_pdf_text(file_path)
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
        
        # Get ontology for prompt
        ontology = get_ontology(ontology_id)
        logger.debug(f"[{job_id}] Using ontology: {ontology_id}")
        
        # Store chunks
        for i, chunk_text_content in enumerate(chunks):
            chunk_id = generate_chunk_id(job_id, i)
            CHUNKS[chunk_id] = {
                "chunk_id": chunk_id,
                "job_id": job_id,
                "index": i,
                "text": chunk_text_content,
                "char_count": len(chunk_text_content),
                "status": "pending",
                "ontology_id": ontology_id,
                "extraction_prompt": ontology.extraction_prompt,
                "source_file": file_path.name,
                "extracted_data": None,
                "created_at": datetime.utcnow().isoformat(),
            }
        
        # Update job status
        JOBS[job_id]["status"] = "chunked"
        JOBS[job_id]["total_chunks"] = len(chunks)
        JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()
        logger.info(f"[{job_id}] Document processing complete: {len(chunks)} chunks created")
        
    except Exception as e:
        logger.error(f"[{job_id}] Document processing failed: {e}", exc_info=True)
        JOBS[job_id]["status"] = "failed"
        JOBS[job_id]["error"] = str(e)
        JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()


def extract_pdf_text(file_path: Path) -> str:
    """
    Extract text from PDF using Docling (without OCR/table models for speed).
    Falls back to PyMuPDF if Docling fails.
    """
    logger.debug(f"Extracting PDF text from: {file_path}")
    try:
        logger.debug("Attempting Docling extraction...")
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.datamodel.base_models import InputFormat
        
        # Use lightweight pipeline - no OCR, no table structure (avoids OpenCV dep)
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
        # Fallback to PyMuPDF for simpler extraction
        logger.warning(f"Docling failed ({e}), falling back to PyMuPDF", exc_info=True)
        import fitz  # PyMuPDF
        
        logger.debug("Using PyMuPDF extraction...")
        doc = fitz.open(str(file_path))
        text_parts = []
        for page in doc:
            text_parts.append(page.get_text())
        doc.close()
        text = "\n\n".join(text_parts)
        logger.info(f"PyMuPDF extraction successful: {len(text)} chars")
        return text


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.get("/ontologies")
async def get_available_ontologies():
    """List all available ontologies"""
    return {
        "ontologies": list_ontologies(),
        "default": "bitcoin_technical"
    }


@router.get("/ontology/{ontology_id}")
async def get_ontology_details(ontology_id: str):
    """Get full details of a specific ontology including extraction prompt"""
    try:
        ontology = get_ontology(ontology_id)
        return ontology.model_dump()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/upload", response_model=UploadResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    ontology_id: str = Form(default="bitcoin_technical"),
):
    """
    Upload a document for processing.
    
    - Accepts PDF, TXT, MD files
    - Converts to text using Docling (for PDFs)
    - Chunks the text for LLM processing
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
    
    # Validate ontology
    try:
        get_ontology(ontology_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    # Generate job ID and save file
    job_id = generate_job_id(file.filename)
    file_path = UPLOADS_DIR / f"{job_id}_{file.filename}"
    
    # Save uploaded file
    content = await file.read()
    file_path.write_bytes(content)
    
    # Create job record
    JOBS[job_id] = {
        "job_id": job_id,
        "filename": file.filename,
        "file_path": str(file_path),
        "status": "pending",
        "ontology_id": ontology_id,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
        "total_chunks": 0,
        "processed_chunks": 0,
        "error": None,
    }
    
    # Process document in background
    background_tasks.add_task(process_document, job_id, file_path, ontology_id)
    
    return UploadResponse(
        job_id=job_id,
        filename=file.filename,
        status="pending",
        message=f"Document queued for processing with ontology '{ontology_id}'"
    )


@router.get("/status/{job_id}", response_model=JobStatus)
async def get_job_status(job_id: str):
    """Get the status of an ingest job"""
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    
    job = JOBS[job_id]
    
    # Count processed chunks
    job_chunks = [c for c in CHUNKS.values() if c["job_id"] == job_id]
    processed = sum(1 for c in job_chunks if c["status"] in ("extracted", "stored"))
    
    return JobStatus(
        job_id=job["job_id"],
        filename=job["filename"],
        status=job["status"],
        ontology_id=job["ontology_id"],
        created_at=job["created_at"],
        updated_at=job["updated_at"],
        total_chunks=job["total_chunks"],
        processed_chunks=processed,
        error=job.get("error"),
    )


@router.get("/jobs")
async def list_jobs():
    """List all ingest jobs"""
    return {
        "total": len(JOBS),
        "jobs": [
            {
                "job_id": j["job_id"],
                "filename": j["filename"],
                "status": j["status"],
                "ontology_id": j["ontology_id"],
                "total_chunks": j["total_chunks"],
                "created_at": j["created_at"],
            }
            for j in JOBS.values()
        ]
    }


@router.get("/pending", response_model=ChunkListResponse)
async def list_pending_chunks(job_id: Optional[str] = None):
    """
    List chunks awaiting LLM extraction.
    Optionally filter by job_id.
    """
    chunks = list(CHUNKS.values())
    
    if job_id:
        chunks = [c for c in chunks if c["job_id"] == job_id]
    
    pending = [c for c in chunks if c["status"] == "pending"]
    extracted = [c for c in chunks if c["status"] == "extracted"]
    stored = [c for c in chunks if c["status"] == "stored"]
    
    return ChunkListResponse(
        total=len(chunks),
        pending=len(pending),
        extracted=len(extracted),
        stored=len(stored),
        chunks=[
            ChunkInfo(
                chunk_id=c["chunk_id"],
                job_id=c["job_id"],
                index=c["index"],
                text=c["text"],
                char_count=c["char_count"],
                status=c["status"],
                ontology_id=c["ontology_id"],
                extraction_prompt=c["extraction_prompt"],
                source_file=c["source_file"],
            )
            for c in chunks
        ]
    )


@router.get("/chunk/{chunk_id}")
async def get_chunk(chunk_id: str):
    """
    Get a specific chunk with its full extraction prompt.
    Use this to copy the prompt + text to your LLM.
    """
    if chunk_id not in CHUNKS:
        raise HTTPException(status_code=404, detail=f"Chunk not found: {chunk_id}")
    
    chunk = CHUNKS[chunk_id]
    
    # Build the full prompt for the user to copy
    full_prompt = chunk["extraction_prompt"] + chunk["text"]
    
    return {
        "chunk_id": chunk["chunk_id"],
        "job_id": chunk["job_id"],
        "index": chunk["index"],
        "source_file": chunk["source_file"],
        "ontology_id": chunk["ontology_id"],
        "status": chunk["status"],
        "text": chunk["text"],
        "char_count": chunk["char_count"],
        "full_prompt_for_llm": full_prompt,
        "extracted_data": chunk.get("extracted_data"),
    }


@router.post("/chunk/{chunk_id}/extract", response_model=ExtractionResponse)
async def submit_extraction(chunk_id: str, extraction: ExtractionInput):
    """
    Submit LLM extraction results for a chunk.
    
    After copying the prompt from GET /chunk/{chunk_id} to your LLM,
    paste the JSON response here.
    """
    if chunk_id not in CHUNKS:
        raise HTTPException(status_code=404, detail=f"Chunk not found: {chunk_id}")
    
    chunk = CHUNKS[chunk_id]
    
    # Validate extraction has required fields
    if not isinstance(extraction.entities, list):
        raise HTTPException(status_code=400, detail="entities must be a list")
    if not isinstance(extraction.relationships, list):
        raise HTTPException(status_code=400, detail="relationships must be a list")
    
    # Store extraction
    chunk["extracted_data"] = {
        "entities": extraction.entities,
        "relationships": extraction.relationships,
        "extracted_at": datetime.utcnow().isoformat(),
    }
    chunk["status"] = "extracted"
    
    return ExtractionResponse(
        chunk_id=chunk_id,
        status="extracted",
        entities_count=len(extraction.entities),
        relationships_count=len(extraction.relationships),
        message="Extraction stored. Use POST /chunk/{chunk_id}/store to commit to graph."
    )


@router.post("/chunk/{chunk_id}/store")
async def store_chunk_to_graph(chunk_id: str):
    """
    Store extracted entities and relationships to Neo4j and embeddings to Qdrant.
    Call this after submitting extraction results.
    """
    if chunk_id not in CHUNKS:
        raise HTTPException(status_code=404, detail=f"Chunk not found: {chunk_id}")
    
    chunk = CHUNKS[chunk_id]
    
    if chunk["status"] != "extracted":
        raise HTTPException(
            status_code=400,
            detail=f"Chunk must be in 'extracted' status. Current: {chunk['status']}"
        )
    
    if not chunk.get("extracted_data"):
        raise HTTPException(status_code=400, detail="No extraction data found")
    
    # Import here to avoid circular imports
    from store import store_extraction_to_graph
    
    try:
        result = await store_extraction_to_graph(
            chunk_id=chunk_id,
            extraction=chunk["extracted_data"],
            source_text=chunk["text"],
            source_file=chunk["source_file"],
            ontology_id=chunk["ontology_id"],
        )
        
        chunk["status"] = "stored"
        
        return {
            "chunk_id": chunk_id,
            "status": "stored",
            "neo4j": result.get("neo4j", {}),
            "qdrant": result.get("qdrant", {}),
            "message": "Extraction committed to graph and vector store"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Storage failed: {str(e)}")


@router.get("/stats")
async def get_ingest_stats():
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
        "ontologies_available": list(o["id"] for o in list_ontologies()),
    }
