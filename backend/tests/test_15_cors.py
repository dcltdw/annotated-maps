#!/usr/bin/env python3
"""test_15_cors.py — CORS preflight coverage.

Regression net for the bug PR #66 discovered: the OPTIONS fallback
only matched single-segment paths, so multi-segment routes returned
403 on preflight and broke CORS for the browser. These tests exercise
OPTIONS at multiple path depths and verify CORS headers are set
correctly based on the Origin header.

The Python integration tests don't normally send an Origin header
(they use urllib, not a browser), so this file is the only place the
CORS preflight path is tested without the full browser stack.
"""

import os
import sys
import urllib.request
import urllib.error
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_status, assert_true, http_options, API,
)

reset_counters()

# The dev backend configures http://localhost:5173 as an allowed origin
# (see backend/config.docker.json `allowed_origins`). We assert against
# that value directly — if the config changes, this test updates with it.
ALLOWED_ORIGIN = "http://localhost:5173"
BOGUS_ORIGIN   = "https://attacker.example"

print("=== CORS Preflight Tests ===")

# ─── Path depth coverage ──────────────────────────────────────────────────────
# Confirms the OPTIONS handler matches paths of arbitrary depth. Before the
# PR #66 fix, everything except the /foo case returned 403.

print("  --- Path depth ---")

for path in [
    "/foo",                             # single segment (worked even before fix)
    "/api",                             # single, under /api
    "/api/v1",                          # two segments
    "/api/v1/auth/register",            # four segments — the actual broken case
    "/api/v1/tenants/1/maps",           # five segments
    "/api/v1/tenants/1/maps/99/notes",  # seven segments
    "/this/path/does/not/exist/at/all", # nonexistent — the handler is global
]:
    status, _ = http_options(path, origin=ALLOWED_ORIGIN)
    assert_status(f"OPTIONS {path} returns 204", 204, status)

# ─── CORS header correctness ──────────────────────────────────────────────────

print("  --- CORS header correctness (allowed origin) ---")

_, headers = http_options("/api/v1/auth/register", origin=ALLOWED_ORIGIN)
hl = {k.lower(): v for k, v in headers.items()}

assert_true("Allow-Origin echoes the allowed Origin",
            hl.get("access-control-allow-origin") == ALLOWED_ORIGIN,
            detail=f"got {hl.get('access-control-allow-origin')!r}")
assert_true("Allow-Credentials is true",
            hl.get("access-control-allow-credentials") == "true")
methods = hl.get("access-control-allow-methods", "")
for verb in ("GET", "POST", "PUT", "DELETE", "OPTIONS"):
    assert_true(f"Allow-Methods includes {verb}", verb in methods)
allowed_headers = hl.get("access-control-allow-headers", "")
assert_true("Allow-Headers includes Content-Type",
            "Content-Type" in allowed_headers)
assert_true("Allow-Headers includes Authorization",
            "Authorization" in allowed_headers)

# ─── Disallowed origin ────────────────────────────────────────────────────────
# Preflight must still return 204 (the handler fires), but
# Access-Control-Allow-Origin must NOT echo the attacker's origin.
# The browser then rejects the real request because there's no matching
# Allow-Origin.

print("  --- CORS header correctness (disallowed origin) ---")

status, headers = http_options("/api/v1/auth/register", origin=BOGUS_ORIGIN)
hl = {k.lower(): v for k, v in headers.items()}
assert_status("OPTIONS with disallowed Origin still returns 204", 204, status)
assert_true("disallowed Origin is NOT echoed in Allow-Origin",
            hl.get("access-control-allow-origin") is None,
            detail=f"got {hl.get('access-control-allow-origin')!r}")

# ─── No Origin header ─────────────────────────────────────────────────────────
# Same-origin or non-browser requests won't send Origin. Preflight still
# succeeds (204); no CORS headers set.

print("  --- No Origin header ---")

status, headers = http_options("/api/v1/auth/register", origin=None)
hl = {k.lower(): v for k, v in headers.items()}
assert_status("OPTIONS without Origin returns 204", 204, status)
assert_true("no Origin → no Allow-Origin header",
            hl.get("access-control-allow-origin") is None)

# ─── Non-OPTIONS responses also include CORS for allowed origin ───────────────
# The CORS helper is called from both the OPTIONS sync advice and the
# pre-sending advice. This verifies the pre-sending path still works
# after the refactor that consolidated the two copies.

print("  --- Non-OPTIONS responses still include CORS ---")

req = urllib.request.Request(
    f"{API}/auth/login", data=b'{}', method="POST"
)
req.add_header("Content-Type", "application/json")
req.add_header("Origin", ALLOWED_ORIGIN)
try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        post_headers = {k.lower(): v for k, v in dict(resp.headers).items()}
except urllib.error.HTTPError as e:
    # Empty login body returns 400 — that's what we want; we just need
    # to read the response headers.
    post_headers = {k.lower(): v for k, v in dict(e.headers).items()}

assert_true("POST error response still includes Allow-Origin",
            post_headers.get("access-control-allow-origin") == ALLOWED_ORIGIN,
            detail=f"got {post_headers.get('access-control-allow-origin')!r}")

sys.exit(0 if report() else 1)
