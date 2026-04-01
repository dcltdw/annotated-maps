#!/usr/bin/env bash
# test_04_annotations.sh — Annotation CRUD and media with permission checks
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers.sh"

echo "=== Annotation Tests ==="

RUN_ID="$$"

# Setup
TOKEN=$(register_user "t04_${RUN_ID}" "t04_${RUN_ID}@test.com" "testpass123")
http_post "/auth/login" "{\"email\":\"t04_${RUN_ID}@test.com\",\"password\":\"testpass123\"}"
TENANT_ID=$(json_field "$HTTP_BODY" "['tenantId']")

http_post "/tenants/$TENANT_ID/maps" '{"title":"Ann Map"}' "$TOKEN"
MAP_ID=$(json_field "$HTTP_BODY" "['id']")

# ─── Create annotation ───────────────────────────────────────────────────────

echo "  --- Create annotation ---"

http_post "/tenants/$TENANT_ID/maps/$MAP_ID/annotations" \
    '{"type":"marker","title":"Test Pin","geoJson":{"type":"Point","coordinates":[-74.0,40.7]}}' \
    "$TOKEN"
assert_status "create: valid marker returns 201" "201" "$HTTP_STATUS"
ANN_ID=$(json_field "$HTTP_BODY" "['id']")
assert_json_field "create: type correct" "$HTTP_BODY" "['type']" "marker"

# Invalid GeoJSON: missing type
http_post "/tenants/$TENANT_ID/maps/$MAP_ID/annotations" \
    '{"type":"marker","title":"Bad","geoJson":{"coordinates":[0,0]}}' \
    "$TOKEN"
assert_status "create: missing geoJson.type returns 400" "400" "$HTTP_STATUS"

# Invalid GeoJSON: bad type
http_post "/tenants/$TENANT_ID/maps/$MAP_ID/annotations" \
    '{"type":"marker","title":"Bad","geoJson":{"type":"Circle","coordinates":[0,0]}}' \
    "$TOKEN"
assert_status "create: invalid geoJson.type returns 400" "400" "$HTTP_STATUS"

# Invalid GeoJSON: empty coordinates
http_post "/tenants/$TENANT_ID/maps/$MAP_ID/annotations" \
    '{"type":"marker","title":"Bad","geoJson":{"type":"Point","coordinates":[]}}' \
    "$TOKEN"
assert_status "create: empty coordinates returns 400" "400" "$HTTP_STATUS"

# Missing required fields
http_post "/tenants/$TENANT_ID/maps/$MAP_ID/annotations" \
    '{"title":"No type"}' "$TOKEN"
assert_status "create: missing type/geoJson returns 400" "400" "$HTTP_STATUS"

echo "  All create annotation tests passed."

# ─── List / Get annotations ──────────────────────────────────────────────────

echo "  --- List / Get ---"

http_get "/tenants/$TENANT_ID/maps/$MAP_ID/annotations" "$TOKEN"
assert_status "list: returns 200" "200" "$HTTP_STATUS"

http_get "/tenants/$TENANT_ID/maps/$MAP_ID/annotations/$ANN_ID" "$TOKEN"
assert_status "get: returns 200" "200" "$HTTP_STATUS"
assert_json_field "get: title correct" "$HTTP_BODY" "['title']" "Test Pin"

echo "  All list/get tests passed."

# ─── Update annotation ───────────────────────────────────────────────────────

echo "  --- Update annotation ---"

http_put "/tenants/$TENANT_ID/maps/$MAP_ID/annotations/$ANN_ID" \
    '{"title":"Updated Pin"}' "$TOKEN"
assert_status "update: owner can update" "200" "$HTTP_STATUS"

echo "  All update annotation tests passed."

# ─── Media: add ───────────────────────────────────────────────────────────────

echo "  --- Add media ---"

http_post "/tenants/$TENANT_ID/maps/$MAP_ID/annotations/$ANN_ID/media" \
    '{"mediaType":"link","url":"https://example.com/info"}' "$TOKEN"
assert_status "addMedia: valid https URL returns 201" "201" "$HTTP_STATUS"
MEDIA_ID=$(json_field "$HTTP_BODY" "['id']")

# Invalid URL scheme
http_post "/tenants/$TENANT_ID/maps/$MAP_ID/annotations/$ANN_ID/media" \
    '{"mediaType":"link","url":"javascript:alert(1)"}' "$TOKEN"
assert_status "addMedia: javascript URL returns 400" "400" "$HTTP_STATUS"

http_post "/tenants/$TENANT_ID/maps/$MAP_ID/annotations/$ANN_ID/media" \
    '{"mediaType":"link","url":"data:text/html,<h1>hi</h1>"}' "$TOKEN"
assert_status "addMedia: data URL returns 400" "400" "$HTTP_STATUS"

echo "  All add media tests passed."

# ─── Media: delete ────────────────────────────────────────────────────────────

echo "  --- Delete media ---"

http_delete "/tenants/$TENANT_ID/maps/$MAP_ID/annotations/$ANN_ID/media/$MEDIA_ID" "$TOKEN"
assert_status "deleteMedia: owner can delete" "204" "$HTTP_STATUS"

echo "  All delete media tests passed."

# ─── Delete annotation ───────────────────────────────────────────────────────

echo "  --- Delete annotation ---"

http_delete "/tenants/$TENANT_ID/maps/$MAP_ID/annotations/$ANN_ID" "$TOKEN"
assert_status "delete: owner can delete" "204" "$HTTP_STATUS"

echo "  All delete annotation tests passed."

report
