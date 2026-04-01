#!/usr/bin/env python3
"""test_08_audit.py — Verify audit log entries are created for security events"""

import os
import sys
import time
sys.path.insert(0, os.path.dirname(__file__))

from helpers import (
    reset_counters, report, assert_true,
    http_post, register_user, login_user, mysql_query
)

reset_counters()
RUN_ID = os.getpid()

print("=== Audit Log Tests ===")

mysql_query("DELETE FROM audit_log;")
print("  Cleared audit_log table.")

# ─── Login failure ────────────────────────────────────────────────────────────

print("  --- Login failure audit ---")

http_post("/auth/login", {"email": f"audit_{RUN_ID}@test.com", "password": "wrong"})
time.sleep(2)

count = mysql_query("SELECT COUNT(*) FROM audit_log WHERE event_type = 'login_failure';")
assert_true("audit: login_failure recorded", int(count or 0) >= 1)

detail = mysql_query(
    f"SELECT detail FROM audit_log WHERE event_type = 'login_failure' "
    f"AND detail LIKE '%audit_{RUN_ID}%' LIMIT 1;")
assert_true("audit: login_failure detail contains email", f"audit_{RUN_ID}" in (detail or ""))

print("  All login failure audit tests passed.")

# ─── Registration ─────────────────────────────────────────────────────────────

print("  --- Registration audit ---")

status, body = http_post("/auth/register", {
    "username": f"t08_{RUN_ID}", "email": f"t08_{RUN_ID}@test.com", "password": "testpass123"
})
print(f"  DEBUG: register status={status}")
time.sleep(2)

count = mysql_query("SELECT COUNT(*) FROM audit_log WHERE event_type = 'register';")
print(f"  DEBUG: register audit count={count}")
assert_true("audit: register recorded", int(count or 0) >= 1)

print("  All registration audit tests passed.")

# ─── Login success ────────────────────────────────────────────────────────────

print("  --- Login success audit ---")

status, _ = http_post("/auth/login", {
    "email": f"t08_{RUN_ID}@test.com", "password": "testpass123"
})
print(f"  DEBUG: login status={status}")
time.sleep(2)

count = mysql_query("SELECT COUNT(*) FROM audit_log WHERE event_type = 'login_success';")
print(f"  DEBUG: login_success audit count={count}")
assert_true("audit: login_success recorded", int(count or 0) >= 1)

print("  All login success audit tests passed.")

# ─── IP address presence ─────────────────────────────────────────────────────

print("  --- IP address presence ---")

empty_ip = mysql_query(
    "SELECT COUNT(*) FROM audit_log WHERE ip_address = '' OR ip_address IS NULL;")
assert_true("audit: all entries have IP address", int(empty_ip or 0) == 0)

print("  All IP address tests passed.")

sys.exit(0 if report() else 1)
