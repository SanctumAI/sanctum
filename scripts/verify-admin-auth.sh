#!/bin/bash
# =============================================================================
# Sanctum Admin Endpoint Authentication Verification
# =============================================================================
# This script verifies that all admin endpoints require authentication
# by checking they return 401 Unauthorized without an Authorization header.
#
# Usage:
#   ./scripts/verify-admin-auth.sh [base_url]
#
# Examples:
#   ./scripts/verify-admin-auth.sh                    # Uses http://localhost:8000
#   ./scripts/verify-admin-auth.sh http://localhost:8000
# =============================================================================

set -e

BASE_URL="${1:-http://localhost:8000}"
FAILED=0
PASSED=0

echo "============================================"
echo "Admin Endpoint Authentication Verification"
echo "============================================"
echo "Base URL: $BASE_URL"
echo ""

# Function to test an endpoint
test_endpoint() {
    local method=$1
    local path=$2
    local expected=$3
    local data=$4

    if [ -n "$data" ]; then
        status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$path" \
            -H "Content-Type: application/json" -d "$data" 2>/dev/null)
    else
        status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$path" 2>/dev/null)
    fi

    if [ "$status" = "$expected" ]; then
        echo "  ✓ $method $path → $status"
        PASSED=$((PASSED + 1))
    else
        echo "  ✗ $method $path → $status (expected $expected)"
        FAILED=$((FAILED + 1))
    fi
}

# Check if backend is reachable
echo "Checking backend connectivity..."
if ! curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health" | grep -q "200"; then
    echo "✗ Backend not reachable at $BASE_URL"
    echo "  Make sure the backend is running: docker compose -f docker-compose.infra.yml -f docker-compose.app.yml up backend"
    exit 1
fi
echo "✓ Backend is reachable"
echo ""

# Test login endpoint (should NOT require auth header)
echo "=== Login Endpoint (should accept unauthenticated requests) ==="
# /admin/auth returns 422 for invalid event payload, NOT 401
test_endpoint "POST" "/admin/auth" "422" '{"event":{}}'
echo ""

# Test all protected endpoints
echo "=== Protected Endpoints (should return 401 without auth) ==="

# Admin management
test_endpoint "GET" "/admin/list" "401"
test_endpoint "GET" "/admin/session" "401"
test_endpoint "DELETE" "/admin/testpubkey" "401"

# Instance settings
test_endpoint "GET" "/admin/settings" "401"
test_endpoint "PUT" "/admin/settings" "401" '{"instance_name":"test"}'

# User types
test_endpoint "GET" "/admin/user-types" "401"
test_endpoint "POST" "/admin/user-types" "401" '{"name":"test"}'
test_endpoint "PUT" "/admin/user-types/1" "401" '{"name":"test"}'
test_endpoint "DELETE" "/admin/user-types/1" "401"

# User fields
test_endpoint "GET" "/admin/user-fields" "401"
test_endpoint "POST" "/admin/user-fields" "401" '{"field_name":"test","field_type":"text"}'
test_endpoint "PUT" "/admin/user-fields/1" "401" '{"field_name":"test"}'
test_endpoint "DELETE" "/admin/user-fields/1" "401"

# User management
test_endpoint "GET" "/admin/users" "401"

# Database explorer
test_endpoint "GET" "/admin/db/tables" "401"
test_endpoint "GET" "/admin/db/tables/users" "401"
test_endpoint "GET" "/admin/db/tables/users/schema" "401"
test_endpoint "POST" "/admin/db/query" "401" '{"sql":"SELECT 1"}'
test_endpoint "POST" "/admin/db/tables/users/rows" "401" '{"data":{}}'
test_endpoint "PUT" "/admin/db/tables/users/rows/1" "401" '{"data":{}}'
test_endpoint "DELETE" "/admin/db/tables/users/rows/1" "401"

# Neo4j query
test_endpoint "POST" "/admin/neo4j/query" "401" '{"query":"RETURN 1"}'

echo ""
echo "============================================"
echo "Results: $PASSED passed, $FAILED failed"
echo "============================================"

if [ $FAILED -eq 0 ]; then
    echo "✓ All admin endpoints correctly require authentication!"
    exit 0
else
    echo "✗ $FAILED endpoint(s) failed authentication check"
    exit 1
fi
