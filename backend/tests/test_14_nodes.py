#!/usr/bin/env python3
"""test_14_nodes.py — Node CRUD with tenant scoping, parent_id tree, max-depth."""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_json_field, assert_json_exists,
    assert_true, http_post, http_get, http_put, http_delete,
    register_user, json_field, mysql_query,
)

reset_counters()
RUN_ID = os.getpid()

print("=== Node Tests ===")

# Two users in different tenants for cross-tenant checks.
TOKEN_A = register_user(f"t14_a_{RUN_ID}", f"t14_a_{RUN_ID}@test.com", "testpass123")
_, body_a = http_post("/auth/login",
    {"email": f"t14_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A   = json_field(body_a, ["tenantId"])
USER_A_ID  = json_field(body_a, ["user", "id"])

TOKEN_B = register_user(f"t14_b_{RUN_ID}", f"t14_b_{RUN_ID}@test.com", "testpass123")
_, body_b = http_post("/auth/login",
    {"email": f"t14_b_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_B = json_field(body_b, ["tenantId"])

# A creates a map in their own tenant.
_, body = http_post(f"/tenants/{TENANT_A}/maps", {
    "title": "Node Test Map",
    "coordinateSystem": {"type": "wgs84", "center": {"lat": 0, "lng": 0}, "zoom": 3},
}, TOKEN_A)
MAP_A = json_field(body, ["id"])

BASE = f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes"

# ─── Create ──────────────────────────────────────────────────────────────────

print("  --- Create ---")

# Top-level node with no geometry (tree-only).
status, body = http_post(BASE, {"name": "Root"}, TOKEN_A)
assert_status("create: top-level node returns 201", 201, status)
ROOT = json_field(body, ["id"])
assert_json_field("create: name correct", body, ["name"], "Root")
assert_json_field("create: parentId is null", body, ["parentId"], "None")
assert_json_field("create: geoJson is null", body, ["geoJson"], "None")

# Node with point geometry.
status, body = http_post(BASE, {
    "name": "PinA",
    "geoJson": {"type": "Point", "coordinates": [-74.0, 40.7]},
    "description": "A pin",
    "color": "#ff0000",
}, TOKEN_A)
assert_status("create: pin returns 201", 201, status)
PIN_A = json_field(body, ["id"])
assert_json_field("create: pin name", body, ["name"], "PinA")
assert_json_field("create: pin description", body, ["description"], "A pin")
assert_json_field("create: pin color", body, ["color"], "#ff0000")
assert_json_field("create: pin geoJson type", body, ["geoJson", "type"], "Point")

# Child node under root.
status, body = http_post(BASE, {"name": "Child1", "parentId": ROOT}, TOKEN_A)
assert_status("create: child node returns 201", 201, status)
CHILD1 = json_field(body, ["id"])
assert_json_field("create: child parentId set", body, ["parentId"], str(ROOT))

# Validation: name required
status, _ = http_post(BASE, {}, TOKEN_A)
assert_status("create: missing name returns 400", 400, status)

# Validation: invalid geoJson
status, _ = http_post(BASE, {
    "name": "BadGeo",
    "geoJson": {"type": "Circle", "coordinates": [0, 0]},
}, TOKEN_A)
assert_status("create: invalid geoJson type returns 400", 400, status)

# Validation: parentId on a different map (use a node from B's tenant)
_, body = http_post(f"/tenants/{TENANT_B}/maps", {"title": "Other"}, TOKEN_B)
MAP_B = json_field(body, ["id"])
_, body = http_post(f"/tenants/{TENANT_B}/maps/{MAP_B}/nodes",
    {"name": "B-Root"}, TOKEN_B)
B_ROOT = json_field(body, ["id"])
status, _ = http_post(BASE, {"name": "X", "parentId": B_ROOT}, TOKEN_A)
assert_status("create: cross-map parentId rejected", 400, status)

print("  All create tests passed.")

# ─── List ────────────────────────────────────────────────────────────────────

print("  --- List ---")

status, body = http_get(BASE, TOKEN_A)
assert_status("list: returns 200", 200, status)
assert_true("list: returns array", isinstance(body, list))
assert_true("list: contains the 3 created nodes", len(body) >= 3)

# Top-level filter: parentId= (empty)
status, body = http_get(f"{BASE}?parentId=", TOKEN_A)
assert_status("list: top-level filter returns 200", 200, status)
top_names = [n["name"] for n in body]
assert_true("list: top-level includes Root and PinA", "Root" in top_names and "PinA" in top_names)
assert_true("list: top-level excludes Child1", "Child1" not in top_names)

# Children filter: parentId=N
status, body = http_get(f"{BASE}?parentId={ROOT}", TOKEN_A)
assert_status("list: children filter returns 200", 200, status)
assert_true("list: only Child1 is direct child of Root",
            len(body) == 1 and body[0]["name"] == "Child1")

# Bad parentId
status, _ = http_get(f"{BASE}?parentId=notanumber", TOKEN_A)
assert_status("list: non-numeric parentId returns 400", 400, status)

print("  All list tests passed.")

# ─── Get ─────────────────────────────────────────────────────────────────────

print("  --- Get ---")

status, body = http_get(f"{BASE}/{PIN_A}", TOKEN_A)
assert_status("get: returns 200", 200, status)
assert_json_field("get: name correct", body, ["name"], "PinA")
assert_json_exists("get: has createdAt", body, ["createdAt"])
assert_json_exists("get: has createdByUsername", body, ["createdByUsername"])

# Cross-tenant isolation
status, _ = http_get(f"{BASE}/{PIN_A}", TOKEN_B)
assert_status("get: cross-tenant blocked", 403, status)

# Not found
status, _ = http_get(f"{BASE}/9999999", TOKEN_A)
assert_status("get: missing node returns 404", 404, status)

print("  All get tests passed.")

# ─── Update ──────────────────────────────────────────────────────────────────

print("  --- Update ---")

status, _ = http_put(f"{BASE}/{PIN_A}", {"name": "PinA Updated"}, TOKEN_A)
assert_status("update: name update returns 200", 200, status)
status, body = http_get(f"{BASE}/{PIN_A}", TOKEN_A)
assert_json_field("update: name persisted", body, ["name"], "PinA Updated")

# Update geoJson
status, _ = http_put(f"{BASE}/{PIN_A}", {
    "geoJson": {"type": "Point", "coordinates": [10.0, 20.0]},
}, TOKEN_A)
assert_status("update: geoJson update returns 200", 200, status)
status, body = http_get(f"{BASE}/{PIN_A}", TOKEN_A)
assert_json_field("update: geoJson persisted", body, ["geoJson", "type"], "Point")

# Clear geoJson via null
status, _ = http_put(f"{BASE}/{PIN_A}", {"geoJson": None}, TOKEN_A)
assert_status("update: geoJson clear returns 200", 200, status)
status, body = http_get(f"{BASE}/{PIN_A}", TOKEN_A)
assert_json_field("update: geoJson cleared to null", body, ["geoJson"], "None")

# Cross-tenant cannot update
status, _ = http_put(f"{BASE}/{PIN_A}", {"name": "Hacked"}, TOKEN_B)
assert_status("update: cross-tenant blocked", 403, status)

print("  All update tests passed.")

# ─── Delete (with subtree CASCADE) ───────────────────────────────────────────
# Run before max-depth so the cascade happens on a shallow tree (avoids
# bumping into MySQL's FK cascade nesting limit).

print("  --- Delete ---")

# Confirm Child1 still exists under Root before delete.
status, body = http_get(f"{BASE}/{CHILD1}", TOKEN_A)
assert_status("delete: child exists pre-delete", 200, status)

# Cross-tenant cannot delete
status, _ = http_delete(f"{BASE}/{ROOT}", TOKEN_B)
assert_status("delete: cross-tenant blocked", 403, status)

# Owner can delete; subtree cascades (Root → Child1)
status, _ = http_delete(f"{BASE}/{ROOT}", TOKEN_A)
assert_status("delete: owner can delete", 204, status)

# Root is gone
status, _ = http_get(f"{BASE}/{ROOT}", TOKEN_A)
assert_status("delete: root is gone", 404, status)

# Child cascaded
status, _ = http_get(f"{BASE}/{CHILD1}", TOKEN_A)
assert_status("delete: subtree cascaded (child gone)", 404, status)

print("  All delete tests passed.")

# ─── Max depth ───────────────────────────────────────────────────────────────
# Build a fresh chain under a new root to avoid affecting the (now-deleted)
# original Root. With MAX_NODE_DEPTH = 15, the deepest valid node is at
# depth 14. Inserting at proposed depth 15 should be rejected.

print("  --- Max depth ---")

_, body = http_post(BASE, {"name": "DepthRoot"}, TOKEN_A)
DEPTH_ROOT = json_field(body, ["id"])

chain = [DEPTH_ROOT]
for d in range(1, 15):  # creates L1..L14 → 15 levels including DepthRoot
    status, body = http_post(BASE, {"name": f"L{d}", "parentId": chain[-1]}, TOKEN_A)
    if status != 201:
        print(f"  unexpected at depth {d}: {status}")
        break
    chain.append(json_field(body, ["id"]))

assert_true("max depth: chain reached the boundary", len(chain) == 15)

# Insert under the deepest node should be rejected (proposed depth 15).
status, _ = http_post(BASE, {"name": "TooDeep", "parentId": chain[-1]}, TOKEN_A)
assert_status("max depth: inserting beyond limit returns 400", 400, status)

print("  All max-depth tests passed.")

# ─── Per-map node count cap (#217) ───────────────────────────────────────────
# Audit #46 L2: createNode COUNTs existing nodes and rejects with 400
# when at MAX_NODES_PER_MAP (5,000). Filling 5,000 via HTTP is slow;
# bulk-fill via SQL up to one-below-limit, then exercise the boundary
# via the API.

print("  --- Per-map node count cap (#217) ---")

_, body = http_post(f"/tenants/{TENANT_A}/maps", {
    "title": f"Cap test {RUN_ID}",
    "coordinateSystem": {"type": "wgs84", "center": {"lat": 0, "lng": 0}, "zoom": 3},
}, TOKEN_A)
CAP_MAP = json_field(body, ["id"])
CAP_BASE = f"/tenants/{TENANT_A}/maps/{CAP_MAP}/nodes"

# Bulk-fill 4,999 placeholder nodes via direct SQL.
mysql_query(
    f"INSERT INTO nodes (map_id, name, created_by) "
    f"SELECT {CAP_MAP}, CONCAT('bulk_', seq), {USER_A_ID} "
    f"FROM (SELECT @row := @row + 1 AS seq "
    f"      FROM information_schema.columns t1, information_schema.columns t2, "
    f"           (SELECT @row := 0) r LIMIT 4999) seq;")

count_str = mysql_query(f"SELECT COUNT(*) FROM nodes WHERE map_id = {CAP_MAP};")
assert_true("cap-fill seeded 4999 nodes",  count_str == "4999",
            f"got count={count_str!r}")

# 5,000th create succeeds (existing 4,999 < 5,000 cap).
status, _ = http_post(CAP_BASE, {"name": "AtCap"}, TOKEN_A)
assert_status("cap: create at limit-1 succeeds (becomes 5000th)", 201, status)

# 5,001st create rejected.
status, body = http_post(CAP_BASE, {"name": "OverCap"}, TOKEN_A)
assert_status("cap: create over limit returns 400", 400, status)
assert_true("cap: error mentions limit",
            isinstance(body, dict) and "limit" in body.get("message", "").lower(),
            f"got {body!r}")

print("  All node-count-cap tests passed.")

sys.exit(0 if report() else 1)
