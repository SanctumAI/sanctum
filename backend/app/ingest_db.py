"""
Sanctum Ingest Database Module
Handles SQLite persistence for ingest jobs and chunks.

This module provides Create and Read operations for ingest job state.
The data is stored in SQLite (which is volume-mounted) rather than JSON files,
ensuring job state survives container rebuilds.

TODO (Future CRUD operations):
- Update: update_job_status(), update_chunk_status()
- Delete: delete_job(), delete_chunks_for_job(), purge_old_jobs()
"""

import logging
from datetime import datetime
from typing import Optional

from database import get_connection, get_cursor

logger = logging.getLogger("sanctum.ingest_db")


# =============================================================================
# SCHEMA INITIALIZATION
# =============================================================================

def init_ingest_schema():
    """
    Initialize ingest-related tables in SQLite.
    Call this on app startup (from database.init_schema or separately).
    """
    conn = get_connection()
    cursor = conn.cursor()

    # Ingest jobs table - tracks document processing jobs
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ingest_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT UNIQUE NOT NULL,
            filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            ontology_id TEXT NOT NULL,
            sample_percent REAL DEFAULT 100.0,
            total_chunks INTEGER DEFAULT 0,
            processed_chunks INTEGER DEFAULT 0,
            failed_chunks INTEGER DEFAULT 0,
            error TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Ingest chunks table - tracks individual chunk processing
    # NOTE: For MVP, we may not need to persist all chunk details.
    # The chunks table is optional - uncomment if needed for resumable ingestion.
    #
    # cursor.execute("""
    #     CREATE TABLE IF NOT EXISTS ingest_chunks (
    #         id INTEGER PRIMARY KEY AUTOINCREMENT,
    #         chunk_id TEXT UNIQUE NOT NULL,
    #         job_id TEXT NOT NULL,
    #         chunk_index INTEGER NOT NULL,
    #         status TEXT NOT NULL DEFAULT 'pending',
    #         source_file TEXT NOT NULL,
    #         char_count INTEGER DEFAULT 0,
    #         error TEXT,
    #         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    #         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    #         FOREIGN KEY (job_id) REFERENCES ingest_jobs(job_id) ON DELETE CASCADE
    #     )
    # """)

    # Index for faster job lookups by status
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_ingest_jobs_status ON ingest_jobs(status)
    """)

    conn.commit()
    cursor.close()
    logger.info("Ingest schema initialized")


# =============================================================================
# CREATE OPERATIONS
# =============================================================================

def create_job(
    job_id: str,
    filename: str,
    file_path: str,
    ontology_id: str,
    sample_percent: float = 100.0,
) -> int:
    """
    Create a new ingest job record.
    
    Args:
        job_id: Unique job identifier (hash)
        filename: Original uploaded filename
        file_path: Path to saved file
        ontology_id: Ontology used for extraction
        sample_percent: Percentage of chunks to process (for testing)
    
    Returns:
        SQLite row ID of created job
    """
    with get_cursor() as cursor:
        cursor.execute("""
            INSERT INTO ingest_jobs (job_id, filename, file_path, ontology_id, sample_percent)
            VALUES (?, ?, ?, ?, ?)
        """, (job_id, filename, file_path, ontology_id, sample_percent))
        logger.info(f"Created ingest job: {job_id} ({filename})")
        return cursor.lastrowid


# =============================================================================
# READ OPERATIONS
# =============================================================================

def get_job(job_id: str) -> Optional[dict]:
    """
    Get a single job by job_id.
    
    Returns:
        Job dict or None if not found
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM ingest_jobs WHERE job_id = ?", (job_id,))
    row = cursor.fetchone()
    cursor.close()
    
    if row:
        return dict(row)
    return None


def list_jobs(status: Optional[str] = None, limit: int = 100) -> list[dict]:
    """
    List all ingest jobs, optionally filtered by status.
    
    Args:
        status: Filter by status (e.g., 'completed', 'pending')
        limit: Max number of jobs to return
    
    Returns:
        List of job dicts
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    if status:
        cursor.execute(
            "SELECT * FROM ingest_jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?",
            (status, limit)
        )
    else:
        cursor.execute(
            "SELECT * FROM ingest_jobs ORDER BY created_at DESC LIMIT ?",
            (limit,)
        )
    
    rows = cursor.fetchall()
    cursor.close()
    return [dict(row) for row in rows]


def list_completed_jobs() -> list[dict]:
    """
    List all completed jobs (for document selector UI).
    Includes both 'completed' and 'completed_with_errors' statuses.
    
    Returns:
        List of job dicts that have finished processing
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM ingest_jobs 
        WHERE status IN ('completed', 'completed_with_errors')
        ORDER BY created_at DESC
    """)
    rows = cursor.fetchall()
    cursor.close()
    return [dict(row) for row in rows]


def job_exists(job_id: str) -> bool:
    """Check if a job exists by job_id."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT 1 FROM ingest_jobs WHERE job_id = ?", (job_id,))
    exists = cursor.fetchone() is not None
    cursor.close()
    return exists


# =============================================================================
# UPDATE OPERATIONS
# =============================================================================

def update_job_status(
    job_id: str,
    status: str,
    total_chunks: Optional[int] = None,
    processed_chunks: Optional[int] = None,
    failed_chunks: Optional[int] = None,
    error: Optional[str] = None,
) -> bool:
    """
    Update job status and progress counters.
    
    Args:
        job_id: Job to update
        status: New status value
        total_chunks: Total chunks (set once after chunking)
        processed_chunks: Number of successfully processed chunks
        failed_chunks: Number of failed chunks
        error: Error message if failed
    
    Returns:
        True if job was updated, False if not found
    """
    with get_cursor() as cursor:
        # Build dynamic SET clause
        updates = ["status = ?", "updated_at = ?"]
        params = [status, datetime.utcnow().isoformat()]
        
        if total_chunks is not None:
            updates.append("total_chunks = ?")
            params.append(total_chunks)
        if processed_chunks is not None:
            updates.append("processed_chunks = ?")
            params.append(processed_chunks)
        if failed_chunks is not None:
            updates.append("failed_chunks = ?")
            params.append(failed_chunks)
        if error is not None:
            updates.append("error = ?")
            params.append(error)
        
        params.append(job_id)
        
        cursor.execute(
            f"UPDATE ingest_jobs SET {', '.join(updates)} WHERE job_id = ?",
            params
        )
        return cursor.rowcount > 0


# =============================================================================
# DELETE OPERATIONS (TODO - not yet needed for MVP)
# =============================================================================

# def delete_job(job_id: str) -> bool:
#     """Delete a job and its associated chunks."""
#     pass

# def purge_old_jobs(days: int = 30) -> int:
#     """Delete jobs older than specified days. Returns count deleted."""
#     pass


# =============================================================================
# MIGRATION HELPER
# =============================================================================

def migrate_from_json(jobs_dict: dict) -> int:
    """
    One-time migration helper to import jobs from the old JSON format.
    
    Args:
        jobs_dict: The JOBS dictionary from the old JSON file
    
    Returns:
        Number of jobs migrated
    """
    migrated = 0
    for job_id, job in jobs_dict.items():
        if job_exists(job_id):
            logger.debug(f"Job {job_id} already exists, skipping")
            continue
        
        try:
            create_job(
                job_id=job_id,
                filename=job.get("filename", "unknown"),
                file_path=job.get("file_path", ""),
                ontology_id=job.get("ontology_id", "general"),
                sample_percent=job.get("sample_percent", 100.0),
            )
            # Update with final status
            update_job_status(
                job_id=job_id,
                status=job.get("status", "completed"),
                total_chunks=job.get("total_chunks", 0),
                processed_chunks=job.get("processed_chunks", 0),
                failed_chunks=job.get("failed_chunks", 0),
                error=job.get("error"),
            )
            migrated += 1
        except Exception as e:
            logger.error(f"Failed to migrate job {job_id}: {e}")
    
    logger.info(f"Migrated {migrated} jobs from JSON to SQLite")
    return migrated
