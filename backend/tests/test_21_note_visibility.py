#!/usr/bin/env python3
"""test_21_note_visibility.py — Phase 2b.iii: Note visibility tagging +
read-time filtering (note → node → parent chain inheritance).

Two halves:
  1. Tagging endpoints (mirror of #86 tests for nodes).
  2. Effective-visibility filter on listNotes + getNote, including
     admin bypass, owner_xray, and the cross-table (note → node → up
     parent chain) inheritance walk.

Same SQL fixtures as test_20: B becomes a same-org `viewer` member of
A's tenant + has explicit map view permission.
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

print("=== Note Visibility Tests ===")

# ─── Setup ───────────────────────────────────────────────────────────────────

TOKEN_A = register_user(f"t21_a_{RUN_ID}", f"t21_a_{RUN_ID}@test.com", "testpass123")
_, body_a = http_post("/auth/login",
    {"email": f"t21_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A   = json_field(body_a, ["tenantId"])
USER_A_ID  = json_field(body_a, ["user", "id"])

TOKEN_B = register_user(f"t21_b_{RUN_ID}", f"t21_b_{RUN_ID}@test.com", "testpass123")
_, body_b = http_post("/auth/login",
    {"email": f"t21_b_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_B  = json_field(body_b, ["tenantId"])
USER_B_ID = json_field(body_b, ["user", "id"])

# Move B into A's org + insert as viewer (same fixture as test_20).
A_ORG_ID = mysql_query(f"SELECT org_id FROM users WHERE id={USER_A_ID};")
mysql_query(f"UPDATE users SET org_id={A_ORG_ID} WHERE id={USER_B_ID};")
mysql_query(
    f"INSERT INTO tenant_members (tenant_id, user_id, role) "
    f"VALUES ({TENANT_A}, {USER_B_ID}, 'viewer');")

_, body = http_post(f"/tenants/{TENANT_A}/maps", {
    "title": "Note Vis Map",
    "coordinateSystem": {"type": "wgs84", "center": {"lat": 0, "lng": 0}, "zoom": 3},
}, TOKEN_A)
MAP_ID = json_field(body, ["id"])

mysql_query(
    f"INSERT INTO map_permissions (map_id, user_id, level) "
    f"VALUES ({MAP_ID}, {USER_B_ID}, 'view');")

VG_BASE = f"/tenants/{TENANT_A}/visibility-groups"
_, body = http_post(VG_BASE, {"name": "Players"}, TOKEN_A)
G_PLAYERS = json_field(body, ["id"])
_, body = http_post(VG_BASE, {"name": "GMs"}, TOKEN_A)
G_GMS = json_field(body, ["id"])
http_post(f"{VG_BASE}/{G_PLAYERS}/members", {"userId": USER_B_ID}, TOKEN_A)

# Build the node tree:
#   Root (no override)
#   ├── Pin (no override)
#   ├── PlayersBranch (override=TRUE, [Players])
#   └── GmBranch (override=TRUE, [GMs])
#       └── DeepChild (no override)            ← inherits GMs
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

ROOT            = mknode("Root")
PIN             = mknode("Pin", ROOT)
PLAYERS_BRANCH  = mknode("PlayersBranch", ROOT); settag_node(PLAYERS_BRANCH, True, [G_PLAYERS])
GM_BRANCH       = mknode("GmBranch", ROOT);      settag_node(GM_BRANCH,      True, [G_GMS])
DEEP_CHILD      = mknode("DeepChild", GM_BRANCH)

def mknote(node_id, title, text="text"):
    _, b = http_post(f"{NODES_BASE}/{node_id}/notes",
                     {"title": title, "text": text}, TOKEN_A)
    return json_field(b, ["id"])

# Notes attached to various nodes, with various override states:
NOTE_PIN_INHERIT  = mknote(PIN,            "InheritFromPin")          # → admin-only via Root
NOTE_PLR_INHERIT  = mknote(PLAYERS_BRANCH, "InheritFromPlayers")      # → Players via node
NOTE_GM_INHERIT   = mknote(GM_BRANCH,      "InheritFromGm")           # → GMs via node
NOTE_DEEP_INHERIT = mknote(DEEP_CHILD,     "InheritFromDeep")         # → walks up to GM_BRANCH
NOTE_PLR_OWN      = mknote(GM_BRANCH,      "OwnPlayersOverride")      # node says GM but…
NOTE_GM_OWN       = mknote(PLAYERS_BRANCH, "OwnGmOverride")           # node says Players but…
NOTE_LOCK         = mknote(PLAYERS_BRANCH, "ExplicitLock")            # override TRUE, empty tags

NOTES_VIS_BASE = f"/tenants/{TENANT_A}/maps/{MAP_ID}/notes"

def settag_note(note_id, override, group_ids):
    return http_post(f"{NOTES_VIS_BASE}/{note_id}/visibility",
                     {"override": override, "groupIds": group_ids}, TOKEN_A)

# Apply note-level overrides
settag_note(NOTE_PLR_OWN, True, [G_PLAYERS])
settag_note(NOTE_GM_OWN,  True, [G_GMS])
settag_note(NOTE_LOCK,    True, [])

# B should be able to see (after all settings):
#   NOTE_PLR_INHERIT (inherits Players-tagged node)
#   NOTE_PLR_OWN     (own override Players)
B_VISIBLE_NOTES = {NOTE_PLR_INHERIT, NOTE_PLR_OWN}
ALL_NOTES       = {NOTE_PIN_INHERIT, NOTE_PLR_INHERIT, NOTE_GM_INHERIT,
                   NOTE_DEEP_INHERIT, NOTE_PLR_OWN, NOTE_GM_OWN, NOTE_LOCK}

# ─── Tagging endpoint: GET ───────────────────────────────────────────────────

print("  --- GET visibility ---")

vis_path = f"{NOTES_VIS_BASE}/{NOTE_PLR_OWN}/visibility"
status, body = http_get(vis_path, TOKEN_A)
assert_status("get-vis: returns 200", 200, status)
assert_json_field("get-vis: noteId", body, ["noteId"], str(NOTE_PLR_OWN))
assert_json_field("get-vis: override TRUE", body, ["override"], "True")
assert_true("get-vis: groupIds = [Players]", body["groupIds"] == [G_PLAYERS])

# Unknown note → 404
status, _ = http_get(f"{NOTES_VIS_BASE}/9999999/visibility", TOKEN_A)
assert_status("get-vis: unknown note returns 404", 404, status)

# Cross-tenant blocked at TenantFilter
status, _ = http_get(vis_path, TOKEN_B)  # B is tenant_member viewer
# Note: B is a member of A's tenant, so TenantFilter allows. The endpoint
# itself doesn't restrict reads to managers — that mirrors NodeController's
# getVisibility behavior. So B gets 200 here.
assert_status("get-vis: tenant member sees raw state", 200, status)

print("  All GET-visibility tests passed.")

# ─── Tagging endpoint: POST ──────────────────────────────────────────────────

print("  --- POST visibility ---")

# Override-only call leaves tags untouched
status, _ = http_post(vis_path, {"override": False}, TOKEN_A)
assert_status("set-vis: override-only returns 204", 204, status)
status, body = http_get(vis_path, TOKEN_A)
assert_json_field("set-vis: override flipped", body, ["override"], "False")
assert_true("set-vis: tags survived flip", body["groupIds"] == [G_PLAYERS])

# Restore for the filter tests that follow
http_post(vis_path, {"override": True, "groupIds": [G_PLAYERS]}, TOKEN_A)

# Empty body
status, _ = http_post(vis_path, {}, TOKEN_A)
assert_status("set-vis: empty body 400", 400, status)

# Cross-tenant group rejected
_, body = http_post(f"/tenants/{TENANT_B}/visibility-groups",
                    {"name": "OtherTenantGroup"}, TOKEN_B)
G_OTHER = json_field(body, ["id"])
status, _ = http_post(vis_path, {"groupIds": [G_OTHER]}, TOKEN_A)
assert_status("set-vis: cross-tenant groupId 400", 400, status)

# Unknown note id
status, _ = http_post(f"{NOTES_VIS_BASE}/9999999/visibility",
                      {"override": True}, TOKEN_A)
assert_status("set-vis: unknown note 404", 404, status)

print("  All POST-visibility tests passed.")

# ─── Admin bypass on listNotes + getNote ─────────────────────────────────────
# Admin should see every note attached to every node, regardless of
# override or tagging state.

print("  --- Admin bypass ---")

for node_id in [PIN, PLAYERS_BRANCH, GM_BRANCH, DEEP_CHILD]:
    status, body = http_get(f"{NODES_BASE}/{node_id}/notes", TOKEN_A)
    assert_status(f"admin: listNotes node {node_id} returns 200", 200, status)
    # Just make sure the list isn't empty if the node has notes attached.
    expected = sum(1 for nid in [
        (PIN, NOTE_PIN_INHERIT),
        (PLAYERS_BRANCH, NOTE_PLR_INHERIT), (PLAYERS_BRANCH, NOTE_GM_OWN),
        (PLAYERS_BRANCH, NOTE_LOCK),
        (GM_BRANCH, NOTE_GM_INHERIT), (GM_BRANCH, NOTE_PLR_OWN),
        (DEEP_CHILD, NOTE_DEEP_INHERIT),
    ] if nid[0] == node_id)
    assert_true(f"admin: list under {node_id} contains {expected} notes",
                len(body) == expected)

for note_id in ALL_NOTES:
    status, _ = http_get(f"{NOTES_VIS_BASE}/{note_id}", TOKEN_A)
    assert_status(f"admin: getNote {note_id} returns 200", 200, status)

print("  All admin-bypass tests passed.")

# ─── Non-admin filter on listNotes + getNote ─────────────────────────────────

print("  --- Non-admin filter ---")

# Listing under PIN (a Root-fallback node) — should be empty for B.
status, body = http_get(f"{NODES_BASE}/{PIN}/notes", TOKEN_B)
assert_status("B: listNotes under Pin returns 200", 200, status)
assert_true("B: no notes visible under admin-only node",
            len(body) == 0)

# Listing under PlayersBranch — B sees the inherit + own-override, but
# NOT the GM-override note attached to that same node, NOR the lock.
status, body = http_get(f"{NODES_BASE}/{PLAYERS_BRANCH}/notes", TOKEN_B)
ids = {n["id"] for n in body}
assert_true("B: listNotes under PlayersBranch = {InheritFromPlayers}",
            ids == {NOTE_PLR_INHERIT})

# Listing under GmBranch — B sees only the note that overrides itself
# back to Players, NOT the inheriting note (which goes to GMs).
status, body = http_get(f"{NODES_BASE}/{GM_BRANCH}/notes", TOKEN_B)
ids = {n["id"] for n in body}
assert_true("B: listNotes under GmBranch = {OwnPlayersOverride}",
            ids == {NOTE_PLR_OWN})

# Listing under DeepChild — note inherits via DeepChild → GmBranch (GMs).
# B isn't in GMs, so the list is empty.
status, body = http_get(f"{NODES_BASE}/{DEEP_CHILD}/notes", TOKEN_B)
assert_true("B: listNotes under DeepChild empty (inherits GMs)",
            len(body) == 0)

# getNote: 200 for visible, 404 for hidden.
for note_id in B_VISIBLE_NOTES:
    status, _ = http_get(f"{NOTES_VIS_BASE}/{note_id}", TOKEN_B)
    assert_status(f"B: getNote visible {note_id} returns 200", 200, status)
for note_id in ALL_NOTES - B_VISIBLE_NOTES:
    status, _ = http_get(f"{NOTES_VIS_BASE}/{note_id}", TOKEN_B)
    assert_status(f"B: getNote hidden {note_id} returns 404", 404, status)

print("  All non-admin-filter tests passed.")

# ─── owner_xray bypass for notes ─────────────────────────────────────────────

print("  --- owner_xray ---")

mysql_query(f"UPDATE maps SET owner_id={USER_B_ID}, owner_xray=TRUE WHERE id={MAP_ID};")

status, body = http_get(f"{NODES_BASE}/{GM_BRANCH}/notes", TOKEN_B)
ids = {n["id"] for n in body}
assert_true("xray=TRUE owner: sees every note under GmBranch",
            ids == {NOTE_GM_INHERIT, NOTE_PLR_OWN})
status, _ = http_get(f"{NOTES_VIS_BASE}/{NOTE_LOCK}", TOKEN_B)
assert_status("xray=TRUE owner: explicit-lock note 200", 200, status)

mysql_query(f"UPDATE maps SET owner_xray=FALSE WHERE id={MAP_ID};")
status, _ = http_get(f"{NOTES_VIS_BASE}/{NOTE_LOCK}", TOKEN_B)
assert_status("xray=FALSE owner: lock note 404 again", 404, status)
mysql_query(f"UPDATE maps SET owner_id={USER_A_ID} WHERE id={MAP_ID};")

print("  All owner_xray tests passed.")

# ─── Cleanup CASCADE ─────────────────────────────────────────────────────────

print("  --- Cleanup cascade ---")

# Re-tag NOTE_PLR_OWN with both groups
http_post(f"{NOTES_VIS_BASE}/{NOTE_PLR_OWN}/visibility",
          {"override": True, "groupIds": [G_PLAYERS, G_GMS]}, TOKEN_A)
status, body = http_get(f"{NOTES_VIS_BASE}/{NOTE_PLR_OWN}/visibility", TOKEN_A)
assert_true("cleanup: re-tagged with both",
            sorted(body["groupIds"]) == sorted([G_PLAYERS, G_GMS]))

# Delete G_PLAYERS — note_visibility row should CASCADE
http_delete(f"{VG_BASE}/{G_PLAYERS}", TOKEN_A)
status, body = http_get(f"{NOTES_VIS_BASE}/{NOTE_PLR_OWN}/visibility", TOKEN_A)
assert_true("cleanup: cascade dropped Players row", body["groupIds"] == [G_GMS])

# Deleting the underlying note should also cascade away its visibility rows
NOTE_TOMBSTONE = mknote(PLAYERS_BRANCH, "ToCascade")
http_post(f"{NOTES_VIS_BASE}/{NOTE_TOMBSTONE}/visibility",
          {"override": True, "groupIds": [G_GMS]}, TOKEN_A)
http_delete(f"{NOTES_VIS_BASE}/{NOTE_TOMBSTONE}", TOKEN_A)
remaining = mysql_query(
    f"SELECT COUNT(*) FROM note_visibility WHERE note_id={NOTE_TOMBSTONE};")
assert_true("cleanup: note delete cascaded note_visibility",
            remaining == "0")

print("  All cleanup tests passed.")

sys.exit(0 if report() else 1)
