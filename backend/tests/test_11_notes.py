#!/usr/bin/env python3
"""test_11_notes.py — Notes CRUD tests"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_json_field, assert_json_exists,
    http_post, http_get, http_put, http_delete, register_user, json_field
)

reset_counters()
RUN_ID = os.getpid()

print("=== Notes Tests ===")

# Setup: user + tenant + map
TOKEN = register_user(f"t11_{RUN_ID}", f"t11_{RUN_ID}@test.com", "testpass123")
_, body = http_post("/auth/login", {"email": f"t11_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_ID = json_field(body, ["tenantId"])

_, body = http_post(f"/tenants/{TENANT_ID}/maps", {"title": "Notes Map"}, TOKEN)
MAP_ID = json_field(body, ["id"])

BASE = f"/tenants/{TENANT_ID}/maps/{MAP_ID}/notes"

# ─── Create note ──────────────────────────────────────────────────────────────

print("  --- Create ---")

status, body = http_post(BASE, {
    "lat": 40.7128, "lng": -74.006, "title": "HQ", "text": "Main office location"
}, TOKEN)
assert_status("create: valid note returns 201", 201, status)
NOTE_ID = json_field(body, ["id"])
assert_json_field("create: lat correct", body, ["lat"], 40.7128)
assert_json_field("create: text correct", body, ["text"], "Main office location")
assert_json_field("create: title correct", body, ["title"], "HQ")
assert_json_field("create: pinned defaults to false", body, ["pinned"], False)
assert_json_field("create: canEdit is true for creator", body, ["canEdit"], True)

# Without title (optional)
status, body = http_post(BASE, {
    "lat": 40.714, "lng": -74.002, "text": "No title note"
}, TOKEN)
assert_status("create: note without title returns 201", 201, status)
NOTE_ID_2 = json_field(body, ["id"])

# Missing required fields
status, _ = http_post(BASE, {"lat": 40.0, "lng": -74.0}, TOKEN)
assert_status("create: missing text returns 400", 400, status)

status, _ = http_post(BASE, {"text": "no coords"}, TOKEN)
assert_status("create: missing lat/lng returns 400", 400, status)

status, _ = http_post(BASE, {}, TOKEN)
assert_status("create: empty body returns 400", 400, status)

print("  All create tests passed.")

# ─── List notes ───────────────────────────────────────────────────────────────

print("  --- List ---")

status, body = http_get(BASE, TOKEN)
assert_status("list: returns 200", 200, status)
assert_true_imported = len(body) >= 2 if isinstance(body, list) else False
from helpers import assert_true
assert_true("list: contains at least 2 notes", isinstance(body, list) and len(body) >= 2)

print("  All list tests passed.")

# ─── Get note ─────────────────────────────────────────────────────────────────

print("  --- Get ---")

status, body = http_get(f"{BASE}/{NOTE_ID}", TOKEN)
assert_status("get: returns 200", 200, status)
assert_json_field("get: text correct", body, ["text"], "Main office location")
assert_json_exists("get: has createdAt", body, ["createdAt"])
assert_json_exists("get: has createdByUsername", body, ["createdByUsername"])

print("  All get tests passed.")

# ─── Update note ──────────────────────────────────────────────────────────────

print("  --- Update ---")

status, body = http_put(f"{BASE}/{NOTE_ID}", {"text": "Updated location info"}, TOKEN)
assert_status("update: creator can update", 200, status)

# Verify update took effect
status, body = http_get(f"{BASE}/{NOTE_ID}", TOKEN)
assert_json_field("update: text changed", body, ["text"], "Updated location info")

# Update title only
status, _ = http_put(f"{BASE}/{NOTE_ID}", {"title": "New HQ"}, TOKEN)
assert_status("update: title only returns 200", 200, status)

print("  All update tests passed.")

# ─── Cross-org isolation ──────────────────────────────────────────────────────

print("  --- Cross-org isolation ---")

TOKEN_B = register_user(f"t11_b_{RUN_ID}", f"t11_b_{RUN_ID}@test.com", "testpass123")

# Other org user cannot list notes
status, _ = http_get(BASE, TOKEN_B)
assert_status("isolation: cross-org cannot list notes", 403, status)

# Other org user cannot create a note
status, _ = http_post(BASE, {"lat": 0, "lng": 0, "text": "hacked"}, TOKEN_B)
assert_status("isolation: cross-org cannot create note", 403, status)

# Other org user cannot read a note
status, _ = http_get(f"{BASE}/{NOTE_ID}", TOKEN_B)
assert_status("isolation: cross-org cannot get note", 403, status)

# Other org user cannot update a note
status, _ = http_put(f"{BASE}/{NOTE_ID}", {"text": "hacked"}, TOKEN_B)
assert_status("isolation: cross-org cannot update note", 403, status)

# Other org user cannot delete a note
status, _ = http_delete(f"{BASE}/{NOTE_ID}", TOKEN_B)
assert_status("isolation: cross-org cannot delete note", 403, status)

print("  All cross-org isolation tests passed.")

# ─── Delete note ──────────────────────────────────────────────────────────────

print("  --- Delete ---")

status, _ = http_delete(f"{BASE}/{NOTE_ID_2}", TOKEN)
assert_status("delete: creator can delete", 204, status)

status, _ = http_get(f"{BASE}/{NOTE_ID_2}", TOKEN)
assert_status("delete: note is gone", 404, status)

# Delete the other note too
status, _ = http_delete(f"{BASE}/{NOTE_ID}", TOKEN)
assert_status("delete: second note deleted", 204, status)

print("  All delete tests passed.")

sys.exit(0 if report() else 1)
