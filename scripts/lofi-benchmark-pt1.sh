#!/bin/bash
# Lo-Fi Benchmark Part 1: Family Member Detained (Nicaragua)
# 
# Runs the benchmark test against the Sanctum RAG backend and grades
# responses against the WLC Benchmark Q&A using GPT.
#
# Usage:
#   ./scripts/lofi-benchmark-pt1.sh
#
# Requirements:
#   - Backend running (docker compose up)
#   - OPENAI_API_KEY set in environment or .env file
#   - Python 3 with httpx installed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║     SANCTUM Lo-Fi BENCHMARK - Part 1                             ║"
echo "║     Family Member Detained (Nicaragua)                           ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# Load .env if exists
if [ -f "$PROJECT_ROOT/.env" ]; then
    echo "📁 Loading environment from .env..."
    export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
fi

# Check for OPENAI_API_KEY
if [ -z "$OPENAI_API_KEY" ]; then
    echo "⚠️  Warning: OPENAI_API_KEY not set"
    echo "   GPT grading will be skipped. Set OPENAI_API_KEY for full benchmark."
    echo ""
fi

# Check backend is running
echo "🔍 Checking backend health..."
if ! curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "❌ Backend not reachable at http://localhost:8000"
    echo ""
    echo "Start the backend first:"
    echo "   docker compose up --build"
    echo ""
    exit 1
fi
echo "✅ Backend is healthy"
echo ""

# Check Python and httpx
if ! python3 -c "import httpx" 2>/dev/null; then
    echo "📦 Installing httpx..."
    pip3 install httpx --quiet
fi

# Change to project root for output file
cd "$PROJECT_ROOT"

# Run the benchmark
echo "🚀 Starting benchmark..."
echo ""
python3 "$SCRIPT_DIR/lofi-benchmark-pt1.py"

echo ""
echo "Done! Results saved to ./scripts/evals/"
echo "View results: ls -la scripts/evals/"
