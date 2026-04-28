#!/usr/bin/env python3
"""test_20_node_visibility_filter.py — Phase 2b.ii.b: read-time effective
visibility filtering on GET nodes / GET nodes/{id}, plus owner_xray bypass.

Setup uses direct SQL for two fixture moves the personal-tenant API can't
naturally produce:
  1. Move B's user.org_id into A's org (so cross-org visibility-group
     membership rejection in #98 doesn't get in the way of the test).
  2. Insert B into A's tenant_members as 'viewer' (a same-tenant non-admin
     user — required to exercise the non-admin filter path; admins bypass).
  3. Reassign maps.owner_id to B, toggling owner_xray, to test the xray
     bypass.

These bypass the API surface but stay within database invariants; the
behaviour under test is the read filter itself, not how members are
provisioned.

Tree built on map M (under tenant A_T):

    Root (override=FALSE, no tags)  → admin-only (root fallback)
    ├── Pin (override=FALSE, no tags)            → admin-only
    ├── PlayersOnly (override=TRUE, [Players])   → visible to Players group
    │   └── PlayersChild (override=FALSE)        → inherits PlayersOnly
    ├── GmOnly (override=TRUE, [GMs])            → visible to GMs group
    │   └── GmChild (override=FALSE)             → inherits GmOnly
    └── GmBranch (override=TRUE, [GMs])          → visible to GMs
        └── PlayerUnderGm (override=TRUE, [Players])  → visible to Players;
            (parent GmBranch hidden from B → parentId nulled in response)

A is tenant admin (sees everything).
B is non-admin, member of Players (sees PlayersOnly, PlayersChild, PlayerUnderGm).
"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_json_field, assert_true,
    http_post, http_get, register_user, json_field, mysql_query,
)

reset_counters()
RUN_ID = os.getpid()

print("=== Node Visibility Read Filter Tests ===")

# ─── Setup ───────────────────────────────────────────────────────────────────

TOKEN_A = register_user(f"t20_a_{RUN_ID}", f"t20_a_{RUN_ID}@test.com", "testpass123")
_, body_a = http_post("/auth/login",
    {"email": f"t20_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A = json_field(body_a, ["tenantId"])
USER_A_ID = json_field(body_a, ["user", "id"])

TOKEN_B = register_user(f"t20_b_{RUN_ID}", f"t20_b_{RUN_ID}@test.com", "testpass123")
_, body_b = http_post("/auth/login",
    {"email": f"t20_b_{RUN_ID}@test.com", "password": "testpass123"})
USER_B_ID = json_field(body_b, ["user", "id"])

# Move B into A's org so visibility-group membership is allowed,
# then insert B into A's tenant as a viewer (non-admin).
A_ORG_ID = mysql_query(f"SELECT org_id FROM users WHERE id={USER_A_ID};")
mysql_query(f"UPDATE users SET org_id={A_ORG_ID} WHERE id={USER_B_ID};")
mysql_query(
    f"INSERT INTO tenant_members (tenant_id, user_id, role) "
    f"VALUES ({TENANT_A}, {USER_B_ID}, 'viewer');")

# A creates a map and two visibility groups.
_, body = http_post(f"/tenants/{TENANT_A}/maps", {
    "title": "VisFilter Map",
    "coordinateSystem": {"type": "wgs84", "center": {"lat": 0, "lng": 0}, "zoom": 3},
}, TOKEN_A)
MAP_ID = json_field(body, ["id"])

# Grant B view permission on the map. (Tenant membership alone doesn't
# carry map-level read permission — the existing map gating in NodeController
# requires owner / per-user / public.) Bypass the API for fixture brevity.
mysql_query(
    f"INSERT INTO map_permissions (map_id, user_id, level) "
    f"VALUES ({MAP_ID}, {USER_B_ID}, 'view');")

VG_BASE = f"/tenants/{TENANT_A}/visibility-groups"
_, body = http_post(VG_BASE, {"name": "Players"}, TOKEN_A)
G_PLAYERS = json_field(body, ["id"])
_, body = http_post(VG_BASE, {"name": "GMs"}, TOKEN_A)
G_GMS = json_field(body, ["id"])

# A adds B to Players (now allowed — same org).
_, _ = http_post(f"{VG_BASE}/{G_PLAYERS}/members",
                 {"userId": USER_B_ID}, TOKEN_A)

# Build the tree.
NODES_BASE = f"/tenants/{TENANT_A}/maps/{MAP_ID}/nodes"

def mknode(name, parent_id=None):
    body_in = {"name": name}
    if parent_id is not None:
        body_in["parentId"] = parent_id
    _, b = http_post(NODES_BASE, body_in, TOKEN_A)
    return json_field(b, ["id"])

def settag(node_id, override, group_ids):
    http_post(f"{NODES_BASE}/{node_id}/visibility",
              {"override": override, "groupIds": group_ids}, TOKEN_A)

ROOT          = mknode("Root")
PIN           = mknode("Pin", ROOT)
PLAYERS_ONLY  = mknode("PlayersOnly", ROOT);     settag(PLAYERS_ONLY,  True, [G_PLAYERS])
PLAYERS_CHILD = mknode("PlayersChild", PLAYERS_ONLY)
GM_ONLY       = mknode("GmOnly", ROOT);          settag(GM_ONLY,       True, [G_GMS])
GM_CHILD      = mknode("GmChild", GM_ONLY)
GM_BRANCH     = mknode("GmBranch", ROOT);        settag(GM_BRANCH,     True, [G_GMS])
PLAYER_UNDER_GM = mknode("PlayerUnderGm", GM_BRANCH)
settag(PLAYER_UNDER_GM, True, [G_PLAYERS])

ALL_NODES = {ROOT, PIN, PLAYERS_ONLY, PLAYERS_CHILD, GM_ONLY, GM_CHILD,
             GM_BRANCH, PLAYER_UNDER_GM}
B_VISIBLE = {PLAYERS_ONLY, PLAYERS_CHILD, PLAYER_UNDER_GM}

# ─── Admin sees everything (bypass) ──────────────────────────────────────────

print("  --- Admin bypass ---")

status, body = http_get(NODES_BASE, TOKEN_A)
assert_status("admin: list returns 200", 200, status)
admin_ids = {n["id"] for n in body}
assert_true("admin: sees every node",
            admin_ids == ALL_NODES)

for nid in ALL_NODES:
    status, _ = http_get(f"{NODES_BASE}/{nid}", TOKEN_A)
    assert_status(f"admin: get node {nid} returns 200", 200, status)

print("  All admin-bypass tests passed.")

# ─── Non-admin filtering (B with Players membership) ─────────────────────────

print("  --- Non-admin filter ---")

status, body = http_get(NODES_BASE, TOKEN_B)
assert_status("B: list returns 200", 200, status)
b_ids = {n["id"] for n in body}
assert_true("B: list contains exactly visible set",
            b_ids == B_VISIBLE)

# GET visible nodes → 200
for nid in B_VISIBLE:
    status, _ = http_get(f"{NODES_BASE}/{nid}", TOKEN_B)
    assert_status(f"B: get visible node {nid} returns 200", 200, status)

# GET hidden nodes → 404 (don't leak existence)
for nid in ALL_NODES - B_VISIBLE:
    status, _ = http_get(f"{NODES_BASE}/{nid}", TOKEN_B)
    assert_status(f"B: get hidden node {nid} returns 404", 404, status)

# Hidden parent leak check: PlayerUnderGm is visible to B, GmBranch
# (its parent) is not. The list response must report parentId=null
# rather than leaking the hidden ancestor's id.
b_by_id = {n["id"]: n for n in body}
assert_true("B: visible-child-of-hidden-parent has parentId nulled",
            b_by_id[PLAYER_UNDER_GM]["parentId"] is None)

# Conversely, when a child's parent IS visible (PlayersChild → PlayersOnly),
# parentId should still report the parent.
assert_true("B: visible-child-of-visible-parent keeps parentId",
            b_by_id[PLAYERS_CHILD]["parentId"] == PLAYERS_ONLY)

# Same null-out behaviour on the single-node GET endpoint.
status, body_one = http_get(f"{NODES_BASE}/{PLAYER_UNDER_GM}", TOKEN_B)
assert_status("B: single-get visible-of-hidden returns 200", 200, status)
assert_true("B: single-get parentId nulled when parent hidden",
            body_one["parentId"] is None)

print("  All non-admin-filter tests passed.")

# ─── parentId child-filter still works on filtered results ───────────────────

print("  --- parentId query param ---")

# B asking for direct children of PlayersOnly should see PlayersChild only.
status, body = http_get(f"{NODES_BASE}?parentId={PLAYERS_ONLY}", TOKEN_B)
assert_status("B: parentId filter returns 200", 200, status)
ids = {n["id"] for n in body}
assert_true("B: children of PlayersOnly = {PlayersChild}",
            ids == {PLAYERS_CHILD})

# B asking for children of GmOnly (which B can't see) should get an empty
# list — and certainly not GmChild.
status, body = http_get(f"{NODES_BASE}?parentId={GM_ONLY}", TOKEN_B)
assert_status("B: parentId filter on hidden parent returns 200", 200, status)
assert_true("B: children of hidden parent are filtered out",
            len(body) == 0)

print("  All parentId-filter tests passed.")

# ─── owner_xray bypass ───────────────────────────────────────────────────────
# Reassign map owner to B, and toggle xray. xray=TRUE → B sees everything;
# xray=FALSE → B is bound by visibility (back to the Players-only set).

print("  --- owner_xray ---")

mysql_query(
    f"UPDATE maps SET owner_id={USER_B_ID}, owner_xray=TRUE WHERE id={MAP_ID};")

status, body = http_get(NODES_BASE, TOKEN_B)
b_ids_xray = {n["id"] for n in body}
assert_true("xray=TRUE owner: sees every node",
            b_ids_xray == ALL_NODES)
status, _ = http_get(f"{NODES_BASE}/{ROOT}", TOKEN_B)
assert_status("xray=TRUE owner: get hidden-by-default node returns 200",
              200, status)

mysql_query(f"UPDATE maps SET owner_xray=FALSE WHERE id={MAP_ID};")

status, body = http_get(NODES_BASE, TOKEN_B)
b_ids_no_xray = {n["id"] for n in body}
assert_true("xray=FALSE owner: bound by visibility filter",
            b_ids_no_xray == B_VISIBLE)
status, _ = http_get(f"{NODES_BASE}/{ROOT}", TOKEN_B)
assert_status("xray=FALSE owner: get admin-only node still 404",
              404, status)

print("  All owner_xray tests passed.")

# ─── Override-with-empty-junction = admin-only ───────────────────────────────
# A node with override=TRUE but no visibility_group tags = explicit
# admin-only. Verify B can't see it but admin can.

print("  --- empty-junction admin-only ---")

mysql_query(f"UPDATE maps SET owner_id={USER_A_ID} WHERE id={MAP_ID};")
EXPLICIT_LOCK = mknode("ExplicitLock", ROOT)
settag(EXPLICIT_LOCK, True, [])  # override TRUE, empty tag set

status, _ = http_get(f"{NODES_BASE}/{EXPLICIT_LOCK}", TOKEN_A)
assert_status("explicit-lock: admin sees it", 200, status)
status, _ = http_get(f"{NODES_BASE}/{EXPLICIT_LOCK}", TOKEN_B)
assert_status("explicit-lock: non-admin gets 404", 404, status)

print("  All empty-junction tests passed.")

sys.exit(0 if report() else 1)
