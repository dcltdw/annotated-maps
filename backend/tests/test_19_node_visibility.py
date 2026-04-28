#!/usr/bin/env python3
"""test_19_node_visibility.py — Phase 2b.ii.a: Node visibility tagging endpoints.

Covers POST/GET /tenants/{tid}/maps/{mid}/nodes/{nid}/visibility:
  - Auth: tenant admins always allowed; non-admin manages_visibility
    member also allowed; cross-tenant blocked at TenantFilter.
  - GET returns raw stored state (override + groupIds list).
  - POST replaces entire tag set when groupIds present; leaves it alone
    when omitted; tags survive override flips.
  - Cross-tenant groupId rejected (400).
  - Bad shapes (non-array groupIds, non-bool override, missing both) → 400.
  - Unknown node → 404.
"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_json_field, assert_true,
    http_post, http_get, http_put, http_delete,
    register_user, json_field,
)

reset_counters()
RUN_ID = os.getpid()

print("=== Node Visibility Tagging Tests ===")

# ─── Setup ───────────────────────────────────────────────────────────────────
# A is a tenant admin in their own tenant.
TOKEN_A = register_user(f"t19_a_{RUN_ID}", f"t19_a_{RUN_ID}@test.com", "testpass123")
_, body_a = http_post("/auth/login",
    {"email": f"t19_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A = json_field(body_a, ["tenantId"])
USER_A_ID = json_field(body_a, ["user", "id"])

# B is a tenant admin in a *different* tenant — used for cross-tenant checks.
TOKEN_B = register_user(f"t19_b_{RUN_ID}", f"t19_b_{RUN_ID}@test.com", "testpass123")
_, body_b = http_post("/auth/login",
    {"email": f"t19_b_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_B = json_field(body_b, ["tenantId"])

# A creates a map and three nodes.
_, body = http_post(f"/tenants/{TENANT_A}/maps", {
    "title": "Vis Test Map",
    "coordinateSystem": {"type": "wgs84", "center": {"lat": 0, "lng": 0}, "zoom": 3},
}, TOKEN_A)
MAP_A = json_field(body, ["id"])

NODES_BASE = f"/tenants/{TENANT_A}/maps/{MAP_A}/nodes"
_, body = http_post(NODES_BASE, {"name": "Root"}, TOKEN_A)
ROOT = json_field(body, ["id"])
_, body = http_post(NODES_BASE, {"name": "Child", "parentId": ROOT}, TOKEN_A)
CHILD = json_field(body, ["id"])

# A creates two visibility groups in their tenant.
VG_BASE = f"/tenants/{TENANT_A}/visibility-groups"
_, body = http_post(VG_BASE, {"name": "Players"}, TOKEN_A)
G_PLAYERS = json_field(body, ["id"])
_, body = http_post(VG_BASE, {"name": "GMs"}, TOKEN_A)
G_GMS = json_field(body, ["id"])

# B creates a visibility group in *their* tenant — used to verify the
# cross-tenant group rejection.
_, body = http_post(f"/tenants/{TENANT_B}/visibility-groups",
    {"name": "OtherTenantGroup"}, TOKEN_B)
G_OTHER = json_field(body, ["id"])

# ─── GET (initial state) ─────────────────────────────────────────────────────

print("  --- GET (initial) ---")

VIS_ROOT = f"{NODES_BASE}/{ROOT}/visibility"
status, body = http_get(VIS_ROOT, TOKEN_A)
assert_status("get: returns 200", 200, status)
assert_json_field("get: nodeId", body, ["nodeId"], str(ROOT))
assert_json_field("get: override defaults false", body, ["override"], "False")
assert_true("get: groupIds empty initially",
            isinstance(body.get("groupIds"), list) and body["groupIds"] == [])

# Unknown node → 404
status, _ = http_get(f"{NODES_BASE}/9999999/visibility", TOKEN_A)
assert_status("get: unknown node returns 404", 404, status)

# Cross-tenant blocked at TenantFilter (uses TENANT_A in URL but TOKEN_B)
status, _ = http_get(VIS_ROOT, TOKEN_B)
assert_status("get: cross-tenant blocked", 403, status)

print("  All GET-initial tests passed.")

# ─── POST (set tags + override) ──────────────────────────────────────────────

print("  --- POST (set) ---")

# Set both override and tags in one call
status, _ = http_post(VIS_ROOT,
    {"override": True, "groupIds": [G_PLAYERS, G_GMS]}, TOKEN_A)
assert_status("set: override+tags returns 204", 204, status)

# GET reflects new state
status, body = http_get(VIS_ROOT, TOKEN_A)
assert_json_field("set: override now true", body, ["override"], "True")
assert_true("set: groupIds contains both",
            sorted(body["groupIds"]) == sorted([G_PLAYERS, G_GMS]))

# Override-only call (omit groupIds) leaves tags untouched
status, _ = http_post(VIS_ROOT, {"override": False}, TOKEN_A)
assert_status("set: override-only returns 204", 204, status)
status, body = http_get(VIS_ROOT, TOKEN_A)
assert_json_field("set: override flipped to false", body, ["override"], "False")
assert_true("set: tags survived override flip",
            sorted(body["groupIds"]) == sorted([G_PLAYERS, G_GMS]))

# groupIds-only call (omit override) replaces tags but leaves override alone
status, _ = http_post(VIS_ROOT, {"groupIds": [G_PLAYERS]}, TOKEN_A)
assert_status("set: groupIds-only returns 204", 204, status)
status, body = http_get(VIS_ROOT, TOKEN_A)
assert_json_field("set: override unchanged (false)", body, ["override"], "False")
assert_true("set: tags now [Players]",
            body["groupIds"] == [G_PLAYERS])

# Empty groupIds clears the tag set
status, _ = http_post(VIS_ROOT, {"groupIds": []}, TOKEN_A)
assert_status("set: empty groupIds returns 204", 204, status)
status, body = http_get(VIS_ROOT, TOKEN_A)
assert_true("set: tags cleared", body["groupIds"] == [])

print("  All POST tests passed.")

# ─── Validation ──────────────────────────────────────────────────────────────

print("  --- Validation ---")

# Empty body: must include override or groupIds
status, _ = http_post(VIS_ROOT, {}, TOKEN_A)
assert_status("validate: empty body returns 400", 400, status)

# Non-array groupIds
status, _ = http_post(VIS_ROOT, {"groupIds": "nope"}, TOKEN_A)
assert_status("validate: groupIds non-array returns 400", 400, status)

# Non-int element in groupIds
status, _ = http_post(VIS_ROOT, {"groupIds": ["x"]}, TOKEN_A)
assert_status("validate: groupIds non-int element returns 400", 400, status)

# Group from another tenant
status, _ = http_post(VIS_ROOT, {"groupIds": [G_OTHER]}, TOKEN_A)
assert_status("validate: cross-tenant groupId returns 400", 400, status)

# Mixed (one valid, one cross-tenant) — still rejected
status, _ = http_post(VIS_ROOT,
    {"groupIds": [G_PLAYERS, G_OTHER]}, TOKEN_A)
assert_status("validate: mixed valid+cross-tenant rejected", 400, status)

# Unknown node id
status, _ = http_post(f"{NODES_BASE}/9999999/visibility",
    {"override": True}, TOKEN_A)
assert_status("validate: unknown node returns 404", 404, status)

# Cross-tenant POST blocked at TenantFilter
status, _ = http_post(VIS_ROOT, {"override": True}, TOKEN_B)
assert_status("validate: cross-tenant POST blocked", 403, status)

print("  All validation tests passed.")

# ─── Authorization (non-admin manager + non-manager) ─────────────────────────
# A manages_visibility group already exists for A's tenant (auto-bootstrapped
# at registration: "Visibility Managers"). To test the non-admin-but-manager
# path, we'd need a same-org non-admin user — same infra gap as #98. The
# happy-path admin coverage is above; the manager path is exercised in
# code by the same requireVisibilityGroupManager helper that #98 covered.
#
# What we *can* cover here: a regular cross-tenant user (TOKEN_B) is
# blocked at TenantFilter (already done above), and there's no other
# attack surface to enumerate from personal-tenant users alone.

# ─── Cleanup behaviour: deleting a group cascades junction rows ──────────────
# (Schema-level guarantee, but worth a fast smoke test.)

print("  --- Cleanup cascade ---")

# Re-tag with both groups
status, _ = http_post(VIS_ROOT,
    {"override": True, "groupIds": [G_PLAYERS, G_GMS]}, TOKEN_A)
assert_status("cleanup: re-tag returns 204", 204, status)

# Delete G_PLAYERS
status, _ = http_delete(f"{VG_BASE}/{G_PLAYERS}", TOKEN_A)
assert_status("cleanup: delete group returns 204", 204, status)

# GET should now show only G_GMS (FK CASCADE removed the junction row)
status, body = http_get(VIS_ROOT, TOKEN_A)
assert_true("cleanup: cascaded junction row dropped",
            body["groupIds"] == [G_GMS])

print("  All cleanup tests passed.")

sys.exit(0 if report() else 1)
