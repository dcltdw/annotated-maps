#!/usr/bin/env bash
# test_10_soak.sh — Extended soak test for rate limiter
# Tier: extended only
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers.sh"

echo "=== Rate Limit Soak Test (10 minutes) ==="

DURATION=600  # 10 minutes
INTERVAL=5    # seconds between request bursts
MAX_PER_WINDOW=5  # must match config.json rate_limit.max_requests

violations=0
bursts=0
start_time=$(date +%s)
end_time=$((start_time + DURATION))

echo "  --- Soak run ---"
echo "  Sending bursts of $((MAX_PER_WINDOW + 3)) requests every ${INTERVAL}s for ${DURATION}s"
echo "  Started at $(date '+%H:%M:%S')"

while [ "$(date +%s)" -lt "$end_time" ]; do
    bursts=$((bursts + 1))
    success_count=0

    for i in $(seq 1 $((MAX_PER_WINDOW + 3))); do
        code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$CURL_TIMEOUT" -X POST "$API/auth/login" \
            -H "Content-Type: application/json" \
            -d '{"email":"soak@fake.com","password":"x"}' 2>/dev/null || echo "000")
        if [ "$code" != "429" ]; then
            success_count=$((success_count + 1))
        fi
    done

    if [ "$success_count" -gt "$MAX_PER_WINDOW" ]; then
        violations=$((violations + 1))
        echo "  WARNING: burst $bursts allowed $success_count requests (limit is $MAX_PER_WINDOW)"
    fi

    # Progress every 60 seconds
    elapsed=$(( $(date +%s) - start_time ))
    if [ $((bursts % 12)) -eq 0 ]; then
        remaining=$(( end_time - $(date +%s) ))
        echo "  ... ${elapsed}s elapsed, ${remaining}s remaining, $bursts bursts, $violations violations"
    fi

    sleep "$INTERVAL"
done

echo "  --- Soak complete ---"
echo "  Completed $bursts bursts over ${DURATION}s"
assert_true "soak: no rate limit violations in $bursts bursts" \
    "$([ "$violations" -eq 0 ] && echo true || echo false)"

echo "  All soak tests passed."

report
