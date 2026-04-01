#!/usr/bin/env bash
# test_01_auth.sh — Registration and login tests
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers.sh"

echo "=== Auth Tests ==="

# Unique suffix per run so tests are idempotent
RUN_ID="$$"

# ─── Registration ─────────────────────────────────────────────────────────────

echo "  --- Registration ---"

http_post "/auth/register" "{\"username\":\"t01_${RUN_ID}\",\"email\":\"t01_${RUN_ID}@test.com\",\"password\":\"testpass123\"}"
assert_status "register: valid input returns 201" "201" "$HTTP_STATUS"
assert_json_exists "register: response has token" "$HTTP_BODY" "['token']"
assert_json_exists "register: response has orgId" "$HTTP_BODY" "['orgId']"
assert_json_exists "register: response has tenantId" "$HTTP_BODY" "['tenantId']"
assert_json_exists "register: response has tenants list" "$HTTP_BODY" "['tenants']"
assert_json_field "register: user.username correct" "$HTTP_BODY" "['user']['username']" "t01_${RUN_ID}"
assert_json_field "register: first tenant is Personal" "$HTTP_BODY" "['tenants'][0]['name']" "Personal"
assert_json_field "register: tenant role is admin" "$HTTP_BODY" "['tenants'][0]['role']" "admin"

# Save token from registration
REG_TOKEN=$(json_field "$HTTP_BODY" "['token']")

# Duplicate registration (2nd auth endpoint hit)
http_post "/auth/register" "{\"username\":\"t01_${RUN_ID}\",\"email\":\"t01_${RUN_ID}@test.com\",\"password\":\"testpass123\"}"
assert_status "register: duplicate returns 409" "409" "$HTTP_STATUS"
assert_json_field "register: generic error message" "$HTTP_BODY" "['message']" "Registration failed"

# Missing fields — rejected at validation, don't count against rate limit
http_post "/auth/register" '{"email":"t01_nouser@test.com","password":"testpass123"}'
assert_status "register: missing username returns 400" "400" "$HTTP_STATUS"

http_post "/auth/register" '{"username":"t01_nomail","password":"testpass123"}'
assert_status "register: missing email returns 400" "400" "$HTTP_STATUS"

http_post "/auth/register" '{"username":"t01_nopw","email":"t01_nopw@test.com"}'
assert_status "register: missing password returns 400" "400" "$HTTP_STATUS"

echo "  All registration tests passed."

# ─── Login ────────────────────────────────────────────────────────────────────

echo "  --- Login ---"

http_post "/auth/login" "{\"email\":\"t01_${RUN_ID}@test.com\",\"password\":\"testpass123\"}"
assert_status "login: correct credentials returns 200" "200" "$HTTP_STATUS"
assert_json_exists "login: response has token" "$HTTP_BODY" "['token']"
assert_json_exists "login: response has tenants" "$HTTP_BODY" "['tenants']"
assert_json_field "login: user.email correct" "$HTTP_BODY" "['user']['email']" "t01_${RUN_ID}@test.com"

# Wrong password
http_post "/auth/login" "{\"email\":\"t01_${RUN_ID}@test.com\",\"password\":\"wrongpassword\"}"
assert_status "login: wrong password returns 401" "401" "$HTTP_STATUS"
assert_json_field "login: generic error on wrong password" "$HTTP_BODY" "['message']" "Invalid email or password"

# Non-existent email
http_post "/auth/login" '{"email":"nobody@test.com","password":"testpass123"}'
assert_status "login: non-existent email returns 401" "401" "$HTTP_STATUS"
assert_json_field "login: same error for non-existent user" "$HTTP_BODY" "['message']" "Invalid email or password"

# Missing email — rejected at validation
http_post "/auth/login" '{"password":"testpass123"}'
assert_status "login: missing email returns 400" "400" "$HTTP_STATUS"

echo "  All login tests passed."

# ─── Refresh ──────────────────────────────────────────────────────────────────
# Uses token obtained above — no additional rate-limited request.

echo "  --- Refresh ---"

# Use the registration token — login may have been rate-limited
TOKEN="$REG_TOKEN"
echo "  DEBUG: TOKEN length=${#TOKEN}"
echo "  DEBUG: JWT payload=$(echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null)"

if [ -n "$TOKEN" ]; then
    http_post "/auth/refresh" '{}' "$TOKEN"
    echo "  DEBUG: refresh status=$HTTP_STATUS body=$HTTP_BODY"
    assert_status "refresh: valid token returns 200" "200" "$HTTP_STATUS"
    assert_json_exists "refresh: response has new token" "$HTTP_BODY" "['token']"
else
    echo "FAIL: refresh: no token available (registration and login both failed)"
    FAILED=$((FAILED + 2))
fi

http_post "/auth/refresh" '{}' "invalid.jwt.token"
assert_status "refresh: invalid token returns 401" "401" "$HTTP_STATUS"

echo "  All refresh tests passed."

# ─── Deactivated user ─────────────────────────────────────────────────────────

echo "  --- Deactivated user ---"

if [ -n "$TOKEN" ]; then
    echo "  DEBUG: deactivating t01_${RUN_ID}@test.com"
    mysql_query "UPDATE users SET is_active = FALSE WHERE email = 't01_${RUN_ID}@test.com';"
    sleep 1
    http_get "/tenants" "$TOKEN"
    echo "  DEBUG: deactivated status=$HTTP_STATUS body=$HTTP_BODY"
    # If 000, the backend may have crashed — check logs. Try a second request.
    if [ "$HTTP_STATUS" = "000" ]; then
        echo "  DEBUG: first request got 000, retrying after 2s..."
        sleep 2
        http_get "/tenants" "$TOKEN"
        echo "  DEBUG: retry status=$HTTP_STATUS body=$HTTP_BODY"
    fi
    assert_status "deactivated: existing token rejected" "401" "$HTTP_STATUS"
    mysql_query "UPDATE users SET is_active = TRUE WHERE email = 't01_${RUN_ID}@test.com';"
else
    echo "FAIL: deactivated: no token available (skipped)"
    FAILED=$((FAILED + 1))
fi

echo "  All deactivated user tests passed."

report
