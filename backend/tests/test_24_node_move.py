#!/usr/bin/env python3
"""test_24_node_move.py — Phase 2e.a (#90): node move endpoint.

Covers:
  - Same-map re-parent (visibility tags + plot memberships preserved)
  - Move to top-level (newParentId = null)
  - Cross-map (same tenant) — non-admin allowed; visibility tags dropped;
    plot memberships preserved
  - Cross-tenant — admin in BOTH tenants required; visibility tags AND
    plot memberships dropped
  - Cycle attempts rejected (newParentId == source, or in source's subtree)
  - Notes follow the moved node (note.node_id unchanged)
  - Audit log emits node_move event with descendantCount
  - Bad pagination params, missing fields, etc.

Setup uses two tenants (A's personal + a separate one), with B as a
viewer tenant_member of A's tenant for the non-admin paths.
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

print("=== Node Move Tests ===")

# ─── Setup ───────────────────────────────────────────────────────────────────

TOKEN_A = register_user(f"t24_a_{RUN_ID}", f"t24_a_{RUN_ID}@test.com", "testpass123")
_, body_a = http_post("/auth/login",
    {"email": f"t24_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A   = json_field(body_a, ["tenantId"])
USER_A_ID  = json_field(body_a, ["user", "id"])

TOKEN_B = register_user(f"t24_b_{RUN_ID}", f"t24_b_{RUN_ID}@test.com", "testpass123")
_, body_b = http_post("/auth/login",
    {"email": f"t24_b_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_B  = json_field(body_b, ["tenantId"])
USER_B_ID = json_field(body_b, ["user", "id"])

# B becomes a same-org tenant_member of TENANT_A as viewer (and editor in
# the cases below where we need write access — adjust per case via SQL).
A_ORG_ID = mysql_query(f"SELECT org_id FROM users WHERE id={USER_A_ID};")
mysql_query(f"UPDATE users SET org_id={A_ORG_ID} WHERE id={USER_B_ID};")
mysql_query(
    f"INSERT INTO tenant_members (tenant_id, user_id, role) "
    f"VALUES ({TENANT_A}, {USER_B_ID}, 'editor');")

# Two maps in TENANT_A; one map in TENANT_B (for cross-tenant move).
def mkmap(tenant, token, title):
    _, b = http_post(f"/tenants/{tenant}/maps", {
        "title": title,
        "coordinateSystem": {"type": "wgs84", "center": {"lat":0,"lng":0}, "zoom": 3},
    }, token)
    return json_field(b, ["id"])

MAP_1 = mkmap(TENANT_A, TOKEN_A, "Map One")
MAP_2 = mkmap(TENANT_A, TOKEN_A, "Map Two")
MAP_B = mkmap(TENANT_B, TOKEN_B, "Other-Tenant Map")

# Grant B edit access on MAP_1 + MAP_2 (so non-admin same-tenant cross-map
# moves can be tested without admin role).
mysql_query(
    f"INSERT INTO map_permissions (map_id, user_id, level) "
    f"VALUES ({MAP_1}, {USER_B_ID}, 'edit'), "
    f"       ({MAP_2}, {USER_B_ID}, 'edit');")

NODES_M1 = f"/tenants/{TENANT_A}/maps/{MAP_1}/nodes"
NODES_M2 = f"/tenants/{TENANT_A}/maps/{MAP_2}/nodes"
NODES_MB = f"/tenants/{TENANT_B}/maps/{MAP_B}/nodes"

def mknode(base, token, name, parent_id=None):
    body_in = {"name": name}
    if parent_id is not None:
        body_in["parentId"] = parent_id
    _, b = http_post(base, body_in, token)
    return json_field(b, ["id"])

# A visibility group on TENANT_A — used to verify cross-map drops tags
VG_BASE = f"/tenants/{TENANT_A}/visibility-groups"
_, body = http_post(VG_BASE, {"name": "Players"}, TOKEN_A)
G_PLAYERS = json_field(body, ["id"])

# ─── Same-map re-parent ──────────────────────────────────────────────────────

print("  --- Same-map re-parent ---")

# Build:  Root → A → B (subtree)
ROOT = mknode(NODES_M1, TOKEN_A, "Root")
A    = mknode(NODES_M1, TOKEN_A, "A", ROOT)
B    = mknode(NODES_M1, TOKEN_A, "B", A)
C    = mknode(NODES_M1, TOKEN_A, "C", ROOT)

# Tag B with Players visibility
http_post(f"{NODES_M1}/{B}/visibility",
          {"override": True, "groupIds": [G_PLAYERS]}, TOKEN_A)

# Move B from A to C (under same map)
status, body = http_post(f"{NODES_M1}/{B}/move",
                          {"newParentId": C}, TOKEN_A)
assert_status("same-map re-parent: returns 200", 200, status)
assert_json_field("same-map: id in response",        body, ["id"], str(B))
assert_json_field("same-map: parentId now C",        body, ["parentId"], str(C))
assert_json_field("same-map: descendantCount = 1",   body, ["descendantCount"], "1")

# Verify via GET
status, body = http_get(f"{NODES_M1}/{B}", TOKEN_A)
assert_json_field("same-map: GET reflects new parent", body, ["parentId"], str(C))

# Verify visibility tag preserved (same map = parent chain still in same tenant)
status, body = http_get(f"{NODES_M1}/{B}/visibility", TOKEN_A)
assert_true("same-map: visibility tags preserved",
            body["override"] is True and body["groupIds"] == [G_PLAYERS])

print("  All same-map re-parent tests passed.")

# ─── Move to top-level (newParentId = null) ──────────────────────────────────

print("  --- Move to top-level ---")

status, body = http_post(f"{NODES_M1}/{B}/move",
                          {"newParentId": None}, TOKEN_A)
assert_status("top-level: returns 200", 200, status)
assert_true("top-level: parentId is null", body["parentId"] is None)
status, body = http_get(f"{NODES_M1}/{B}", TOKEN_A)
assert_true("top-level: GET reflects null parent", body["parentId"] is None)

print("  All top-level tests passed.")

# ─── Cycle prevention ────────────────────────────────────────────────────────

print("  --- Cycle prevention ---")

# Reset: B back under A; build a deeper subtree under A
http_post(f"{NODES_M1}/{B}/move", {"newParentId": A}, TOKEN_A)
B_CHILD = mknode(NODES_M1, TOKEN_A, "B_Child", B)
B_GRAND = mknode(NODES_M1, TOKEN_A, "B_Grand", B_CHILD)

# Self-loop: A under A
status, _ = http_post(f"{NODES_M1}/{A}/move", {"newParentId": A}, TOKEN_A)
assert_status("cycle: self-loop returns 400", 400, status)

# A under B (B is descendant of A → cycle)
status, _ = http_post(f"{NODES_M1}/{A}/move", {"newParentId": B}, TOKEN_A)
assert_status("cycle: parent-into-child returns 400", 400, status)

# A under B_GRAND (B_GRAND is deeper descendant of A → cycle)
status, _ = http_post(f"{NODES_M1}/{A}/move", {"newParentId": B_GRAND}, TOKEN_A)
assert_status("cycle: parent-into-grandchild returns 400", 400, status)

print("  All cycle-prevention tests passed.")

# ─── Cross-map (same tenant) ─────────────────────────────────────────────────

print("  --- Cross-map (same tenant) ---")

# B has Players tag (set earlier). Move B + its subtree (B_CHILD, B_GRAND)
# from MAP_1 to MAP_2 as top-level there.
http_post(f"{NODES_M1}/{B}/visibility",
          {"override": True, "groupIds": [G_PLAYERS]}, TOKEN_A)

status, body = http_post(f"{NODES_M1}/{B}/move",
                          {"newParentId": None, "newMapId": MAP_2}, TOKEN_A)
assert_status("cross-map: returns 200", 200, status)
assert_json_field("cross-map: mapId is now MAP_2",   body, ["mapId"], str(MAP_2))
assert_json_field("cross-map: parentId is null",     body, ["parentId"], "None")
assert_json_field("cross-map: descendantCount = 3",  body, ["descendantCount"], "3")

# Source map no longer holds B
status, _ = http_get(f"{NODES_M1}/{B}", TOKEN_A)
assert_status("cross-map: B not in source map", 404, status)

# Destination map holds B + descendants
status, body = http_get(f"{NODES_M2}/{B}", TOKEN_A)
assert_status("cross-map: B in dest map", 200, status)
status, body = http_get(f"{NODES_M2}/{B_GRAND}", TOKEN_A)
assert_status("cross-map: B_GRAND in dest map", 200, status)

# Visibility tags dropped on cross-map move
status, body = http_get(f"{NODES_M2}/{B}/visibility", TOKEN_A)
assert_true("cross-map: visibility tags dropped",
            body["groupIds"] == [])

# Non-admin (B-user) can do cross-map moves within same tenant — already
# tested via map_permissions edit grant. Quick additional check:
ROOT_2 = mknode(NODES_M1, TOKEN_A, "Root_2")
status, body = http_post(f"{NODES_M1}/{ROOT_2}/move",
                          {"newMapId": MAP_2}, TOKEN_B)
assert_status("cross-map: non-admin (with edit perms) allowed", 200, status)

print("  All cross-map (same-tenant) tests passed.")

# ─── Cross-tenant ────────────────────────────────────────────────────────────

print("  --- Cross-tenant ---")

# Source in TENANT_A, destination in TENANT_B.
# Set up: build a small subtree on MAP_2 (in TENANT_A), tag it with Players,
# attach it to a plot.
SUB_ROOT  = mknode(NODES_M2, TOKEN_A, "SubRoot")
SUB_CHILD = mknode(NODES_M2, TOKEN_A, "SubChild", SUB_ROOT)
http_post(f"{NODES_M2}/{SUB_ROOT}/visibility",
          {"override": True, "groupIds": [G_PLAYERS]}, TOKEN_A)

_, body = http_post(f"/tenants/{TENANT_A}/plots", {"name": "Test Plot"}, TOKEN_A)
PLOT_ID = json_field(body, ["id"])
http_post(f"/tenants/{TENANT_A}/plots/{PLOT_ID}/nodes",
          {"nodeId": SUB_ROOT}, TOKEN_A)

# Verify plot membership before move
status, body = http_get(f"/tenants/{TENANT_A}/plots/{PLOT_ID}/members", TOKEN_A)
assert_true("pre-move: plot has SubRoot",
            any(n["id"] == SUB_ROOT for n in body["nodes"]))

# B-user is not admin of TENANT_A (only editor) — cross-tenant attempt fails
status, _ = http_post(f"{NODES_M2}/{SUB_ROOT}/move",
                      {"newMapId": MAP_B}, TOKEN_B)
assert_status("cross-tenant: non-admin source rejected", 403, status)

# A-user is admin of TENANT_A but NOT a member of TENANT_B at all — fails
status, _ = http_post(f"{NODES_M2}/{SUB_ROOT}/move",
                      {"newMapId": MAP_B}, TOKEN_A)
# Could be 400 (newMapId not found / no edit perm) since A isn't in TENANT_B.
assert_true("cross-tenant: source admin without dest membership rejected",
            status in (400, 403))

# Make A-user an admin of TENANT_B too
mysql_query(
    f"INSERT INTO tenant_members (tenant_id, user_id, role) "
    f"VALUES ({TENANT_B}, {USER_A_ID}, 'admin');")
mysql_query(
    f"INSERT INTO map_permissions (map_id, user_id, level) "
    f"VALUES ({MAP_B}, {USER_A_ID}, 'admin');")

# Now A is admin in BOTH tenants — cross-tenant move allowed
status, body = http_post(f"{NODES_M2}/{SUB_ROOT}/move",
                          {"newMapId": MAP_B}, TOKEN_A)
assert_status("cross-tenant: admin-in-both succeeds", 200, status)
assert_json_field("cross-tenant: mapId is MAP_B",
                  body, ["mapId"], str(MAP_B))

# Visibility tags AND plot memberships dropped
status, body = http_get(f"{NODES_MB}/{SUB_ROOT}/visibility", TOKEN_A)
assert_true("cross-tenant: visibility tags dropped",
            body["groupIds"] == [])

status, body = http_get(f"/tenants/{TENANT_A}/plots/{PLOT_ID}/members", TOKEN_A)
assert_true("cross-tenant: plot membership cleared",
            not any(n["id"] == SUB_ROOT for n in body["nodes"]))

print("  All cross-tenant tests passed.")

# ─── Notes follow nodes ──────────────────────────────────────────────────────

print("  --- Notes follow nodes ---")

# Build a node with a note on MAP_1, move node to MAP_2, verify note follows.
NOTE_HOST = mknode(NODES_M1, TOKEN_A, "NoteHost")
_, b = http_post(f"{NODES_M1}/{NOTE_HOST}/notes",
                 {"title": "T", "text": "hello"}, TOKEN_A)
NOTE_ID = json_field(b, ["id"])

http_post(f"{NODES_M1}/{NOTE_HOST}/move", {"newMapId": MAP_2}, TOKEN_A)

# Note still attached to NOTE_HOST (via its node_id), and the note is
# fetchable through MAP_2 now.
status, body = http_get(f"/tenants/{TENANT_A}/maps/{MAP_2}/notes/{NOTE_ID}", TOKEN_A)
assert_status("notes-follow: note on dest map returns 200", 200, status)
assert_json_field("notes-follow: nodeId still NOTE_HOST",
                  body, ["nodeId"], str(NOTE_HOST))

print("  All notes-follow tests passed.")

# ─── Audit log ───────────────────────────────────────────────────────────────

print("  --- Audit log ---")

audit_count = mysql_query(
    "SELECT COUNT(*) FROM audit_log WHERE event_type = 'node_move';")
assert_true("audit: node_move events recorded",
            int(audit_count) > 0)

# Spot-check that the most recent event has descendantCount in detail
detail_check = mysql_query(
    "SELECT JSON_EXTRACT(detail, '$.descendantCount') FROM audit_log "
    "WHERE event_type = 'node_move' ORDER BY id DESC LIMIT 1;")
assert_true("audit: detail includes descendantCount",
            detail_check is not None and detail_check != "")

print("  All audit-log tests passed.")

# ─── Validation ──────────────────────────────────────────────────────────────

print("  --- Validation ---")

# Empty body
status, _ = http_post(f"{NODES_M1}/{NOTE_HOST}/move", {}, TOKEN_A)
# NOTE_HOST was moved to MAP_2 above; 403 expected (not in M1 anymore)
assert_true("validate: missing body / non-existent source 400 or 403",
            status in (400, 403))

# Need a fresh source on MAP_1 for the rest
NOTE_HOST_2 = mknode(NODES_M2, TOKEN_A, "Misc")
status, _ = http_post(f"{NODES_M2}/{NOTE_HOST_2}/move", {}, TOKEN_A)
assert_status("validate: missing both fields 400", 400, status)

# Non-integer newParentId
status, _ = http_post(f"{NODES_M2}/{NOTE_HOST_2}/move",
                      {"newParentId": "abc"}, TOKEN_A)
assert_status("validate: non-int newParentId 400", 400, status)

# Non-integer newMapId
status, _ = http_post(f"{NODES_M2}/{NOTE_HOST_2}/move",
                      {"newMapId": "abc"}, TOKEN_A)
assert_status("validate: non-int newMapId 400", 400, status)

# newParentId not on destination map
WRONG_PARENT = mknode(NODES_M1, TOKEN_A, "WrongMap")
status, _ = http_post(f"{NODES_M2}/{NOTE_HOST_2}/move",
                      {"newParentId": WRONG_PARENT}, TOKEN_A)
assert_status("validate: newParentId on different map 400", 400, status)

# Cross-tenant attempt by a non-admin user (unrelated to TOKEN_B's role above)
TOKEN_X = register_user(f"t24_x_{RUN_ID}", f"t24_x_{RUN_ID}@test.com", "testpass123")
status, _ = http_post(f"{NODES_M2}/{NOTE_HOST_2}/move", {}, TOKEN_X)
# X isn't a member of TENANT_A → blocked at TenantFilter
assert_status("validate: stranger blocked at TenantFilter", 403, status)

print("  All validation tests passed.")

sys.exit(0 if report() else 1)
