#!/usr/bin/env python3
"""test_22_plots.py — Phase 2c (#88): Plots + plot membership.

Covers:
  - Plot CRUD (list, create, get, update, delete)
  - Membership (add/remove nodes, add/remove notes; idempotent; cross-tenant rejected)
  - Combined GET .../members response shape and ordering
  - Visibility filter on listMembers (admin bypass, non-admin filtering,
    owner_xray bypass)
  - Auth: editor/admin can write; viewer can only read
  - Cross-tenant blocked at TenantFilter

Same SQL fixtures as test_20/test_21:
  - Move B's user.org_id into A's org so visibility-group membership is allowed
  - Insert B as 'viewer' in A's tenant_members (non-admin tenant member)
  - Grant B map view permission so map gating doesn't reject the read
"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_json_field, assert_true,
    http_post, http_get, http_put, http_delete,
    register_user, json_field, mysql_query,
)

reset_counters()
RUN_ID = os.getpid()

print("=== Plot Tests ===")

# ─── Setup ───────────────────────────────────────────────────────────────────

TOKEN_A = register_user(f"t22_a_{RUN_ID}", f"t22_a_{RUN_ID}@test.com", "testpass123")
_, body_a = http_post("/auth/login",
    {"email": f"t22_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A   = json_field(body_a, ["tenantId"])
USER_A_ID  = json_field(body_a, ["user", "id"])

TOKEN_B = register_user(f"t22_b_{RUN_ID}", f"t22_b_{RUN_ID}@test.com", "testpass123")
_, body_b = http_post("/auth/login",
    {"email": f"t22_b_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_B  = json_field(body_b, ["tenantId"])
USER_B_ID = json_field(body_b, ["user", "id"])

# Move B into A's org so visibility-group membership is allowed; insert as
# viewer in A's tenant_members so B exercises the non-admin paths.
A_ORG_ID = mysql_query(f"SELECT org_id FROM users WHERE id={USER_A_ID};")
mysql_query(f"UPDATE users SET org_id={A_ORG_ID} WHERE id={USER_B_ID};")
mysql_query(
    f"INSERT INTO tenant_members (tenant_id, user_id, role) "
    f"VALUES ({TENANT_A}, {USER_B_ID}, 'viewer');")

# A creates a map.
_, body = http_post(f"/tenants/{TENANT_A}/maps", {
    "title": "Plot Test Map",
    "coordinateSystem": {"type": "wgs84", "center": {"lat": 0, "lng": 0}, "zoom": 3},
}, TOKEN_A)
MAP_ID = json_field(body, ["id"])
mysql_query(
    f"INSERT INTO map_permissions (map_id, user_id, level) "
    f"VALUES ({MAP_ID}, {USER_B_ID}, 'view');")

# Two visibility groups; add B to Players.
VG_BASE = f"/tenants/{TENANT_A}/visibility-groups"
_, body = http_post(VG_BASE, {"name": "Players"}, TOKEN_A)
G_PLAYERS = json_field(body, ["id"])
_, body = http_post(VG_BASE, {"name": "GMs"}, TOKEN_A)
G_GMS = json_field(body, ["id"])
http_post(f"{VG_BASE}/{G_PLAYERS}/members", {"userId": USER_B_ID}, TOKEN_A)

# Tree with mixed visibility:
#   Root (no override)
#   ├── PlayersNode  (override=TRUE, [Players])
#   └── GmNode       (override=TRUE, [GMs])
NODES_BASE = f"/tenants/{TENANT_A}/maps/{MAP_ID}/nodes"

def mknode(name, parent_id=None):
    body_in = {"name": name}
    if parent_id is not None:
        body_in["parentId"] = parent_id
    _, b = http_post(NODES_BASE, body_in, TOKEN_A)
    return json_field(b, ["id"])

def settag_node(node_id, override, group_ids):
    http_post(f"{NODES_BASE}/{node_id}/visibility",
              {"override": override, "groupIds": group_ids}, TOKEN_A)

ROOT          = mknode("Root")
PLAYERS_NODE  = mknode("PlayersNode", ROOT); settag_node(PLAYERS_NODE, True, [G_PLAYERS])
GM_NODE       = mknode("GmNode",      ROOT); settag_node(GM_NODE,      True, [G_GMS])

def mknote(node_id, title):
    _, b = http_post(f"{NODES_BASE}/{node_id}/notes",
                     {"title": title, "text": "..."}, TOKEN_A)
    return json_field(b, ["id"])

# Notes: one inheriting Players (visible to B), one inheriting GMs (hidden from B)
NOTE_PLAYERS = mknote(PLAYERS_NODE, "PlayersNote")  # inherits Players
NOTE_GM      = mknote(GM_NODE,      "GmNote")       # inherits GMs

PLOTS_BASE = f"/tenants/{TENANT_A}/plots"

# ─── CRUD ────────────────────────────────────────────────────────────────────

print("  --- CRUD ---")

# Empty list initially
status, body = http_get(PLOTS_BASE, TOKEN_A)
assert_status("list: empty returns 200", 200, status)
assert_true("list: array initially empty",
            isinstance(body, list) and len(body) == 0)

# Create
status, body = http_post(PLOTS_BASE,
    {"name": "Story Arc 1", "description": "The opening"}, TOKEN_A)
assert_status("create: returns 201", 201, status)
PLOT_1 = json_field(body, ["id"])
assert_json_field("create: name set",        body, ["name"], "Story Arc 1")
assert_json_field("create: description set", body, ["description"], "The opening")
assert_json_field("create: tenantId set",    body, ["tenantId"], str(TENANT_A))

# Validation: missing name
status, _ = http_post(PLOTS_BASE, {}, TOKEN_A)
assert_status("create: missing name 400", 400, status)

# Validation: empty name
status, _ = http_post(PLOTS_BASE, {"name": ""}, TOKEN_A)
assert_status("create: empty name 400", 400, status)

# Multiple plots can share names (intentional — no UNIQUE)
status, body = http_post(PLOTS_BASE, {"name": "Story Arc 1"}, TOKEN_A)
assert_status("create: duplicate name allowed", 201, status)
PLOT_DUP = json_field(body, ["id"])

# Cross-tenant create blocked at TenantFilter
status, _ = http_post(PLOTS_BASE, {"name": "X"}, TOKEN_B)
# B is a member of TENANT_A but role=viewer — should be 403 not 'forbidden role'
assert_status("create: viewer rejected", 403, status)

# Create another for variety
status, body = http_post(PLOTS_BASE, {"name": "Sidequest"}, TOKEN_A)
PLOT_2 = json_field(body, ["id"])

# Get
status, body = http_get(f"{PLOTS_BASE}/{PLOT_1}", TOKEN_A)
assert_status("get: returns 200", 200, status)
assert_json_field("get: name", body, ["name"], "Story Arc 1")

# Get unknown
status, _ = http_get(f"{PLOTS_BASE}/9999999", TOKEN_A)
assert_status("get: unknown returns 404", 404, status)

# List shows multiple plots, alphabetical
status, body = http_get(PLOTS_BASE, TOKEN_A)
names = [p["name"] for p in body]
assert_true("list: alphabetical",
            names == sorted(names))
assert_true("list: contains all 3 plots", len(body) == 3)

# Update name + description
status, _ = http_put(f"{PLOTS_BASE}/{PLOT_1}",
    {"name": "Story Arc One", "description": "Revised"}, TOKEN_A)
assert_status("update: returns 200", 200, status)
status, body = http_get(f"{PLOTS_BASE}/{PLOT_1}", TOKEN_A)
assert_json_field("update: name persisted",        body, ["name"], "Story Arc One")
assert_json_field("update: description persisted", body, ["description"], "Revised")

# Partial update — name only
status, _ = http_put(f"{PLOTS_BASE}/{PLOT_1}", {"name": "Renamed"}, TOKEN_A)
status, body = http_get(f"{PLOTS_BASE}/{PLOT_1}", TOKEN_A)
assert_json_field("update: partial name change",  body, ["name"], "Renamed")
assert_json_field("update: description preserved", body, ["description"], "Revised")

# Update unknown
status, _ = http_put(f"{PLOTS_BASE}/9999999", {"name": "X"}, TOKEN_A)
assert_status("update: unknown returns 404", 404, status)

# Cross-tenant update blocked
status, _ = http_put(f"{PLOTS_BASE}/{PLOT_1}", {"name": "X"}, TOKEN_B)
assert_status("update: viewer rejected", 403, status)

# Delete
status, _ = http_delete(f"{PLOTS_BASE}/{PLOT_DUP}", TOKEN_A)
assert_status("delete: returns 204", 204, status)
status, _ = http_get(f"{PLOTS_BASE}/{PLOT_DUP}", TOKEN_A)
assert_status("delete: gone", 404, status)

# Delete unknown
status, _ = http_delete(f"{PLOTS_BASE}/9999999", TOKEN_A)
assert_status("delete: unknown returns 404", 404, status)

# Viewer can read but not write
status, _ = http_get(PLOTS_BASE, TOKEN_B)
assert_status("read: viewer can list", 200, status)
status, _ = http_get(f"{PLOTS_BASE}/{PLOT_1}", TOKEN_B)
assert_status("read: viewer can get", 200, status)
status, _ = http_delete(f"{PLOTS_BASE}/{PLOT_1}", TOKEN_B)
assert_status("delete: viewer rejected", 403, status)

print("  All CRUD tests passed.")

# ─── Membership ──────────────────────────────────────────────────────────────

print("  --- Membership ---")

# Initially empty members
status, body = http_get(f"{PLOTS_BASE}/{PLOT_1}/members", TOKEN_A)
assert_status("members: returns 200", 200, status)
assert_true("members: nodes empty initially",  body["nodes"] == [])
assert_true("members: notes empty initially",  body["notes"] == [])

# Attach a node
status, body = http_post(f"{PLOTS_BASE}/{PLOT_1}/nodes",
                         {"nodeId": ROOT}, TOKEN_A)
assert_status("attach: node returns 201", 201, status)
assert_json_field("attach: plotId in response", body, ["plotId"], str(PLOT_1))
assert_json_field("attach: nodeId in response", body, ["nodeId"], str(ROOT))

# Idempotent dup-attach (INSERT IGNORE) — still 201, no duplicate row
status, _ = http_post(f"{PLOTS_BASE}/{PLOT_1}/nodes",
                      {"nodeId": ROOT}, TOKEN_A)
assert_status("attach: dup returns 201 (idempotent)", 201, status)
status, body = http_get(f"{PLOTS_BASE}/{PLOT_1}/members", TOKEN_A)
assert_true("attach: still 1 node member", len(body["nodes"]) == 1)

# Attach more nodes
http_post(f"{PLOTS_BASE}/{PLOT_1}/nodes", {"nodeId": PLAYERS_NODE}, TOKEN_A)
http_post(f"{PLOTS_BASE}/{PLOT_1}/nodes", {"nodeId": GM_NODE}, TOKEN_A)

# Attach notes
http_post(f"{PLOTS_BASE}/{PLOT_1}/notes", {"noteId": NOTE_PLAYERS}, TOKEN_A)
http_post(f"{PLOTS_BASE}/{PLOT_1}/notes", {"noteId": NOTE_GM}, TOKEN_A)

# Validation: missing nodeId / noteId
status, _ = http_post(f"{PLOTS_BASE}/{PLOT_1}/nodes", {}, TOKEN_A)
assert_status("attach: missing nodeId 400", 400, status)
status, _ = http_post(f"{PLOTS_BASE}/{PLOT_1}/notes", {}, TOKEN_A)
assert_status("attach: missing noteId 400", 400, status)

# Cross-tenant defense: B's tenant has no nodes/notes; trying to attach
# id 9999999 should fail with 400 "not found in this tenant"
status, _ = http_post(f"{PLOTS_BASE}/{PLOT_1}/nodes",
                      {"nodeId": 9999999}, TOKEN_A)
assert_status("attach: unknown nodeId 400", 400, status)

# Unknown plot
status, _ = http_post(f"{PLOTS_BASE}/9999999/nodes",
                      {"nodeId": ROOT}, TOKEN_A)
assert_status("attach: unknown plot 404", 404, status)

# Viewer can't attach
status, _ = http_post(f"{PLOTS_BASE}/{PLOT_1}/nodes",
                      {"nodeId": ROOT}, TOKEN_B)
assert_status("attach: viewer rejected", 403, status)

# Detach
status, _ = http_delete(f"{PLOTS_BASE}/{PLOT_1}/nodes/{ROOT}", TOKEN_A)
assert_status("detach: node returns 204", 204, status)

# Detach unknown / non-member
status, _ = http_delete(f"{PLOTS_BASE}/{PLOT_1}/nodes/{ROOT}", TOKEN_A)
assert_status("detach: non-member returns 404", 404, status)
status, _ = http_delete(f"{PLOTS_BASE}/9999999/nodes/{PLAYERS_NODE}", TOKEN_A)
assert_status("detach: unknown plot 404", 404, status)

# Viewer can't detach
status, _ = http_delete(f"{PLOTS_BASE}/{PLOT_1}/nodes/{PLAYERS_NODE}", TOKEN_B)
assert_status("detach: viewer rejected", 403, status)

# Detach a note
status, _ = http_delete(f"{PLOTS_BASE}/{PLOT_1}/notes/{NOTE_GM}", TOKEN_A)
assert_status("detach: note returns 204", 204, status)
http_post(f"{PLOTS_BASE}/{PLOT_1}/notes", {"noteId": NOTE_GM}, TOKEN_A)  # re-attach for filter tests

print("  All membership tests passed.")

# ─── Visibility filter on listMembers ────────────────────────────────────────

print("  --- Visibility filter on listMembers ---")

# Plot now contains: nodes={PlayersNode, GmNode}, notes={NotePlayers, NoteGm}.
# (ROOT was detached above.)

# Admin sees everything
status, body = http_get(f"{PLOTS_BASE}/{PLOT_1}/members", TOKEN_A)
node_ids = {n["id"] for n in body["nodes"]}
note_ids = {n["id"] for n in body["notes"]}
assert_true("admin: all node members visible",
            node_ids == {PLAYERS_NODE, GM_NODE})
assert_true("admin: all note members visible",
            note_ids == {NOTE_PLAYERS, NOTE_GM})

# Non-admin (B, in Players) sees only Players-resolved members
status, body = http_get(f"{PLOTS_BASE}/{PLOT_1}/members", TOKEN_B)
node_ids = {n["id"] for n in body["nodes"]}
note_ids = {n["id"] for n in body["notes"]}
assert_true("B: only PlayersNode visible",
            node_ids == {PLAYERS_NODE})
assert_true("B: only PlayersNote visible",
            note_ids == {NOTE_PLAYERS})

# Owner-xray bypass: B as map owner with xray TRUE sees everything in the plot
mysql_query(f"UPDATE maps SET owner_id={USER_B_ID}, owner_xray=TRUE WHERE id={MAP_ID};")
status, body = http_get(f"{PLOTS_BASE}/{PLOT_1}/members", TOKEN_B)
node_ids = {n["id"] for n in body["nodes"]}
note_ids = {n["id"] for n in body["notes"]}
assert_true("xray=TRUE: B sees all node members",
            node_ids == {PLAYERS_NODE, GM_NODE})
assert_true("xray=TRUE: B sees all note members",
            note_ids == {NOTE_PLAYERS, NOTE_GM})

# Without xray, B is back to filtered
mysql_query(f"UPDATE maps SET owner_xray=FALSE WHERE id={MAP_ID};")
status, body = http_get(f"{PLOTS_BASE}/{PLOT_1}/members", TOKEN_B)
node_ids = {n["id"] for n in body["nodes"]}
assert_true("xray=FALSE: B back to filtered set",
            node_ids == {PLAYERS_NODE})

# Restore ownership
mysql_query(f"UPDATE maps SET owner_id={USER_A_ID} WHERE id={MAP_ID};")

print("  All visibility-filter tests passed.")

# ─── Reverse membership: GET /maps/{mid}/nodes/{nid}/plots (#139) ────────────
#
# State entering this section: PLOT_1 contains {PLAYERS_NODE, GM_NODE} as
# nodes and {NOTE_PLAYERS, NOTE_GM} as notes. PLOT_2 exists but currently
# has no node/note attached to PLAYERS_NODE / GM_NODE. We attach
# PLAYERS_NODE to PLOT_2 to exercise the multi-plot case.

print("  --- Reverse membership: plots-for-node ---")

http_post(f"{PLOTS_BASE}/{PLOT_2}/nodes", {"nodeId": PLAYERS_NODE}, TOKEN_A)

# Admin: PLAYERS_NODE is in both PLOT_1 and PLOT_2
status, body = http_get(
    f"/tenants/{TENANT_A}/maps/{MAP_ID}/nodes/{PLAYERS_NODE}/plots", TOKEN_A)
assert_status("plots-for-node admin: 200", 200, status)
plot_ids = {p["id"] for p in body}
assert_true("plots-for-node admin: both plots returned",
            plot_ids == {PLOT_1, PLOT_2})

# Admin: GM_NODE is only in PLOT_1
status, body = http_get(
    f"/tenants/{TENANT_A}/maps/{MAP_ID}/nodes/{GM_NODE}/plots", TOKEN_A)
plot_ids = {p["id"] for p in body}
assert_true("plots-for-node admin: GM_NODE only in PLOT_1",
            plot_ids == {PLOT_1})

# Admin: ROOT was detached from PLOT_1 and was never on PLOT_2 → empty list
status, body = http_get(
    f"/tenants/{TENANT_A}/maps/{MAP_ID}/nodes/{ROOT}/plots", TOKEN_A)
assert_status("plots-for-node admin: empty returns 200", 200, status)
assert_true("plots-for-node admin: ROOT empty", body == [])

# Non-admin (B): PLAYERS_NODE is visible to B (in Players group), so B sees both plots
status, body = http_get(
    f"/tenants/{TENANT_A}/maps/{MAP_ID}/nodes/{PLAYERS_NODE}/plots", TOKEN_B)
assert_status("plots-for-node B: 200 (visible)", 200, status)
plot_ids = {p["id"] for p in body}
assert_true("plots-for-node B: PLAYERS_NODE in both plots",
            plot_ids == {PLOT_1, PLOT_2})

# Non-admin (B): GM_NODE is hidden from B → 404
status, _ = http_get(
    f"/tenants/{TENANT_A}/maps/{MAP_ID}/nodes/{GM_NODE}/plots", TOKEN_B)
assert_status("plots-for-node B: hidden returns 404", 404, status)

# Unknown node id → 404
status, _ = http_get(
    f"/tenants/{TENANT_A}/maps/{MAP_ID}/nodes/9999999/plots", TOKEN_A)
assert_status("plots-for-node: unknown node 404", 404, status)

# Wrong map id → 404 (the node exists, but not on this map)
OTHER_MAP_BODY = http_post(f"/tenants/{TENANT_A}/maps", {
    "title": "Other Map",
    "coordinateSystem": {"type": "wgs84", "center": {"lat": 0, "lng": 0}, "zoom": 3},
}, TOKEN_A)[1]
OTHER_MAP_ID = json_field(OTHER_MAP_BODY, ["id"])
status, _ = http_get(
    f"/tenants/{TENANT_A}/maps/{OTHER_MAP_ID}/nodes/{PLAYERS_NODE}/plots", TOKEN_A)
assert_status("plots-for-node: wrong map 404", 404, status)

# Owner-xray bypass: B as map owner with xray sees plots even for hidden node
mysql_query(f"UPDATE maps SET owner_id={USER_B_ID}, owner_xray=TRUE WHERE id={MAP_ID};")
status, body = http_get(
    f"/tenants/{TENANT_A}/maps/{MAP_ID}/nodes/{GM_NODE}/plots", TOKEN_B)
assert_status("plots-for-node xray: 200 even for hidden node", 200, status)
assert_true("plots-for-node xray: GM_NODE returned PLOT_1",
            {p["id"] for p in body} == {PLOT_1})
mysql_query(f"UPDATE maps SET owner_id={USER_A_ID}, owner_xray=FALSE WHERE id={MAP_ID};")

print("  All plots-for-node tests passed.")

print("  --- Reverse membership: plots-for-note ---")

# Admin: NOTE_PLAYERS is in PLOT_1
status, body = http_get(
    f"/tenants/{TENANT_A}/maps/{MAP_ID}/notes/{NOTE_PLAYERS}/plots", TOKEN_A)
assert_status("plots-for-note admin: 200", 200, status)
assert_true("plots-for-note admin: NOTE_PLAYERS in PLOT_1",
            {p["id"] for p in body} == {PLOT_1})

# Admin: NOTE_GM is in PLOT_1 too
status, body = http_get(
    f"/tenants/{TENANT_A}/maps/{MAP_ID}/notes/{NOTE_GM}/plots", TOKEN_A)
assert_true("plots-for-note admin: NOTE_GM in PLOT_1",
            {p["id"] for p in body} == {PLOT_1})

# Non-admin (B): NOTE_PLAYERS visible (inherits Players via parent), sees PLOT_1
status, body = http_get(
    f"/tenants/{TENANT_A}/maps/{MAP_ID}/notes/{NOTE_PLAYERS}/plots", TOKEN_B)
assert_status("plots-for-note B: 200 (visible)", 200, status)
assert_true("plots-for-note B: NOTE_PLAYERS in PLOT_1",
            {p["id"] for p in body} == {PLOT_1})

# Non-admin (B): NOTE_GM hidden → 404
status, _ = http_get(
    f"/tenants/{TENANT_A}/maps/{MAP_ID}/notes/{NOTE_GM}/plots", TOKEN_B)
assert_status("plots-for-note B: hidden returns 404", 404, status)

# Unknown note id → 404
status, _ = http_get(
    f"/tenants/{TENANT_A}/maps/{MAP_ID}/notes/9999999/plots", TOKEN_A)
assert_status("plots-for-note: unknown note 404", 404, status)

# Owner-xray bypass for notes
mysql_query(f"UPDATE maps SET owner_id={USER_B_ID}, owner_xray=TRUE WHERE id={MAP_ID};")
status, body = http_get(
    f"/tenants/{TENANT_A}/maps/{MAP_ID}/notes/{NOTE_GM}/plots", TOKEN_B)
assert_status("plots-for-note xray: 200 even for hidden note", 200, status)
mysql_query(f"UPDATE maps SET owner_id={USER_A_ID}, owner_xray=FALSE WHERE id={MAP_ID};")

print("  All plots-for-note tests passed.")

# ─── Cleanup CASCADE ─────────────────────────────────────────────────────────
# Deleting the plot should cascade away both junction tables.

print("  --- Cleanup cascade ---")

remaining_pn = mysql_query(
    f"SELECT COUNT(*) FROM plot_nodes WHERE plot_id={PLOT_1};")
remaining_pnn = mysql_query(
    f"SELECT COUNT(*) FROM plot_notes WHERE plot_id={PLOT_1};")
assert_true("cleanup: plot_nodes populated before delete",  int(remaining_pn) > 0)
assert_true("cleanup: plot_notes populated before delete",  int(remaining_pnn) > 0)

http_delete(f"{PLOTS_BASE}/{PLOT_1}", TOKEN_A)

remaining_pn = mysql_query(
    f"SELECT COUNT(*) FROM plot_nodes WHERE plot_id={PLOT_1};")
remaining_pnn = mysql_query(
    f"SELECT COUNT(*) FROM plot_notes WHERE plot_id={PLOT_1};")
assert_true("cleanup: plot_nodes cascaded",  remaining_pn == "0")
assert_true("cleanup: plot_notes cascaded",  remaining_pnn == "0")

# Deleting a node (in NodeController) should also cascade plot_nodes membership
TOMB_NODE = mknode("Tombstone")
http_post(f"{PLOTS_BASE}/{PLOT_2}/nodes", {"nodeId": TOMB_NODE}, TOKEN_A)
http_delete(f"{NODES_BASE}/{TOMB_NODE}", TOKEN_A)
remaining = mysql_query(
    f"SELECT COUNT(*) FROM plot_nodes WHERE node_id={TOMB_NODE};")
assert_true("cleanup: node delete cascaded plot_nodes", remaining == "0")

print("  All cleanup tests passed.")

sys.exit(0 if report() else 1)
