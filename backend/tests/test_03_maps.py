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
    "title": "Test Map", "description": "A test", "centerLat": 40.7, "centerLng": -74.0, "zoom": 12
}, TOKEN_A)
assert_status("create: valid input returns 201", 201, status)
MAP_ID = json_field(body, ["id"])
assert_json_field("create: title correct", body, ["title"], "Test Map")
assert_json_field("create: permission is owner", body, ["permission"], "owner")

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
assert_status("update: owner can update", 200, status)

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
