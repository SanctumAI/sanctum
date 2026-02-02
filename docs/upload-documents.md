# Document Upload & Ingestion Guide

This guide explains how to upload documents to your locally running Sanctum server and monitor the ingestion process as it populates Qdrant (vector store).

## Prerequisites

Make sure the Docker stack is running:

```bash
docker compose up --build -d
```

Verify all services are healthy:

```bash
curl http://localhost:8000/health
```

Expected response:
```json
{
  "status": "healthy",
  "services": {
    "qdrant": "healthy"
  }
}
```

## Step 1: Upload a Document

Upload a document to the ingest endpoint (example with a PDF file):

```bash
curl -X POST http://localhost:8000/ingest/upload \
  -F "file=@uploads/example-document.pdf" \
  -F "ontology_id=general"
```

### Upload Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `file` | Yes | - | The document file (PDF, TXT, or MD) |
| `ontology_id` | No | `general` | Ontology to use for extraction. See available options below. |
| `sample_percent` | No | `100.0` | Percentage of chunks to process (useful for testing with large documents) |

### Response

```json
{
  "job_id": "ab442f508fae94f8",
  "filename": "example-document.pdf",
  "status": "pending",
  "message": "Document queued for processing"
}
```

**Save the `job_id`** - you'll need it to check progress.

## Step 2: Poll for Completion

Check the job status using the `job_id` returned from the upload:

```bash
curl http://localhost:8000/ingest/status/{job_id}
```

Example:
```bash
curl http://localhost:8000/ingest/status/ab442f508fae94f8
```

### Response

```json
{
  "job_id": "ab442f508fae94f8",
  "filename": "example-document.pdf",
  "status": "processing",
  "ontology_id": "general",
  "created_at": "2026-01-17T22:30:00.000000",
  "updated_at": "2026-01-17T22:35:00.000000",
  "total_chunks": 85,
  "processed_chunks": 42,
  "error": null
}
```

### Job Status Values

| Status | Description |
|--------|-------------|
| `pending` | Job created, waiting to start |
| `processing` | Extracting text, chunking, embedding, and running ontology extraction |
| `completed` | All chunks processed successfully |
| `completed_with_errors` | Processing finished but some chunks failed |
| `failed` | Job failed entirely (check `error` field) |

## Step 3: Poll Script (Bash)

Here's a script to poll until completion:

```bash
#!/bin/bash
JOB_ID="${1:-ab442f508fae94f8}"
API="http://localhost:8000"

echo "Polling job: $JOB_ID"

while true; do
  RESPONSE=$(curl -s "$API/ingest/status/$JOB_ID")
  STATUS=$(echo "$RESPONSE" | jq -r '.status')
  TOTAL=$(echo "$RESPONSE" | jq -r '.total_chunks')
  PROCESSED=$(echo "$RESPONSE" | jq -r '.processed_chunks')
  
  echo "Status: $STATUS | Progress: $PROCESSED/$TOTAL chunks"
  
  if [[ "$STATUS" == "completed" || "$STATUS" == "completed_with_errors" || "$STATUS" == "failed" ]]; then
    echo ""
    echo "Final status: $STATUS"
    echo "$RESPONSE" | jq .
    break
  fi
  
  sleep 5
done
```

Usage:
```bash
chmod +x poll_job.sh
./poll_job.sh ab442f508fae94f8
```

## Step 4: Verify Data in Datastores

Once the job completes, verify the data was stored:

### Check Qdrant Stats

```bash
curl http://localhost:8000/ingest/stats
```

Response:
```json
{
  "qdrant": {
    "status": "ok",
    "collections": {
      "sanctum_knowledge": {
        "points": 85,
        "status": "green",
        "vector_size": 768
      }
    }
  }
}
```

### Test Vector Search

Test that the embeddings are searchable:

```bash
curl -X POST http://localhost:8000/vector-search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "example search query",
    "top_k": 5,
    "collection": "sanctum_knowledge"
  }'
```

## Available Ontologies

List available ontologies:

```bash
curl http://localhost:8000/ingest/ontologies
```

Response:
```json
{
  "ontologies": ["bitcoin", "general"],
  "default": "general"
}
```

Common ontologies:
- `general` - General-purpose knowledge extraction (default)
- `bitcoin` - Bitcoin/cryptocurrency concepts

## Troubleshooting

### Job Stuck in "processing"

Check backend logs:
```bash
docker compose logs -f backend
```

### PDF Extraction Issues

The system uses PyMuPDF (fast) by default. For better quality extraction (slower), set in `.env`:
```
PDF_EXTRACT_MODE=quality
```

### Reset All Data

To wipe Qdrant and SQLite data and start fresh:

```bash
curl -X POST http://localhost:8000/ingest/wipe
```

**Warning:** This deletes all stored knowledge!

### List All Jobs

```bash
curl http://localhost:8000/ingest/jobs \
  -H "Authorization: Bearer <session-token>"
```

This endpoint requires an admin or approved user session token. See `docs/authentication.md` for how to obtain a token.

### Delete a Document (Admin Only)

```bash
curl -X DELETE http://localhost:8000/ingest/jobs/{job_id} \
  -H "Authorization: Bearer <admin-token>"
```

**Notes:**
- Returns `409` if the job is still `pending` or `processing`
- Deletes Qdrant vectors, the uploaded file, and the SQLite job record

## Complete Example

```bash
# 1. Upload the document
RESPONSE=$(curl -s -X POST http://localhost:8000/ingest/upload \
  -F "file=@uploads/example-document.pdf" \
  -F "ontology_id=general")

JOB_ID=$(echo "$RESPONSE" | jq -r '.job_id')
echo "Job started: $JOB_ID"

# 2. Poll until complete
while true; do
  STATUS=$(curl -s "http://localhost:8000/ingest/status/$JOB_ID" | jq -r '.status')
  echo "Status: $STATUS"
  
  if [[ "$STATUS" == "completed" || "$STATUS" == "completed_with_errors" || "$STATUS" == "failed" ]]; then
    break
  fi
  sleep 10
done

# 3. Verify data
echo "Checking datastores..."
curl -s http://localhost:8000/ingest/stats | jq .
```
