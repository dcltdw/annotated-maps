#!/usr/bin/env bash
# test_08_audit.sh — Verify audit log entries are created for security events
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers.sh"

echo "=== Audit Log Tests ==="

RUN_ID="$$"

# Clear audit log to isolate our test
mysql_query "DELETE FROM audit_log;"
echo "  Cleared audit_log table."

# ─── Login failure creates audit entry ────────────────────────────────────────

echo "  --- Login failure audit ---"

http_post "/auth/login" "{\"email\":\"audit_${RUN_ID}@test.com\",\"password\":\"wrong\"}"
sleep 1  # give async insert time to complete

COUNT=$(mysql_query "SELECT COUNT(*) FROM audit_log WHERE event_type = 'login_failure';")
assert_true "audit: login_failure recorded" "$([ "$COUNT" -ge 1 ] && echo true || echo false)"

# Verify email is in detail JSON — find our specific entry
DETAIL=$(mysql_query "SELECT detail FROM audit_log WHERE event_type = 'login_failure' AND detail LIKE '%audit_${RUN_ID}%' LIMIT 1;")
has_email=$(echo "$DETAIL" | grep -c "audit_${RUN_ID}" || true)
assert_true "audit: login_failure detail contains email" \
    "$([ "$has_email" -ge 1 ] && echo true || echo false)"

echo "  All login failure audit tests passed."

# ─── Registration creates audit entry ─────────────────────────────────────────

echo "  --- Registration audit ---"

# Register directly via http_post so we know exactly what happened
http_post "/auth/register" "{\"username\":\"t08_${RUN_ID}\",\"email\":\"t08_${RUN_ID}@test.com\",\"password\":\"testpass123\"}"
echo "  DEBUG: register status=$HTTP_STATUS"
REG_TOKEN=$(json_field "$HTTP_BODY" "['token']")
sleep 2  # async audit insert

COUNT=$(mysql_query "SELECT COUNT(*) FROM audit_log WHERE event_type = 'register';")
echo "  DEBUG: register audit count=$COUNT"
assert_true "audit: register recorded" "$([ "$COUNT" -ge 1 ] && echo true || echo false)"

echo "  All registration audit tests passed."

# ─── Login success creates audit entry ────────────────────────────────────────

echo "  --- Login success audit ---"

http_post "/auth/login" "{\"email\":\"t08_${RUN_ID}@test.com\",\"password\":\"testpass123\"}"
echo "  DEBUG: login status=$HTTP_STATUS"
sleep 2  # async audit insert

COUNT=$(mysql_query "SELECT COUNT(*) FROM audit_log WHERE event_type = 'login_success';")
echo "  DEBUG: login_success audit count=$COUNT"
assert_true "audit: login_success recorded" "$([ "$COUNT" -ge 1 ] && echo true || echo false)"

echo "  All login success audit tests passed."

# ─── All entries have IP address ──────────────────────────────────────────────

# Dump all audit entries for debugging
echo "  --- DEBUG: all audit entries ---"
mysql_query "SELECT id, event_type, user_id, LEFT(detail, 80) AS detail FROM audit_log ORDER BY id;"
echo "  ---"

echo "  --- IP address presence ---"

EMPTY_IP=$(mysql_query "SELECT COUNT(*) FROM audit_log WHERE ip_address = '' OR ip_address IS NULL;")
assert_true "audit: all entries have IP address" "$([ "$EMPTY_IP" -eq 0 ] && echo true || echo false)"

echo "  All IP address tests passed."

report
