#!/usr/bin/env python3
"""test_26_coordinate_systems.py — Phase 2f (#91): coordinate_system shape
validation across all three supported types.

Backend-only validation. Frontend rendering for `pixel` and `blank` lands
later with #101 (Map view rebuild) — see PR body for split rationale.

Covers each type's shape requirements per the ticket:
  - wgs84:  { type, center: {lat, lng}, zoom }
  - pixel:  { type, image_url, width, height, viewport: {x, y, zoom} }
  - blank:  { type, extent: {x, y} }

For each type: happy path (create succeeds) + rejection of each missing
or malformed field. Validation runs on both create and update.
"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_json_field, assert_true,
    http_post, http_get, http_put,
    register_user, json_field,
)

reset_counters()
RUN_ID = os.getpid()

print("=== Coordinate System Validation Tests ===")

TOKEN_A = register_user(f"t26_a_{RUN_ID}", f"t26_a_{RUN_ID}@test.com", "testpass123")
_, body_a = http_post("/auth/login",
    {"email": f"t26_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A = json_field(body_a, ["tenantId"])

MAPS = f"/tenants/{TENANT_A}/maps"

def make(coord_sys, title="m"):
    return http_post(MAPS, {"title": title, "coordinateSystem": coord_sys}, TOKEN_A)

# ─── WGS84 ───────────────────────────────────────────────────────────────────

print("  --- WGS84 ---")

ok = {"type": "wgs84", "center": {"lat": 40.7, "lng": -74.0}, "zoom": 10}
status, body = make(ok, "wgs84-ok")
assert_status("wgs84: happy path returns 201", 201, status)
assert_json_field("wgs84: type round-trips", body, ["coordinateSystem", "type"], "wgs84")
WGS_MAP = json_field(body, ["id"])

# Missing center
status, _ = make({"type": "wgs84", "zoom": 10})
assert_status("wgs84: missing center 400", 400, status)

# Missing zoom
status, _ = make({"type": "wgs84", "center": {"lat": 0, "lng": 0}})
assert_status("wgs84: missing zoom 400", 400, status)

# Non-numeric lat
status, _ = make({"type": "wgs84", "center": {"lat": "x", "lng": 0}, "zoom": 1})
assert_status("wgs84: non-numeric lat 400", 400, status)

# Non-numeric zoom
status, _ = make({"type": "wgs84", "center": {"lat": 0, "lng": 0}, "zoom": "x"})
assert_status("wgs84: non-numeric zoom 400", 400, status)

print("  All wgs84 tests passed.")

# ─── Pixel ───────────────────────────────────────────────────────────────────

print("  --- Pixel ---")

pixel_ok = {
    "type": "pixel",
    "image_url": "https://example.com/map.png",
    "width": 1024, "height": 768,
    "viewport": {"x": 512, "y": 384, "zoom": 1},
}
status, body = make(pixel_ok, "pixel-ok")
assert_status("pixel: happy path returns 201", 201, status)
assert_json_field("pixel: type round-trips", body, ["coordinateSystem", "type"], "pixel")
PIXEL_MAP = json_field(body, ["id"])

# Missing image_url
status, _ = make({**pixel_ok, "image_url": None})
assert_status("pixel: missing image_url 400", 400, status)

# Bad URL scheme
status, _ = make({**pixel_ok, "image_url": "javascript:alert(1)"})
assert_status("pixel: javascript: scheme 400", 400, status)
status, _ = make({**pixel_ok, "image_url": "ftp://example.com/x.png"})
assert_status("pixel: ftp scheme 400", 400, status)
status, _ = make({**pixel_ok, "image_url": "data:image/png;base64,xxx"})
assert_status("pixel: data: scheme 400", 400, status)

# Non-positive width / height
status, _ = make({**pixel_ok, "width": 0})
assert_status("pixel: zero width 400", 400, status)
status, _ = make({**pixel_ok, "width": -10})
assert_status("pixel: negative width 400", 400, status)
status, _ = make({**pixel_ok, "height": 0})
assert_status("pixel: zero height 400", 400, status)

# Missing viewport entirely (the new check from this ticket)
no_vp = {k: v for k, v in pixel_ok.items() if k != "viewport"}
status, _ = make(no_vp)
assert_status("pixel: missing viewport 400", 400, status)

# Viewport not an object
status, _ = make({**pixel_ok, "viewport": "nope"})
assert_status("pixel: non-object viewport 400", 400, status)

# Missing viewport.x / .y / .zoom
status, _ = make({**pixel_ok, "viewport": {"y": 0, "zoom": 1}})
assert_status("pixel: missing viewport.x 400", 400, status)
status, _ = make({**pixel_ok, "viewport": {"x": 0, "zoom": 1}})
assert_status("pixel: missing viewport.y 400", 400, status)
status, _ = make({**pixel_ok, "viewport": {"x": 0, "y": 0}})
assert_status("pixel: missing viewport.zoom 400", 400, status)

# Non-numeric viewport.x / .y / .zoom
status, _ = make({**pixel_ok, "viewport": {"x": "a", "y": 0, "zoom": 1}})
assert_status("pixel: non-numeric viewport.x 400", 400, status)
status, _ = make({**pixel_ok, "viewport": {"x": 0, "y": 0, "zoom": "a"}})
assert_status("pixel: non-numeric viewport.zoom 400", 400, status)

print("  All pixel tests passed.")

# ─── Blank ───────────────────────────────────────────────────────────────────

print("  --- Blank ---")

blank_ok = {"type": "blank", "extent": {"x": 1000, "y": 800}}
status, body = make(blank_ok, "blank-ok")
assert_status("blank: happy path returns 201", 201, status)
assert_json_field("blank: type round-trips", body, ["coordinateSystem", "type"], "blank")
BLANK_MAP = json_field(body, ["id"])

# Missing extent
status, _ = make({"type": "blank"})
assert_status("blank: missing extent 400", 400, status)

# extent not an object
status, _ = make({"type": "blank", "extent": "nope"})
assert_status("blank: non-object extent 400", 400, status)

# Missing extent.x / .y
status, _ = make({"type": "blank", "extent": {"y": 100}})
assert_status("blank: missing extent.x 400", 400, status)
status, _ = make({"type": "blank", "extent": {"x": 100}})
assert_status("blank: missing extent.y 400", 400, status)

# Non-positive extent
status, _ = make({"type": "blank", "extent": {"x": 0, "y": 100}})
assert_status("blank: zero extent.x 400", 400, status)
status, _ = make({"type": "blank", "extent": {"x": 100, "y": -1}})
assert_status("blank: negative extent.y 400", 400, status)

print("  All blank tests passed.")

# ─── Unknown type ────────────────────────────────────────────────────────────

print("  --- Unknown type ---")

status, _ = make({"type": "mercator-2"})
assert_status("unknown: type rejected", 400, status)

# Type field missing entirely (would fall back to default in caller; but
# if we explicitly pass an empty object as coordinateSystem, the validator
# fires)
status, _ = http_post(MAPS,
    {"title": "no-type", "coordinateSystem": {}}, TOKEN_A)
assert_status("unknown: missing type 400", 400, status)

print("  All unknown-type tests passed.")

# ─── Update path also validates ──────────────────────────────────────────────

print("  --- Update path ---")

# Update existing map with bad coordinate system → 400
status, _ = http_put(f"{MAPS}/{WGS_MAP}",
    {"coordinateSystem": {"type": "pixel"}}, TOKEN_A)
assert_status("update: bad pixel rejected", 400, status)

# Update with valid pixel works
status, _ = http_put(f"{MAPS}/{WGS_MAP}",
    {"coordinateSystem": pixel_ok}, TOKEN_A)
assert_status("update: valid pixel accepted", 200, status)
status, body = http_get(f"{MAPS}/{WGS_MAP}", TOKEN_A)
assert_json_field("update: type now pixel", body, ["coordinateSystem", "type"], "pixel")

# Update with bad blank rejected
status, _ = http_put(f"{MAPS}/{WGS_MAP}",
    {"coordinateSystem": {"type": "blank", "extent": {"x": 0, "y": 0}}}, TOKEN_A)
assert_status("update: bad blank rejected", 400, status)

print("  All update-path tests passed.")

sys.exit(0 if report() else 1)
