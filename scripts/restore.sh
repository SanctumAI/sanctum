#!/usr/bin/env bash
#
# Sanctum Restore Script
# Restores Neo4j and Qdrant data from a backup
#
# Usage: ./scripts/restore.sh [backup_dir]
#
# If no backup_dir is specified, lists available backups and prompts for selection.
#

set -euo pipefail

# Configuration
QDRANT_HOST="${QDRANT_HOST:-localhost}"
QDRANT_PORT="${QDRANT_PORT:-6333}"
QDRANT_COLLECTION="${QDRANT_COLLECTION:-sanctum_knowledge}"
NEO4J_VOLUME="${NEO4J_VOLUME:-hrf-26-hackathon_neo4j_data}"
QDRANT_VOLUME="${QDRANT_VOLUME:-hrf-26-hackathon_qdrant_data}"
BACKUP_BASE="${BACKUP_BASE:-./backups}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${CYAN}[STEP]${NC} $1"; }

# -----------------------------------------------------------------------------
# List available backups
# -----------------------------------------------------------------------------
list_backups() {
    if [ ! -d "$BACKUP_BASE" ]; then
        log_error "Backup directory not found: $BACKUP_BASE"
        exit 1
    fi
    
    local backups=()
    while IFS= read -r dir; do
        if [ -n "$dir" ]; then
            backups+=("$(basename "$dir")")
        fi
    done < <(find "$BACKUP_BASE" -mindepth 1 -maxdepth 1 -type d | sort -r)
    
    if [ ${#backups[@]} -eq 0 ]; then
        log_error "No backups found in $BACKUP_BASE"
        exit 1
    fi
    
    echo ""
    log_info "Available backups:"
    echo ""
    for i in "${!backups[@]}"; do
        local backup_path="${BACKUP_BASE}/${backups[$i]}"
        local files=$(ls -1 "$backup_path" 2>/dev/null | tr '\n' ' ')
        printf "  ${CYAN}%2d)${NC} %s\n" $((i+1)) "${backups[$i]}"
        printf "      Files: %s\n" "$files"
    done
    echo ""
    
    # Return the array via global variable
    AVAILABLE_BACKUPS=("${backups[@]}")
}

# -----------------------------------------------------------------------------
# Select backup interactively
# -----------------------------------------------------------------------------
select_backup() {
    list_backups
    
    local selection
    read -p "Select backup to restore (1-${#AVAILABLE_BACKUPS[@]}): " selection
    
    if ! [[ "$selection" =~ ^[0-9]+$ ]] || [ "$selection" -lt 1 ] || [ "$selection" -gt ${#AVAILABLE_BACKUPS[@]} ]; then
        log_error "Invalid selection"
        exit 1
    fi
    
    SELECTED_BACKUP="${BACKUP_BASE}/${AVAILABLE_BACKUPS[$((selection-1))]}"
}

# -----------------------------------------------------------------------------
# Confirm restore
# -----------------------------------------------------------------------------
confirm_restore() {
    local backup_dir="$1"
    
    echo ""
    log_warn "========================================="
    log_warn "WARNING: This will OVERWRITE existing data!"
    log_warn "========================================="
    echo ""
    log_info "Backup to restore: $backup_dir"
    echo ""
    log_info "Contents:"
    ls -lh "$backup_dir"
    echo ""
    
    read -p "Are you sure you want to restore? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        log_info "Restore cancelled."
        exit 0
    fi
}

# -----------------------------------------------------------------------------
# Check if services are running
# -----------------------------------------------------------------------------
check_services() {
    local services_running=false
    
    if docker ps --format '{{.Names}}' | grep -q "sanctum-neo4j"; then
        log_warn "Neo4j container is running (sanctum-neo4j)"
        services_running=true
    fi
    
    if docker ps --format '{{.Names}}' | grep -q "sanctum-qdrant"; then
        log_warn "Qdrant container is running (sanctum-qdrant)"
        services_running=true
    fi
    
    if [ "$services_running" = true ]; then
        echo ""
        log_warn "Services should be stopped before restoring volumes."
        read -p "Stop services now? (yes/no): " stop_services
        if [ "$stop_services" = "yes" ]; then
            log_step "Stopping services..."
            docker compose -f docker-compose.infra.yml -f docker-compose.app.yml down 2>/dev/null || docker-compose -f docker-compose.infra.yml -f docker-compose.app.yml down 2>/dev/null || true
            log_info "Services stopped."
        else
            log_warn "Proceeding with services running (may cause issues)..."
        fi
    fi
}

# -----------------------------------------------------------------------------
# Restore Neo4j volume
# -----------------------------------------------------------------------------
restore_neo4j() {
    local backup_dir="$1"
    local backup_file="${backup_dir}/neo4j_data.tar.gz"
    
    if [ ! -f "$backup_file" ]; then
        log_warn "Neo4j backup not found: $backup_file - skipping"
        return
    fi
    
    log_step "Restoring Neo4j volume from $backup_file..."
    
    # Check if volume exists, create if not
    if ! docker volume inspect "$NEO4J_VOLUME" > /dev/null 2>&1; then
        log_info "Creating Neo4j volume: $NEO4J_VOLUME"
        docker volume create "$NEO4J_VOLUME"
    fi
    
    # Restore the volume
    docker run --rm \
        -v "${NEO4J_VOLUME}:/target" \
        -v "$(cd "$backup_dir" && pwd):/backup:ro" \
        alpine sh -c "rm -rf /target/* && tar xzf /backup/neo4j_data.tar.gz -C /target"
    
    log_info "Neo4j volume restored successfully."
}

# -----------------------------------------------------------------------------
# Restore Qdrant volume
# -----------------------------------------------------------------------------
restore_qdrant_volume() {
    local backup_dir="$1"
    local backup_file="${backup_dir}/qdrant_data.tar.gz"
    
    if [ ! -f "$backup_file" ]; then
        log_warn "Qdrant volume backup not found: $backup_file - skipping"
        return
    fi
    
    log_step "Restoring Qdrant volume from $backup_file..."
    
    # Check if volume exists, create if not
    if ! docker volume inspect "$QDRANT_VOLUME" > /dev/null 2>&1; then
        log_info "Creating Qdrant volume: $QDRANT_VOLUME"
        docker volume create "$QDRANT_VOLUME"
    fi
    
    # Restore the volume
    docker run --rm \
        -v "${QDRANT_VOLUME}:/target" \
        -v "$(cd "$backup_dir" && pwd):/backup:ro" \
        alpine sh -c "rm -rf /target/* && tar xzf /backup/qdrant_data.tar.gz -C /target"
    
    log_info "Qdrant volume restored successfully."
}

# -----------------------------------------------------------------------------
# Restore Qdrant via snapshot API (alternative if services are running)
# -----------------------------------------------------------------------------
restore_qdrant_snapshot() {
    local backup_dir="$1"
    local snapshot_file="${backup_dir}/qdrant_${QDRANT_COLLECTION}.snapshot"
    
    if [ ! -f "$snapshot_file" ]; then
        log_warn "Qdrant snapshot not found: $snapshot_file - skipping API restore"
        return 1
    fi
    
    local qdrant_url="http://${QDRANT_HOST}:${QDRANT_PORT}"
    
    # Check if Qdrant is reachable
    if ! curl -s "${qdrant_url}/collections" > /dev/null 2>&1; then
        log_warn "Qdrant not reachable at ${qdrant_url} - cannot use snapshot API"
        return 1
    fi
    
    log_step "Restoring Qdrant collection from snapshot via API..."
    
    # Upload and restore snapshot
    curl -X POST "${qdrant_url}/collections/${QDRANT_COLLECTION}/snapshots/upload" \
        -H "Content-Type: multipart/form-data" \
        -F "snapshot=@${snapshot_file}"
    
    log_info "Qdrant snapshot restored via API."
    return 0
}

# -----------------------------------------------------------------------------
# Restore uploads directory
# -----------------------------------------------------------------------------
restore_uploads() {
    local backup_dir="$1"
    local backup_file="${backup_dir}/uploads.tar.gz"
    
    if [ ! -f "$backup_file" ]; then
        log_warn "Uploads backup not found: $backup_file - skipping"
        return
    fi
    
    log_step "Restoring uploads directory..."
    
    # Backup existing uploads if present
    if [ -d "./uploads" ] && [ "$(ls -A ./uploads 2>/dev/null)" ]; then
        log_info "Backing up existing uploads to uploads.bak..."
        rm -rf ./uploads.bak 2>/dev/null || true
        mv ./uploads ./uploads.bak
    fi
    
    # Extract uploads
    tar xzf "$backup_file" -C .
    
    log_info "Uploads directory restored successfully."
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    echo ""
    log_info "========================================="
    log_info "Sanctum Restore Script"
    log_info "========================================="
    echo ""
    
    # Check for Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found - required for restore"
        exit 1
    fi
    
    # Determine backup directory
    local backup_dir
    if [ $# -ge 1 ]; then
        backup_dir="$1"
        if [ ! -d "$backup_dir" ]; then
            log_error "Backup directory not found: $backup_dir"
            exit 1
        fi
    else
        select_backup
        backup_dir="$SELECTED_BACKUP"
    fi
    
    # Confirm with user
    confirm_restore "$backup_dir"
    
    # Check and optionally stop services
    check_services
    
    # Perform restores
    echo ""
    log_info "Starting restore process..."
    echo ""
    
    restore_neo4j "$backup_dir"
    restore_qdrant_volume "$backup_dir"
    restore_uploads "$backup_dir"
    
    # Summary
    echo ""
    log_info "========================================="
    log_info "Restore complete!"
    log_info "========================================="
    echo ""
    log_info "Next steps:"
    echo "  1. Start services: docker compose -f docker-compose.infra.yml -f docker-compose.app.yml up -d"
    echo "  2. Verify Neo4j: http://localhost:7474"
    echo "  3. Verify Qdrant: http://localhost:6333/dashboard"
    echo ""
}

main "$@"
