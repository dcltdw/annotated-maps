#!/usr/bin/env python3
"""test_18_visibility_groups.py — Visibility groups CRUD (Phase 2b.i.a).

This phase is admin-only. Member management + the manages_visibility
escape hatch + tenant-creation bootstrap arrive in Phase 2b.i.b (#98);
proper non-admin authorization tests live there too. Personal-tenant
users (the only thing test infrastructure can produce today) are always
admins of their own tenant, so non-admin coverage is deferred.
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

print("=== Visibility Group Tests ===")

# Two tenants for cross-tenant checks
TOKEN_A = register_user(f"t18_a_{RUN_ID}", f"t18_a_{RUN_ID}@test.com", "testpass123")
_, body_a = http_post("/auth/login",
    {"email": f"t18_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A = json_field(body_a, ["tenantId"])

TOKEN_B = register_user(f"t18_b_{RUN_ID}", f"t18_b_{RUN_ID}@test.com", "testpass123")

BASE = f"/tenants/{TENANT_A}/visibility-groups"

# ─── Create ──────────────────────────────────────────────────────────────────

print("  --- Create ---")

status, body = http_post(BASE, {"name": "Players"}, TOKEN_A)
assert_status("create: minimal returns 201", 201, status)
G_PLAYERS = json_field(body, ["id"])
assert_json_field("create: name", body, ["name"], "Players")
assert_json_field("create: managesVisibility defaults false",
                  body, ["managesVisibility"], False)
assert_json_field("create: tenantId set", body, ["tenantId"], str(TENANT_A))

status, body = http_post(BASE, {
    "name": "GMs",
    "description": "Game masters",
    "managesVisibility": True,
}, TOKEN_A)
assert_status("create: with description + flag returns 201", 201, status)
G_GMS = json_field(body, ["id"])
assert_json_field("create: managesVisibility true", body, ["managesVisibility"], True)
assert_json_field("create: description set", body, ["description"], "Game masters")

# Validation: missing name
status, _ = http_post(BASE, {"description": "no name"}, TOKEN_A)
assert_status("create: missing name returns 400", 400, status)

# Validation: empty name
status, _ = http_post(BASE, {"name": ""}, TOKEN_A)
assert_status("create: empty name returns 400", 400, status)

# Duplicate (tenant_id, name) → 409
status, _ = http_post(BASE, {"name": "Players"}, TOKEN_A)
assert_status("create: duplicate name returns 409", 409, status)

# Cross-tenant blocked at the TenantFilter
status, _ = http_post(BASE, {"name": "Trespass"}, TOKEN_B)
assert_status("create: cross-tenant blocked", 403, status)

print("  All create tests passed.")

# ─── List ────────────────────────────────────────────────────────────────────

print("  --- List ---")

status, body = http_get(BASE, TOKEN_A)
assert_status("list: returns 200", 200, status)
assert_true("list: returns array", isinstance(body, list))
assert_true("list: contains both groups", len(body) >= 2)

names = sorted(g["name"] for g in body)
assert_true("list: alphabetical-ish (or at least both names present)",
            "GMs" in names and "Players" in names)

# Cross-tenant blocked
status, _ = http_get(BASE, TOKEN_B)
assert_status("list: cross-tenant blocked", 403, status)

print("  All list tests passed.")

# ─── Get ─────────────────────────────────────────────────────────────────────

print("  --- Get ---")

status, body = http_get(f"{BASE}/{G_PLAYERS}", TOKEN_A)
assert_status("get: returns 200", 200, status)
assert_json_field("get: name", body, ["name"], "Players")
assert_json_exists("get: has createdAt", body, ["createdAt"])

# Not found
status, _ = http_get(f"{BASE}/9999999", TOKEN_A)
assert_status("get: missing returns 404", 404, status)

# Cross-tenant blocked
status, _ = http_get(f"{BASE}/{G_PLAYERS}", TOKEN_B)
assert_status("get: cross-tenant blocked", 403, status)

print("  All get tests passed.")

# ─── Update ──────────────────────────────────────────────────────────────────

print("  --- Update ---")

status, _ = http_put(f"{BASE}/{G_PLAYERS}",
    {"description": "Player characters"}, TOKEN_A)
assert_status("update: description returns 200", 200, status)
status, body = http_get(f"{BASE}/{G_PLAYERS}", TOKEN_A)
assert_json_field("update: description persisted",
                  body, ["description"], "Player characters")

# Toggle managesVisibility
status, _ = http_put(f"{BASE}/{G_PLAYERS}", {"managesVisibility": True}, TOKEN_A)
status, body = http_get(f"{BASE}/{G_PLAYERS}", TOKEN_A)
assert_json_field("update: managesVisibility true persisted",
                  body, ["managesVisibility"], True)
status, _ = http_put(f"{BASE}/{G_PLAYERS}", {"managesVisibility": False}, TOKEN_A)
status, body = http_get(f"{BASE}/{G_PLAYERS}", TOKEN_A)
assert_json_field("update: managesVisibility false persisted",
                  body, ["managesVisibility"], False)

# Rename (and prove uniqueness still enforced)
status, _ = http_put(f"{BASE}/{G_PLAYERS}", {"name": "GMs"}, TOKEN_A)
assert_status("update: rename to existing name returns 409", 409, status)

# Cross-tenant cannot update
status, _ = http_put(f"{BASE}/{G_PLAYERS}", {"name": "hacked"}, TOKEN_B)
assert_status("update: cross-tenant blocked", 403, status)

# Missing record
status, _ = http_put(f"{BASE}/9999999", {"description": "x"}, TOKEN_A)
assert_status("update: missing returns 404", 404, status)

print("  All update tests passed.")

# ─── Delete ──────────────────────────────────────────────────────────────────

print("  --- Delete ---")

# Cross-tenant blocked
status, _ = http_delete(f"{BASE}/{G_PLAYERS}", TOKEN_B)
assert_status("delete: cross-tenant blocked", 403, status)

# Missing record
status, _ = http_delete(f"{BASE}/9999999", TOKEN_A)
assert_status("delete: missing returns 404", 404, status)

# Owner deletes
status, _ = http_delete(f"{BASE}/{G_PLAYERS}", TOKEN_A)
assert_status("delete: returns 204", 204, status)

# Verify gone
status, _ = http_get(f"{BASE}/{G_PLAYERS}", TOKEN_A)
assert_status("delete: group is gone", 404, status)

print("  All delete tests passed.")

sys.exit(0 if report() else 1)
