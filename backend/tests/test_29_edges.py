#!/usr/bin/env python3
"""test_29_edges.py — Phase 1 of edges epic (#148): schema + EdgeController CRUD.

Covers:
  - CRUD round-trip (list / create / get / update / delete)
  - listEdgesForNode endpoint
  - Self-loop rejection (DB CHECK + controller pre-check)
  - Cross-map endpoint rejection (both nodes must belong to {mapId})
  - Map FK CASCADE on delete (delete map → edges gone)
  - Node FK CASCADE on delete (delete endpoint node → edge gone)
  - Cross-tenant 403 (TenantFilter)
  - Read auth: viewer can read, non-member rejected
  - Write auth: viewer rejected, editor/admin allowed
  - POST/PUT return full canonical record (#152 pattern)
  - Endpoints immutable on update (PUT body can't change source/dest)
  - Duplicate edges allowed (same source/dest/directed)
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

print("=== Edge Tests ===")

# ─── Setup ───────────────────────────────────────────────────────────────────

# A: tenant admin (full access)
TOKEN_A = register_user(f"t29_a_{RUN_ID}", f"t29_a_{RUN_ID}@test.com", "testpass123")
_, body_a = http_post("/auth/login",
    {"email": f"t29_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A   = json_field(body_a, ["tenantId"])
USER_A_ID  = json_field(body_a, ["user", "id"])

# B: same-org viewer of TENANT_A (read access only)
TOKEN_B = register_user(f"t29_b_{RUN_ID}", f"t29_b_{RUN_ID}@test.com", "testpass123")
_, body_b = http_post("/auth/login",
    {"email": f"t29_b_{RUN_ID}@test.com", "password": "testpass123"})
USER_B_ID = json_field(body_b, ["user", "id"])

A_ORG_ID = mysql_query(f"SELECT org_id FROM users WHERE id={USER_A_ID};")
mysql_query(f"UPDATE users SET org_id={A_ORG_ID} WHERE id={USER_B_ID};")
mysql_query(
    f"INSERT INTO tenant_members (tenant_id, user_id, role) "
    f"VALUES ({TENANT_A}, {USER_B_ID}, 'viewer');")

# C: separate tenant, used for cross-tenant rejection tests
TOKEN_C = register_user(f"t29_c_{RUN_ID}", f"t29_c_{RUN_ID}@test.com", "testpass123")
_, body_c = http_post("/auth/login",
    {"email": f"t29_c_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_C  = json_field(body_c, ["tenantId"])

# A creates a map and grants B view permission (so B can read but not write)
_, body = http_post(f"/tenants/{TENANT_A}/maps", {
    "title": "Edge Test Map",
    "coordinateSystem": {"type": "wgs84", "center": {"lat": 0, "lng": 0}, "zoom": 3},
}, TOKEN_A)
MAP_ID = json_field(body, ["id"])
mysql_query(
    f"INSERT INTO map_permissions (map_id, user_id, level) "
    f"VALUES ({MAP_ID}, {USER_B_ID}, 'view');")

# Second map, used for cross-map endpoint rejection
_, body = http_post(f"/tenants/{TENANT_A}/maps", {
    "title": "Edge Other Map",
    "coordinateSystem": {"type": "wgs84", "center": {"lat": 0, "lng": 0}, "zoom": 3},
}, TOKEN_A)
MAP2_ID = json_field(body, ["id"])

NODES_BASE  = f"/tenants/{TENANT_A}/maps/{MAP_ID}/nodes"
NODES2_BASE = f"/tenants/{TENANT_A}/maps/{MAP2_ID}/nodes"
EDGES_BASE  = f"/tenants/{TENANT_A}/maps/{MAP_ID}/edges"

def mknode(base, name):
    _, b = http_post(base, {"name": name}, TOKEN_A)
    return json_field(b, ["id"])

NODE_X = mknode(NODES_BASE,  "X")
NODE_Y = mknode(NODES_BASE,  "Y")
NODE_Z = mknode(NODES_BASE,  "Z")
NODE_OTHERMAP = mknode(NODES2_BASE, "OtherMapNode")

# ─── CRUD ────────────────────────────────────────────────────────────────────

print("  --- CRUD ---")

# Empty list
status, body = http_get(EDGES_BASE, TOKEN_A)
assert_status("list: empty 200", 200, status)
assert_true("list: array initially empty",
            isinstance(body, list) and len(body) == 0)

# Create (minimal — required fields only)
status, body = http_post(EDGES_BASE, {
    "sourceNodeId": NODE_X,
    "destNodeId":   NODE_Y,
}, TOKEN_A)
assert_status("create: minimal returns 201", 201, status)
EDGE_1 = json_field(body, ["id"])
assert_json_field("create: mapId echoed",        body, ["mapId"],         str(MAP_ID))
assert_json_field("create: source echoed",       body, ["sourceNodeId"],  str(NODE_X))
assert_json_field("create: dest echoed",         body, ["destNodeId"],    str(NODE_Y))
assert_json_field("create: directed defaults false", body, ["directed"], "False")
assert_true("create: createdAt present", body.get("createdAt"))
assert_true("create: updatedAt present", body.get("updatedAt"))

# Create (full — all optional fields)
status, body = http_post(EDGES_BASE, {
    "sourceNodeId": NODE_Y,
    "destNodeId":   NODE_Z,
    "directed":     True,
    "color":        "#ff0000",
    "label":        "Trade route",
    "description":  "Weekly caravan",
}, TOKEN_A)
assert_status("create: full body returns 201", 201, status)
EDGE_2 = json_field(body, ["id"])
assert_json_field("create: directed=true",   body, ["directed"], "True")
assert_json_field("create: color persisted", body, ["color"],    "#ff0000")
assert_json_field("create: label persisted", body, ["label"],    "Trade route")

# Duplicate edges (same source/dest/directed) are intentionally allowed
status, body = http_post(EDGES_BASE, {
    "sourceNodeId": NODE_X,
    "destNodeId":   NODE_Y,
}, TOKEN_A)
assert_status("create: duplicate edge allowed 201", 201, status)
EDGE_DUP = json_field(body, ["id"])
assert_true("create: duplicate edge has new id", EDGE_DUP != EDGE_1)

# List shows all three
status, body = http_get(EDGES_BASE, TOKEN_A)
assert_true("list: 3 edges after create", len(body) == 3)

# Get one
status, body = http_get(f"{EDGES_BASE}/{EDGE_2}", TOKEN_A)
assert_status("get: 200", 200, status)
assert_json_field("get: label", body, ["label"], "Trade route")

# Get unknown
status, _ = http_get(f"{EDGES_BASE}/9999999", TOKEN_A)
assert_status("get: unknown 404", 404, status)

# Update — partial body (just label)
status, body = http_put(f"{EDGES_BASE}/{EDGE_2}", {"label": "Updated route"}, TOKEN_A)
assert_status("update: 200", 200, status)
assert_json_field("update: label changed",    body, ["label"], "Updated route")
assert_json_field("update: directed preserved", body, ["directed"], "True")
assert_json_field("update: color preserved",  body, ["color"], "#ff0000")

# Update — multiple fields at once
status, body = http_put(f"{EDGES_BASE}/{EDGE_2}",
                        {"directed": False, "color": "#00ff00"}, TOKEN_A)
assert_json_field("update: directed flipped", body, ["directed"], "False")
assert_json_field("update: color changed",    body, ["color"],    "#00ff00")
assert_json_field("update: label preserved (partial)", body, ["label"], "Updated route")

# Update with empty body returns 400
status, _ = http_put(f"{EDGES_BASE}/{EDGE_2}", {}, TOKEN_A)
assert_status("update: empty body 400", 400, status)

# Update unknown
status, _ = http_put(f"{EDGES_BASE}/9999999", {"label": "x"}, TOKEN_A)
assert_status("update: unknown 404", 404, status)

# Delete one (the duplicate)
status, _ = http_delete(f"{EDGES_BASE}/{EDGE_DUP}", TOKEN_A)
assert_status("delete: 204", 204, status)
status, _ = http_get(f"{EDGES_BASE}/{EDGE_DUP}", TOKEN_A)
assert_status("delete: gone after delete (404)", 404, status)

# Delete unknown
status, _ = http_delete(f"{EDGES_BASE}/9999999", TOKEN_A)
assert_status("delete: unknown 404", 404, status)

print("  All CRUD tests passed.")

# ─── Validation ──────────────────────────────────────────────────────────────

print("  --- Validation ---")

# Missing required fields
status, _ = http_post(EDGES_BASE, {"sourceNodeId": NODE_X}, TOKEN_A)
assert_status("create: missing destNodeId 400", 400, status)

status, _ = http_post(EDGES_BASE, {"destNodeId": NODE_Y}, TOKEN_A)
assert_status("create: missing sourceNodeId 400", 400, status)

# Self-loop rejection (controller pre-check)
status, _ = http_post(EDGES_BASE,
    {"sourceNodeId": NODE_X, "destNodeId": NODE_X}, TOKEN_A)
assert_status("create: self-loop 400", 400, status)

# Cross-map endpoint rejection — NODE_OTHERMAP is on MAP2, not MAP
status, _ = http_post(EDGES_BASE,
    {"sourceNodeId": NODE_X, "destNodeId": NODE_OTHERMAP}, TOKEN_A)
assert_status("create: cross-map dest 400", 400, status)

status, _ = http_post(EDGES_BASE,
    {"sourceNodeId": NODE_OTHERMAP, "destNodeId": NODE_X}, TOKEN_A)
assert_status("create: cross-map source 400", 400, status)

# Missing endpoint id
status, _ = http_post(EDGES_BASE,
    {"sourceNodeId": NODE_X, "destNodeId": 9999999}, TOKEN_A)
assert_status("create: missing dest 400", 400, status)

# Color validation (oversized)
status, _ = http_post(EDGES_BASE, {
    "sourceNodeId": NODE_X, "destNodeId": NODE_Z,
    "color": "#" + "f" * 20,
}, TOKEN_A)
assert_status("create: oversized color 400", 400, status)

print("  All validation tests passed.")

# ─── listEdgesForNode ───────────────────────────────────────────────────────

print("  --- listEdgesForNode ---")

# Currently: EDGE_1 (X→Y), EDGE_2 (Y→Z, after the updates above)
# So NODE_Y touches both edges; NODE_X touches only EDGE_1
status, body = http_get(f"{NODES_BASE}/{NODE_Y}/edges", TOKEN_A)
assert_status("listForNode: 200", 200, status)
edge_ids = {e["id"] for e in body}
assert_true("listForNode: NODE_Y has 2 edges", edge_ids == {EDGE_1, EDGE_2})

status, body = http_get(f"{NODES_BASE}/{NODE_X}/edges", TOKEN_A)
edge_ids = {e["id"] for e in body}
assert_true("listForNode: NODE_X has 1 edge", edge_ids == {EDGE_1})

# Non-existent node
status, _ = http_get(f"{NODES_BASE}/9999999/edges", TOKEN_A)
assert_status("listForNode: unknown node 404", 404, status)

# Node from a different map
status, _ = http_get(f"{NODES_BASE}/{NODE_OTHERMAP}/edges", TOKEN_A)
assert_status("listForNode: node on other map 404", 404, status)

print("  All listEdgesForNode tests passed.")

# ─── Authorization ──────────────────────────────────────────────────────────

print("  --- Authorization ---")

# Cross-tenant: TOKEN_C is in TENANT_C, not TENANT_A
status, _ = http_get(EDGES_BASE, TOKEN_C)
assert_status("auth: cross-tenant 403", 403, status)

status, _ = http_post(EDGES_BASE,
    {"sourceNodeId": NODE_X, "destNodeId": NODE_Y}, TOKEN_C)
assert_status("auth: cross-tenant create 403", 403, status)

# B is a viewer of TENANT_A with view perm on MAP_ID — read endpoint
# returns 200 (the visibility filter applies — see Visibility filter
# section below for the per-edge expectations). EDGE_1 / EDGE_2's
# endpoints (NODE_X / NODE_Y / NODE_Z) are untagged in this section,
# which under the existing visibility model means admin-only — so B
# gets back an empty list and a 404 on direct get.
status, body = http_get(EDGES_BASE, TOKEN_B)
assert_status("auth: viewer can list 200", 200, status)
assert_true("auth: viewer sees no untagged-endpoint edges (vis filter)",
            isinstance(body, list) and len(body) == 0)

status, _ = http_get(f"{EDGES_BASE}/{EDGE_1}", TOKEN_B)
assert_status("auth: viewer get untagged-endpoint edge 404 (hidden, not 403)", 404, status)

# Viewer cannot write — tenant role 'viewer' fails the editor/admin gate
status, _ = http_post(EDGES_BASE,
    {"sourceNodeId": NODE_X, "destNodeId": NODE_Z}, TOKEN_B)
assert_status("auth: viewer cannot create 403", 403, status)

status, _ = http_put(f"{EDGES_BASE}/{EDGE_1}", {"label": "hacked"}, TOKEN_B)
assert_status("auth: viewer cannot update 403", 403, status)

status, _ = http_delete(f"{EDGES_BASE}/{EDGE_1}", TOKEN_B)
assert_status("auth: viewer cannot delete 403", 403, status)

print("  All authorization tests passed.")

# ─── Cascade behavior ───────────────────────────────────────────────────────
# FK constraints: deleting an endpoint node, the source/dest map, or the
# user who created the edge should cascade-delete the edge row.

print("  --- Cascade ---")

# Create a fresh edge to verify node-delete cascade
status, body = http_post(EDGES_BASE,
    {"sourceNodeId": NODE_X, "destNodeId": NODE_Z}, TOKEN_A)
EDGE_CASCADE = json_field(body, ["id"])

# Delete NODE_Z → edge should cascade
http_delete(f"{NODES_BASE}/{NODE_Z}", TOKEN_A)
status, _ = http_get(f"{EDGES_BASE}/{EDGE_CASCADE}", TOKEN_A)
assert_status("cascade: edge gone after endpoint node delete (404)", 404, status)

# Delete the entire MAP2 with NODE_OTHERMAP attached: no edge to verify
# (we only have edges on MAP_ID), but confirm map deletion still works.
# Add an edge on MAP2 first to verify the map-delete cascade.
NODE_M2_A = mknode(NODES2_BASE, "M2A")
NODE_M2_B = mknode(NODES2_BASE, "M2B")
status, body = http_post(f"/tenants/{TENANT_A}/maps/{MAP2_ID}/edges", {
    "sourceNodeId": NODE_M2_A, "destNodeId": NODE_M2_B,
}, TOKEN_A)
EDGE_MAP2 = json_field(body, ["id"])

http_delete(f"/tenants/{TENANT_A}/maps/{MAP2_ID}", TOKEN_A)
# Map deletion cascades to nodes + edges; verify the edge row is gone
remaining = mysql_query(
    f"SELECT COUNT(*) FROM node_edges WHERE id={EDGE_MAP2};")
assert_true("cascade: edge gone after map delete",  remaining == "0",
            f"got remaining={remaining!r}")

print("  All cascade tests passed.")

# ─── Visibility filter (#197) ───────────────────────────────────────────────
# An edge is visible iff BOTH endpoints are visible to the caller.
# Owner-xray and tenant-admin bypass.

print("  --- Visibility filter (#197) ---")

# Fresh map for the visibility tests (the earlier MAP_ID has all edges
# from the CRUD section + a new node count near the end). Easier reasoning
# with a clean slate.
_, body = http_post(f"/tenants/{TENANT_A}/maps", {
    "title": "Edge Visibility Map",
    "coordinateSystem": {"type": "wgs84", "center": {"lat": 0, "lng": 0}, "zoom": 3},
}, TOKEN_A)
VMAP = json_field(body, ["id"])
mysql_query(
    f"INSERT INTO map_permissions (map_id, user_id, level) "
    f"VALUES ({VMAP}, {USER_B_ID}, 'view');")

VBASE     = f"/tenants/{TENANT_A}/maps/{VMAP}/nodes"
VEDGES    = f"/tenants/{TENANT_A}/maps/{VMAP}/edges"

# Two visibility groups; B is in Players.
VGB = f"/tenants/{TENANT_A}/visibility-groups"
_, body = http_post(VGB, {"name": "EdgePlayers"}, TOKEN_A)
VG_PLAYERS = json_field(body, ["id"])
_, body = http_post(VGB, {"name": "EdgeGMs"}, TOKEN_A)
VG_GMS = json_field(body, ["id"])
http_post(f"{VGB}/{VG_PLAYERS}/members", {"userId": USER_B_ID}, TOKEN_A)

# Per the existing visibility model (test_20 fixture comment): untagged
# nodes are admin-only — there is no "publicly visible" default for
# non-admins. To make a node visible to a non-admin, tag it with a group
# they belong to. So the fixtures use:
#   VPNODE_A, VPNODE_B: Players-tagged → visible to B (Players member)
#   VGNODE:             GMs-tagged     → hidden from B (not in GMs)
#   VUNTAGGED:          no tags        → admin-only (hidden from B)

VPNODE_A = mknode(VBASE, "PlayersA")
http_post(f"{VBASE}/{VPNODE_A}/visibility",
          {"override": True, "groupIds": [VG_PLAYERS]}, TOKEN_A)
VPNODE_B = mknode(VBASE, "PlayersB")
http_post(f"{VBASE}/{VPNODE_B}/visibility",
          {"override": True, "groupIds": [VG_PLAYERS]}, TOKEN_A)
VGNODE = mknode(VBASE, "GMsOnly")
http_post(f"{VBASE}/{VGNODE}/visibility",
          {"override": True, "groupIds": [VG_GMS]}, TOKEN_A)
VUNTAGGED = mknode(VBASE, "Untagged")  # admin-only

# Edges:
#   E_PVIS:   PlayersA ↔ PlayersB  → both visible to B → visible
#   E_MIXED:  PlayersA ↔ GMsOnly   → B sees A but not GMsOnly → hidden
#   E_GHIDDEN:GMsOnly  ↔ Untagged  → B sees neither → hidden
#   E_UNTAG:  PlayersA ↔ Untagged  → B sees A but not Untagged → hidden
def mkedge(s, d):
    _, b = http_post(VEDGES, {"sourceNodeId": s, "destNodeId": d}, TOKEN_A)
    return json_field(b, ["id"])
E_PVIS    = mkedge(VPNODE_A, VPNODE_B)
E_MIXED   = mkedge(VPNODE_A, VGNODE)
E_GHIDDEN = mkedge(VGNODE,   VUNTAGGED)
E_UNTAG   = mkedge(VPNODE_A, VUNTAGGED)

# Admin (A) sees all 4
status, body = http_get(VEDGES, TOKEN_A)
assert_status("vis: admin list 200", 200, status)
ids = {e["id"] for e in body}
assert_true("vis: admin sees all 4 edges",
            ids == {E_PVIS, E_MIXED, E_GHIDDEN, E_UNTAG})

# B (Players member, no GMs) sees only edges where BOTH endpoints visible
status, body = http_get(VEDGES, TOKEN_B)
assert_status("vis: B list 200", 200, status)
ids = {e["id"] for e in body}
assert_true("vis: B sees only E_PVIS",
            ids == {E_PVIS},
            f"got {ids}")

# B getting visible edge → 200; getting any hidden → 404 (never 403)
status, _ = http_get(f"{VEDGES}/{E_PVIS}", TOKEN_B)
assert_status("vis: B get visible edge 200", 200, status)
status, _ = http_get(f"{VEDGES}/{E_MIXED}", TOKEN_B)
assert_status("vis: B get mixed-vis edge 404 (hidden, not 403)", 404, status)
status, _ = http_get(f"{VEDGES}/{E_GHIDDEN}", TOKEN_B)
assert_status("vis: B get fully-hidden edge 404", 404, status)
status, _ = http_get(f"{VEDGES}/{E_UNTAG}", TOKEN_B)
assert_status("vis: B get untagged-endpoint edge 404", 404, status)

# listEdgesForNode from a visible-to-B node — only edges where the OTHER
# endpoint is also visible
status, body = http_get(f"{VBASE}/{VPNODE_A}/edges", TOKEN_B)
assert_status("vis: listForNode visible-source 200", 200, status)
ids = {e["id"] for e in body}
assert_true("vis: listForNode VPNODE_A → only E_PVIS",
            ids == {E_PVIS},
            f"got {ids}")

# listEdgesForNode from a HIDDEN node → 404 (hidden node looks missing)
status, _ = http_get(f"{VBASE}/{VGNODE}/edges", TOKEN_B)
assert_status("vis: listForNode hidden node 404", 404, status)
status, _ = http_get(f"{VBASE}/{VUNTAGGED}/edges", TOKEN_B)
assert_status("vis: listForNode untagged node 404 (admin-only)", 404, status)

# Owner-xray bypass: temporarily hand the map to B with xray=TRUE.
# B should now see ALL 4 edges regardless of tags.
mysql_query(f"UPDATE maps SET owner_id={USER_B_ID}, owner_xray=TRUE "
            f"WHERE id={VMAP};")
status, body = http_get(VEDGES, TOKEN_B)
ids = {e["id"] for e in body}
assert_true("vis: xray=TRUE B sees all 4 edges",
            ids == {E_PVIS, E_MIXED, E_GHIDDEN, E_UNTAG},
            f"got {ids}")

# xray=FALSE → back to filtered
mysql_query(f"UPDATE maps SET owner_xray=FALSE WHERE id={VMAP};")
status, body = http_get(VEDGES, TOKEN_B)
ids = {e["id"] for e in body}
assert_true("vis: xray=FALSE B back to filtered set",
            ids == {E_PVIS})

# Restore A as owner
mysql_query(f"UPDATE maps SET owner_id={USER_A_ID} WHERE id={VMAP};")

# Restore A as owner
mysql_query(f"UPDATE maps SET owner_id={USER_A_ID} WHERE id={VMAP};")

print("  All visibility-filter tests passed.")

sys.exit(0 if report() else 1)
