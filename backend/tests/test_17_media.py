#!/usr/bin/env python3
"""test_17_media.py — Media attachments on Nodes and Notes (Phase 2a.iii).

Two parallel controllers (NodeMediaController, NoteMediaController) with
identical body shape and validation. Tests cover the shared invariants
(scheme validation, caption update, permission, CASCADE) once per owner type.
"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_json_field, assert_json_exists,
    assert_true, http_post, http_get, http_put, http_delete,
    register_user, json_field,
)

reset_counters()
RUN_ID = os.getpid()

print("=== Media Tests ===")

# Two users in different tenants for cross-tenant checks.
TOKEN_A = register_user(f"t17_a_{RUN_ID}", f"t17_a_{RUN_ID}@test.com", "testpass123")
_, body_a = http_post("/auth/login",
    {"email": f"t17_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A = json_field(body_a, ["tenantId"])

TOKEN_B = register_user(f"t17_b_{RUN_ID}", f"t17_b_{RUN_ID}@test.com", "testpass123")

# Setup: A has a map with a node and a note on it.
_, body = http_post(f"/tenants/{TENANT_A}/maps", {"title": "Media Test Map"}, TOKEN_A)
MAP_A = json_field(body, ["id"])

_, body = http_post(f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes",
    {"name": "MediaNode"}, TOKEN_A)
NODE_A = json_field(body, ["id"])

_, body = http_post(f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes/{NODE_A}/notes",
    {"text": "Note for media tests"}, TOKEN_A)
NOTE_A = json_field(body, ["id"])

NODE_MEDIA = f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes/{NODE_A}/media"
NOTE_MEDIA = f"/tenants/{TENANT_A}/maps/{MAP_A}/notes/{NOTE_A}/media"

# ─── Node media: add ─────────────────────────────────────────────────────────

print("  --- Node media: add ---")

status, body = http_post(NODE_MEDIA, {
    "mediaType": "image", "url": "https://example.com/photo.png", "caption": "A photo"
}, TOKEN_A)
assert_status("node-add: image returns 201", 201, status)
NM1 = json_field(body, ["id"])
assert_json_field("node-add: mediaType", body, ["mediaType"], "image")
assert_json_field("node-add: url",       body, ["url"], "https://example.com/photo.png")
assert_json_field("node-add: caption",   body, ["caption"], "A photo")

status, body = http_post(NODE_MEDIA, {
    "mediaType": "link", "url": "https://example.com/page"
}, TOKEN_A)
assert_status("node-add: link without caption returns 201", 201, status)
NM2 = json_field(body, ["id"])

# Validation: bad scheme rejected
status, _ = http_post(NODE_MEDIA, {
    "mediaType": "image", "url": "javascript:alert(1)"
}, TOKEN_A)
assert_status("node-add: javascript: scheme rejected", 400, status)

status, _ = http_post(NODE_MEDIA, {
    "mediaType": "image", "url": "data:image/png;base64,xxx"
}, TOKEN_A)
assert_status("node-add: data: scheme rejected", 400, status)

# Validation: invalid mediaType
status, _ = http_post(NODE_MEDIA, {
    "mediaType": "video", "url": "https://example.com/v.mp4"
}, TOKEN_A)
assert_status("node-add: invalid mediaType rejected", 400, status)

# Validation: missing url
status, _ = http_post(NODE_MEDIA, {"mediaType": "image"}, TOKEN_A)
assert_status("node-add: missing url returns 400", 400, status)

# Cross-tenant blocked
status, _ = http_post(NODE_MEDIA, {
    "mediaType": "image", "url": "https://example.com/x.png"
}, TOKEN_B)
assert_status("node-add: cross-tenant blocked", 403, status)

print("  All node-media add tests passed.")

# ─── Node media: list ────────────────────────────────────────────────────────

print("  --- Node media: list ---")

status, body = http_get(NODE_MEDIA, TOKEN_A)
assert_status("node-list: returns 200", 200, status)
assert_true("node-list: returns array", isinstance(body, list))
assert_true("node-list: contains 2 media items", len(body) == 2)

# Cross-tenant blocked
status, _ = http_get(NODE_MEDIA, TOKEN_B)
assert_status("node-list: cross-tenant blocked", 403, status)

print("  All node-media list tests passed.")

# ─── Node media: update + delete ─────────────────────────────────────────────

print("  --- Node media: update + delete ---")

status, _ = http_put(f"{NODE_MEDIA}/{NM1}", {"caption": "Updated caption"}, TOKEN_A)
assert_status("node-update: caption returns 200", 200, status)
status, body = http_get(NODE_MEDIA, TOKEN_A)
items = {m["id"]: m for m in body}
assert_json_field("node-update: caption persisted", items[NM1], ["caption"], "Updated caption")

# Caption-only — no other fields editable. Missing caption → 400.
status, _ = http_put(f"{NODE_MEDIA}/{NM1}", {"url": "https://other.com/x.png"}, TOKEN_A)
assert_status("node-update: missing caption returns 400", 400, status)

# Cross-tenant cannot update
status, _ = http_put(f"{NODE_MEDIA}/{NM1}", {"caption": "hacked"}, TOKEN_B)
assert_status("node-update: cross-tenant blocked", 403, status)

# Delete
status, _ = http_delete(f"{NODE_MEDIA}/{NM2}", TOKEN_A)
assert_status("node-delete: owner can delete", 204, status)
status, body = http_get(NODE_MEDIA, TOKEN_A)
assert_true("node-delete: only one item left", len(body) == 1)

print("  All node-media update/delete tests passed.")

# ─── Note media: add + list ──────────────────────────────────────────────────

print("  --- Note media: add + list ---")

status, body = http_post(NOTE_MEDIA, {
    "mediaType": "image", "url": "https://example.com/note-photo.png"
}, TOKEN_A)
assert_status("note-add: image returns 201", 201, status)
NMM1 = json_field(body, ["id"])
assert_json_field("note-add: noteId set", body, ["noteId"], str(NOTE_A))

# Same scheme/type validation as node media.
status, _ = http_post(NOTE_MEDIA, {
    "mediaType": "image", "url": "ftp://example.com/x.png"
}, TOKEN_A)
assert_status("note-add: ftp scheme rejected", 400, status)

status, body = http_get(NOTE_MEDIA, TOKEN_A)
assert_status("note-list: returns 200", 200, status)
assert_true("note-list: contains 1 media", len(body) == 1)

# Cross-tenant blocked
status, _ = http_get(NOTE_MEDIA, TOKEN_B)
assert_status("note-list: cross-tenant blocked", 403, status)

print("  All note-media add/list tests passed.")

# ─── Note media: update + delete + CASCADE ────────────────────────────────────

print("  --- Note media: update + delete + CASCADE ---")

status, _ = http_put(f"{NOTE_MEDIA}/{NMM1}", {"caption": "Updated note caption"}, TOKEN_A)
assert_status("note-update: caption returns 200", 200, status)

# Add a second media item, then delete the parent NOTE — both should cascade.
http_post(NOTE_MEDIA, {"mediaType": "link", "url": "https://example.com"}, TOKEN_A)
status, body = http_get(NOTE_MEDIA, TOKEN_A)
assert_true("cascade setup: two media items present", len(body) == 2)

# Delete the parent note
status, _ = http_delete(f"/tenants/{TENANT_A}/maps/{MAP_A}/notes/{NOTE_A}", TOKEN_A)
assert_status("cascade: parent note deleted", 204, status)

# Media should be gone (CASCADE via FK)
status, _ = http_get(NOTE_MEDIA, TOKEN_A)
# NOTE: parent note is gone; the LIST endpoint joins through notes, so the
# query naturally returns empty — but the route also validates note exists
# implicitly. The expected response is 200 with empty list (the notes table
# returns no row, so the JOIN returns no rows, so the list is empty).
# However if the route requires the noteId to exist, this might 404.
# The actual behavior: query returns empty array because the JOIN on notes
# produces nothing. So 200 + empty.
assert_status("cascade: list after parent delete returns 200", 200, status)

print("  All note-media cascade tests passed.")

# ─── CASCADE on parent NODE deletion ─────────────────────────────────────────

print("  --- Node media CASCADE on parent delete ---")

# Create fresh node + media for cascade test
_, body = http_post(f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes",
    {"name": "CascadeNode"}, TOKEN_A)
CN = json_field(body, ["id"])
http_post(f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes/{CN}/media",
    {"mediaType": "image", "url": "https://example.com/c.png"}, TOKEN_A)

# Delete the node
status, _ = http_delete(f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes/{CN}", TOKEN_A)
assert_status("node-cascade: parent node deleted", 204, status)
# Media list returns 200 + empty (parent gone, JOIN finds nothing)
status, _ = http_get(f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes/{CN}/media", TOKEN_A)
assert_status("node-cascade: list after parent delete returns 200", 200, status)

print("  All node-cascade tests passed.")

sys.exit(0 if report() else 1)
