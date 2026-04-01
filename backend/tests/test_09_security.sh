#!/usr/bin/env bash
# test_09_security.sh — Cross-org isolation and input validation
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers.sh"

echo "=== Security Tests ==="

RUN_ID="$$"

# Setup: two orgs
TOKEN_A=$(register_user "t09_a_${RUN_ID}" "t09_a_${RUN_ID}@test.com" "testpass123")
http_post "/auth/login" "{\"email\":\"t09_a_${RUN_ID}@test.com\",\"password\":\"testpass123\"}"
TENANT_A=$(json_field "$HTTP_BODY" "['tenantId']")
ORG_A=$(json_field "$HTTP_BODY" "['orgId']")
USER_A_ID=$(json_field "$HTTP_BODY" "['user']['id']")

TOKEN_B=$(register_user "t09_b_${RUN_ID}" "t09_b_${RUN_ID}@test.com" "testpass123")
http_post "/auth/login" "{\"email\":\"t09_b_${RUN_ID}@test.com\",\"password\":\"testpass123\"}"
TENANT_B=$(json_field "$HTTP_BODY" "['tenantId']")
USER_B_ID=$(json_field "$HTTP_BODY" "['user']['id']")

# Create a map in org A
http_post "/tenants/$TENANT_A/maps" '{"title":"Org A Map"}' "$TOKEN_A"
MAP_A=$(json_field "$HTTP_BODY" "['id']")

# ─── Cross-org map access ────────────────────────────────────────────────────

echo "  --- Cross-org map isolation ---"

http_get "/tenants/$TENANT_A/maps/$MAP_A" "$TOKEN_B"
assert_status "security: org B cannot read org A map" "403" "$HTTP_STATUS"

http_put "/tenants/$TENANT_A/maps/$MAP_A" '{"title":"Hacked"}' "$TOKEN_B"
assert_status "security: org B cannot update org A map" "403" "$HTTP_STATUS"

http_delete "/tenants/$TENANT_A/maps/$MAP_A" "$TOKEN_B"
assert_status "security: org B cannot delete org A map" "403" "$HTTP_STATUS"

echo "  All cross-org map isolation tests passed."

# ─── Cross-org permission grant ──────────────────────────────────────────────

echo "  --- Cross-org permission grant ---"

http_put "/tenants/$TENANT_A/maps/$MAP_A/permissions" \
    "{\"userId\":$USER_B_ID,\"canView\":true,\"canEdit\":false}" "$TOKEN_A"
assert_status "security: cannot grant permission to cross-org user" "400" "$HTTP_STATUS"

echo "  All cross-org permission grant tests passed."

# ─── Cross-org tenant member add ──────────────────────────────────────────────

echo "  --- Cross-org member add ---"

http_post "/tenants/$TENANT_A/members" \
    "{\"userId\":$USER_B_ID,\"role\":\"viewer\"}" "$TOKEN_A"
assert_status "security: cannot add cross-org member" "400" "$HTTP_STATUS"

echo "  All cross-org member add tests passed."

# ─── Cross-org annotation access ─────────────────────────────────────────────

echo "  --- Cross-org annotation isolation ---"

http_post "/tenants/$TENANT_A/maps/$MAP_A/annotations" \
    '{"type":"marker","title":"Pin","geoJson":{"type":"Point","coordinates":[0,0]}}' "$TOKEN_A"
ANN_A=$(json_field "$HTTP_BODY" "['id']")

http_get "/tenants/$TENANT_A/maps/$MAP_A/annotations/$ANN_A" "$TOKEN_B"
assert_status "security: org B cannot read org A annotation" "403" "$HTTP_STATUS"

echo "  All cross-org annotation isolation tests passed."

# ─── Security headers ────────────────────────────────────────────────────────

echo "  --- Security headers ---"

headers=$(curl -s -D - -o /dev/null --max-time "$CURL_TIMEOUT" "$API/auth/login" 2>/dev/null) || true

has_xcto=$(echo "$headers" | grep -ci "X-Content-Type-Options: nosniff" || true)
assert_true "security: X-Content-Type-Options header present" \
    "$([ "$has_xcto" -ge 1 ] && echo true || echo false)"

has_xfo=$(echo "$headers" | grep -ci "X-Frame-Options: DENY" || true)
assert_true "security: X-Frame-Options header present" \
    "$([ "$has_xfo" -ge 1 ] && echo true || echo false)"

has_rp=$(echo "$headers" | grep -ci "Referrer-Policy" || true)
assert_true "security: Referrer-Policy header present" \
    "$([ "$has_rp" -ge 1 ] && echo true || echo false)"

echo "  All security header tests passed."

report
