#!/usr/bin/env python3
"""test_07_rate_limit_slow.py — Rate limiter window expiry test (300-second wait)
Tier: nightly, extended"""

import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta
sys.path.insert(0, os.path.dirname(__file__))

from helpers import reset_counters, report, assert_status, assert_true, API, CURL_TIMEOUT

reset_counters()

print("=== Rate Limit Tests (slow — 300s window expiry) ===")


def auth_request():
    url = f"{API}/auth/login"
    data = b'{"email":"slowtest@fake.com","password":"x"}'
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=CURL_TIMEOUT) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


# Step 1: exhaust rate limit
# Rate limit is set in backend/config.docker.json under custom_config.rate_limit.
print("  --- Step 1: Exhausting rate limit ---")
code = 0
for i in range(1, 151):
    code = auth_request()
    if code == 429:
        print(f"  Rate limit triggered on request {i}")
        break

assert_status("slow: rate limit is active", 429, code)
print("  Rate limit confirmed active.")

# Step 2: wait for window
WINDOW = 300
now = datetime.now()
resume = now + timedelta(seconds=WINDOW)
print(f"  --- Step 2: Waiting {WINDOW}s for window expiry ---")
print(f"  Started at {now.strftime('%H:%M:%S')}")
print(f"  Will resume at {resume.strftime('%H:%M:%S')}")

elapsed = 0
while elapsed < WINDOW:
    remaining = WINDOW - elapsed
    if remaining > 60:
        time.sleep(60)
        elapsed += 60
        print(f"  ... {elapsed}s / {WINDOW}s elapsed")
    else:
        time.sleep(remaining)
        elapsed = WINDOW

# Step 3: verify window expired
print("  --- Step 3: Verifying window expired ---")
code = auth_request()
assert_true(f"slow: request succeeds after window expiry (got HTTP {code}, expected non-429)",
            code != 429)

print("  All window expiry tests passed.")

sys.exit(0 if report() else 1)
