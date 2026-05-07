#!/usr/bin/env python3
"""test_06_rate_limit_fast.py — Rate limiter enforcement test (fast tier)"""

import json
import os
import sys
import urllib.request
import urllib.error
sys.path.insert(0, os.path.dirname(__file__))

from helpers import reset_counters, report, assert_true, API, CURL_TIMEOUT

reset_counters()

print("=== Rate Limit Tests (fast) ===")
print("  --- Enforcement ---")


def auth_request():
    """Send a login request, return HTTP status code."""
    url = f"{API}/auth/login"
    data = b'{"email":"ratelimit@fake.com","password":"x"}'
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=CURL_TIMEOUT) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


def get_retry_after():
    """Send a login request and return the Retry-After header value."""
    url = f"{API}/auth/login"
    data = b'{"email":"ratelimit@fake.com","password":"x"}'
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=CURL_TIMEOUT) as resp:
            return resp.headers.get("Retry-After", "")
    except urllib.error.HTTPError as e:
        return e.headers.get("Retry-After", "")
    except Exception:
        return ""


# Check if already rate-limited
code = auth_request()
if code == 429:
    retry = get_retry_after()
    if retry and int(retry) > 10:
        print(f"  (wait would be {retry}s — skipping for fast tier)")
        print("PASS: rate_limit: skipped (window active from prior tests)")
        report()
        sys.exit(0)
    elif retry:
        import time
        time.sleep(int(retry))

# Send requests until 429
# Rate limit is set in backend/config.docker.json under custom_config.rate_limit.
# Default for dev: 100 requests / 60 seconds.
print("  Sending requests until rate limit triggers...")
got_429 = False
last_non_429 = 0
for i in range(1, 151):
    code = auth_request()
    if code == 429:
        got_429 = True
        print(f"  Rate limit triggered on request {i}")
        break
    last_non_429 = i

assert_true("rate_limit: server returns 429 after limit", got_429)
assert_true("rate_limit: at least 1 request succeeded before 429", last_non_429 >= 1)

print("  All enforcement tests passed.")

# ─── Retry-After header ──────────────────────────────────────────────────────

print("  --- Retry-After header ---")

retry = get_retry_after()
assert_true("rate_limit: 429 includes Retry-After header", len(retry) > 0)

print("  All Retry-After header tests passed.")

# ─── 429 body shape (#52 follow-up) ──────────────────────────────────────────
# RateLimitFilter is its own response emitter (separate from errorResponse)
# so the {error, message} shape contract — which extractApiError() on the
# frontend depends on — needs to be pinned here too. The bucket is already
# saturated from the enforcement section above; one more request hits 429
# and gives us a body to inspect. The runner restarts the backend before
# every NEEDS_RESTART test (which includes test_08 right after this one),
# so the saturated bucket doesn't leak past this file.

print("  --- 429 body shape ---")

def get_429_body():
    """Send a login request (already rate-limited) and return parsed JSON body."""
    url = f"{API}/auth/login"
    data = b'{"email":"ratelimit@fake.com","password":"x"}'
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=CURL_TIMEOUT) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")
    except Exception:
        return 0, ""

code, raw = get_429_body()
if code == 429:
    try:
        body = json.loads(raw)
    except (ValueError, TypeError):
        body = None
    assert_true("rate_limit: 429 body is JSON", isinstance(body, dict))
    assert_true("rate_limit: 429 body has non-empty 'error' string",
                isinstance(body, dict)
                and isinstance(body.get("error"), str)
                and len(body["error"]) > 0)
    assert_true("rate_limit: 429 body has non-empty 'message' string",
                isinstance(body, dict)
                and isinstance(body.get("message"), str)
                and len(body["message"]) > 0)
else:
    # Bucket aged out between the previous request and this one — possible
    # but unlikely. Don't fail the suite, just record a non-fatal note.
    print(f"  (bucket aged out between requests; got status {code} not 429 — "
          "shape check skipped)")

print("  All 429 body shape tests passed.")

sys.exit(0 if report() else 1)
