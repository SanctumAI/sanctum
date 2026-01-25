#!/usr/bin/env python3
"""
RAG Document Persistence Tests

Tests document ingestion and retrieval across server restarts:
- Test C: Generate PDF from config, ingest, verify via frontend route

Usage:
    python test_document_persistence.py [--api-base http://localhost:8000]

Requirements:
    - Backend must be running
    - reportlab package for PDF generation (pip install reportlab)
"""

import os
import sys
import json
import time
import argparse
import tempfile
import requests
from pathlib import Path
from datetime import datetime

# PDF generation
try:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False
    print("[WARN] reportlab not installed. Install with: pip install reportlab")


SCRIPT_DIR = Path(__file__).parent


def load_config() -> dict:
    """Load test configuration."""
    config_path = SCRIPT_DIR / "test-config.json"
    with open(config_path) as f:
        return json.load(f)


def generate_pdf_from_config(config: dict, output_path: str) -> str:
    """
    Generate a PDF document from the test config content.
    
    Returns path to generated PDF.
    """
    if not REPORTLAB_AVAILABLE:
        raise RuntimeError("reportlab is required for PDF generation")
    
    doc_config = config["test_document"]
    
    # Create PDF
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        rightMargin=72,
        leftMargin=72,
        topMargin=72,
        bottomMargin=72
    )
    
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=18,
        spaceAfter=30
    )
    
    body_style = ParagraphStyle(
        'CustomBody',
        parent=styles['Normal'],
        fontSize=11,
        leading=16,
        spaceAfter=12
    )
    
    # Build document content
    story = []
    
    # Title
    story.append(Paragraph(doc_config["title"], title_style))
    story.append(Spacer(1, 0.25*inch))
    
    # Body content - split by paragraphs
    content = doc_config["content"]
    paragraphs = content.split("\n\n")
    
    for para in paragraphs:
        if para.strip():
            # Clean up the text for PDF
            clean_para = para.replace("\n", " ").strip()
            story.append(Paragraph(clean_para, body_style))
            story.append(Spacer(1, 0.1*inch))
    
    # Build PDF
    doc.build(story)
    
    return output_path


def upload_document(api_base: str, file_path: str, token: str = None) -> dict:
    """Upload a document via the ingest API."""
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    with open(file_path, "rb") as f:
        files = {"file": (Path(file_path).name, f, "application/pdf")}
        response = requests.post(
            f"{api_base}/ingest/upload",
            files=files,
            headers=headers
        )
    
    if response.status_code != 200:
        print(f"[ERROR] Upload failed: {response.status_code}")
        print(response.text)
        return None
    
    return response.json()


def wait_for_job_completion(api_base: str, job_id: str, timeout: int = 300) -> dict:
    """Poll job status until completion or timeout."""
    start_time = time.time()
    
    while time.time() - start_time < timeout:
        response = requests.get(f"{api_base}/ingest/status/{job_id}")
        
        if response.status_code != 200:
            print(f"[ERROR] Failed to get job status: {response.status_code}")
            return None
        
        job = response.json()
        status = job.get("status", "unknown")
        
        print(f"  Job status: {status} ({job.get('processed_chunks', 0)}/{job.get('total_chunks', 0)} chunks)")
        
        if status in ("completed", "completed_with_errors", "failed"):
            return job
        
        time.sleep(5)
    
    print(f"[ERROR] Timeout waiting for job completion")
    return None


def list_jobs_via_frontend_route(api_base: str, token: str = None) -> list:
    """
    List jobs using the same endpoint the frontend uses.
    This is the key test - verifying jobs persist across restarts.
    """
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    response = requests.get(f"{api_base}/ingest/jobs", headers=headers)
    
    if response.status_code != 200:
        print(f"[ERROR] Failed to list jobs: {response.status_code}")
        print(response.text)
        return []
    
    data = response.json()
    return data.get("jobs", [])


def run_rag_query(api_base: str, question: str, token: str) -> dict:
    """Run a RAG query against the ingested documents."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    }
    
    response = requests.post(
        f"{api_base}/query",
        json={"question": question},
        headers=headers
    )
    
    if response.status_code != 200:
        print(f"[ERROR] RAG query failed: {response.status_code}")
        print(response.text)
        return None
    
    return response.json()


def cleanup_test_artifacts(job_id: str, api_base: str = None):
    """
    Clean up ALL test artifacts from the backend:
    1. Delete vectors from Qdrant
    2. Delete job record from SQLite
    3. Delete uploaded file from /uploads/
    """
    import subprocess
    
    repo_root = SCRIPT_DIR.parent.parent.parent
    
    print(f"\n[CLEANUP] Removing test artifacts for job {job_id}...")
    
    # 1. Delete vectors from Qdrant for this job's source file
    # The vectors have payload.source_file containing the job_id
    qdrant_cmd = f'''docker compose exec -T backend python -c "
from qdrant_client import QdrantClient
client = QdrantClient(host='qdrant', port=6333)
try:
    from qdrant_client.models import Filter, FieldCondition, MatchText
    # Delete points where source_file contains the job_id
    result = client.delete(
        collection_name='sanctum_knowledge',
        points_selector=Filter(
            must=[FieldCondition(key='source_file', match=MatchText(text='{job_id}'))]
        )
    )
    print('Deleted vectors from Qdrant')
except Exception as e:
    print(f'Qdrant cleanup: {{e}}')
"'''
    result = subprocess.run(qdrant_cmd, shell=True, capture_output=True, text=True, cwd=repo_root)
    if "Deleted" in result.stdout:
        print(f"  ✓ Removed vectors from Qdrant")
    else:
        print(f"  ⚠ Qdrant cleanup: {result.stdout.strip() or result.stderr.strip()}")
    
    # 2. Delete job record from ingest_jobs table
    sql_cmd = f"docker compose exec -T backend sqlite3 /data/sanctum.db \"DELETE FROM ingest_jobs WHERE job_id = '{job_id}'\""
    result = subprocess.run(sql_cmd, shell=True, capture_output=True, text=True, cwd=repo_root)
    if result.returncode == 0:
        print(f"  ✓ Removed job record from database")
    else:
        print(f"  ⚠ DB cleanup: {result.stderr.strip()}")
    
    # 3. Delete the uploaded file from /uploads/
    file_cmd = f"docker compose exec -T backend sh -c 'rm -f /uploads/{job_id}_*.pdf'"
    result = subprocess.run(file_cmd, shell=True, capture_output=True, text=True, cwd=repo_root)
    if result.returncode == 0:
        print(f"  ✓ Removed uploaded file from /uploads/")
    else:
        print(f"  ⚠ File cleanup: {result.stderr.strip()}")


def test_c_document_persistence(api_base: str, config: dict, token: str = None) -> bool:
    """
    Test C: Generate PDF, ingest, and verify via frontend route.
    
    Steps:
    1. Generate PDF from config content
    2. Upload via /ingest/upload
    3. Wait for processing
    4. Verify job appears in /ingest/jobs (frontend route)
    5. Optionally run RAG query to verify retrieval
    6. Cleanup test artifacts
    """
    print("\n" + "="*60)
    print("TEST 2A: Document Persistence via Frontend Route")
    print("="*60)
    
    doc_config = config["test_document"]
    passed = True
    job_id = None
    
    # Step 1: Generate PDF
    print("\n[STEP 1] Generating test PDF...")
    
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        pdf_path = tmp.name
    
    try:
        generate_pdf_from_config(config, pdf_path)
        file_size = os.path.getsize(pdf_path)
        print(f"  Generated: {pdf_path}")
        print(f"  Size: {file_size} bytes")
        print(f"  Title: {doc_config['title']}")
    except Exception as e:
        print(f"  ✗ PDF generation failed: {e}")
        return False
    
    try:
        # Step 2: Upload document
        print("\n[STEP 2] Uploading document...")
        upload_result = upload_document(api_base, pdf_path, token)
        
        if not upload_result:
            print("  ✗ Upload failed")
            return False
        
        job_id = upload_result.get("job_id")
        print(f"  ✓ Uploaded successfully")
        print(f"  Job ID: {job_id}")
        
        # Step 3: Wait for processing
        print("\n[STEP 3] Waiting for processing...")
        job_result = wait_for_job_completion(api_base, job_id, timeout=180)
        
        if not job_result:
            print("  ✗ Job did not complete")
            passed = False
        elif job_result.get("status") == "failed":
            print(f"  ✗ Job failed: {job_result.get('error')}")
            passed = False
        else:
            print(f"  ✓ Job completed: {job_result.get('status')}")
            print(f"  Chunks: {job_result.get('total_chunks', 0)}")
        
        # Step 4: Verify via frontend route
        print("\n[STEP 4] Verifying job via frontend route (/ingest/jobs)...")
        jobs = list_jobs_via_frontend_route(api_base, token)
        
        job_found = any(j.get("job_id") == job_id for j in jobs)
        
        if job_found:
            print(f"  ✓ Job {job_id} found in job list")
            print(f"  Total jobs in system: {len(jobs)}")
        else:
            print(f"  ✗ Job {job_id} NOT found in job list")
            print(f"  Available jobs: {[j.get('job_id') for j in jobs]}")
            passed = False
        
        # Step 5: RAG Query (optional, requires auth)
        if token and passed:
            print("\n[STEP 5] Running test RAG queries...")
            
            for query in config.get("test_queries", [])[:1]:  # Just test first query
                print(f"\n  Query: \"{query}\"")
                
                result = run_rag_query(api_base, query, token)
                
                if result:
                    answer = result.get("answer", "")[:200]
                    sources = result.get("sources", [])
                    
                    print(f"  Answer: {answer}...")
                    print(f"  Sources: {len(sources)} found")
                    
                    # Check if our test doc is in sources
                    test_filename = doc_config["filename"]
                    source_files = [s.get("source_file", "") for s in sources]
                    
                    if any(test_filename in sf for sf in source_files):
                        print(f"  ✓ Test document found in sources")
                    else:
                        print(f"  ⚠ Test document not in top sources (may be expected)")
                else:
                    print(f"  ⚠ RAG query failed (may need auth)")
        else:
            print("\n[STEP 5] Skipping RAG query (no token provided)")
        
    finally:
        # Cleanup local temp file
        try:
            os.unlink(pdf_path)
        except:
            pass
        
        # Cleanup uploaded file from backend
        if job_id:
            cleanup_test_artifacts(job_id, api_base)
    
    print("\n" + "-"*60)
    print(f"TEST 2A RESULT: {'PASSED ✓' if passed else 'FAILED ✗'}")
    
    return passed


def test_persistence_after_restart(api_base: str, expected_job_id: str) -> bool:
    """
    Verify that a previously created job still exists.
    
    This test should be run AFTER restarting the server.
    """
    print("\n" + "="*60)
    print("TEST C.2: Persistence After Restart")
    print("="*60)
    
    print(f"\n[CHECK] Looking for job: {expected_job_id}")
    
    jobs = list_jobs_via_frontend_route(api_base)
    
    job_found = any(j.get("job_id") == expected_job_id for j in jobs)
    
    if job_found:
        print(f"  ✓ Job persisted across restart!")
        matching_job = next(j for j in jobs if j.get("job_id") == expected_job_id)
        print(f"  Status: {matching_job.get('status')}")
        print(f"  Filename: {matching_job.get('filename')}")
        return True
    else:
        print(f"  ✗ Job NOT found after restart")
        print(f"  This indicates a persistence issue!")
        return False


def main():
    parser = argparse.ArgumentParser(description="RAG Document Persistence Tests")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--token", help="Admin session token for authenticated requests")
    parser.add_argument("--verify-job", help="Just verify a specific job exists (for post-restart test)")
    args = parser.parse_args()
    
    config = load_config()
    
    print("="*60)
    print("SANCTUM RAG DOCUMENT PERSISTENCE TESTS")
    print("="*60)
    print(f"API Base: {args.api_base}")
    print(f"Timestamp: {datetime.now().isoformat()}")
    
    if args.verify_job:
        # Post-restart verification mode
        passed = test_persistence_after_restart(args.api_base, args.verify_job)
    else:
        # Full test mode
        if not REPORTLAB_AVAILABLE:
            print("\n[ERROR] reportlab required. Install with: pip install reportlab")
            sys.exit(1)
        
        passed = test_c_document_persistence(args.api_base, config, args.token)
    
    # Summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    print(f"Result: {'PASSED ✓' if passed else 'FAILED ✗'}")
    
    if passed and not args.verify_job:
        print("\n[NEXT STEPS]")
        print("To verify persistence across restarts:")
        print("  1. Note the job_id from above")
        print("  2. Restart the server: docker compose down && docker compose up --build")
        print("  3. Run: python test_document_persistence.py --verify-job <job_id>")
    
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
