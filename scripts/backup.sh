#!/usr/bin/env bash
#
# Sanctum Backup Script
# Creates backups of Neo4j and Qdrant data stores
#
# Usage: ./scripts/backup.sh [backup_dir]
#
# Default backup location: ./backups/<timestamp>/
#

set -euo pipefail

# Configuration
QDRANT_HOST="${QDRANT_HOST:-localhost}"
QDRANT_PORT="${QDRANT_PORT:-6333}"
QDRANT_COLLECTION="${QDRANT_COLLECTION:-sanctum_knowledge}"
NEO4J_VOLUME="${NEO4J_VOLUME:-hrf-26-hackathon_neo4j_data}"
QDRANT_VOLUME="${QDRANT_VOLUME:-hrf-26-hackathon_qdrant_data}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Create backup directory
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_BASE="${1:-./backups}"
BACKUP_DIR="${BACKUP_BASE}/${TIMESTAMP}"

mkdir -p "$BACKUP_DIR"
log_info "Backup directory: $BACKUP_DIR"

# -----------------------------------------------------------------------------
# 1. Qdrant Snapshot (via REST API)
# -----------------------------------------------------------------------------
log_info "Creating Qdrant snapshot..."

QDRANT_URL="http://${QDRANT_HOST}:${QDRANT_PORT}"

# Check if Qdrant is reachable
if ! curl -s "${QDRANT_URL}/collections" > /dev/null 2>&1; then
    log_warn "Qdrant not reachable at ${QDRANT_URL} - skipping API snapshot"
else
    # Check if collection exists
    COLLECTION_EXISTS=$(curl -s "${QDRANT_URL}/collections/${QDRANT_COLLECTION}" | grep -c '"status":"ok"' || true)
    
    if [ "$COLLECTION_EXISTS" -gt 0 ]; then
        # Create snapshot
        SNAPSHOT_RESPONSE=$(curl -s -X POST "${QDRANT_URL}/collections/${QDRANT_COLLECTION}/snapshots")
        SNAPSHOT_NAME=$(echo "$SNAPSHOT_RESPONSE" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 || true)
        
        if [ -n "$SNAPSHOT_NAME" ]; then
            log_info "Snapshot created: $SNAPSHOT_NAME"
            
            # Download the snapshot
            curl -s -o "${BACKUP_DIR}/qdrant_${QDRANT_COLLECTION}.snapshot" \
                "${QDRANT_URL}/collections/${QDRANT_COLLECTION}/snapshots/${SNAPSHOT_NAME}"
            log_info "Qdrant snapshot downloaded to ${BACKUP_DIR}/qdrant_${QDRANT_COLLECTION}.snapshot"
        else
            log_warn "Failed to create Qdrant snapshot via API"
        fi
    else
        log_warn "Collection '${QDRANT_COLLECTION}' not found - skipping Qdrant API snapshot"
    fi
fi

# -----------------------------------------------------------------------------
# 2. Docker Volume Backups
# -----------------------------------------------------------------------------
log_info "Backing up Docker volumes..."

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    log_error "Docker not found - cannot backup volumes"
    exit 1
fi

# Backup Neo4j volume
if docker volume inspect "$NEO4J_VOLUME" > /dev/null 2>&1; then
    log_info "Backing up Neo4j volume: $NEO4J_VOLUME"
    docker run --rm \
        -v "${NEO4J_VOLUME}:/source:ro" \
        -v "$(cd "$BACKUP_DIR" && pwd):/backup" \
        alpine tar czf /backup/neo4j_data.tar.gz -C /source .
    log_info "Neo4j backup complete: ${BACKUP_DIR}/neo4j_data.tar.gz"
else
    log_warn "Neo4j volume '$NEO4J_VOLUME' not found - skipping"
fi

# Backup Qdrant volume
if docker volume inspect "$QDRANT_VOLUME" > /dev/null 2>&1; then
    log_info "Backing up Qdrant volume: $QDRANT_VOLUME"
    docker run --rm \
        -v "${QDRANT_VOLUME}:/source:ro" \
        -v "$(cd "$BACKUP_DIR" && pwd):/backup" \
        alpine tar czf /backup/qdrant_data.tar.gz -C /source .
    log_info "Qdrant backup complete: ${BACKUP_DIR}/qdrant_data.tar.gz"
else
    log_warn "Qdrant volume '$QDRANT_VOLUME' not found - skipping"
fi

# -----------------------------------------------------------------------------
# 3. Backup uploads directory (source documents)
# -----------------------------------------------------------------------------
UPLOADS_DIR="./uploads"
if [ -d "$UPLOADS_DIR" ]; then
    log_info "Backing up uploads directory..."
    tar czf "${BACKUP_DIR}/uploads.tar.gz" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
    log_info "Uploads backup complete: ${BACKUP_DIR}/uploads.tar.gz"
else
    log_warn "Uploads directory not found at $UPLOADS_DIR"
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
log_info "========================================="
log_info "Backup complete!"
log_info "========================================="
log_info "Location: $BACKUP_DIR"
echo ""
ls -lh "$BACKUP_DIR"
echo ""
log_info "To restore, see: ./scripts/restore.sh (if available)"
