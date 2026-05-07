#!/usr/bin/env python3
"""test_23_tree_navigation.py — Phase 2d (#89): tree navigation endpoints.

Covers:
  - GET /nodes/{id}/children — direct children, visibility-filtered
  - GET /nodes/{id}/subtree  — recursive descent with depth, paginated,
    visibility-filtered, hidden-root → 404

Setup mirrors test_20/21/22:
  - A is tenant admin in T_A.
  - B is moved into A's org, added as 'viewer' tenant_member of T_A,
    granted map view permission, and added to the Players visibility group.
"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_json_field, assert_true,
    http_post, http_get,
    register_user, json_field, mysql_query,
)

reset_counters()
RUN_ID = os.getpid()

print("=== Tree Navigation Tests ===")

# ─── Setup ───────────────────────────────────────────────────────────────────

TOKEN_A = register_user(f"t23_a_{RUN_ID}", f"t23_a_{RUN_ID}@test.com", "testpass123")
_, body_a = http_post("/auth/login",
    {"email": f"t23_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A   = json_field(body_a, ["tenantId"])
USER_A_ID  = json_field(body_a, ["user", "id"])

TOKEN_B = register_user(f"t23_b_{RUN_ID}", f"t23_b_{RUN_ID}@test.com", "testpass123")
_, body_b = http_post("/auth/login",
    {"email": f"t23_b_{RUN_ID}@test.com", "password": "testpass123"})
USER_B_ID = json_field(body_b, ["user", "id"])

# Move B into A's org + insert as viewer.
A_ORG_ID = mysql_query(f"SELECT org_id FROM users WHERE id={USER_A_ID};")
mysql_query(f"UPDATE users SET org_id={A_ORG_ID} WHERE id={USER_B_ID};")
mysql_query(
    f"INSERT INTO tenant_members (tenant_id, user_id, role) "
    f"VALUES ({TENANT_A}, {USER_B_ID}, 'viewer');")

# A creates a map; grant B view permission.
_, body = http_post(f"/tenants/{TENANT_A}/maps", {
    "title": "Tree Test Map",
    "coordinateSystem": {"type": "wgs84", "center": {"lat": 0, "lng": 0}, "zoom": 3},
}, TOKEN_A)
MAP_ID = json_field(body, ["id"])
mysql_query(
    f"INSERT INTO map_permissions (map_id, user_id, level) "
    f"VALUES ({MAP_ID}, {USER_B_ID}, 'view');")

# Visibility groups + B in Players.
VG_BASE = f"/tenants/{TENANT_A}/visibility-groups"
_, body = http_post(VG_BASE, {"name": "Players"}, TOKEN_A)
G_PLAYERS = json_field(body, ["id"])
_, body = http_post(VG_BASE, {"name": "GMs"}, TOKEN_A)
G_GMS = json_field(body, ["id"])
http_post(f"{VG_BASE}/{G_PLAYERS}/members", {"userId": USER_B_ID}, TOKEN_A)

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

# Tree:
#   Root (no override, admin-only via fallback)
#   ├── PlayersBranch (override=TRUE, [Players])
#   │   ├── PlayersChild (no override, inherits Players → visible to B)
#   │   └── PlayersGrandchild (no override, inherits Players)
#   ├── GmBranch (override=TRUE, [GMs])
#   │   └── GmChild (no override, inherits GMs → hidden from B)
#   └── PublicBranch (override=TRUE, [Players])
#       └── PublicChild (no override, inherits Players)

ROOT             = mknode("Root")
PLAYERS_BRANCH   = mknode("PlayersBranch", ROOT);   settag(PLAYERS_BRANCH, True, [G_PLAYERS])
PLAYERS_CHILD    = mknode("PlayersChild", PLAYERS_BRANCH)
PLAYERS_GRAND    = mknode("PlayersGrand", PLAYERS_CHILD)
GM_BRANCH        = mknode("GmBranch", ROOT);        settag(GM_BRANCH, True, [G_GMS])
GM_CHILD         = mknode("GmChild", GM_BRANCH)
PUBLIC_BRANCH    = mknode("PublicBranch", ROOT);    settag(PUBLIC_BRANCH, True, [G_PLAYERS])
PUBLIC_CHILD     = mknode("PublicChild", PUBLIC_BRANCH)

ALL_NODES = {ROOT, PLAYERS_BRANCH, PLAYERS_CHILD, PLAYERS_GRAND,
             GM_BRANCH, GM_CHILD, PUBLIC_BRANCH, PUBLIC_CHILD}
B_VISIBLE = {PLAYERS_BRANCH, PLAYERS_CHILD, PLAYERS_GRAND,
             PUBLIC_BRANCH, PUBLIC_CHILD}

# ─── /children — direct children only ────────────────────────────────────────

print("  --- /children (admin) ---")

# Admin sees all 3 direct children of Root
status, body = http_get(f"{NODES_BASE}/{ROOT}/children", TOKEN_A)
assert_status("admin: children of Root returns 200", 200, status)
ids = {n["id"] for n in body}
assert_true("admin: 3 direct children",
            ids == {PLAYERS_BRANCH, GM_BRANCH, PUBLIC_BRANCH})

# Admin sees the leaf's empty children
status, body = http_get(f"{NODES_BASE}/{PLAYERS_GRAND}/children", TOKEN_A)
assert_status("admin: leaf children returns 200", 200, status)
assert_true("admin: leaf has no children", len(body) == 0)

print("  All admin /children tests passed.")

print("  --- /children (non-admin) ---")

# B only sees the Players-visible direct children of Root: PlayersBranch + PublicBranch
# (Root's visibility resolves to admin-only, but B can see specific children that
# have their own override=TRUE pointing at Players.)
status, body = http_get(f"{NODES_BASE}/{ROOT}/children", TOKEN_B)
assert_status("B: children of Root returns 200", 200, status)
ids = {n["id"] for n in body}
assert_true("B: only Players-visible direct children",
            ids == {PLAYERS_BRANCH, PUBLIC_BRANCH})

# Children of GmBranch: B can't see GmBranch, so empty
status, body = http_get(f"{NODES_BASE}/{GM_BRANCH}/children", TOKEN_B)
assert_status("B: children of hidden parent returns 200", 200, status)
assert_true("B: hidden parent's children empty (per leak-safe spec)",
            len(body) == 0)

# Children of PlayersBranch: B sees PlayersChild
status, body = http_get(f"{NODES_BASE}/{PLAYERS_BRANCH}/children", TOKEN_B)
ids = {n["id"] for n in body}
assert_true("B: children of PlayersBranch", ids == {PLAYERS_CHILD})

print("  All non-admin /children tests passed.")

# ─── /subtree — recursive descent with depth ─────────────────────────────────

print("  --- /subtree (admin) ---")

# Full tree from Root
status, body = http_get(f"{NODES_BASE}/{ROOT}/subtree", TOKEN_A)
assert_status("admin: subtree from Root returns 200", 200, status)
ids = {n["id"] for n in body["nodes"]}
assert_true("admin: subtree contains all 8 nodes", ids == ALL_NODES)

# Verify depth values
depth_by_id = {n["id"]: n["depth"] for n in body["nodes"]}
assert_true("admin: Root depth = 0",            depth_by_id[ROOT] == 0)
assert_true("admin: PlayersBranch depth = 1",   depth_by_id[PLAYERS_BRANCH] == 1)
assert_true("admin: PlayersChild depth = 2",    depth_by_id[PLAYERS_CHILD] == 2)
assert_true("admin: PlayersGrand depth = 3",    depth_by_id[PLAYERS_GRAND] == 3)
assert_true("admin: GmBranch depth = 1",        depth_by_id[GM_BRANCH] == 1)

# nextCursor null when full subtree fits in one page
assert_true("admin: nextCursor null when no more pages",
            body.get("nextCursor") is None)

# Subtree from a leaf returns just the leaf
status, body = http_get(f"{NODES_BASE}/{PLAYERS_GRAND}/subtree", TOKEN_A)
assert_true("admin: leaf subtree contains only itself",
            len(body["nodes"]) == 1 and body["nodes"][0]["id"] == PLAYERS_GRAND)
assert_true("admin: leaf subtree depth=0",
            body["nodes"][0]["depth"] == 0)

# Unknown node → 404
status, _ = http_get(f"{NODES_BASE}/9999999/subtree", TOKEN_A)
assert_status("admin: unknown node 404", 404, status)

print("  All admin /subtree tests passed.")

print("  --- /subtree (non-admin) ---")

# B requesting subtree from Root → 404 (Root is admin-only-visible, hidden from B)
status, _ = http_get(f"{NODES_BASE}/{ROOT}/subtree", TOKEN_B)
assert_status("B: subtree from hidden root returns 404", 404, status)

# B requesting subtree from PlayersBranch → sees PlayersBranch, PlayersChild, PlayersGrand
status, body = http_get(f"{NODES_BASE}/{PLAYERS_BRANCH}/subtree", TOKEN_B)
assert_status("B: subtree from visible PlayersBranch returns 200", 200, status)
ids = {n["id"] for n in body["nodes"]}
assert_true("B: PlayersBranch subtree = {PB, PC, PG}",
            ids == {PLAYERS_BRANCH, PLAYERS_CHILD, PLAYERS_GRAND})
depth_by_id = {n["id"]: n["depth"] for n in body["nodes"]}
assert_true("B: PlayersBranch depth = 0 (subtree root)",
            depth_by_id[PLAYERS_BRANCH] == 0)
assert_true("B: PlayersChild depth = 1",
            depth_by_id[PLAYERS_CHILD] == 1)

# B requesting subtree from GmBranch → 404 (hidden)
status, _ = http_get(f"{NODES_BASE}/{GM_BRANCH}/subtree", TOKEN_B)
assert_status("B: subtree from hidden GmBranch returns 404", 404, status)

print("  All non-admin /subtree tests passed.")

# ─── Pagination ──────────────────────────────────────────────────────────────

print("  --- /subtree pagination ---")

# Full subtree with limit=3 → 3 nodes + nextCursor
status, body = http_get(f"{NODES_BASE}/{ROOT}/subtree?limit=3", TOKEN_A)
assert_status("paginate: limit=3 returns 200", 200, status)
assert_true("paginate: 3 nodes returned", len(body["nodes"]) == 3)
assert_true("paginate: nextCursor present",
            body.get("nextCursor") is not None)
first_page_ids = [n["id"] for n in body["nodes"]]

# Follow the cursor for page 2
cursor = body["nextCursor"]
status, body = http_get(f"{NODES_BASE}/{ROOT}/subtree?limit=3&cursor={cursor}", TOKEN_A)
assert_status("paginate: cursored page 2 returns 200", 200, status)
second_page_ids = [n["id"] for n in body["nodes"]]
assert_true("paginate: page 2 has fresh ids",
            set(first_page_ids).isdisjoint(set(second_page_ids)))

# Final page (limit=3 covers everything from cursor onward; ≤3 results, no nextCursor)
final_cursor = body.get("nextCursor")
if final_cursor is not None:
    status, body = http_get(
        f"{NODES_BASE}/{ROOT}/subtree?limit=3&cursor={final_cursor}", TOKEN_A)
    assert_true("paginate: final page nextCursor null",
                body.get("nextCursor") is None)

# Bad limit values
status, _ = http_get(f"{NODES_BASE}/{ROOT}/subtree?limit=0", TOKEN_A)
assert_status("paginate: limit=0 returns 400", 400, status)
status, _ = http_get(f"{NODES_BASE}/{ROOT}/subtree?limit=501", TOKEN_A)
assert_status("paginate: limit > 500 returns 400", 400, status)
status, _ = http_get(f"{NODES_BASE}/{ROOT}/subtree?limit=abc", TOKEN_A)
assert_status("paginate: non-integer limit returns 400", 400, status)
status, _ = http_get(f"{NODES_BASE}/{ROOT}/subtree?cursor=xyz", TOKEN_A)
assert_status("paginate: non-integer cursor returns 400", 400, status)

print("  All pagination tests passed.")

# ─── Cross-tenant blocked ────────────────────────────────────────────────────

print("  --- Cross-tenant blocked ---")

# A different unauthenticated tenant — register a third user in their own
# tenant, try to hit T_A's nodes.
TOKEN_C = register_user(f"t23_c_{RUN_ID}", f"t23_c_{RUN_ID}@test.com", "testpass123")
status, _ = http_get(f"{NODES_BASE}/{ROOT}/children", TOKEN_C)
assert_status("cross-tenant: /children blocked at TenantFilter", 403, status)
status, _ = http_get(f"{NODES_BASE}/{ROOT}/subtree", TOKEN_C)
assert_status("cross-tenant: /subtree blocked at TenantFilter", 403, status)

print("  All cross-tenant tests passed.")

# ─── Owner-xray bypass on subtree ────────────────────────────────────────────
# When B becomes the map owner with owner_xray=TRUE, the subtree from Root
# (otherwise hidden from B) should return the full tree.

print("  --- owner_xray on subtree ---")

mysql_query(f"UPDATE maps SET owner_id={USER_B_ID}, owner_xray=TRUE WHERE id={MAP_ID};")

status, body = http_get(f"{NODES_BASE}/{ROOT}/subtree", TOKEN_B)
assert_status("xray=TRUE: B sees subtree from Root", 200, status)
ids = {n["id"] for n in body["nodes"]}
assert_true("xray=TRUE: B sees all 8 nodes", ids == ALL_NODES)

mysql_query(f"UPDATE maps SET owner_xray=FALSE WHERE id={MAP_ID};")
status, _ = http_get(f"{NODES_BASE}/{ROOT}/subtree", TOKEN_B)
assert_status("xray=FALSE: B back to 404", 404, status)
mysql_query(f"UPDATE maps SET owner_id={USER_A_ID} WHERE id={MAP_ID};")

print("  All owner_xray tests passed.")

sys.exit(0 if report() else 1)
