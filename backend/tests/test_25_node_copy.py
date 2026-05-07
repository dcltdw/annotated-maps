#!/usr/bin/env python3
"""test_25_node_copy.py — Phase 2e.b (#100): node copy endpoint.

Covers:
  - Single-node copy (degenerate subtree of size 1)
  - 3-level subtree copy: parent-child relationships rewired correctly
  - Cross-map (same tenant) — non-admin allowed; visibility tags + plot
    memberships NOT carried over to copies
  - Cross-tenant — admin in BOTH tenants required
  - Notes attached to copied nodes are duplicated with reset created_by /
    created_at, no note_visibility carry-over
  - Audit log emits node_copy event with descendantCount + newRootId
  - Sources unaffected by the copy (no in-place mutation)
"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_json_field, assert_true,
    http_post, http_get, http_delete,
    register_user, json_field, mysql_query,
)

reset_counters()
RUN_ID = os.getpid()

print("=== Node Copy Tests ===")

# ─── Setup ───────────────────────────────────────────────────────────────────

TOKEN_A = register_user(f"t25_a_{RUN_ID}", f"t25_a_{RUN_ID}@test.com", "testpass123")
_, body_a = http_post("/auth/login",
    {"email": f"t25_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A   = json_field(body_a, ["tenantId"])
USER_A_ID  = json_field(body_a, ["user", "id"])

TOKEN_B = register_user(f"t25_b_{RUN_ID}", f"t25_b_{RUN_ID}@test.com", "testpass123")
_, body_b = http_post("/auth/login",
    {"email": f"t25_b_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_B  = json_field(body_b, ["tenantId"])
USER_B_ID = json_field(body_b, ["user", "id"])

# B as same-org editor of TENANT_A
A_ORG_ID = mysql_query(f"SELECT org_id FROM users WHERE id={USER_A_ID};")
mysql_query(f"UPDATE users SET org_id={A_ORG_ID} WHERE id={USER_B_ID};")
mysql_query(
    f"INSERT INTO tenant_members (tenant_id, user_id, role) "
    f"VALUES ({TENANT_A}, {USER_B_ID}, 'editor');")

def mkmap(tenant, token, title):
    _, b = http_post(f"/tenants/{tenant}/maps", {
        "title": title,
        "coordinateSystem": {"type": "wgs84", "center": {"lat":0,"lng":0}, "zoom": 3},
    }, token)
    return json_field(b, ["id"])

MAP_1 = mkmap(TENANT_A, TOKEN_A, "Source Map")
MAP_2 = mkmap(TENANT_A, TOKEN_A, "Target Map")
MAP_B = mkmap(TENANT_B, TOKEN_B, "Other Tenant Map")

mysql_query(
    f"INSERT INTO map_permissions (map_id, user_id, level) "
    f"VALUES ({MAP_1}, {USER_B_ID}, 'edit'), "
    f"       ({MAP_2}, {USER_B_ID}, 'edit');")

NODES_M1 = f"/tenants/{TENANT_A}/maps/{MAP_1}/nodes"
NODES_M2 = f"/tenants/{TENANT_A}/maps/{MAP_2}/nodes"
NODES_MB = f"/tenants/{TENANT_B}/maps/{MAP_B}/nodes"

def mknode(base, token, name, parent_id=None, geo=None, color=None, description=None):
    body_in = {"name": name}
    if parent_id is not None:
        body_in["parentId"] = parent_id
    if geo is not None:
        body_in["geoJson"] = geo
    if color is not None:
        body_in["color"] = color
    if description is not None:
        body_in["description"] = description
    _, b = http_post(base, body_in, token)
    return json_field(b, ["id"])

VG_BASE = f"/tenants/{TENANT_A}/visibility-groups"
_, body = http_post(VG_BASE, {"name": "Players"}, TOKEN_A)
G_PLAYERS = json_field(body, ["id"])

# ─── Single-node copy ────────────────────────────────────────────────────────

print("  --- Single-node copy ---")

LONE = mknode(NODES_M1, TOKEN_A, "Lone",
              geo={"type":"Point","coordinates":[1.0, 2.0]},
              color="#aabbcc", description="solo")
status, body = http_post(f"{NODES_M1}/{LONE}/copy",
                          {"newParentId": None}, TOKEN_A)
assert_status("single: copy returns 201", 201, status)
LONE_COPY = body["id"]
assert_true("single: new id different from source", LONE_COPY != LONE)
assert_json_field("single: descendantCount = 1", body, ["descendantCount"], "1")
assert_json_field("single: parentId null",       body, ["parentId"], "None")
assert_json_field("single: mapId same",          body, ["mapId"], str(MAP_1))

# Verify copy fields match source where applicable
status, copyBody = http_get(f"{NODES_M1}/{LONE_COPY}", TOKEN_A)
assert_json_field("single: name copied",        copyBody, ["name"], "Lone")
assert_json_field("single: color copied",       copyBody, ["color"], "#aabbcc")
assert_json_field("single: description copied", copyBody, ["description"], "solo")
assert_json_field("single: createdBy = caller", copyBody, ["createdBy"], str(USER_A_ID))

# Source unchanged
status, srcBody = http_get(f"{NODES_M1}/{LONE}", TOKEN_A)
assert_json_field("single: source name unchanged", srcBody, ["name"], "Lone")

print("  All single-node tests passed.")

# ─── 3-level subtree copy ────────────────────────────────────────────────────

print("  --- 3-level subtree copy ---")

ROOT  = mknode(NODES_M1, TOKEN_A, "Root")
A     = mknode(NODES_M1, TOKEN_A, "A", ROOT)
B_    = mknode(NODES_M1, TOKEN_A, "B", A)
C_    = mknode(NODES_M1, TOKEN_A, "C", A)
D_    = mknode(NODES_M1, TOKEN_A, "D", B_)
SOURCE_SET = {ROOT, A, B_, C_, D_}

# Tag ROOT with Players (should NOT carry to copy)
http_post(f"{NODES_M1}/{ROOT}/visibility",
          {"override": True, "groupIds": [G_PLAYERS]}, TOKEN_A)

# Attach ROOT to a plot (membership should NOT carry to copy)
_, body = http_post(f"/tenants/{TENANT_A}/plots", {"name": "Test"}, TOKEN_A)
PLOT = json_field(body, ["id"])
http_post(f"/tenants/{TENANT_A}/plots/{PLOT}/nodes",
          {"nodeId": ROOT}, TOKEN_A)

# Copy ROOT subtree as a top-level on the same map
status, body = http_post(f"{NODES_M1}/{ROOT}/copy",
                          {"newParentId": None}, TOKEN_A)
assert_status("3-level: copy returns 201", 201, status)
ROOT_COPY = body["id"]
assert_json_field("3-level: descendantCount = 5",
                  body, ["descendantCount"], "5")

# Find all the copies. We can do this by fetching the subtree of ROOT_COPY.
status, body = http_get(f"{NODES_M1}/{ROOT_COPY}/subtree", TOKEN_A)
copies_by_name = {n["name"]: n for n in body["nodes"]}
assert_true("3-level: subtree has 5 copies",
            len(copies_by_name) == 5)
assert_true("3-level: all expected names present",
            set(copies_by_name.keys()) == {"Root", "A", "B", "C", "D"})

# Verify parent-child relationships in the copy:
#   Root_copy: parentId null, depth 0
#   A_copy:    parent is Root_copy, depth 1
#   B_copy, C_copy: parent is A_copy, depth 2
#   D_copy:    parent is B_copy, depth 3
assert_true("3-level: root_copy depth = 0", copies_by_name["Root"]["depth"] == 0)
assert_true("3-level: a_copy depth = 1",    copies_by_name["A"]["depth"] == 1)
assert_true("3-level: b_copy depth = 2",    copies_by_name["B"]["depth"] == 2)
assert_true("3-level: c_copy depth = 2",    copies_by_name["C"]["depth"] == 2)
assert_true("3-level: d_copy depth = 3",    copies_by_name["D"]["depth"] == 3)

A_copy_id    = copies_by_name["A"]["id"]
B_copy_id    = copies_by_name["B"]["id"]
ROOT_copy_id = copies_by_name["Root"]["id"]
assert_true("3-level: A's parent is Root_copy",
            copies_by_name["A"]["parentId"] == ROOT_copy_id)
assert_true("3-level: B's parent is A_copy",
            copies_by_name["B"]["parentId"] == A_copy_id)
assert_true("3-level: D's parent is B_copy",
            copies_by_name["D"]["parentId"] == B_copy_id)

# All copy ids are NEW (disjoint from source ids)
copy_ids = {n["id"] for n in body["nodes"]}
assert_true("3-level: copy ids disjoint from source ids",
            copy_ids.isdisjoint(SOURCE_SET))

# Visibility tags on Root_copy should be empty (not carried over)
status, body = http_get(f"{NODES_M1}/{ROOT_copy_id}/visibility", TOKEN_A)
assert_true("3-level: visibility tags NOT carried over",
            body["override"] is False and body["groupIds"] == [])

# Plot membership NOT carried over: the plot should still only contain
# the original ROOT, not ROOT_copy.
status, body = http_get(f"/tenants/{TENANT_A}/plots/{PLOT}/members", TOKEN_A)
plot_node_ids = {n["id"] for n in body["nodes"]}
assert_true("3-level: plot membership NOT duplicated",
            ROOT in plot_node_ids and ROOT_copy_id not in plot_node_ids)

# Source untouched
status, srcBody = http_get(f"{NODES_M1}/{ROOT}", TOKEN_A)
assert_json_field("3-level: source unchanged", srcBody, ["name"], "Root")

print("  All 3-level tests passed.")

# ─── Notes follow (duplicated with reset created_by/created_at) ──────────────

print("  --- Notes are duplicated ---")

NOTE_HOST = mknode(NODES_M1, TOKEN_A, "NoteHost")
_, b = http_post(f"{NODES_M1}/{NOTE_HOST}/notes",
                 {"title": "Original", "text": "hello"}, TOKEN_A)
NOTE_ID = json_field(b, ["id"])
# Tag the note with Players (should NOT carry to copy per same logic)
http_post(f"/tenants/{TENANT_A}/maps/{MAP_1}/notes/{NOTE_ID}/visibility",
          {"override": True, "groupIds": [G_PLAYERS]}, TOKEN_A)

status, body = http_post(f"{NODES_M1}/{NOTE_HOST}/copy",
                          {"newParentId": None}, TOKEN_A)
NOTE_HOST_COPY = body["id"]

# Find the copied note
status, body = http_get(f"{NODES_M1}/{NOTE_HOST_COPY}/notes", TOKEN_A)
assert_true("notes: 1 note attached to copy", len(body) == 1)
NOTE_COPY = body[0]["id"]
assert_true("notes: new note id != source",   NOTE_COPY != NOTE_ID)
assert_json_field("notes: title copied",      body[0], ["title"], "Original")
assert_json_field("notes: text copied",       body[0], ["text"],  "hello")
assert_json_field("notes: createdBy = caller", body[0], ["createdBy"], str(USER_A_ID))

# Note visibility tags on the COPY should be empty
status, body = http_get(f"/tenants/{TENANT_A}/maps/{MAP_1}/notes/{NOTE_COPY}/visibility", TOKEN_A)
assert_true("notes: visibility NOT carried over",
            body["override"] is False and body["groupIds"] == [])

# Original note untouched
status, body = http_get(f"/tenants/{TENANT_A}/maps/{MAP_1}/notes/{NOTE_ID}", TOKEN_A)
assert_json_field("notes: source note still has its title",
                  body, ["title"], "Original")

print("  All notes-duplication tests passed.")

# ─── Cross-map (same tenant) ─────────────────────────────────────────────────

print("  --- Cross-map (same tenant) ---")

# Build a small subtree on MAP_1, copy it to MAP_2 as a top-level
SRC = mknode(NODES_M1, TOKEN_A, "CrossMapSrc")
SUB = mknode(NODES_M1, TOKEN_A, "CrossMapSub", SRC)

status, body = http_post(f"{NODES_M1}/{SRC}/copy",
                          {"newParentId": None, "newMapId": MAP_2}, TOKEN_A)
assert_status("cross-map: copy returns 201", 201, status)
SRC_COPY = body["id"]
assert_json_field("cross-map: copy is on MAP_2", body, ["mapId"], str(MAP_2))

# Source still on MAP_1
status, _ = http_get(f"{NODES_M1}/{SRC}", TOKEN_A)
assert_status("cross-map: source still on MAP_1", 200, status)

# Copy on MAP_2 + has 1 descendant
status, body = http_get(f"{NODES_M2}/{SRC_COPY}/subtree", TOKEN_A)
assert_true("cross-map: copy has 2 nodes (root + sub)",
            len(body["nodes"]) == 2)

# Non-admin (B) can do same-tenant cross-map copies
SRC_B = mknode(NODES_M1, TOKEN_A, "ForB")
status, _ = http_post(f"{NODES_M1}/{SRC_B}/copy",
                      {"newMapId": MAP_2}, TOKEN_B)
assert_status("cross-map: non-admin allowed", 201, status)

print("  All cross-map tests passed.")

# ─── Cross-tenant ────────────────────────────────────────────────────────────

print("  --- Cross-tenant ---")

# B (editor of TENANT_A, not admin) tries cross-tenant — fails
SRC_X = mknode(NODES_M2, TOKEN_A, "ForXtenant")
status, _ = http_post(f"{NODES_M2}/{SRC_X}/copy",
                      {"newMapId": MAP_B}, TOKEN_B)
assert_status("cross-tenant: non-admin rejected", 403, status)

# A (admin of TENANT_A but not member of TENANT_B) — fails (no edit access)
status, _ = http_post(f"{NODES_M2}/{SRC_X}/copy",
                      {"newMapId": MAP_B}, TOKEN_A)
assert_true("cross-tenant: admin without dest membership rejected",
            status in (400, 403))

# Make A admin of TENANT_B too
mysql_query(
    f"INSERT INTO tenant_members (tenant_id, user_id, role) "
    f"VALUES ({TENANT_B}, {USER_A_ID}, 'admin');")
mysql_query(
    f"INSERT INTO map_permissions (map_id, user_id, level) "
    f"VALUES ({MAP_B}, {USER_A_ID}, 'admin');")

status, body = http_post(f"{NODES_M2}/{SRC_X}/copy",
                          {"newMapId": MAP_B}, TOKEN_A)
assert_status("cross-tenant: admin-in-both succeeds", 201, status)
SRC_X_COPY = body["id"]
assert_json_field("cross-tenant: copy on MAP_B",
                  body, ["mapId"], str(MAP_B))

# Source on TENANT_A still there
status, _ = http_get(f"{NODES_M2}/{SRC_X}", TOKEN_A)
assert_status("cross-tenant: source still on TENANT_A", 200, status)

print("  All cross-tenant tests passed.")

# ─── Audit log ───────────────────────────────────────────────────────────────

print("  --- Audit log ---")

audit_count = mysql_query(
    "SELECT COUNT(*) FROM audit_log WHERE event_type = 'node_copy';")
assert_true("audit: node_copy events recorded",
            int(audit_count) > 0)

# Latest event should have descendantCount + newRootId in detail
detail_dc = mysql_query(
    "SELECT JSON_EXTRACT(detail, '$.descendantCount') FROM audit_log "
    "WHERE event_type = 'node_copy' ORDER BY id DESC LIMIT 1;")
detail_root = mysql_query(
    "SELECT JSON_EXTRACT(detail, '$.newRootId') FROM audit_log "
    "WHERE event_type = 'node_copy' ORDER BY id DESC LIMIT 1;")
assert_true("audit: detail includes descendantCount",
            detail_dc != "" and detail_dc != "NULL")
assert_true("audit: detail includes newRootId",
            detail_root != "" and detail_root != "NULL")

print("  All audit-log tests passed.")

# ─── Validation ──────────────────────────────────────────────────────────────

print("  --- Validation ---")

# Empty body
status, _ = http_post(f"{NODES_M1}/{LONE}/copy", {}, TOKEN_A)
assert_status("validate: missing both fields 400", 400, status)

# Non-int newParentId
status, _ = http_post(f"{NODES_M1}/{LONE}/copy",
                      {"newParentId": "x"}, TOKEN_A)
assert_status("validate: non-int newParentId 400", 400, status)

# newParentId on different map
WRONG = mknode(NODES_M2, TOKEN_A, "WrongMap")
status, _ = http_post(f"{NODES_M1}/{LONE}/copy",
                      {"newParentId": WRONG}, TOKEN_A)
assert_status("validate: newParentId on different map 400", 400, status)

# Cross-tenant attempt by stranger (not a member)
TOKEN_X = register_user(f"t25_x_{RUN_ID}", f"t25_x_{RUN_ID}@test.com", "testpass123")
status, _ = http_post(f"{NODES_M1}/{LONE}/copy", {}, TOKEN_X)
assert_status("validate: stranger blocked at TenantFilter", 403, status)

# Self-as-newParent is VALID for copy (not a cycle since copy has new ids)
SELF_TEST = mknode(NODES_M1, TOKEN_A, "SelfTest")
status, _ = http_post(f"{NODES_M1}/{SELF_TEST}/copy",
                      {"newParentId": SELF_TEST}, TOKEN_A)
assert_status("validate: copy under self is allowed", 201, status)

print("  All validation tests passed.")

sys.exit(0 if report() else 1)
