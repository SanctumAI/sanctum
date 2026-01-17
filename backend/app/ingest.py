"""
Sanctum Ingest Router - Fully Automated Pipeline
Upload → Chunk → LLM Extract (Maple) → Store to Neo4j/Qdrant
"""

import os
import uuid
import json
import hashlib
import logging
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Optional
from enum import Enum
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from ontology import get_ontology, list_ontologies, Ontology
from llm import get_provider

# Thread pool for running blocking LLM calls without blocking the event loop
# Size matches MAX_CONCURRENT_CHUNKS for optimal parallelism
_executor = ThreadPoolExecutor(max_workers=8)

# =============================================================================
# LOGGING CONFIGURATION
# =============================================================================

LOGS_DIR = Path(os.getenv("LOGS_DIR", "/logs"))
LOGS_DIR.mkdir(parents=True, exist_ok=True)

# File handler for persistent logs
file_handler = logging.FileHandler(LOGS_DIR / "ingest.log")
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(logging.Formatter(
    '%(asctime)s | %(levelname)-8s | %(name)s | %(message)s'
))

# Console handler for docker logs
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(logging.Formatter(
    '%(asctime)s | %(levelname)-8s | %(message)s'
))

# Main logger
logger = logging.getLogger("sanctum.ingest")
logger.setLevel(logging.DEBUG)
logger.addHandler(file_handler)
logger.addHandler(console_handler)

# Job-specific loggers will be created per job

def get_job_logger(job_id: str) -> logging.Logger:
    """Create a job-specific logger that writes to its own file"""
    job_logger = logging.getLogger(f"sanctum.job.{job_id}")
    job_logger.setLevel(logging.DEBUG)
    
    # Avoid duplicate handlers
    if not job_logger.handlers:
        job_file = LOGS_DIR / f"job_{job_id}.log"
        handler = logging.FileHandler(job_file)
        handler.setLevel(logging.DEBUG)
        handler.setFormatter(logging.Formatter(
            '%(asctime)s | %(levelname)-8s | %(message)s'
        ))
        job_logger.addHandler(handler)
    
    return job_logger


# =============================================================================
# CONFIGURATION
# =============================================================================

router = APIRouter(prefix="/ingest", tags=["ingest"])

UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", "/uploads"))
CHUNKS_DIR = UPLOADS_DIR / "chunks"
PROCESSED_DIR = UPLOADS_DIR / "processed"

# Ensure directories exist
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
CHUNKS_DIR.mkdir(parents=True, exist_ok=True)
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

# Processing configuration
MAX_RETRIES = 3
MAX_CONCURRENT_CHUNKS = int(os.getenv("MAX_CONCURRENT_CHUNKS", "3"))  # Limited by CPU for embeddings

class ProcessingMode(str, Enum):
    SEQUENTIAL = "sequential"  # Process chunks one at a time (reliable, slow)
    PARALLEL = "parallel"      # Process multiple chunks concurrently (fast)

PROCESSING_MODE = ProcessingMode.PARALLEL  # Now using parallel by default

# Job state persistence (JSON files in logs dir for durability across restarts)
JOBS_FILE = LOGS_DIR / "jobs_state.json"
CHUNKS_FILE = LOGS_DIR / "chunks_state.json"


def _load_state() -> tuple[dict, dict]:
    """Load job and chunk state from disk"""
    jobs = {}
    chunks = {}
    try:
        if JOBS_FILE.exists():
            jobs = json.loads(JOBS_FILE.read_text())
            logger.info(f"Loaded {len(jobs)} jobs from disk")
    except Exception as e:
        logger.warning(f"Failed to load jobs state: {e}")
    try:
        if CHUNKS_FILE.exists():
            chunks = json.loads(CHUNKS_FILE.read_text())
            logger.info(f"Loaded {len(chunks)} chunks from disk")
    except Exception as e:
        logger.warning(f"Failed to load chunks state: {e}")
    return jobs, chunks


def _save_jobs():
    """Persist job state to disk"""
    try:
        JOBS_FILE.write_text(json.dumps(JOBS, indent=2))
    except Exception as e:
        logger.error(f"Failed to save jobs state: {e}")


def _save_chunks():
    """Persist chunk state to disk"""
    try:
        CHUNKS_FILE.write_text(json.dumps(CHUNKS, indent=2))
    except Exception as e:
        logger.error(f"Failed to save chunks state: {e}")


# Load persisted state on startup
JOBS, CHUNKS = _load_state()


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
    status: str  # pending, processing, extracting, completed, failed
    ontology_id: str
    created_at: str
    updated_at: str
    total_chunks: int
    processed_chunks: int
    failed_chunks: int
    error: Optional[str] = None


class DumpItem(BaseModel):
    source: str  # 'neo4j' or 'qdrant'
    data: dict


class DumpResponse(BaseModel):
    neo4j_nodes: list[dict]
    neo4j_relationships: list[dict]
    qdrant_points: list[dict]


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


def _sync_extract_pdf(file_path: str) -> str:
    """Synchronous PDF extraction - runs in thread pool"""
    try:
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.datamodel.base_models import InputFormat
        
        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = False
        pipeline_options.do_table_structure = False
        
        converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
            }
        )
        
        result = converter.convert(file_path)
        return result.document.export_to_markdown()
        
    except Exception as e:
        # Fallback to PyMuPDF
        import fitz
        doc = fitz.open(file_path)
        text_parts = []
        for page in doc:
            text_parts.append(page.get_text())
        doc.close()
        return "\n\n".join(text_parts)


async def extract_pdf_text(file_path: Path, job_logger: logging.Logger) -> str:
    """
    Extract text from PDF using Docling (without OCR/table models for speed).
    Falls back to PyMuPDF if Docling fails.
    Runs in thread pool to not block event loop.
    """
    job_logger.info(f"Extracting PDF text from: {file_path} (in thread pool)")
    loop = asyncio.get_event_loop()
    text = await loop.run_in_executor(_executor, _sync_extract_pdf, str(file_path))
    job_logger.info(f"PDF extraction complete: {len(text)} chars")
    return text


def parse_llm_json(response_text: str, job_logger: logging.Logger) -> dict:
    """
    Parse JSON from LLM response, handling common issues like markdown code blocks.
    """
    text = response_text.strip()
    
    # Remove markdown code blocks if present
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    
    text = text.strip()
    
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        job_logger.error(f"JSON parse error: {e}")
        job_logger.debug(f"Raw response (first 500 chars): {text[:500]}")
        raise ValueError(f"Invalid JSON from LLM: {e}")


def _sync_llm_call(prompt: str) -> str:
    """Synchronous LLM call to run in thread pool"""
    provider = get_provider()
    response = provider.complete(prompt)
    return response.content


async def extract_chunk_with_llm(
    chunk: dict,
    ontology: Ontology,
    job_logger: logging.Logger,
) -> dict:
    """
    Send chunk to LLM for extraction, with retries.
    Returns extracted entities and relationships.
    Runs blocking LLM call in thread pool to not block event loop.
    """
    chunk_id = chunk["chunk_id"]
    prompt = ontology.extraction_prompt + chunk["text"]
    
    job_logger.info(f"[{chunk_id}] Calling LLM provider (in thread pool)")
    
    last_error = None
    loop = asyncio.get_event_loop()
    
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            job_logger.debug(f"[{chunk_id}] Attempt {attempt}/{MAX_RETRIES}")
            
            # Run blocking LLM call in thread pool
            content = await loop.run_in_executor(_executor, _sync_llm_call, prompt)
            job_logger.debug(f"[{chunk_id}] LLM response received: {len(content)} chars")
            
            # Parse JSON from response
            extraction = parse_llm_json(content, job_logger)
            
            # Validate structure
            if "entities" not in extraction:
                extraction["entities"] = []
            if "relationships" not in extraction:
                extraction["relationships"] = []
            
            job_logger.info(f"[{chunk_id}] Extraction successful: {len(extraction['entities'])} entities, {len(extraction['relationships'])} relationships")
            return extraction
            
        except Exception as e:
            last_error = e
            job_logger.warning(f"[{chunk_id}] Attempt {attempt} failed: {e}")
            if attempt < MAX_RETRIES:
                job_logger.debug(f"[{chunk_id}] Retrying...")
    
    # All retries exhausted
    job_logger.error(f"[{chunk_id}] FAILED after {MAX_RETRIES} attempts: {last_error}")
    raise last_error


async def process_and_store_chunk(
    chunk: dict,
    ontology: Ontology,
    job_logger: logging.Logger,
) -> bool:
    """
    Process a single chunk: extract with LLM then store to graph/vector.
    Returns True on success, False on failure.
    """
    chunk_id = chunk["chunk_id"]
    
    try:
        # Step 1: LLM extraction
        job_logger.info(f"[{chunk_id}] Starting LLM extraction...")
        extraction = await extract_chunk_with_llm(chunk, ontology, job_logger)
        
        chunk["extracted_data"] = {
            "entities": extraction["entities"],
            "relationships": extraction["relationships"],
            "extracted_at": datetime.utcnow().isoformat(),
        }
        chunk["status"] = "extracted"
        
        # Step 2: Store to Neo4j/Qdrant
        job_logger.info(f"[{chunk_id}] Storing to graph and vector DB...")
        from store import store_extraction_to_graph
        
        result = await store_extraction_to_graph(
            chunk_id=chunk_id,
            extraction=chunk["extracted_data"],
            source_text=chunk["text"],
            source_file=chunk["source_file"],
            ontology_id=chunk["ontology_id"],
        )
        
        chunk["status"] = "stored"
        chunk["store_result"] = result
        
        job_logger.info(f"[{chunk_id}] SUCCESS - Neo4j: {result['neo4j']}, Qdrant: {result['qdrant']}")
        return True
        
    except Exception as e:
        chunk["status"] = "failed"
        chunk["error"] = str(e)
        job_logger.error(f"[{chunk_id}] FAILED: {e}")
        return False


async def process_document_full(job_id: str, file_path: Path, ontology_id: str):
    """
    Full automated pipeline: extract text → chunk → LLM extract → store.
    Runs as background task.
    """
    job_logger = get_job_logger(job_id)
    job_logger.info(f"=" * 60)
    job_logger.info(f"STARTING JOB: {job_id}")
    job_logger.info(f"File: {file_path}")
    job_logger.info(f"Ontology: {ontology_id}")
    job_logger.info(f"=" * 60)
    
    try:
        JOBS[job_id]["status"] = "processing"
        JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()
        _save_jobs()
        
        # Get file extension
        suffix = file_path.suffix.lower()
        job_logger.debug(f"File type: {suffix}")
        
        # Extract text based on file type
        if suffix == ".pdf":
            job_logger.info("Extracting text from PDF...")
            text = await extract_pdf_text(file_path, job_logger)
        elif suffix == ".txt":
            job_logger.info("Reading text file...")
            text = file_path.read_text(encoding="utf-8")
        elif suffix == ".md":
            job_logger.info("Reading markdown file...")
            text = file_path.read_text(encoding="utf-8")
        else:
            raise ValueError(f"Unsupported file type: {suffix}")
        
        job_logger.info(f"Extracted {len(text)} characters")
        
        # Chunk the text
        job_logger.info("Chunking text...")
        chunks = chunk_text(text)
        job_logger.info(f"Created {len(chunks)} chunks")
        
        # Get ontology for prompt
        ontology = get_ontology(ontology_id)
        job_logger.debug(f"Using ontology: {ontology_id}")
        
        # Create chunk records
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
                "source_file": file_path.name,
                "extracted_data": None,
                "created_at": datetime.utcnow().isoformat(),
            }
        
        JOBS[job_id]["total_chunks"] = len(chunks)
        JOBS[job_id]["status"] = "extracting"
        JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()
        _save_jobs()
        _save_chunks()
        
        # Get chunk IDs for this job
        chunk_ids = sorted(c for c in CHUNKS if CHUNKS[c]["job_id"] == job_id)
        
        if PROCESSING_MODE == ProcessingMode.PARALLEL:
            # Parallel processing with semaphore-limited concurrency
            job_logger.info(f"Processing {len(chunks)} chunks in PARALLEL (max {MAX_CONCURRENT_CHUNKS} concurrent)")
            
            semaphore = asyncio.Semaphore(MAX_CONCURRENT_CHUNKS)
            success_count = 0
            fail_count = 0
            completed_count = 0
            
            async def process_with_semaphore(chunk_id: str, index: int):
                nonlocal success_count, fail_count, completed_count
                async with semaphore:
                    chunk = CHUNKS[chunk_id]
                    job_logger.info(f"[{index+1}/{len(chunks)}] Starting: {chunk_id}")
                    
                    success = await process_and_store_chunk(chunk, ontology, job_logger)
                    
                    completed_count += 1
                    if success:
                        success_count += 1
                    else:
                        fail_count += 1
                    
                    # Update progress
                    JOBS[job_id]["processed_chunks"] = success_count
                    JOBS[job_id]["failed_chunks"] = fail_count
                    JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()
                    
                    job_logger.info(f"[{completed_count}/{len(chunks)}] Completed: {chunk_id} ({'OK' if success else 'FAIL'})")
                    
                    # Save state periodically (every 5 chunks to reduce I/O)
                    if completed_count % 5 == 0:
                        _save_jobs()
                        _save_chunks()
            
            # Launch all tasks, semaphore limits actual concurrency
            tasks = [
                process_with_semaphore(chunk_id, i) 
                for i, chunk_id in enumerate(chunk_ids)
            ]
            await asyncio.gather(*tasks)
            
            # Final save
            _save_jobs()
            _save_chunks()
            
        else:
            # Sequential processing (original behavior)
            job_logger.info(f"Processing {len(chunks)} chunks SEQUENTIALLY...")
            
            success_count = 0
            fail_count = 0
            
            for i, chunk_id in enumerate(chunk_ids):
                chunk = CHUNKS[chunk_id]
                job_logger.info(f"-" * 40)
                job_logger.info(f"Processing chunk {i+1}/{len(chunks)}: {chunk_id}")
                
                success = await process_and_store_chunk(chunk, ontology, job_logger)
                
                if success:
                    success_count += 1
                else:
                    fail_count += 1
                
                # Update job progress and persist
                JOBS[job_id]["processed_chunks"] = success_count
                JOBS[job_id]["failed_chunks"] = fail_count
                JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()
                _save_jobs()
                _save_chunks()
        
        # Final status
        job_logger.info(f"=" * 60)
        if fail_count == 0:
            JOBS[job_id]["status"] = "completed"
            job_logger.info(f"JOB COMPLETED SUCCESSFULLY")
        else:
            JOBS[job_id]["status"] = "completed_with_errors"
            job_logger.warning(f"JOB COMPLETED WITH ERRORS")
        
        JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()
        _save_jobs()
        _save_chunks()
        
        job_logger.info(f"Total chunks: {len(chunks)}")
        job_logger.info(f"Successful: {success_count}")
        job_logger.info(f"Failed: {fail_count}")
        job_logger.info(f"=" * 60)
        
    except Exception as e:
        job_logger.error(f"JOB FAILED: {e}", exc_info=True)
        JOBS[job_id]["status"] = "failed"
        JOBS[job_id]["error"] = str(e)
        JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()
        _save_jobs()


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.post("/upload", response_model=UploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    ontology_id: str = Form(default="bitcoin_technical"),
):
    """
    Upload a document for FULL AUTOMATED processing.
    
    Pipeline: Upload → Text Extraction → Chunking → LLM Extraction → Neo4j/Qdrant Storage
    
    **Returns immediately with job_id** - processing happens in background.
    
    - Accepts PDF, TXT, MD files
    - Converts to text using Docling (for PDFs)
    - Chunks the text for LLM processing
    - Automatically calls Maple LLM for entity/relationship extraction
    - Stores results to Neo4j (graph) and Qdrant (vectors)
    - Returns job_id to track progress via GET /ingest/status/{job_id}
    
    Processing uses 3 retries per chunk, then skips failed chunks.
    Check ./logs/job_{job_id}.log for detailed processing logs.
    """
    logger.info(f"Upload request: {file.filename} with ontology {ontology_id}")
    
    # Validate file type
    allowed_extensions = {".pdf", ".txt", ".md"}
    suffix = Path(file.filename).suffix.lower()
    
    if suffix not in allowed_extensions:
        logger.warning(f"Rejected unsupported file type: {suffix}")
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {suffix}. Allowed: {allowed_extensions}"
        )
    
    # Validate ontology
    try:
        get_ontology(ontology_id)
    except ValueError as e:
        logger.warning(f"Rejected unknown ontology: {ontology_id}")
        raise HTTPException(status_code=400, detail=str(e))
    
    # Generate job ID and save file
    job_id = generate_job_id(file.filename)
    file_path = UPLOADS_DIR / f"{job_id}_{file.filename}"
    
    logger.info(f"Created job {job_id} for {file.filename}")
    
    # Save uploaded file
    content = await file.read()
    file_path.write_bytes(content)
    logger.debug(f"Saved file to {file_path}")
    
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
        "failed_chunks": 0,
        "error": None,
    }
    _save_jobs()  # Persist immediately
    
    # Fire-and-forget: start processing in background without blocking response
    asyncio.create_task(process_document_full(job_id, file_path, ontology_id))
    
    logger.info(f"Job {job_id} queued for background processing - returning immediately")
    
    return UploadResponse(
        job_id=job_id,
        filename=file.filename,
        status="pending",
        message=f"Document queued for FULL AUTOMATED processing with ontology '{ontology_id}'. Check /ingest/status/{job_id} for progress."
    )


@router.get("/status/{job_id}", response_model=JobStatus)
async def get_job_status(job_id: str):
    """
    Get the status of an ingest job.
    
    Statuses:
    - pending: Upload received, processing not started
    - processing: Extracting text and chunking
    - extracting: Calling LLM for each chunk
    - completed: All chunks processed successfully
    - completed_with_errors: Some chunks failed (check logs)
    - failed: Job failed entirely
    
    Check ./logs/job_{job_id}.log for detailed processing logs.
    """
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    
    job = JOBS[job_id]
    
    return JobStatus(
        job_id=job["job_id"],
        filename=job["filename"],
        status=job["status"],
        ontology_id=job["ontology_id"],
        created_at=job["created_at"],
        updated_at=job["updated_at"],
        total_chunks=job["total_chunks"],
        processed_chunks=job.get("processed_chunks", 0),
        failed_chunks=job.get("failed_chunks", 0),
        error=job.get("error"),
    )


@router.get("/dump", response_model=DumpResponse)
async def get_data_dump(limit: int = 20):
    """
    Get a quick dump of the last N items from Neo4j and Qdrant.
    
    Useful for verifying data was stored correctly.
    
    Returns:
    - neo4j_nodes: Last N nodes from Neo4j
    - neo4j_relationships: Last N relationships from Neo4j
    - qdrant_points: Last N points from Qdrant
    """
    logger.info(f"Data dump requested with limit={limit}")
    
    neo4j_nodes = []
    neo4j_relationships = []
    qdrant_points = []
    
    # Get Neo4j data
    try:
        from store import get_neo4j_driver
        driver = get_neo4j_driver()
        
        with driver.session() as session:
            # Get recent nodes
            result = session.run(f"""
                MATCH (n)
                WHERE n.chunk_id IS NOT NULL
                RETURN labels(n) as labels, properties(n) as props
                ORDER BY n.chunk_id DESC
                LIMIT {limit}
            """)
            for record in result:
                neo4j_nodes.append({
                    "labels": record["labels"],
                    "properties": dict(record["props"]),
                })
            
            # Get recent relationships
            result = session.run(f"""
                MATCH (a)-[r]->(b)
                WHERE r.chunk_id IS NOT NULL
                RETURN type(r) as type, properties(r) as props, a.name as from_name, b.name as to_name
                ORDER BY r.chunk_id DESC
                LIMIT {limit}
            """)
            for record in result:
                neo4j_relationships.append({
                    "type": record["type"],
                    "from": record["from_name"],
                    "to": record["to_name"],
                    "properties": dict(record["props"]),
                })
        
        logger.debug(f"Retrieved {len(neo4j_nodes)} nodes, {len(neo4j_relationships)} relationships from Neo4j")
        
    except Exception as e:
        logger.error(f"Failed to query Neo4j: {e}")
    
    # Get Qdrant data
    try:
        from store import get_qdrant_client, COLLECTION_NAME
        client = get_qdrant_client()
        
        # Check if collection exists
        collections = client.get_collections().collections
        if any(c.name == COLLECTION_NAME for c in collections):
            # Scroll to get recent points
            records, _ = client.scroll(
                collection_name=COLLECTION_NAME,
                limit=limit,
                with_payload=True,
                with_vectors=False,
            )
            
            for record in records:
                qdrant_points.append({
                    "id": str(record.id),
                    "payload": record.payload,
                })
            
            logger.debug(f"Retrieved {len(qdrant_points)} points from Qdrant")
        else:
            logger.warning(f"Qdrant collection {COLLECTION_NAME} does not exist yet")
        
    except Exception as e:
        logger.error(f"Failed to query Qdrant: {e}")
    
    return DumpResponse(
        neo4j_nodes=neo4j_nodes,
        neo4j_relationships=neo4j_relationships,
        qdrant_points=qdrant_points,
    )


@router.get("/ontologies")
async def get_available_ontologies():
    """List all available ontologies for use with /upload"""
    return {
        "ontologies": list_ontologies(),
        "default": "bitcoin_technical"
    }
