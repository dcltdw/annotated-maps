#!/usr/bin/env python3
"""test_02_filters.py — JwtFilter and TenantFilter tests"""

import os
import sys
import urllib.request
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_true,
    http_get, http_post, register_user, json_field, mysql_query, API, CURL_TIMEOUT
)

reset_counters()
RUN_ID = os.getpid()

print("=== Filter Tests ===")

TOKEN = register_user(f"t02_{RUN_ID}", f"t02_{RUN_ID}@test.com", "testpass123")
status, body = http_post("/auth/login", {"email": f"t02_{RUN_ID}@test.com", "password": "testpass123"})
TENANT_ID = json_field(body, ["tenantId"])

# ─── JwtFilter ────────────────────────────────────────────────────────────────

print("  --- JwtFilter ---")

status, _ = http_get("/tenants")
assert_status("jwt: missing auth header returns 401", 401, status)

# Malformed header (no Bearer prefix)
req = urllib.request.Request(f"{API}/tenants", method="GET")
req.add_header("Authorization", TOKEN or "x")
try:
    with urllib.request.urlopen(req, timeout=CURL_TIMEOUT) as resp:
        status = resp.status
except urllib.error.HTTPError as e:
    status = e.code
except Exception:
    status = 0
assert_status("jwt: missing Bearer prefix returns 401", 401, status)

status, _ = http_get("/tenants", "not.a.valid.jwt")
assert_status("jwt: garbage token returns 401", 401, status)

status, _ = http_get("/tenants", TOKEN)
assert_status("jwt: valid token returns 200", 200, status)

mysql_query(f"UPDATE users SET is_active = FALSE WHERE email = 't02_{RUN_ID}@test.com';")
status, _ = http_get("/tenants", TOKEN)
assert_status("jwt: deactivated user with valid token returns 401", 401, status)
mysql_query(f"UPDATE users SET is_active = TRUE WHERE email = 't02_{RUN_ID}@test.com';")

print("  All JwtFilter tests passed.")

# ─── TenantFilter ─────────────────────────────────────────────────────────────

print("  --- TenantFilter ---")

status, _ = http_get(f"/tenants/{TENANT_ID}/maps", TOKEN)
assert_status("tenant: member can access tenant", 200, status)

status, _ = http_get("/tenants/99999/maps", TOKEN)
assert_status("tenant: non-member returns 403", 403, status)

TOKEN2 = register_user(f"t02_o_{RUN_ID}", f"t02_o_{RUN_ID}@test.com", "testpass123")
status, _ = http_get(f"/tenants/{TENANT_ID}/maps", TOKEN2)
assert_status("tenant: cross-org access returns 403", 403, status)

print("  All TenantFilter tests passed.")

sys.exit(0 if report() else 1)
