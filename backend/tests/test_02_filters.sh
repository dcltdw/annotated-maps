#!/usr/bin/env bash
# test_02_filters.sh — JwtFilter and TenantFilter tests
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers.sh"

echo "=== Filter Tests ==="

RUN_ID="$$"

# Setup: register a user and get token + tenantId
TOKEN=$(register_user "t02_${RUN_ID}" "t02_${RUN_ID}@test.com" "testpass123")
http_post "/auth/login" "{\"email\":\"t02_${RUN_ID}@test.com\",\"password\":\"testpass123\"}"
TENANT_ID=$(json_field "$HTTP_BODY" "['tenantId']")

# ─── JwtFilter ────────────────────────────────────────────────────────────────

echo "  --- JwtFilter ---"

# No Authorization header
http_get "/tenants" ""
assert_status "jwt: missing auth header returns 401" "401" "$HTTP_STATUS"

# Malformed header (no Bearer prefix)
response=$(curl -s -w "\n%{http_code}" --max-time "$CURL_TIMEOUT" -X GET "$API/tenants" \
    -H "Authorization: $TOKEN" 2>/dev/null) || true
HTTP_STATUS=$(echo "$response" | tail -1)
assert_status "jwt: missing Bearer prefix returns 401" "401" "$HTTP_STATUS"

# Invalid token
http_get "/tenants" "not.a.valid.jwt"
assert_status "jwt: garbage token returns 401" "401" "$HTTP_STATUS"

# Valid token
http_get "/tenants" "$TOKEN"
assert_status "jwt: valid token returns 200" "200" "$HTTP_STATUS"

# Deactivated user with valid token
mysql_query "UPDATE users SET is_active = FALSE WHERE email = 't02_${RUN_ID}@test.com';"
http_get "/tenants" "$TOKEN"
assert_status "jwt: deactivated user with valid token returns 401" "401" "$HTTP_STATUS"

mysql_query "UPDATE users SET is_active = TRUE WHERE email = 't02_${RUN_ID}@test.com';"

echo "  All JwtFilter tests passed."

# ─── TenantFilter ─────────────────────────────────────────────────────────────

echo "  --- TenantFilter ---"

# Valid tenant membership
http_get "/tenants/$TENANT_ID/maps" "$TOKEN"
assert_status "tenant: member can access tenant" "200" "$HTTP_STATUS"

# Non-existent tenant
http_get "/tenants/99999/maps" "$TOKEN"
assert_status "tenant: non-member returns 403" "403" "$HTTP_STATUS"

# Register a second user in a different org
TOKEN2=$(register_user "t02_o_${RUN_ID}" "t02_o_${RUN_ID}@test.com" "testpass123")

# Second user cannot access first user's tenant
http_get "/tenants/$TENANT_ID/maps" "$TOKEN2"
assert_status "tenant: cross-org access returns 403" "403" "$HTTP_STATUS"

echo "  All TenantFilter tests passed."

report
