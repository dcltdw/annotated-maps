#!/usr/bin/env python3
"""test_01_auth.py — Registration and login tests"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_json_exists, assert_json_field,
    http_post, http_get, register_user, login_user, json_field, mysql_query
)

reset_counters()
RUN_ID = os.getpid()

print("=== Auth Tests ===")

# ─── Registration ─────────────────────────────────────────────────────────────

print("  --- Registration ---")

status, body = http_post("/auth/register", {
    "username": f"t01_{RUN_ID}", "email": f"t01_{RUN_ID}@test.com", "password": "testpass123"
})
assert_status("register: valid input returns 201", 201, status)
assert_json_exists("register: response has token", body, ["token"])
assert_json_exists("register: response has orgId", body, ["orgId"])
assert_json_exists("register: response has tenantId", body, ["tenantId"])
assert_json_exists("register: response has tenants list", body, ["tenants"])
assert_json_field("register: user.username correct", body, ["user", "username"], f"t01_{RUN_ID}")
assert_json_field("register: first tenant is Personal", body, ["tenants", 0, "name"], "Personal")
assert_json_field("register: tenant role is admin", body, ["tenants", 0, "role"], "admin")

REG_TOKEN = json_field(body, ["token"]) or ""

# Duplicate
status, body = http_post("/auth/register", {
    "username": f"t01_{RUN_ID}", "email": f"t01_{RUN_ID}@test.com", "password": "testpass123"
})
assert_status("register: duplicate returns 409", 409, status)
assert_json_field("register: generic error message", body, ["message"], "Registration failed")
assert_json_field("register: duplicate email error code", body, ["error"], "email_taken")

# Duplicate username, different email
status, body = http_post("/auth/register", {
    "username": f"t01_{RUN_ID}", "email": f"t01_{RUN_ID}_alt@test.com", "password": "testpass123"
})
assert_status("register: duplicate username returns 409", 409, status)
assert_json_field("register: duplicate username error code", body, ["error"], "username_taken")

# Missing fields
status, _ = http_post("/auth/register", {"email": "t01_nouser@test.com", "password": "testpass123"})
assert_status("register: missing username returns 400", 400, status)

status, _ = http_post("/auth/register", {"username": "t01_nomail", "password": "testpass123"})
assert_status("register: missing email returns 400", 400, status)

status, _ = http_post("/auth/register", {"username": "t01_nopw", "email": "t01_nopw@test.com"})
assert_status("register: missing password returns 400", 400, status)

print("  All registration tests passed.")

# ─── Login ────────────────────────────────────────────────────────────────────

print("  --- Login ---")

status, body = http_post("/auth/login", {
    "email": f"t01_{RUN_ID}@test.com", "password": "testpass123"
})
assert_status("login: correct credentials returns 200", 200, status)
assert_json_exists("login: response has token", body, ["token"])
assert_json_exists("login: response has tenants", body, ["tenants"])
assert_json_field("login: user.email correct", body, ["user", "email"], f"t01_{RUN_ID}@test.com")

status, body = http_post("/auth/login", {
    "email": f"t01_{RUN_ID}@test.com", "password": "wrongpassword"
})
assert_status("login: wrong password returns 401", 401, status)
assert_json_field("login: generic error on wrong password", body, ["message"], "Invalid email or password")

status, body = http_post("/auth/login", {"email": "nobody@test.com", "password": "testpass123"})
assert_status("login: non-existent email returns 401", 401, status)
assert_json_field("login: same error for non-existent user", body, ["message"], "Invalid email or password")

status, _ = http_post("/auth/login", {"password": "testpass123"})
assert_status("login: missing email returns 400", 400, status)

print("  All login tests passed.")

# ─── Refresh ──────────────────────────────────────────────────────────────────

print("  --- Refresh ---")

TOKEN = REG_TOKEN
if TOKEN:
    status, body = http_post("/auth/refresh", {}, TOKEN)
    assert_status("refresh: valid token returns 200", 200, status)
    assert_json_exists("refresh: response has new token", body, ["token"])
else:
    print("FAIL: refresh: no token available")

status, _ = http_post("/auth/refresh", {}, "invalid.jwt.token")
assert_status("refresh: invalid token returns 401", 401, status)

print("  All refresh tests passed.")

# ─── Deactivated user ─────────────────────────────────────────────────────────

print("  --- Deactivated user ---")

if TOKEN:
    mysql_query(f"UPDATE users SET status = 'deactivated' WHERE email = 't01_{RUN_ID}@test.com';")
    status, _ = http_get("/tenants", TOKEN)
    assert_status("deactivated: existing token rejected", 401, status)
    mysql_query(f"UPDATE users SET status = 'active' WHERE email = 't01_{RUN_ID}@test.com';")
else:
    print("FAIL: deactivated: no token available (skipped)")

print("  All deactivated user tests passed.")

sys.exit(0 if report() else 1)
