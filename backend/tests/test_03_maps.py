#!/usr/bin/env python3
"""test_03_maps.py — Map CRUD with tenant scoping and permission tests"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_json_field,
    http_post, http_get, http_put, http_delete, register_user, json_field
)

reset_counters()
RUN_ID = os.getpid()

print("=== Map Tests ===")

TOKEN_A = register_user(f"t03_a_{RUN_ID}", f"t03_a_{RUN_ID}@test.com", "testpass123")
_, body_a = http_post("/auth/login", {"email": f"t03_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A = json_field(body_a, ["tenantId"])

TOKEN_B = register_user(f"t03_b_{RUN_ID}", f"t03_b_{RUN_ID}@test.com", "testpass123")
_, body_b = http_post("/auth/login", {"email": f"t03_b_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_B = json_field(body_b, ["tenantId"])

# ─── Create ───────────────────────────────────────────────────────────────────

print("  --- Create ---")

status, body = http_post(f"/tenants/{TENANT_A}/maps", {
    "title": "Test Map", "description": "A test",
    "coordinateSystem": {
        "type": "wgs84", "center": {"lat": 40.7, "lng": -74.0}, "zoom": 12,
    },
}, TOKEN_A)
assert_status("create: valid input returns 201", 201, status)
MAP_ID = json_field(body, ["id"])
assert_json_field("create: title correct",          body, ["title"], "Test Map")
assert_json_field("create: permission is owner",    body, ["permission"], "owner")
assert_json_field("create: coordinateSystem.type",  body, ["coordinateSystem", "type"], "wgs84")
assert_json_field("create: ownerXray defaults to False", body, ["ownerXray"], "False")

# coordinateSystem omitted → backend supplies a usable WGS84 default
status, body = http_post(f"/tenants/{TENANT_A}/maps", {"title": "Default Coord"}, TOKEN_A)
assert_status("create: default coordinateSystem returns 201", 201, status)
assert_json_field("create: default coordinateSystem.type", body, ["coordinateSystem", "type"], "wgs84")

# Invalid coordinateSystem.type rejected
status, _ = http_post(f"/tenants/{TENANT_A}/maps", {
    "title": "Bad CS", "coordinateSystem": {"type": "bogus"}
}, TOKEN_A)
assert_status("create: invalid coordinateSystem.type returns 400", 400, status)

# Missing required fields for known type rejected
status, _ = http_post(f"/tenants/{TENANT_A}/maps", {
    "title": "Bad WGS", "coordinateSystem": {"type": "wgs84"}
}, TOKEN_A)
assert_status("create: incomplete wgs84 rejected", 400, status)

# pixel type with insecure URL rejected
status, _ = http_post(f"/tenants/{TENANT_A}/maps", {
    "title": "Bad Pixel",
    "coordinateSystem": {
        "type": "pixel", "image_url": "javascript:alert(1)",
        "width": 100, "height": 100,
    },
}, TOKEN_A)
assert_status("create: pixel image_url scheme validated", 400, status)

status, _ = http_post(f"/tenants/{TENANT_A}/maps", {}, TOKEN_A)
assert_status("create: missing title returns 400", 400, status)

print("  All create tests passed.")

# ─── Get ──────────────────────────────────────────────────────────────────────

print("  --- Get ---")

status, body = http_get(f"/tenants/{TENANT_A}/maps/{MAP_ID}", TOKEN_A)
assert_status("get: owner can view map", 200, status)
assert_json_field("get: title correct", body, ["title"], "Test Map")

status, _ = http_get(f"/tenants/{TENANT_A}/maps/{MAP_ID}", TOKEN_B)
assert_status("get: cross-org user cannot view map", 403, status)

print("  All get tests passed.")

# ─── List ─────────────────────────────────────────────────────────────────────

print("  --- List ---")

status, _ = http_get(f"/tenants/{TENANT_A}/maps", TOKEN_A)
assert_status("list: returns 200", 200, status)

status, _ = http_get(f"/tenants/{TENANT_A}/maps?page=0&pageSize=abc", TOKEN_A)
assert_status("list: bad pagination still returns 200", 200, status)

print("  All list tests passed.")

# ─── Update ───────────────────────────────────────────────────────────────────

print("  --- Update ---")

status, _ = http_put(f"/tenants/{TENANT_A}/maps/{MAP_ID}", {"title": "Updated Map"}, TOKEN_A)
assert_status("update: owner can update title", 200, status)

# Update coordinateSystem
status, _ = http_put(f"/tenants/{TENANT_A}/maps/{MAP_ID}", {
    "coordinateSystem": {
        "type": "wgs84", "center": {"lat": 0, "lng": 0}, "zoom": 5,
    },
}, TOKEN_A)
assert_status("update: owner can update coordinateSystem", 200, status)

# Verify it persisted
status, body = http_get(f"/tenants/{TENANT_A}/maps/{MAP_ID}", TOKEN_A)
assert_json_field("update: coordinateSystem.zoom persisted", body, ["coordinateSystem", "zoom"], "5")

# Invalid coordinateSystem on update is rejected
status, _ = http_put(f"/tenants/{TENANT_A}/maps/{MAP_ID}", {
    "coordinateSystem": {"type": "bogus"}
}, TOKEN_A)
assert_status("update: invalid coordinateSystem rejected", 400, status)

# ownerXray toggle
status, _ = http_put(f"/tenants/{TENANT_A}/maps/{MAP_ID}", {"ownerXray": True}, TOKEN_A)
assert_status("update: ownerXray toggle accepted", 200, status)
status, body = http_get(f"/tenants/{TENANT_A}/maps/{MAP_ID}", TOKEN_A)
assert_json_field("update: ownerXray persisted", body, ["ownerXray"], "True")

status, _ = http_put(f"/tenants/{TENANT_A}/maps/{MAP_ID}", {"title": "Hacked"}, TOKEN_B)
assert_status("update: cross-org user cannot update", 403, status)

print("  All update tests passed.")

# ─── Permissions ──────────────────────────────────────────────────────────────

print("  --- Permissions ---")

status, _ = http_put(f"/tenants/{TENANT_A}/maps/{MAP_ID}/permissions",
                     {"userId": None, "level": "view"}, TOKEN_A)
assert_status("permission: owner can set public access", 200, status)

status, _ = http_get(f"/tenants/{TENANT_A}/maps/{MAP_ID}/permissions", TOKEN_A)
assert_status("permission: owner can list permissions", 200, status)

print("  All permission tests passed.")

# ─── Delete ───────────────────────────────────────────────────────────────────

print("  --- Delete ---")

status, _ = http_delete(f"/tenants/{TENANT_A}/maps/{MAP_ID}", TOKEN_B)
assert_status("delete: cross-org user cannot delete", 403, status)

status, _ = http_delete(f"/tenants/{TENANT_A}/maps/{MAP_ID}", TOKEN_A)
assert_status("delete: owner can delete", 204, status)

status, _ = http_get(f"/tenants/{TENANT_A}/maps/{MAP_ID}", TOKEN_A)
assert_status("delete: map is gone", 404, status)

print("  All delete tests passed.")

sys.exit(0 if report() else 1)
