#!/usr/bin/env python3
"""test_09_security.py — Cross-org isolation and security headers"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_true,
    http_post, http_get, http_put, http_delete,
    register_user, json_field, http_get_headers
)

reset_counters()
RUN_ID = os.getpid()

print("=== Security Tests ===")

TOKEN_A = register_user(f"t09_a_{RUN_ID}", f"t09_a_{RUN_ID}@test.com", "testpass123")
_, body_a = http_post("/auth/login", {"email": f"t09_a_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_A = json_field(body_a, ["tenantId"])
USER_A_ID = json_field(body_a, ["user", "id"])

TOKEN_B = register_user(f"t09_b_{RUN_ID}", f"t09_b_{RUN_ID}@test.com", "testpass123")
_, body_b = http_post("/auth/login", {"email": f"t09_b_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_B = json_field(body_b, ["tenantId"])
USER_B_ID = json_field(body_b, ["user", "id"])

_, body = http_post(f"/tenants/{TENANT_A}/maps", {"title": "Org A Map"}, TOKEN_A)
MAP_A = json_field(body, ["id"])

# ─── Cross-org map access ────────────────────────────────────────────────────

print("  --- Cross-org map isolation ---")

status, _ = http_get(f"/tenants/{TENANT_A}/maps/{MAP_A}", TOKEN_B)
assert_status("security: org B cannot read org A map", 403, status)

status, _ = http_put(f"/tenants/{TENANT_A}/maps/{MAP_A}", {"title": "Hacked"}, TOKEN_B)
assert_status("security: org B cannot update org A map", 403, status)

status, _ = http_delete(f"/tenants/{TENANT_A}/maps/{MAP_A}", TOKEN_B)
assert_status("security: org B cannot delete org A map", 403, status)

print("  All cross-org map isolation tests passed.")

# ─── Cross-org permission grant ──────────────────────────────────────────────

print("  --- Cross-org permission grant ---")

status, _ = http_put(f"/tenants/{TENANT_A}/maps/{MAP_A}/permissions",
                     {"userId": USER_B_ID, "level": "view"}, TOKEN_A)
assert_status("security: cannot grant permission to cross-org user", 400, status)

print("  All cross-org permission grant tests passed.")

# ─── Cross-org tenant member add ──────────────────────────────────────────────

print("  --- Cross-org member add ---")

status, _ = http_post(f"/tenants/{TENANT_A}/members",
                      {"userId": USER_B_ID, "role": "viewer"}, TOKEN_A)
assert_status("security: cannot add cross-org member", 400, status)

print("  All cross-org member add tests passed.")

# Cross-tenant access at the *node* level returns in #96 with NodeController.
# For now we cover cross-tenant isolation at the map level (above) — same
# TenantFilter chain protects the future node endpoints.

# ─── Security headers ────────────────────────────────────────────────────────

print("  --- Security headers ---")

headers = http_get_headers("/auth/login")
# Normalize header keys to lowercase for case-insensitive lookup
headers_lower = {k.lower(): v for k, v in headers.items()}

xcto = headers_lower.get("x-content-type-options", "")
assert_true("security: X-Content-Type-Options header present",
            "nosniff" in xcto.lower())

xfo = headers_lower.get("x-frame-options", "")
assert_true("security: X-Frame-Options header present",
            "deny" in xfo.lower())

rp = headers_lower.get("referrer-policy", "")
assert_true("security: Referrer-Policy header present", len(rp) > 0)

print("  All security header tests passed.")

sys.exit(0 if report() else 1)
