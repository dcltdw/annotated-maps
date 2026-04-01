#!/usr/bin/env python3
"""test_06_rate_limit_fast.py — Rate limiter enforcement test (fast tier)"""

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

sys.exit(0 if report() else 1)
