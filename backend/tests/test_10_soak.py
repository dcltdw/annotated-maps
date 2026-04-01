#!/usr/bin/env python3
"""test_10_soak.py — Extended soak test for rate limiter
Tier: extended only"""

import os
import sys
import time
import urllib.request
import urllib.error
sys.path.insert(0, os.path.dirname(__file__))

from helpers import reset_counters, report, assert_true, API, CURL_TIMEOUT

reset_counters()

print("=== Rate Limit Soak Test (10 minutes) ===")

DURATION = 600  # 10 minutes
INTERVAL = 5    # seconds between bursts
MAX_PER_WINDOW = 100  # must match config.docker.json rate_limit.max_requests


def auth_request():
    url = f"{API}/auth/login"
    data = b'{"email":"soak@fake.com","password":"x"}'
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=CURL_TIMEOUT) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


violations = 0
bursts = 0
start = time.time()
end = start + DURATION

print(f"  --- Soak run ---")
print(f"  Sending bursts of {MAX_PER_WINDOW + 3} requests every {INTERVAL}s for {DURATION}s")
print(f"  Started at {time.strftime('%H:%M:%S')}")

while time.time() < end:
    bursts += 1
    success_count = 0

    for _ in range(MAX_PER_WINDOW + 3):
        code = auth_request()
        if code != 429:
            success_count += 1

    if success_count > MAX_PER_WINDOW:
        violations += 1
        print(f"  WARNING: burst {bursts} allowed {success_count} requests "
              f"(limit is {MAX_PER_WINDOW})")

    elapsed = int(time.time() - start)
    if bursts % 12 == 0:
        remaining = int(end - time.time())
        print(f"  ... {elapsed}s elapsed, {remaining}s remaining, "
              f"{bursts} bursts, {violations} violations")

    time.sleep(INTERVAL)

print(f"  --- Soak complete ---")
print(f"  Completed {bursts} bursts over {DURATION}s")
assert_true(f"soak: no rate limit violations in {bursts} bursts", violations == 0)

print("  All soak tests passed.")

sys.exit(0 if report() else 1)
