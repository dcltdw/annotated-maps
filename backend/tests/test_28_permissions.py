#!/usr/bin/env python3
"""test_28_permissions.py — Map-permission endpoint coverage (#177).

Map permissions had only a happy-path PUT/GET test in test_03_maps.py.
This file exercises the branches the audit flagged:

  - Cross-tenant grant rejection (different-org target → 400)
  - Public access via userId=null (then DELETE .../permissions/public)
  - Permission-level enum round-trip (view/comment/edit/moderate/admin)
  - Self-grant by owner (allowed; owner already has full access)
  - Non-owner trying to set permissions (403 forbidden)
  - Invalid level value (400 bad_request)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report,
    http_post, http_get, http_put, http_delete,
    assert_status, assert_true, assert_json_field,
    mysql_query,
)


def _is_error_shape(body, expected_code=None):
    if not isinstance(body, dict):
        return False
    if not isinstance(body.get("error"), str) or not body["error"]:
        return False
    if not isinstance(body.get("message"), str) or not body["message"]:
        return False
    if expected_code is not None and body["error"] != expected_code:
        return False
    return True


def assert_error_shape(name, body, expected_code=None):
    """Inline error-shape check until #52's helpers.assert_error_shape lands."""
    assert_true(name, _is_error_shape(body, expected_code), f"got {body!r}")

reset_counters()
print("=== Map Permission Tests ===")

PID = os.getpid()
PFX = f"t28_{PID}"


def reg(suffix):
    """Register a fresh user; return (token, tenantId, userId)."""
    _, body = http_post("/auth/register", {
        "username": f"{PFX}{suffix}",
        "email": f"{PFX}{suffix}@e2e.test",
        "password": "password123",
    }, None)
    return body["token"], body["tenantId"], body["user"]["id"]


# Owner + same-org collaborator + different-org outsider
OWNER_TOK, OWNER_TID, OWNER_UID = reg("o")
COLLAB_TOK, _, COLLAB_UID       = reg("c")
OUT_TOK, OUT_TID, OUT_UID       = reg("x")


# Move COLLAB into OWNER's org so the cross-org check passes for happy-path
# tests; OUT stays in their own org for the rejection test. Mirrors the
# fixture pattern in visibility.spec.ts and test_20_node_visibility_filter.
owner_org_id = mysql_query(f"SELECT org_id FROM users WHERE id={OWNER_UID};")
mysql_query(f"UPDATE users SET org_id={owner_org_id} WHERE id={COLLAB_UID};")
mysql_query(
    f"INSERT INTO tenant_members (tenant_id, user_id, role) "
    f"VALUES ({OWNER_TID}, {COLLAB_UID}, 'viewer');"
)


# Owner creates a fresh map
status, body = http_post(f"/tenants/{OWNER_TID}/maps", {
    "title": f"{PFX} permissions map",
    "description": "scratch",
    "coordinateSystem": {
        "type": "wgs84",
        "center": {"lat": 0, "lng": 0},
        "zoom": 3,
    },
}, OWNER_TOK)
assert_status("owner creates map → 201", 201, status)
MAP_ID = body["id"]


print("  --- level enum round-trip ---")
for lvl in ["view", "comment", "edit", "moderate", "admin"]:
    status, _ = http_put(f"/tenants/{OWNER_TID}/maps/{MAP_ID}/permissions",
                         {"userId": COLLAB_UID, "level": lvl}, OWNER_TOK)
    assert_status(f"set level={lvl} → 200", 200, status)
    status, body = http_get(f"/tenants/{OWNER_TID}/maps/{MAP_ID}/permissions",
                            OWNER_TOK)
    assert_status(f"list permissions ({lvl}) → 200", 200, status)
    found = next((p for p in body if p.get("userId") == COLLAB_UID), None)
    assert_true(f"level={lvl} round-trips", found is not None and found.get("level") == lvl,
                f"got {found}")


print("  --- invalid level ---")
status, body = http_put(f"/tenants/{OWNER_TID}/maps/{MAP_ID}/permissions",
                        {"userId": COLLAB_UID, "level": "wizard"}, OWNER_TOK)
assert_status("invalid level → 400", 400, status)
assert_error_shape("invalid level: error shape", body, "bad_request")


print("  --- cross-org target rejected ---")
# OUT user is in a different org — granting should 400
status, body = http_put(f"/tenants/{OWNER_TID}/maps/{MAP_ID}/permissions",
                        {"userId": OUT_UID, "level": "view"}, OWNER_TOK)
assert_status("cross-org grant → 400", 400, status)
assert_error_shape("cross-org grant: error shape", body, "bad_request")
# Verify it didn't silently grant
status, body = http_get(f"/tenants/{OWNER_TID}/maps/{MAP_ID}/permissions",
                        OWNER_TOK)
out_found = any(p.get("userId") == OUT_UID for p in body)
assert_true("cross-org user NOT in permissions list", not out_found)


print("  --- public access (userId=null) ---")
status, _ = http_put(f"/tenants/{OWNER_TID}/maps/{MAP_ID}/permissions",
                     {"userId": None, "level": "view"}, OWNER_TOK)
assert_status("set public view → 200", 200, status)
status, body = http_get(f"/tenants/{OWNER_TID}/maps/{MAP_ID}/permissions",
                        OWNER_TOK)
public_row = next((p for p in body if p.get("userId") is None), None)
assert_true("public row present", public_row is not None and public_row.get("level") == "view",
            f"got {public_row}")


print("  --- DELETE .../permissions/public ---")
status, _ = http_delete(f"/tenants/{OWNER_TID}/maps/{MAP_ID}/permissions/public",
                        OWNER_TOK)
assert_status("delete public → 204", 204, status)
status, body = http_get(f"/tenants/{OWNER_TID}/maps/{MAP_ID}/permissions",
                        OWNER_TOK)
public_after = any(p.get("userId") is None for p in body)
assert_true("public row removed", not public_after)


print("  --- non-owner cannot set ---")
# COLLAB has 'admin'-level permission on the map but is NOT the owner.
# Only the map *owner* can manage permissions, regardless of level.
status, body = http_put(f"/tenants/{OWNER_TID}/maps/{MAP_ID}/permissions",
                        {"userId": COLLAB_UID, "level": "view"}, COLLAB_TOK)
assert_status("non-owner set → 403", 403, status)
assert_error_shape("non-owner set: error shape", body, "forbidden")


print("  --- self-grant (owner sets themselves) ---")
# Owner already has full access; setting a level for themselves is a no-op
# but should not error.
status, _ = http_put(f"/tenants/{OWNER_TID}/maps/{MAP_ID}/permissions",
                     {"userId": OWNER_UID, "level": "view"}, OWNER_TOK)
assert_status("owner self-grant → 200", 200, status)


print("  --- DELETE for specific user ---")
status, _ = http_delete(f"/tenants/{OWNER_TID}/maps/{MAP_ID}/permissions/{COLLAB_UID}",
                        OWNER_TOK)
assert_status("delete user permission → 204", 204, status)


print("  --- DELETE permission-target validation (#216) ---")
# Audit #46 L1: removePermission used std::stoi unguarded on the path
# segment. Non-numeric, non-"public" values threw and surfaced as 500.
# Validate that the handler now returns a clean 400 instead.
for bad in ["abc", "123abc", "-7", "0", ""]:
    status, body = http_delete(
        f"/tenants/{OWNER_TID}/maps/{MAP_ID}/permissions/{bad}", OWNER_TOK)
    label = bad if bad else "<empty>"
    # Empty string falls through Drogon's router as a missing path segment
    # and becomes a 404 from the framework — accept either as "not 500".
    assert_true(f"bad target '{label}' rejected (not 500)",
                status in (400, 404),
                f"expected 400/404 for {bad!r}, got {status}")


sys.exit(0 if report() else 1)
