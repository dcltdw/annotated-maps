#!/usr/bin/env python3
"""test_04_annotations.py — Annotation CRUD and media with permission checks"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_json_field,
    http_post, http_get, http_put, http_delete, register_user, json_field
)

reset_counters()
RUN_ID = os.getpid()

print("=== Annotation Tests ===")

TOKEN = register_user(f"t04_{RUN_ID}", f"t04_{RUN_ID}@test.com", "testpass123")
_, body = http_post("/auth/login", {"email": f"t04_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_ID = json_field(body, ["tenantId"])

_, body = http_post(f"/tenants/{TENANT_ID}/maps", {"title": "Ann Map"}, TOKEN)
MAP_ID = json_field(body, ["id"])

# ─── Create annotation ───────────────────────────────────────────────────────

print("  --- Create annotation ---")

status, body = http_post(f"/tenants/{TENANT_ID}/maps/{MAP_ID}/annotations", {
    "type": "marker", "title": "Test Pin",
    "geoJson": {"type": "Point", "coordinates": [-74.0, 40.7]}
}, TOKEN)
assert_status("create: valid marker returns 201", 201, status)
ANN_ID = json_field(body, ["id"])
assert_json_field("create: type correct", body, ["type"], "marker")

status, _ = http_post(f"/tenants/{TENANT_ID}/maps/{MAP_ID}/annotations", {
    "type": "marker", "title": "Bad", "geoJson": {"coordinates": [0, 0]}
}, TOKEN)
assert_status("create: missing geoJson.type returns 400", 400, status)

status, _ = http_post(f"/tenants/{TENANT_ID}/maps/{MAP_ID}/annotations", {
    "type": "marker", "title": "Bad", "geoJson": {"type": "Circle", "coordinates": [0, 0]}
}, TOKEN)
assert_status("create: invalid geoJson.type returns 400", 400, status)

status, _ = http_post(f"/tenants/{TENANT_ID}/maps/{MAP_ID}/annotations", {
    "type": "marker", "title": "Bad", "geoJson": {"type": "Point", "coordinates": []}
}, TOKEN)
assert_status("create: empty coordinates returns 400", 400, status)

status, _ = http_post(f"/tenants/{TENANT_ID}/maps/{MAP_ID}/annotations",
                      {"title": "No type"}, TOKEN)
assert_status("create: missing type/geoJson returns 400", 400, status)

print("  All create annotation tests passed.")

# ─── List / Get ───────────────────────────────────────────────────────────────

print("  --- List / Get ---")

status, _ = http_get(f"/tenants/{TENANT_ID}/maps/{MAP_ID}/annotations", TOKEN)
assert_status("list: returns 200", 200, status)

status, body = http_get(f"/tenants/{TENANT_ID}/maps/{MAP_ID}/annotations/{ANN_ID}", TOKEN)
assert_status("get: returns 200", 200, status)
assert_json_field("get: title correct", body, ["title"], "Test Pin")

print("  All list/get tests passed.")

# ─── Update ───────────────────────────────────────────────────────────────────

print("  --- Update annotation ---")

status, _ = http_put(f"/tenants/{TENANT_ID}/maps/{MAP_ID}/annotations/{ANN_ID}",
                     {"title": "Updated Pin"}, TOKEN)
assert_status("update: owner can update", 200, status)

print("  All update annotation tests passed.")

# ─── Media: add ───────────────────────────────────────────────────────────────

print("  --- Add media ---")

status, body = http_post(f"/tenants/{TENANT_ID}/maps/{MAP_ID}/annotations/{ANN_ID}/media",
                         {"mediaType": "link", "url": "https://example.com/info"}, TOKEN)
assert_status("addMedia: valid https URL returns 201", 201, status)
MEDIA_ID = json_field(body, ["id"])

status, _ = http_post(f"/tenants/{TENANT_ID}/maps/{MAP_ID}/annotations/{ANN_ID}/media",
                      {"mediaType": "link", "url": "javascript:alert(1)"}, TOKEN)
assert_status("addMedia: javascript URL returns 400", 400, status)

status, _ = http_post(f"/tenants/{TENANT_ID}/maps/{MAP_ID}/annotations/{ANN_ID}/media",
                      {"mediaType": "link", "url": "data:text/html,<h1>hi</h1>"}, TOKEN)
assert_status("addMedia: data URL returns 400", 400, status)

print("  All add media tests passed.")

# ─── Media: delete ────────────────────────────────────────────────────────────

print("  --- Delete media ---")

status, _ = http_delete(
    f"/tenants/{TENANT_ID}/maps/{MAP_ID}/annotations/{ANN_ID}/media/{MEDIA_ID}", TOKEN)
assert_status("deleteMedia: owner can delete", 204, status)

print("  All delete media tests passed.")

# ─── Delete annotation ───────────────────────────────────────────────────────

print("  --- Delete annotation ---")

status, _ = http_delete(f"/tenants/{TENANT_ID}/maps/{MAP_ID}/annotations/{ANN_ID}", TOKEN)
assert_status("delete: owner can delete", 204, status)

print("  All delete annotation tests passed.")

sys.exit(0 if report() else 1)
