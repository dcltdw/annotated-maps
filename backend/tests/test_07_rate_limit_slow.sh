#!/usr/bin/env bash
# test_07_rate_limit_slow.sh — Rate limiter window expiry test (300-second wait)
# Tier: nightly, extended
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers.sh"

echo "=== Rate Limit Tests (slow — 300s window expiry) ==="

# Step 1: exhaust the rate limit
# Rate limit is set in backend/config.docker.json under custom_config.rate_limit.
echo "  --- Step 1: Exhausting rate limit ---"
for i in $(seq 1 150); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$CURL_TIMEOUT" -X POST "$API/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"email":"slowtest@fake.com","password":"x"}' 2>/dev/null || echo "000")
    if [ "$code" = "429" ]; then
        echo "  Rate limit triggered on request $i"
        break
    fi
done
assert_status "slow: rate limit is active" "429" "$code"
echo "  Rate limit confirmed active."

# Step 2: wait for window to expire
WINDOW=300
echo "  --- Step 2: Waiting ${WINDOW}s for window expiry ---"
echo "  Started at $(date '+%H:%M:%S')"
echo "  Will resume at $(date -v+${WINDOW}S '+%H:%M:%S' 2>/dev/null || date -d "+${WINDOW} seconds" '+%H:%M:%S' 2>/dev/null || echo '~5min')"

# Progress updates every 60 seconds
elapsed=0
while [ "$elapsed" -lt "$WINDOW" ]; do
    remaining=$((WINDOW - elapsed))
    if [ "$remaining" -gt 60 ]; then
        sleep 60
        elapsed=$((elapsed + 60))
        echo "  ... ${elapsed}s / ${WINDOW}s elapsed"
    else
        sleep "$remaining"
        elapsed=$WINDOW
    fi
done

# Step 3: verify requests succeed again
echo "  --- Step 3: Verifying window expired ---"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"slowtest@fake.com","password":"x"}' 2>/dev/null)
assert_true "slow: request succeeds after window expiry (got HTTP $code, expected non-429)" \
    "$([ "$code" != "429" ] && echo true || echo false)"

echo "  All window expiry tests passed."

report
