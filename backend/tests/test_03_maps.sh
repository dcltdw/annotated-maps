#!/usr/bin/env bash
# test_03_maps.sh — Map CRUD with tenant scoping and permission tests
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers.sh"

echo "=== Map Tests ==="

RUN_ID="$$"

# Setup: two users in different orgs
TOKEN_A=$(register_user "t03_a_${RUN_ID}" "t03_a_${RUN_ID}@test.com" "testpass123")
http_post "/auth/login" "{\"email\":\"t03_a_${RUN_ID}@test.com\",\"password\":\"testpass123\"}"
TENANT_A=$(json_field "$HTTP_BODY" "['tenantId']")

TOKEN_B=$(register_user "t03_b_${RUN_ID}" "t03_b_${RUN_ID}@test.com" "testpass123")
http_post "/auth/login" "{\"email\":\"t03_b_${RUN_ID}@test.com\",\"password\":\"testpass123\"}"
TENANT_B=$(json_field "$HTTP_BODY" "['tenantId']")

# ─── Create ───────────────────────────────────────────────────────────────────

echo "  --- Create ---"

http_post "/tenants/$TENANT_A/maps" '{"title":"Test Map","description":"A test","centerLat":40.7,"centerLng":-74.0,"zoom":12}' "$TOKEN_A"
assert_status "create: valid input returns 201" "201" "$HTTP_STATUS"
MAP_ID=$(json_field "$HTTP_BODY" "['id']")
assert_json_field "create: title correct" "$HTTP_BODY" "['title']" "Test Map"
assert_json_field "create: permission is owner" "$HTTP_BODY" "['permission']" "owner"

http_post "/tenants/$TENANT_A/maps" '{}' "$TOKEN_A"
assert_status "create: missing title returns 400" "400" "$HTTP_STATUS"

echo "  All create tests passed."

# ─── Get ──────────────────────────────────────────────────────────────────────

echo "  --- Get ---"

http_get "/tenants/$TENANT_A/maps/$MAP_ID" "$TOKEN_A"
assert_status "get: owner can view map" "200" "$HTTP_STATUS"
assert_json_field "get: title correct" "$HTTP_BODY" "['title']" "Test Map"

# Cross-org isolation
http_get "/tenants/$TENANT_A/maps/$MAP_ID" "$TOKEN_B"
assert_status "get: cross-org user cannot view map" "403" "$HTTP_STATUS"

echo "  All get tests passed."

# ─── List ─────────────────────────────────────────────────────────────────────

echo "  --- List ---"

http_get "/tenants/$TENANT_A/maps" "$TOKEN_A"
assert_status "list: returns 200" "200" "$HTTP_STATUS"

# Pagination bounds
http_get "/tenants/$TENANT_A/maps?page=0&pageSize=abc" "$TOKEN_A"
assert_status "list: bad pagination still returns 200" "200" "$HTTP_STATUS"

echo "  All list tests passed."

# ─── Update ───────────────────────────────────────────────────────────────────

echo "  --- Update ---"

http_put "/tenants/$TENANT_A/maps/$MAP_ID" '{"title":"Updated Map"}' "$TOKEN_A"
assert_status "update: owner can update" "200" "$HTTP_STATUS"

http_put "/tenants/$TENANT_A/maps/$MAP_ID" '{"title":"Hacked"}' "$TOKEN_B"
assert_status "update: cross-org user cannot update" "403" "$HTTP_STATUS"

echo "  All update tests passed."

# ─── Permissions ──────────────────────────────────────────────────────────────

echo "  --- Permissions ---"

# Set public permission
http_put "/tenants/$TENANT_A/maps/$MAP_ID/permissions" '{"userId":null,"canView":true,"canEdit":false}' "$TOKEN_A"
assert_status "permission: owner can set public access" "200" "$HTTP_STATUS"

# List permissions
http_get "/tenants/$TENANT_A/maps/$MAP_ID/permissions" "$TOKEN_A"
assert_status "permission: owner can list permissions" "200" "$HTTP_STATUS"

echo "  All permission tests passed."

# ─── Delete ───────────────────────────────────────────────────────────────────

echo "  --- Delete ---"

http_delete "/tenants/$TENANT_A/maps/$MAP_ID" "$TOKEN_B"
assert_status "delete: cross-org user cannot delete" "403" "$HTTP_STATUS"

http_delete "/tenants/$TENANT_A/maps/$MAP_ID" "$TOKEN_A"
assert_status "delete: owner can delete" "204" "$HTTP_STATUS"

http_get "/tenants/$TENANT_A/maps/$MAP_ID" "$TOKEN_A"
assert_status "delete: map is gone" "404" "$HTTP_STATUS"

echo "  All delete tests passed."

report
