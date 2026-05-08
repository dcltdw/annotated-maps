#!/usr/bin/env python3
"""test_05_tenants.py — Tenant member management and branding"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_json_field,
    http_post, http_get, http_put, http_delete, register_user, json_field, mysql_query
)

reset_counters()
RUN_ID = os.getpid()

print("=== Tenant Tests ===")

TOKEN_ADMIN = register_user(f"t05_a_{RUN_ID}", f"t05_a_{RUN_ID}@test.com", "testpass123")
_, body = http_post("/auth/login", {"email": f"t05_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_ID = json_field(body, ["tenantId"])
ADMIN_ID = json_field(body, ["user", "id"])
ORG_ID = json_field(body, ["orgId"])

TOKEN_OTHER = register_user(f"t05_o_{RUN_ID}", f"t05_o_{RUN_ID}@test.com", "testpass123")
_, body_o = http_post("/auth/login", {"email": f"t05_o_{RUN_ID}@test.com", "password": "testpass123"})
OTHER_ID = json_field(body_o, ["user", "id"])

# ─── List tenants ─────────────────────────────────────────────────────────────

print("  --- List tenants ---")

status, _ = http_get("/tenants", TOKEN_ADMIN)
assert_status("listTenants: returns 200", 200, status)

print("  All list tenants tests passed.")

# ─── Branding ─────────────────────────────────────────────────────────────────

print("  --- Branding ---")

status, _ = http_get(f"/tenants/{TENANT_ID}/branding", TOKEN_ADMIN)
assert_status("getBranding: returns 200", 200, status)

status, body = http_put(f"/tenants/{TENANT_ID}/branding", {
    "primary_color": "#ff0000", "accent_color": "#cc0000", "display_name": "Test Tenant"
}, TOKEN_ADMIN)
assert_status("updateBranding: admin can update", 200, status)
assert_json_field("updateBranding: color set", body, ["primary_color"], "#ff0000")

status, _ = http_put(f"/tenants/{TENANT_ID}/branding",
                     {"primary_color": "red; background: url(evil)"}, TOKEN_ADMIN)
assert_status("updateBranding: invalid color returns 400", 400, status)

status, _ = http_put(f"/tenants/{TENANT_ID}/branding",
                     {"logo_url": "javascript:alert(1)"}, TOKEN_ADMIN)
assert_status("updateBranding: non-https URL returns 400", 400, status)

status, _ = http_put(f"/tenants/{TENANT_ID}/branding",
                     {"logo_url": "https://example.com/logo.png"}, TOKEN_ADMIN)
assert_status("updateBranding: https URL accepted", 200, status)

status, _ = http_put(f"/tenants/{TENANT_ID}/branding",
                     {"display_name": "Hacked"}, TOKEN_OTHER)
assert_status("updateBranding: cross-org user returns 403", 403, status)

print("  All branding tests passed.")

# ─── Members ─────────────────────────────────────────────────────────────────

print("  --- Members ---")

status, _ = http_post(f"/tenants/{TENANT_ID}/members",
                      {"userId": OTHER_ID, "role": "viewer"}, TOKEN_ADMIN)
assert_status("addMember: cross-org user returns 400", 400, status)

register_user(f"t05_c_{RUN_ID}", f"t05_c_{RUN_ID}@test.com", "testpass123")
mysql_query(f"UPDATE users SET org_id = {ORG_ID} WHERE email = 't05_c_{RUN_ID}@test.com';")
COLLEAGUE_ID = mysql_query(f"SELECT id FROM users WHERE email = 't05_c_{RUN_ID}@test.com';")

status, _ = http_post(f"/tenants/{TENANT_ID}/members",
                      {"userId": int(COLLEAGUE_ID), "role": "editor"}, TOKEN_ADMIN)
assert_status("addMember: same-org user returns 201", 201, status)

status, _ = http_post(f"/tenants/{TENANT_ID}/members",
                      {"userId": int(COLLEAGUE_ID), "role": "superadmin"}, TOKEN_ADMIN)
assert_status("addMember: invalid role returns 400", 400, status)

print("  All member add tests passed.")

# ─── Self-demote guard (#214) ────────────────────────────────────────────────

print("  --- Self-demote guard (#214) ---")

# Last-admin self-demote must be rejected. ADMIN is currently the only
# admin in the tenant (COLLEAGUE was added as editor above).
status, _ = http_post(f"/tenants/{TENANT_ID}/members",
                      {"userId": ADMIN_ID, "role": "viewer"}, TOKEN_ADMIN)
assert_status("addMember: last-admin self-demote returns 400", 400, status)

# Self-promote-to-admin (no-op) is a self-targeted write but role IS admin
# — must still succeed (it's an idempotent re-affirmation, not a demote).
status, _ = http_post(f"/tenants/{TENANT_ID}/members",
                      {"userId": ADMIN_ID, "role": "admin"}, TOKEN_ADMIN)
assert_status("addMember: self admin re-affirm returns 201", 201, status)

# With a second admin present, self-demote IS allowed. Promote COLLEAGUE
# to admin first, then demote self, then restore self to admin so the
# remaining tests in this file still see admin role.
status, _ = http_post(f"/tenants/{TENANT_ID}/members",
                      {"userId": int(COLLEAGUE_ID), "role": "admin"}, TOKEN_ADMIN)
assert_status("addMember: promote colleague to admin returns 201", 201, status)

status, _ = http_post(f"/tenants/{TENANT_ID}/members",
                      {"userId": ADMIN_ID, "role": "viewer"}, TOKEN_ADMIN)
assert_status("addMember: self-demote with co-admin returns 201", 201, status)

# Restore admin role via direct DB (the API can't re-promote a non-admin
# back to admin without a separate role-change endpoint).
mysql_query(f"UPDATE tenant_members SET role='admin' "
            f"WHERE tenant_id={TENANT_ID} AND user_id={ADMIN_ID};")

# Demote colleague back to editor for the remove test below.
status, _ = http_post(f"/tenants/{TENANT_ID}/members",
                      {"userId": int(COLLEAGUE_ID), "role": "editor"}, TOKEN_ADMIN)
assert_status("addMember: demote colleague back to editor returns 201", 201, status)

print("  All self-demote tests passed.")

print("  --- Member list/remove ---")

status, _ = http_get(f"/tenants/{TENANT_ID}/members", TOKEN_ADMIN)
assert_status("listMembers: admin can list", 200, status)

status, _ = http_delete(f"/tenants/{TENANT_ID}/members/{ADMIN_ID}", TOKEN_ADMIN)
assert_status("removeMember: can't remove self returns 400", 400, status)

status, _ = http_delete(f"/tenants/{TENANT_ID}/members/{COLLEAGUE_ID}", TOKEN_ADMIN)
assert_status("removeMember: admin can remove other member", 204, status)

print("  All member list/remove tests passed.")

sys.exit(0 if report() else 1)
