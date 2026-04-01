#!/usr/bin/env python3
"""
run_migrations.py — Apply all migrations in order.

Usage:
    python3 database/run_migrations.py

Or with custom connection (via docker compose exec):
    DB_PASS=secret python3 database/run_migrations.py
"""

import glob
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
MIGRATIONS_DIR = os.path.join(SCRIPT_DIR, "migrations")

HOST = os.environ.get("DB_HOST", "127.0.0.1")
PORT = os.environ.get("DB_PORT", "3306")
USER = os.environ.get("DB_USER", "root")
PASS = os.environ.get("DB_PASS", os.environ.get("MYSQL_ROOT_PASSWORD", "rootpassword"))
NAME = os.environ.get("DB_NAME", "annotated_maps")


def run_sql(sql: str, database: str = None) -> tuple:
    """Run SQL via docker compose exec. Returns (success, output)."""
    cmd = [
        "docker", "compose", "-f", os.path.join(REPO_DIR, "docker-compose.yml"),
        "exec", "-T", "mysql",
        "mysql", f"-uroot", f"-p{PASS}"
    ]
    if database:
        cmd.append(database)
    result = subprocess.run(
        cmd, input=sql, capture_output=True, text=True, timeout=30
    )
    return result.returncode == 0, result.stdout + result.stderr


def main():
    # Create database if it doesn't exist
    print(f"Creating database '{NAME}' if it does not exist...")
    ok, output = run_sql(
        f"CREATE DATABASE IF NOT EXISTS `{NAME}` "
        f"CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    )
    if not ok:
        print(f"FATAL: {output}")
        sys.exit(1)

    # Apply migrations
    print("Running migrations...")
    migration_files = sorted(glob.glob(os.path.join(MIGRATIONS_DIR, "*.sql")))
    if not migration_files:
        print("  No migration files found.")
        sys.exit(1)

    for filepath in migration_files:
        basename = os.path.basename(filepath)
        print(f"  -> {basename}")
        with open(filepath, "r") as f:
            sql = f.read()
        ok, output = run_sql(sql, NAME)
        if not ok:
            print(f"FATAL: Migration {basename} failed:")
            print(output)
            sys.exit(1)

    print("All migrations applied successfully.")


if __name__ == "__main__":
    main()
