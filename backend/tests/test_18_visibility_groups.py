#!/usr/bin/env python3
"""test_18_visibility_groups.py — Visibility groups CRUD + members + bootstrap.

Phase 2b.i.a wired up admin-only CRUD; Phase 2b.i.b (#98) layers in:
  * Member-management endpoints (list / add / remove)
  * The manager-flag-based authorization helper (allows non-admin
    members of any manages_visibility group to manage groups too)
  * Tenant-creation bootstrap of a default "Visibility Managers"
    group with the registering user as the sole member
  * Escalation guards: only tenant admins can set/change the
    managesVisibility flag

Tests for non-admin managers actually exercising the manager-flag
auth helper require a same-org non-admin user, which the personal-
tenant test infrastructure can't produce. Documented inline; covered
by code review for now.
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

USER_A_ID = json_field(body_a, ["user", "id"])

BASE = f"/tenants/{TENANT_A}/visibility-groups"

# ─── Tenant bootstrap ────────────────────────────────────────────────────────
# Registration should auto-create a default "Visibility Managers" group
# with manages_visibility=TRUE and the registering user as a member.

print("  --- Bootstrap ---")

status, body = http_get(BASE, TOKEN_A)
assert_status("bootstrap: list returns 200", 200, status)
managers = [g for g in body if g["name"] == "Visibility Managers"]
assert_true("bootstrap: default Visibility Managers group exists",
            len(managers) == 1)
G_BOOTSTRAP = managers[0]["id"]
assert_json_field("bootstrap: managesVisibility=true",
                  managers[0], ["managesVisibility"], True)

# Member of the bootstrap group should be the registering user.
status, body = http_get(f"{BASE}/{G_BOOTSTRAP}/members", TOKEN_A)
assert_status("bootstrap: list members returns 200", 200, status)
member_ids = [m["userId"] for m in body]
assert_true("bootstrap: caller is a member of Visibility Managers",
            USER_A_ID in member_ids)

print("  All bootstrap tests passed.")

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

# ─── Member management ──────────────────────────────────────────────────────

print("  --- Members ---")

# We deleted G_PLAYERS above; recreate one for member tests.
_, body = http_post(BASE, {"name": "TestGroup"}, TOKEN_A)
G_TEST = json_field(body, ["id"])

# List is initially empty
status, body = http_get(f"{BASE}/{G_TEST}/members", TOKEN_A)
assert_status("members: list empty group returns 200", 200, status)
assert_true("members: empty initially", isinstance(body, list) and len(body) == 0)

# Add the caller (admin) as a member
status, body = http_post(f"{BASE}/{G_TEST}/members", {"userId": USER_A_ID}, TOKEN_A)
assert_status("members: add returns 201", 201, status)
assert_json_field("members: visibilityGroupId in response",
                  body, ["visibilityGroupId"], str(G_TEST))

# Listing now returns 1
status, body = http_get(f"{BASE}/{G_TEST}/members", TOKEN_A)
assert_true("members: now contains 1", len(body) == 1)
assert_json_field("members: userId correct", body[0], ["userId"], str(USER_A_ID))
assert_json_exists("members: username present", body[0], ["username"])
assert_json_exists("members: email present",    body[0], ["email"])

# Idempotent (INSERT IGNORE): adding again still succeeds, list still shows 1
status, _ = http_post(f"{BASE}/{G_TEST}/members", {"userId": USER_A_ID}, TOKEN_A)
assert_status("members: dup add returns 201 (idempotent)", 201, status)
status, body = http_get(f"{BASE}/{G_TEST}/members", TOKEN_A)
assert_true("members: dup add stayed at 1", len(body) == 1)

# Cross-org member rejected — login B again to extract user.id
# (register_user helper only returns the token).
_, body_b_login = http_post("/auth/login",
    {"email": f"t18_b_{RUN_ID}@test.com", "password": "testpass123"})
USER_B_ID = json_field(body_b_login, ["user", "id"])

status, _ = http_post(f"{BASE}/{G_TEST}/members", {"userId": USER_B_ID}, TOKEN_A)
assert_status("members: cross-org add rejected", 400, status)

# Missing userId
status, _ = http_post(f"{BASE}/{G_TEST}/members", {}, TOKEN_A)
assert_status("members: missing userId returns 400", 400, status)

# Cross-tenant blocked at TenantFilter
status, _ = http_post(f"{BASE}/{G_TEST}/members", {"userId": USER_A_ID}, TOKEN_B)
assert_status("members: cross-tenant add blocked", 403, status)

# Remove the member
status, _ = http_delete(f"{BASE}/{G_TEST}/members/{USER_A_ID}", TOKEN_A)
assert_status("members: remove returns 204", 204, status)
status, body = http_get(f"{BASE}/{G_TEST}/members", TOKEN_A)
assert_true("members: list empty after remove", len(body) == 0)

# Removing again returns 404
status, _ = http_delete(f"{BASE}/{G_TEST}/members/{USER_A_ID}", TOKEN_A)
assert_status("members: remove non-member returns 404", 404, status)

# Cross-tenant remove blocked
status, _ = http_delete(f"{BASE}/{G_TEST}/members/{USER_A_ID}", TOKEN_B)
assert_status("members: cross-tenant remove blocked", 403, status)

print("  All members tests passed.")

# ─── managesVisibility escalation guard ─────────────────────────────────────
# Setting managesVisibility=true is admin-only on both create and update.
# The admin (TOKEN_A) can still do it freely; we cover the non-admin path
# by code review since we can't produce a same-org non-admin user from
# personal tenants alone.

print("  --- managesVisibility escalation guard (admin happy paths) ---")

# Admin creates a managesVisibility=true group OK
status, body = http_post(BASE, {
    "name": "AnotherManagerGroup", "managesVisibility": True,
}, TOKEN_A)
assert_status("escalation: admin creates managesVisibility group", 201, status)
GMV = json_field(body, ["id"])

# Admin can flip it back to false
status, _ = http_put(f"{BASE}/{GMV}", {"managesVisibility": False}, TOKEN_A)
assert_status("escalation: admin demotes the flag", 200, status)
status, body = http_get(f"{BASE}/{GMV}", TOKEN_A)
assert_json_field("escalation: managesVisibility=false persisted",
                  body, ["managesVisibility"], False)

print("  All escalation-guard happy paths passed.")

sys.exit(0 if report() else 1)
