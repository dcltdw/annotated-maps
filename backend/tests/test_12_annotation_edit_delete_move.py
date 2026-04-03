#!/usr/bin/env python3
"""test_12_annotation_edit_delete_move.py — Annotation edit, delete, and move tests"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_json_field, assert_json_exists,
    assert_true, http_post, http_get, http_put, http_delete,
    register_user, json_field
)

reset_counters()
RUN_ID = os.getpid()

print("=== Annotation Edit/Delete/Move Tests ===")

# Setup: two users in different orgs, one map, one annotation of each type
TOKEN_A = register_user(f"t12_a_{RUN_ID}", f"t12_a_{RUN_ID}@test.com", "testpass123")
_, body = http_post("/auth/login", {"email": f"t12_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A = json_field(body, ["tenantId"])

TOKEN_B = register_user(f"t12_b_{RUN_ID}", f"t12_b_{RUN_ID}@test.com", "testpass123")

_, body = http_post(f"/tenants/{TENANT_A}/maps", {"title": "Edit Test Map"}, TOKEN_A)
MAP_ID = json_field(body, ["id"])

BASE = f"/tenants/{TENANT_A}/maps/{MAP_ID}/annotations"

# Create a marker
status, body = http_post(BASE, {
    "type": "marker", "title": "Original Title", "description": "Original desc",
    "geoJson": {"type": "Point", "coordinates": [-74.0, 40.7]}
}, TOKEN_A)
assert_status("setup: marker created", 201, status)
MARKER_ID = json_field(body, ["id"])

# Create a polyline
status, body = http_post(BASE, {
    "type": "polyline", "title": "Test Line",
    "geoJson": {"type": "LineString", "coordinates": [[-74.0, 40.7], [-73.9, 40.8]]}
}, TOKEN_A)
assert_status("setup: polyline created", 201, status)
LINE_ID = json_field(body, ["id"])

# Create a polygon
status, body = http_post(BASE, {
    "type": "polygon", "title": "Test Poly",
    "geoJson": {"type": "Polygon", "coordinates": [[[-74.0, 40.7], [-73.9, 40.7], [-73.9, 40.8], [-74.0, 40.7]]]}
}, TOKEN_A)
assert_status("setup: polygon created", 201, status)
POLY_ID = json_field(body, ["id"])

# ─── Edit title and description ───────────────────────────────────────────────

print("  --- Edit title/description ---")

status, body = http_put(f"{BASE}/{MARKER_ID}", {
    "title": "Updated Title", "description": "Updated desc"
}, TOKEN_A)
assert_status("edit: update title/desc returns 200", 200, status)

# Verify the update took effect
status, body = http_get(f"{BASE}/{MARKER_ID}", TOKEN_A)
assert_status("edit: get after update returns 200", 200, status)
assert_json_field("edit: title updated", body, ["title"], "Updated Title")
assert_json_field("edit: description updated", body, ["description"], "Updated desc")

# Update title only (description should stay)
status, _ = http_put(f"{BASE}/{MARKER_ID}", {"title": "Title Only"}, TOKEN_A)
assert_status("edit: title-only update returns 200", 200, status)

status, body = http_get(f"{BASE}/{MARKER_ID}", TOKEN_A)
assert_json_field("edit: title changed", body, ["title"], "Title Only")
assert_json_field("edit: description preserved", body, ["description"], "Updated desc")

# Cross-org user cannot edit
status, _ = http_put(f"{BASE}/{MARKER_ID}", {"title": "Hacked"}, TOKEN_B)
assert_status("edit: cross-org cannot edit", 403, status)

print("  All edit tests passed.")

# ─── Move marker ─────────────────────────────────────────────────────────────

print("  --- Move marker ---")

new_marker_geo = {"type": "Point", "coordinates": [-73.5, 40.9]}
status, _ = http_put(f"{BASE}/{MARKER_ID}", {"geoJson": new_marker_geo}, TOKEN_A)
assert_status("move marker: returns 200", 200, status)

status, body = http_get(f"{BASE}/{MARKER_ID}", TOKEN_A)
geo = json_field(body, ["geoJson"])
assert_json_field("move marker: type unchanged", body, ["geoJson", "type"], "Point")
coords = json_field(body, ["geoJson", "coordinates"])
assert_true("move marker: lng updated", coords is not None and abs(coords[0] - (-73.5)) < 0.001)
assert_true("move marker: lat updated", coords is not None and abs(coords[1] - 40.9) < 0.001)

# Cross-org user cannot move
status, _ = http_put(f"{BASE}/{MARKER_ID}", {"geoJson": new_marker_geo}, TOKEN_B)
assert_status("move marker: cross-org cannot move", 403, status)

print("  All move marker tests passed.")

# ─── Move polyline ───────────────────────────────────────────────────────────

print("  --- Move polyline ---")

new_line_geo = {"type": "LineString", "coordinates": [[-73.0, 41.0], [-72.9, 41.1]]}
status, _ = http_put(f"{BASE}/{LINE_ID}", {"geoJson": new_line_geo}, TOKEN_A)
assert_status("move polyline: returns 200", 200, status)

status, body = http_get(f"{BASE}/{LINE_ID}", TOKEN_A)
assert_json_field("move polyline: type unchanged", body, ["geoJson", "type"], "LineString")
coords = json_field(body, ["geoJson", "coordinates"])
assert_true("move polyline: coordinates updated",
            coords is not None and len(coords) == 2 and abs(coords[0][0] - (-73.0)) < 0.001)

print("  All move polyline tests passed.")

# ─── Move polygon ────────────────────────────────────────────────────────────

print("  --- Move polygon ---")

new_poly_geo = {"type": "Polygon", "coordinates": [[[-73.0, 41.0], [-72.9, 41.0], [-72.9, 41.1], [-73.0, 41.0]]]}
status, _ = http_put(f"{BASE}/{POLY_ID}", {"geoJson": new_poly_geo}, TOKEN_A)
assert_status("move polygon: returns 200", 200, status)

status, body = http_get(f"{BASE}/{POLY_ID}", TOKEN_A)
assert_json_field("move polygon: type unchanged", body, ["geoJson", "type"], "Polygon")

print("  All move polygon tests passed.")

# ─── Delete ───────────────────────────────────────────────────────────────────

print("  --- Delete ---")

# Cross-org user cannot delete
status, _ = http_delete(f"{BASE}/{MARKER_ID}", TOKEN_B)
assert_status("delete: cross-org cannot delete", 403, status)

# Owner can delete
status, _ = http_delete(f"{BASE}/{MARKER_ID}", TOKEN_A)
assert_status("delete: owner can delete marker", 204, status)

status, _ = http_get(f"{BASE}/{MARKER_ID}", TOKEN_A)
assert_status("delete: marker is gone", 404, status)

status, _ = http_delete(f"{BASE}/{LINE_ID}", TOKEN_A)
assert_status("delete: owner can delete polyline", 204, status)

status, _ = http_delete(f"{BASE}/{POLY_ID}", TOKEN_A)
assert_status("delete: owner can delete polygon", 204, status)

# Verify list is empty
status, body = http_get(BASE, TOKEN_A)
assert_status("delete: list returns 200", 200, status)
assert_true("delete: no annotations remain", isinstance(body, list) and len(body) == 0)

print("  All delete tests passed.")

sys.exit(0 if report() else 1)
