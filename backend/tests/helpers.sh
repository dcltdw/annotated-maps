#!/usr/bin/env bash
# helpers.sh — Shared functions for backend integration tests.
# Sourced by each test file. Do not run directly.

API="${API_URL:-http://localhost:8080/api/v1}"
CURL_TIMEOUT="${CURL_TIMEOUT:-30}"  # seconds; Argon2id in Docker/emulation can take 10-20s
_CURL_ERR=$(mktemp /tmp/curl_err.XXXXXX)
trap "rm -f $_CURL_ERR" EXIT
PASSED=0
FAILED=0
ERRORS=""

# ─── Assertions ───────────────────────────────────────────────────────────────

assert_status() {
    local test_name="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo "PASS: $test_name"
        PASSED=$((PASSED + 1))
    else
        echo "FAIL: $test_name — expected HTTP $expected, got $actual"
        FAILED=$((FAILED + 1))
        ERRORS="$ERRORS\nFAIL: $test_name — expected HTTP $expected, got $actual"
    fi
}

assert_json_field() {
    local test_name="$1" body="$2" field="$3" expected="$4"
    local actual
    actual=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d$field)" 2>/dev/null)
    if [ "$actual" = "$expected" ]; then
        echo "PASS: $test_name"
        PASSED=$((PASSED + 1))
    else
        echo "FAIL: $test_name — expected $expected, got $actual"
        FAILED=$((FAILED + 1))
        ERRORS="$ERRORS\nFAIL: $test_name — expected $expected, got $actual"
    fi
}

assert_json_exists() {
    local test_name="$1" body="$2" field="$3"
    local actual
    actual=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d$field else 'no')" 2>/dev/null)
    if [ "$actual" = "yes" ]; then
        echo "PASS: $test_name"
        PASSED=$((PASSED + 1))
    else
        echo "FAIL: $test_name — field $field missing or empty"
        FAILED=$((FAILED + 1))
        ERRORS="$ERRORS\nFAIL: $test_name — field $field missing or empty"
    fi
}

assert_true() {
    local test_name="$1" cond="$2"
    if [ "$cond" = "true" ] || [ "$cond" = "1" ] || [ "$cond" = "yes" ]; then
        echo "PASS: $test_name"
        PASSED=$((PASSED + 1))
    else
        echo "FAIL: $test_name"
        FAILED=$((FAILED + 1))
        ERRORS="$ERRORS\nFAIL: $test_name"
    fi
}

# ─── HTTP helpers ─────────────────────────────────────────────────────────────

# POST JSON, capture status code and body
# Usage: http_post "/auth/login" '{"email":"a@b.com","password":"x"}'
# Sets: HTTP_STATUS, HTTP_BODY
http_post() {
    local path="$1" data="$2" token="${3:-}"
    local response="" curl_err=""
    if [ -n "$token" ]; then
        response=$(curl -s -S -w "\n%{http_code}" --max-time "$CURL_TIMEOUT" -X POST "$API$path" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $token" \
            -d "$data" 2>"$_CURL_ERR") || true
    else
        response=$(curl -s -S -w "\n%{http_code}" --max-time "$CURL_TIMEOUT" -X POST "$API$path" \
            -H "Content-Type: application/json" \
            -d "$data" 2>"$_CURL_ERR") || true
    fi
    HTTP_STATUS=$(echo "$response" | tail -1)
    HTTP_BODY=$(echo "$response" | sed '$d')
    if [ -z "$HTTP_STATUS" ] || [ "$HTTP_STATUS" = "" ]; then
        HTTP_STATUS="000"
        curl_err=$(cat "$_CURL_ERR" 2>/dev/null)
        [ -n "$curl_err" ] && echo "  CURL ERROR: $curl_err"
    fi
}

http_get() {
    local path="$1" token="${2:-}"
    local response="" curl_err=""
    if [ -n "$token" ]; then
        response=$(curl -s -S -w "\n%{http_code}" --max-time "$CURL_TIMEOUT" -X GET "$API$path" \
            -H "Authorization: Bearer $token" 2>"$_CURL_ERR") || true
    else
        response=$(curl -s -S -w "\n%{http_code}" --max-time "$CURL_TIMEOUT" -X GET "$API$path" 2>"$_CURL_ERR") || true
    fi
    HTTP_STATUS=$(echo "$response" | tail -1)
    HTTP_BODY=$(echo "$response" | sed '$d')
    if [ -z "$HTTP_STATUS" ] || [ "$HTTP_STATUS" = "" ]; then
        HTTP_STATUS="000"
        curl_err=$(cat "$_CURL_ERR" 2>/dev/null)
        [ -n "$curl_err" ] && echo "  CURL ERROR: $curl_err"
    fi
}

http_put() {
    local path="$1" data="$2" token="${3:-}"
    local response="" curl_err=""
    if [ -n "$token" ]; then
        response=$(curl -s -S -w "\n%{http_code}" --max-time "$CURL_TIMEOUT" -X PUT "$API$path" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $token" \
            -d "$data" 2>"$_CURL_ERR") || true
    else
        response=$(curl -s -S -w "\n%{http_code}" --max-time "$CURL_TIMEOUT" -X PUT "$API$path" \
            -H "Content-Type: application/json" \
            -d "$data" 2>"$_CURL_ERR") || true
    fi
    HTTP_STATUS=$(echo "$response" | tail -1)
    HTTP_BODY=$(echo "$response" | sed '$d')
    if [ -z "$HTTP_STATUS" ] || [ "$HTTP_STATUS" = "" ]; then
        HTTP_STATUS="000"
        curl_err=$(cat "$_CURL_ERR" 2>/dev/null)
        [ -n "$curl_err" ] && echo "  CURL ERROR: $curl_err"
    fi
}

http_delete() {
    local path="$1" token="${2:-}"
    local response="" curl_err=""
    if [ -n "$token" ]; then
        response=$(curl -s -S -w "\n%{http_code}" --max-time "$CURL_TIMEOUT" -X DELETE "$API$path" \
            -H "Authorization: Bearer $token" 2>"$_CURL_ERR") || true
    else
        response=$(curl -s -S -w "\n%{http_code}" --max-time "$CURL_TIMEOUT" -X DELETE "$API$path" 2>"$_CURL_ERR") || true
    fi
    HTTP_STATUS=$(echo "$response" | tail -1)
    HTTP_BODY=$(echo "$response" | sed '$d')
    if [ -z "$HTTP_STATUS" ] || [ "$HTTP_STATUS" = "" ]; then
        HTTP_STATUS="000"
        curl_err=$(cat "$_CURL_ERR" 2>/dev/null)
        [ -n "$curl_err" ] && echo "  CURL ERROR: $curl_err"
    fi
}

# ─── Setup helpers ────────────────────────────────────────────────────────────

# Register a user and return the token. Idempotent: if the user already
# exists (409), falls back to login to get a token.
# Usage: TOKEN=$(register_user "alice" "alice@test.com" "password")
register_user() {
    local username="$1" email="$2" password="$3"
    local response="" token=""
    response=$(curl -s --max-time "$CURL_TIMEOUT" -X POST "$API/auth/register" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$username\",\"email\":\"$email\",\"password\":\"$password\"}" 2>/dev/null) || true
    token=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null) || true
    if [ -z "$token" ]; then
        # User already exists — login instead
        token=$(login_user "$email" "$password")
    fi
    echo "$token"
}

# Login and return the token.
login_user() {
    local email="$1" password="$2"
    local response=""
    response=$(curl -s --max-time "$CURL_TIMEOUT" -X POST "$API/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$email\",\"password\":\"$password\"}" 2>/dev/null) || true
    echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo ""
}

# Extract a field from a JSON response
json_field() {
    local body="$1" field="$2"
    echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin)$field)" 2>/dev/null
}

# ─── MySQL helper (for audit log verification) ────────────────────────────────

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

mysql_query() {
    local query="$1"
    docker compose -f "$REPO_DIR/docker-compose.yml" exec -T mysql \
        mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-rootpassword}" annotated_maps \
        -N -e "$query" 2>/dev/null
}

# ─── Report ───────────────────────────────────────────────────────────────────

report() {
    echo ""
    echo "  $PASSED passed, $FAILED failed"
    if [ "$FAILED" -gt 0 ]; then
        return 1
    fi
    return 0
}
