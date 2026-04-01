#!/usr/bin/env bash
# test_05_tenants.sh — Tenant member management and branding
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers.sh"

echo "=== Tenant Tests ==="

RUN_ID="$$"

# Setup: admin user
TOKEN_ADMIN=$(register_user "t05_a_${RUN_ID}" "t05_a_${RUN_ID}@test.com" "testpass123")
http_post "/auth/login" "{\"email\":\"t05_a_${RUN_ID}@test.com\",\"password\":\"testpass123\"}"
TENANT_ID=$(json_field "$HTTP_BODY" "['tenantId']")
ADMIN_ID=$(json_field "$HTTP_BODY" "['user']['id']")
ORG_ID=$(json_field "$HTTP_BODY" "['orgId']")

# Second user in a different org
TOKEN_OTHER=$(register_user "t05_o_${RUN_ID}" "t05_o_${RUN_ID}@test.com" "testpass123")
http_post "/auth/login" "{\"email\":\"t05_o_${RUN_ID}@test.com\",\"password\":\"testpass123\"}"
OTHER_ID=$(json_field "$HTTP_BODY" "['user']['id']")

# ─── List tenants ─────────────────────────────────────────────────────────────

echo "  --- List tenants ---"

http_get "/tenants" "$TOKEN_ADMIN"
assert_status "listTenants: returns 200" "200" "$HTTP_STATUS"

echo "  All list tenants tests passed."

# ─── Branding ─────────────────────────────────────────────────────────────────

echo "  --- Branding ---"

http_get "/tenants/$TENANT_ID/branding" "$TOKEN_ADMIN"
assert_status "getBranding: returns 200" "200" "$HTTP_STATUS"

http_put "/tenants/$TENANT_ID/branding" \
    '{"primary_color":"#ff0000","accent_color":"#cc0000","display_name":"Test Tenant"}' \
    "$TOKEN_ADMIN"
assert_status "updateBranding: admin can update" "200" "$HTTP_STATUS"
assert_json_field "updateBranding: color set" "$HTTP_BODY" "['primary_color']" "#ff0000"

# Invalid color
http_put "/tenants/$TENANT_ID/branding" \
    '{"primary_color":"red; background: url(evil)"}' "$TOKEN_ADMIN"
assert_status "updateBranding: invalid color returns 400" "400" "$HTTP_STATUS"

# Invalid URL
http_put "/tenants/$TENANT_ID/branding" \
    '{"logo_url":"javascript:alert(1)"}' "$TOKEN_ADMIN"
assert_status "updateBranding: non-https URL returns 400" "400" "$HTTP_STATUS"

# Valid HTTPS URL
http_put "/tenants/$TENANT_ID/branding" \
    '{"logo_url":"https://example.com/logo.png"}' "$TOKEN_ADMIN"
assert_status "updateBranding: https URL accepted" "200" "$HTTP_STATUS"

# Cross-org user can't update
http_put "/tenants/$TENANT_ID/branding" \
    '{"display_name":"Hacked"}' "$TOKEN_OTHER"
assert_status "updateBranding: cross-org user returns 403" "403" "$HTTP_STATUS"

echo "  All branding tests passed."

# ─── Members ─────────────────────────────────────────────────────────────────

echo "  --- Members ---"

# Cross-org add should fail
http_post "/tenants/$TENANT_ID/members" \
    "{\"userId\":$OTHER_ID,\"role\":\"viewer\"}" "$TOKEN_ADMIN"
assert_status "addMember: cross-org user returns 400" "400" "$HTTP_STATUS"

# Create a same-org user by updating their org_id via DB
register_user "t05_c_${RUN_ID}" "t05_c_${RUN_ID}@test.com" "testpass123" > /dev/null
mysql_query "UPDATE users SET org_id = $ORG_ID WHERE email = 't05_c_${RUN_ID}@test.com';"
COLLEAGUE_ID=$(mysql_query "SELECT id FROM users WHERE email = 't05_c_${RUN_ID}@test.com';")

http_post "/tenants/$TENANT_ID/members" \
    "{\"userId\":$COLLEAGUE_ID,\"role\":\"editor\"}" "$TOKEN_ADMIN"
assert_status "addMember: same-org user returns 201" "201" "$HTTP_STATUS"

# Invalid role
http_post "/tenants/$TENANT_ID/members" \
    "{\"userId\":$COLLEAGUE_ID,\"role\":\"superadmin\"}" "$TOKEN_ADMIN"
assert_status "addMember: invalid role returns 400" "400" "$HTTP_STATUS"

echo "  All member add tests passed."

echo "  --- Member list/remove ---"

# List members (admin only)
http_get "/tenants/$TENANT_ID/members" "$TOKEN_ADMIN"
assert_status "listMembers: admin can list" "200" "$HTTP_STATUS"

# Admin can't remove self
http_delete "/tenants/$TENANT_ID/members/$ADMIN_ID" "$TOKEN_ADMIN"
assert_status "removeMember: can't remove self returns 400" "400" "$HTTP_STATUS"

# Admin can remove colleague
http_delete "/tenants/$TENANT_ID/members/$COLLEAGUE_ID" "$TOKEN_ADMIN"
assert_status "removeMember: admin can remove other member" "204" "$HTTP_STATUS"

echo "  All member list/remove tests passed."

report
