#!/usr/bin/env python3
"""test_27_error_shape.py — Verify every standard error path emits the
shared {"error": "<code>", "message": "<text>"} response shape.

The frontend's `extractApiError()` helper (see frontend/src/utils/errors.ts)
depends on this exact shape to surface backend errors to the user. A
controller that accidentally returns a different structure (e.g.,
{"detail": "..."}) would silently downgrade UI errors to the generic
fallback message, with no test failure to flag the drift.

This file covers each canonical error code by triggering a real path
that produces it. The audit in PR #51 + the rebuild closeout audit
identified the codes in use; this test pins them as a contract.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report,
    http_get, http_post, http_put, http_delete,
    assert_status, assert_error_shape,
)

reset_counters()
print("=== Error-Shape Tests ===")

PID = os.getpid()
PREFIX = f"t27_{PID}"

def _register(suffix):
    """Register a fresh user; return (token, tenantId, email)."""
    email = f"{PREFIX}{suffix}@e2e.test"
    _, body = http_post("/auth/register", {
        "username": f"{PREFIX}{suffix}",
        "email": email,
        "password": "password123",
    }, None)
    return body["token"], body["tenantId"], email

A_TOKEN, A_TENANT, A_EMAIL = _register("a")
B_TOKEN, B_TENANT, B_EMAIL = _register("b")

print("  --- bad_request ---")

# Missing required fields → bad_request
status, body = http_post("/auth/register", {}, None)
assert_status("register: missing fields → 400", 400, status)
assert_error_shape("register: error shape (bad_request)", body, "bad_request")

# Invalid coordinate-system payload on map create → bad_request
status, body = http_post(
    f"/tenants/{A_TENANT}/maps",
    {"title": "x", "description": "x", "coordinateSystem": {"type": "nope"}},
    A_TOKEN,
)
assert_status("create map with bad coord-system → 400", 400, status)
assert_error_shape("create map: error shape (bad_request)", body)

print("  --- unauthorized ---")

# Wrong credentials → unauthorized
status, body = http_post(
    "/auth/login",
    {"email": A_EMAIL, "password": "wrongpassword"},
    None,
)
assert_status("login wrong password → 401", 401, status)
assert_error_shape("login wrong password: error shape (unauthorized)",
                   body, "unauthorized")

# Missing JWT → 401 unauthorized
status, body = http_get(f"/tenants/{A_TENANT}/maps", None)
assert_status("listMaps no token → 401", 401, status)
assert_error_shape("listMaps no token: error shape", body)

print("  --- forbidden ---")

# B fetching A's tenant maps → forbidden (tenant filter)
status, body = http_get(f"/tenants/{A_TENANT}/maps", B_TOKEN)
assert_status("cross-tenant list → 403", 403, status)
assert_error_shape("cross-tenant list: error shape (forbidden)",
                   body, "forbidden")

print("  --- not_found ---")

# Fetch a map that doesn't exist (still inside caller's own tenant)
status, body = http_get(f"/tenants/{A_TENANT}/maps/9999999", A_TOKEN)
assert_status("get missing map → 404", 404, status)
assert_error_shape("get missing map: error shape (not_found)",
                   body, "not_found")

print("  --- conflict (duplicate) ---")

# Re-register the same email → conflict (email_taken or username_taken)
status, body = http_post("/auth/register", {
    "username": f"{PREFIX}a",  # same username
    "email": A_EMAIL,
    "password": "password123",
}, None)
# Expect 409 conflict via username_taken or email_taken; either way the
# shape must hold.
assert_status("re-register duplicate → 409", 409, status)
assert_error_shape("re-register duplicate: error shape", body)

print("  --- limit_exceeded ---")

# Skipped: hitting the per-tenant 1000-map cap requires bulk insertion that
# would be slow + leaks data. Code path is exercised in test_03_maps.py
# already; here we only assert the shape if a limit-exceeded response
# happens to land via another route. (No assertion in this section — the
# code is documented as expected to emit `limit_exceeded` with the shared
# helper, and the helper is what produces the shape.)

print("  --- shape on the JwtFilter rejection path ---")

# Bogus token → JwtFilter rejects with 401 + the shared error shape
status, body = http_get(f"/tenants/{A_TENANT}/maps", "Bearer not-a-jwt")
assert_status("bogus token → 401", 401, status)
assert_error_shape("bogus token: error shape", body)

# Note: rate-limit 429 shape coverage lives in test_06_rate_limit_fast.py
# (where saturation already happens, and the runner correctly restarts
# the backend before the next NEEDS_RESTART test, leaving downstream
# tests with a clean bucket). Saturating here instead would leave the
# bucket full for the rest of the fast tier and break the post-suite
# E2E run on registration-form flows that don't have the
# `registerViaApi` retry-on-429 wrapper.

sys.exit(0 if report() else 1)
