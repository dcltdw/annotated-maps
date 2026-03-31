#!/usr/bin/env bash
# run-db-tests.sh — Run database unit tests against a disposable MySQL database.
#
# Creates a temporary database, applies all migrations, runs each test file,
# then drops the database. Exit code 0 = all tests passed.
#
# Usage (with Docker Compose stack running):
#   ./database/tests/run-db-tests.sh
#
# Or with custom connection:
#   DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASS=rootpassword \
#     ./database/tests/run-db-tests.sh

set -euo pipefail

HOST="${DB_HOST:-127.0.0.1}"
PORT="${DB_PORT:-3306}"
USER="${DB_USER:-root}"
PASS="${DB_PASS:-rootpassword}"
TEST_DB="annotated_maps_test_$$"  # unique per run (PID suffix)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$REPO_DIR/database/migrations"
TESTS_DIR="$SCRIPT_DIR"

# Use local mysql if available, otherwise run inside the Docker container
if command -v mysql &>/dev/null; then
    MYSQL_CMD="mysql -h$HOST -P$PORT -u$USER -p$PASS"
else
    MYSQL_CMD="docker compose -f $REPO_DIR/docker-compose.yml exec -T mysql mysql -uroot -p${PASS}"
fi

cleanup() {
    echo ""
    echo "==> Dropping test database $TEST_DB..."
    echo "DROP DATABASE IF EXISTS \`$TEST_DB\`;" | $MYSQL_CMD 2>/dev/null || true
}
trap cleanup EXIT

echo "==> Creating test database: $TEST_DB"
echo "CREATE DATABASE \`$TEST_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" | $MYSQL_CMD

echo "==> Applying migrations..."
for file in "$MIGRATIONS_DIR"/*.sql; do
    basename=$(basename "$file")
    printf "  %s " "$basename"
    if migration_output=$($MYSQL_CMD "$TEST_DB" < "$file" 2>&1); then
        echo "ok"
    else
        echo "FAILED"
        echo "$migration_output"
        echo "FATAL: Migration $basename failed. Aborting."
        exit 1
    fi
done

echo ""
echo "==> Running tests..."

passed=0
failed=0
errors=""

for test_file in "$TESTS_DIR"/test_*.sql; do
    test_name=$(basename "$test_file" .sql)
    printf "  %-50s " "$test_name"

    # Concatenate helpers + test file, stripping SOURCE lines.
    # Use --force so errors in one statement don't abort the rest.
    combined=$(cat "$TESTS_DIR/helpers.sql"; echo ""; sed '/^SOURCE /d' "$test_file")
    output=$(echo "$combined" | $MYSQL_CMD --force "$TEST_DB" 2>&1) || true

    # Count PASS/FAIL lines in output
    test_passes=$(echo "$output" | grep -c "^PASS:" || true)
    test_fails=$(echo "$output" | grep -c "^FAIL:" || true)

    if [ "$test_fails" -gt 0 ]; then
        echo "FAILED ($test_fails failures)"
        errors="$errors\n--- $test_name ---\n$(echo "$output" | grep "^FAIL:")\n"
        failed=$((failed + test_fails))
        passed=$((passed + test_passes))
    else
        echo "ok ($test_passes assertions)"
        passed=$((passed + test_passes))
    fi
done

echo ""
echo "==> Results: $passed passed, $failed failed"

if [ "$failed" -gt 0 ]; then
    echo ""
    echo "==> Failures:"
    echo -e "$errors"
    exit 1
fi

echo "==> All database tests passed."
