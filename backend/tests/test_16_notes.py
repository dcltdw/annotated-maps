#!/usr/bin/env python3
"""test_16_notes.py — Note CRUD attached to Nodes (Phase 2a.ii).

List/create nest under /maps/{mapId}/nodes/{nodeId}/notes; get/put/delete
sit under /maps/{mapId}/notes/{id}.
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

print("=== Note Tests ===")

# Two users in different tenants for cross-tenant checks.
TOKEN_A = register_user(f"t16_a_{RUN_ID}", f"t16_a_{RUN_ID}@test.com", "testpass123")
_, body_a = http_post("/auth/login",
    {"email": f"t16_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A = json_field(body_a, ["tenantId"])

TOKEN_B = register_user(f"t16_b_{RUN_ID}", f"t16_b_{RUN_ID}@test.com", "testpass123")
_, body_b = http_post("/auth/login",
    {"email": f"t16_b_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_B = json_field(body_b, ["tenantId"])

# Setup: A creates a map and two nodes.
_, body = http_post(f"/tenants/{TENANT_A}/maps", {"title": "Note Test Map"}, TOKEN_A)
MAP_A = json_field(body, ["id"])

_, body = http_post(f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes",
    {"name": "AnchorA"}, TOKEN_A)
NODE_A1 = json_field(body, ["id"])

_, body = http_post(f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes",
    {"name": "AnchorB"}, TOKEN_A)
NODE_A2 = json_field(body, ["id"])

LIST_BASE = f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes/{NODE_A1}/notes"
NOTE_BASE = f"/tenants/{TENANT_A}/maps/{MAP_A}/notes"

# ─── Create ──────────────────────────────────────────────────────────────────

print("  --- Create ---")

# Plain text-only note
status, body = http_post(LIST_BASE, {"text": "Plain note"}, TOKEN_A)
assert_status("create: text-only returns 201", 201, status)
NOTE1 = json_field(body, ["id"])
assert_json_field("create: text correct", body, ["text"], "Plain note")
assert_json_field("create: nodeId set",   body, ["nodeId"], str(NODE_A1))
assert_json_field("create: mapId derived", body, ["mapId"], str(MAP_A))
assert_json_field("create: pinned defaults to false", body, ["pinned"], False)
assert_json_field("create: canEdit true for creator", body, ["canEdit"], True)
assert_json_exists("create: createdByUsername present", body, ["createdByUsername"])

# Note with title and color
status, body = http_post(LIST_BASE, {
    "title": "Beware",
    "text": "Watch the bartender",
    "color": "#ff0000",
}, TOKEN_A)
assert_status("create: full note returns 201", 201, status)
NOTE2 = json_field(body, ["id"])
assert_json_field("create: color set", body, ["color"], "#ff0000")
assert_json_field("create: title set", body, ["title"], "Beware")

# Regression for #154: create-note must honor the `pinned` field
# (previously dropped — INSERT omitted the column, response hardcoded
# false, row landed at the schema default of FALSE).
status, body = http_post(LIST_BASE, {
    "text": "Pinned at creation",
    "pinned": True,
}, TOKEN_A)
assert_status("create: pinned=true returns 201", 201, status)
NOTE_PIN = json_field(body, ["id"])
assert_json_field("create: pinned=true reflected in response", body, ["pinned"], True)
# Round-trip through GET to confirm it's actually persisted, not just
# echoed in the create response.
status, body = http_get(f"{NOTE_BASE}/{NOTE_PIN}", TOKEN_A)
assert_status("create-pinned: GET returns 200", 200, status)
assert_json_field("create-pinned: pinned persisted in DB", body, ["pinned"], True)

# Validation: missing text
status, _ = http_post(LIST_BASE, {"title": "no text"}, TOKEN_A)
assert_status("create: missing text returns 400", 400, status)

# Validation: empty body
status, _ = http_post(LIST_BASE, {}, TOKEN_A)
assert_status("create: empty body returns 400", 400, status)

# Note attached to a different node on the same map
status, body = http_post(
    f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes/{NODE_A2}/notes",
    {"text": "Note on B"}, TOKEN_A)
assert_status("create: on second node returns 201", 201, status)
NOTE3 = json_field(body, ["id"])
assert_json_field("create: nodeId is second node", body, ["nodeId"], str(NODE_A2))

# Cross-tenant cannot create
status, _ = http_post(LIST_BASE, {"text": "hacked"}, TOKEN_B)
assert_status("create: cross-tenant blocked", 403, status)

# Non-existent node returns 403 (caller has no access to "this node on this map")
status, _ = http_post(
    f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes/9999999/notes",
    {"text": "orphan"}, TOKEN_A)
assert_status("create: non-existent node returns 403", 403, status)

print("  All create tests passed.")

# ─── List ────────────────────────────────────────────────────────────────────

print("  --- List ---")

status, body = http_get(LIST_BASE, TOKEN_A)
assert_status("list: returns 200", 200, status)
assert_true("list: returns array", isinstance(body, list))
assert_true("list: contains 3 notes on NODE_A1",
            len([n for n in body if n["nodeId"] == NODE_A1]) == 3)

# Note on NODE_A2 only shows under its own list
status, body = http_get(
    f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes/{NODE_A2}/notes", TOKEN_A)
assert_true("list: NODE_A2 has only its note", len(body) == 1)

# Cross-tenant cannot list
status, _ = http_get(LIST_BASE, TOKEN_B)
assert_status("list: cross-tenant blocked", 403, status)

print("  All list tests passed.")

# ─── Get ─────────────────────────────────────────────────────────────────────

print("  --- Get ---")

status, body = http_get(f"{NOTE_BASE}/{NOTE2}", TOKEN_A)
assert_status("get: returns 200", 200, status)
assert_json_field("get: text correct", body, ["text"], "Watch the bartender")
assert_json_exists("get: has createdAt", body, ["createdAt"])

# Cross-tenant blocked at the TenantFilter (returns 403 before the controller runs).
status, _ = http_get(f"{NOTE_BASE}/{NOTE2}", TOKEN_B)
assert_status("get: cross-tenant blocked", 403, status)

# Not found
status, _ = http_get(f"{NOTE_BASE}/9999999", TOKEN_A)
assert_status("get: missing returns 404", 404, status)

print("  All get tests passed.")

# ─── Update ──────────────────────────────────────────────────────────────────

print("  --- Update ---")

# Update text
status, _ = http_put(f"{NOTE_BASE}/{NOTE1}", {"text": "Updated text"}, TOKEN_A)
assert_status("update: text returns 200", 200, status)
status, body = http_get(f"{NOTE_BASE}/{NOTE1}", TOKEN_A)
assert_json_field("update: text persisted", body, ["text"], "Updated text")

# Update title
status, _ = http_put(f"{NOTE_BASE}/{NOTE1}", {"title": "New Title"}, TOKEN_A)
assert_status("update: title returns 200", 200, status)
status, body = http_get(f"{NOTE_BASE}/{NOTE1}", TOKEN_A)
assert_json_field("update: title persisted", body, ["title"], "New Title")

# Pin and unpin
status, _ = http_put(f"{NOTE_BASE}/{NOTE1}", {"pinned": True}, TOKEN_A)
assert_status("update: pin returns 200", 200, status)
status, body = http_get(f"{NOTE_BASE}/{NOTE1}", TOKEN_A)
assert_json_field("update: pinned persisted", body, ["pinned"], True)
status, _ = http_put(f"{NOTE_BASE}/{NOTE1}", {"pinned": False}, TOKEN_A)
status, body = http_get(f"{NOTE_BASE}/{NOTE1}", TOKEN_A)
assert_json_field("update: unpin persisted", body, ["pinned"], False)

# Cross-tenant blocked
status, _ = http_put(f"{NOTE_BASE}/{NOTE1}", {"text": "hacked"}, TOKEN_B)
assert_status("update: cross-tenant blocked", 403, status)

print("  All update tests passed.")

# ─── Pinned-first sort ──────────────────────────────────────────────────────

print("  --- Pinned-first sort ---")

# Pin NOTE2; list should put it first
http_put(f"{NOTE_BASE}/{NOTE2}", {"pinned": True}, TOKEN_A)
status, body = http_get(LIST_BASE, TOKEN_A)
assert_true("sort: pinned note appears first",
            len(body) >= 2 and body[0]["pinned"] is True)

print("  All sort tests passed.")

# ─── Delete ──────────────────────────────────────────────────────────────────

print("  --- Delete ---")

# Cross-tenant blocked
status, _ = http_delete(f"{NOTE_BASE}/{NOTE1}", TOKEN_B)
assert_status("delete: cross-tenant blocked", 403, status)

# Owner deletes
status, _ = http_delete(f"{NOTE_BASE}/{NOTE1}", TOKEN_A)
assert_status("delete: owner can delete", 204, status)
status, _ = http_get(f"{NOTE_BASE}/{NOTE1}", TOKEN_A)
assert_status("delete: note is gone", 404, status)

# Deleting the parent node CASCADES to remaining notes on it
status, _ = http_delete(f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes/{NODE_A1}", TOKEN_A)
assert_status("delete: parent node removal returns 204", 204, status)
status, _ = http_get(f"{NOTE_BASE}/{NOTE2}", TOKEN_A)
assert_status("delete: note cascaded with parent node", 404, status)

print("  All delete tests passed.")

sys.exit(0 if report() else 1)
