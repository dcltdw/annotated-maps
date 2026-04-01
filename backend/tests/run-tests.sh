#!/usr/bin/env bash
# run-tests.sh — Backend integration test runner.
#
# Runs curl-based tests against the running Docker Compose stack.
# Prerequisites: docker compose up (all 3 containers running)
#
# Usage:
#   ./backend/tests/run-tests.sh                   # fast tier (default)
#   ./backend/tests/run-tests.sh --tier fast        # same as above
#   ./backend/tests/run-tests.sh --tier nightly      # fast + 300s rate limit window test
#   ./backend/tests/run-tests.sh --tier extended     # nightly + 10-minute soak test
#   ./backend/tests/run-tests.sh --only 1            # run only test_01_*.sh
#   ./backend/tests/run-tests.sh --only 3            # run only test_03_*.sh
#   ./backend/tests/run-tests.sh --only 1 --tier nightly  # combinable

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIER="fast"
ONLY=""

# Parse arguments
while [ $# -gt 0 ]; do
    case "$1" in
        --tier)  TIER="${2:-fast}"; shift 2 ;;
        --only)  ONLY="${2:-}"; shift 2 ;;
        *)
            echo "Usage: $0 [--tier fast|nightly|extended] [--only N]"
            echo ""
            echo "Options:"
            echo "  --tier T   Test tier: fast (~60s), nightly (~6min), extended (~17min)"
            echo "  --only N   Run only test_0N_*.sh (e.g., --only 1 for test_01_auth.sh)"
            echo ""
            echo "Tests:"
            echo "   1  Auth (registration, login, refresh, deactivation)"
            echo "   2  Filters (JwtFilter, TenantFilter)"
            echo "   3  Maps (CRUD, scoping, pagination, permissions)"
            echo "   4  Annotations (CRUD, GeoJSON validation, media URLs)"
            echo "   5  Tenants (members, branding)"
            echo "   6  Rate limit — fast (enforcement, Retry-After header)"
            echo "   7  Rate limit — slow (300s window expiry) [nightly+]"
            echo "   8  Audit log (event recording, IP presence)"
            echo "   9  Security (cross-org isolation, headers)"
            echo "  10  Rate limit — soak (10min continuous) [extended]"
            exit 1
            ;;
    esac
done

# Validate tier
case "$TIER" in
    fast|nightly|extended) ;;
    *)
        echo "ERROR: Invalid tier '$TIER'. Use fast, nightly, or extended."
        exit 1
        ;;
esac

# ─── Header ──────────────────────────────────────────────────────────────────

if [ -n "$ONLY" ]; then
    echo "========================================"
    echo "Backend Integration Tests — test $ONLY only"
    echo "========================================"
else
    echo "========================================"
    echo "Backend Integration Tests — tier: $TIER"
    echo "========================================"
fi
echo ""

REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
API="${API_URL:-http://localhost:8080/api/v1}"

# Verify the stack is running
echo "Checking backend..."
if ! curl -s --max-time 5 -o /dev/null "$API/../" 2>/dev/null; then
    echo "ERROR: Backend is not reachable at $API"
    echo "       Run 'docker compose up' first."
    exit 1
fi
echo "Backend reachable at $API"
echo ""

# ─── Select tests ────────────────────────────────────────────────────────────

if [ -n "$ONLY" ]; then
    # Find the test file matching the number
    padded=$(printf "%02d" "$ONLY")
    match=$(ls "$SCRIPT_DIR"/test_${padded}_*.sh 2>/dev/null | head -1)
    if [ -z "$match" ]; then
        echo "ERROR: No test file matching test_${padded}_*.sh"
        exit 1
    fi
    TESTS=("$(basename "$match")")
else
    TESTS=(
        test_01_auth.sh
        test_02_filters.sh
        test_03_maps.sh
        test_04_annotations.sh
        test_05_tenants.sh
        test_06_rate_limit_fast.sh
        test_08_audit.sh
        test_09_security.sh
    )

    if [ "$TIER" = "nightly" ] || [ "$TIER" = "extended" ]; then
        TESTS+=(test_07_rate_limit_slow.sh)
    fi

    if [ "$TIER" = "extended" ]; then
        TESTS+=(test_10_soak.sh)
    fi
fi

# ─── Prepare test state ─────────────────────────────────────────────────────

echo "Preparing test state..."
docker compose -f "$REPO_DIR/docker-compose.yml" exec -T mysql \
    mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-rootpassword}" annotated_maps \
    -e "DELETE FROM audit_log;" 2>/dev/null || true
echo ""

# ─── Run tests ───────────────────────────────────────────────────────────────

total_passed=0
total_failed=0
failed_suites=""
start_time=$(date +%s)

# Tests that need a fresh rate limiter (because they make auth endpoint calls
# and a previous test may have exhausted the limit).
NEEDS_RESTART="test_01_auth.sh test_06_rate_limit_fast.sh test_07_rate_limit_slow.sh test_08_audit.sh test_09_security.sh test_10_soak.sh"

wait_for_backend() {
    for i in $(seq 1 6); do
        if curl -s --max-time 5 -o /dev/null "$API/../" 2>/dev/null; then
            return 0
        fi
        sleep 5
    done
    echo "ERROR: Backend not reachable after restart"
    return 1
}

for test_file in "${TESTS[@]}"; do
    # Restart backend if this test needs a clean rate limiter
    if echo "$NEEDS_RESTART" | grep -q "$test_file"; then
        echo "(restarting backend for $test_file)"
        docker compose -f "$REPO_DIR/docker-compose.yml" restart backend 2>/dev/null || true
        wait_for_backend
    fi

    echo "--- $test_file ---"
    if bash "$SCRIPT_DIR/$test_file"; then
        suite_exit=0
    else
        suite_exit=1
    fi

    echo ""

    if [ "$suite_exit" -ne 0 ]; then
        failed_suites="$failed_suites $test_file"
    fi
done

# ─── Final summary ───────────────────────────────────────────────────────────

elapsed=$(( $(date +%s) - start_time ))
echo "========================================"
if [ -n "$ONLY" ]; then
    echo "Test: ${TESTS[0]}"
else
    echo "Tier: $TIER"
fi
echo "Duration: ${elapsed}s"

if [ -n "$failed_suites" ]; then
    echo "FAILED suites:$failed_suites"
    echo "========================================"
    exit 1
else
    echo "All test suites passed."
    echo "========================================"
    exit 0
fi
