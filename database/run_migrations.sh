#!/usr/bin/env bash
# run_migrations.sh — apply all migrations in order
# Usage: DB_HOST=localhost DB_USER=root DB_PASS=secret DB_NAME=annotated_maps ./run_migrations.sh

set -euo pipefail

HOST="${DB_HOST:-127.0.0.1}"
PORT="${DB_PORT:-3306}"
USER="${DB_USER:-root}"
PASS="${DB_PASS:-}"
NAME="${DB_NAME:-annotated_maps}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"

echo "Creating database '$NAME' if it does not exist…"
mysql -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" \
    -e "CREATE DATABASE IF NOT EXISTS \`$NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo "Running migrations…"
for file in "$MIGRATIONS_DIR"/*.sql; do
    echo "  → $file"
    mysql -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$NAME" < "$file"
done

echo "All migrations applied successfully."
