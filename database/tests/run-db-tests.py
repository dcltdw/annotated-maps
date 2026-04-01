#!/usr/bin/env python3
"""
run-db-tests.py — Run database unit tests against a disposable MySQL database.

Creates a temporary database, applies all migrations, runs each test file,
then drops the database. Exit code 0 = all tests passed.

Usage (with Docker Compose stack running):
    python3 database/tests/run-db-tests.py

Or with custom connection:
    DB_PASS=rootpassword python3 database/tests/run-db-tests.py
"""

import atexit
import glob
import os
import re
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
MIGRATIONS_DIR = os.path.join(REPO_DIR, "database", "migrations")
TESTS_DIR = SCRIPT_DIR

PASS = os.environ.get("DB_PASS", os.environ.get("MYSQL_ROOT_PASSWORD", "rootpassword"))
TEST_DB = f"annotated_maps_test_{os.getpid()}"


def mysql_cmd():
    """Return the base mysql command as a list, using docker compose exec."""
    return [
        "docker", "compose", "-f", os.path.join(REPO_DIR, "docker-compose.yml"),
        "exec", "-T", "mysql",
        "mysql", "-uroot", f"-p{PASS}"
    ]


def run_sql(sql: str, database: str = None, force: bool = False) -> tuple:
    """Run SQL via the mysql client. Returns (success: bool, output: str)."""
    cmd = mysql_cmd()
    if force:
        cmd.append("--force")
    if database:
        cmd.append(database)
    result = subprocess.run(
        cmd, input=sql, capture_output=True, text=True, timeout=30
    )
    output = result.stdout + result.stderr
    return result.returncode == 0, output


def run_sql_file(filepath: str, database: str = None) -> tuple:
    """Run a SQL file via the mysql client. Returns (success: bool, output: str)."""
    with open(filepath, "r") as f:
        sql = f.read()
    return run_sql(sql, database)


def cleanup():
    print()
    print(f"==> Dropping test database {TEST_DB}...")
    run_sql(f"DROP DATABASE IF EXISTS `{TEST_DB}`;")


atexit.register(cleanup)


def main():
    # Create test database
    print(f"==> Creating test database: {TEST_DB}")
    ok, output = run_sql(
        f"CREATE DATABASE `{TEST_DB}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    )
    if not ok:
        print(f"FATAL: Could not create database: {output}")
        sys.exit(1)

    # Apply migrations
    print("==> Applying migrations...")
    migration_files = sorted(glob.glob(os.path.join(MIGRATIONS_DIR, "*.sql")))
    for filepath in migration_files:
        basename = os.path.basename(filepath)
        print(f"  {basename} ", end="", flush=True)
        ok, output = run_sql_file(filepath, TEST_DB)
        if ok:
            print("ok")
        else:
            print("FAILED")
            print(output)
            print(f"FATAL: Migration {basename} failed. Aborting.")
            sys.exit(1)

    # Run tests
    print()
    print("==> Running tests...")

    total_passed = 0
    total_failed = 0
    all_errors = []

    # Load helpers.sql
    helpers_path = os.path.join(TESTS_DIR, "helpers.sql")
    with open(helpers_path, "r") as f:
        helpers_sql = f.read()

    test_files = sorted(glob.glob(os.path.join(TESTS_DIR, "test_*.sql")))
    for test_path in test_files:
        test_name = os.path.splitext(os.path.basename(test_path))[0]
        print(f"  {test_name:<50} ", end="", flush=True)

        # Read test file, strip SOURCE lines, prepend helpers
        with open(test_path, "r") as f:
            test_sql = f.read()
        test_sql = re.sub(r'^SOURCE .*$', '', test_sql, flags=re.MULTILINE)
        combined = helpers_sql + "\n" + test_sql

        # Run with --force so errors in one statement don't abort the rest
        _, output = run_sql(combined, TEST_DB, force=True)

        # Count PASS/FAIL lines
        passes = len(re.findall(r'^PASS:', output, re.MULTILINE))
        fails = len(re.findall(r'^FAIL:', output, re.MULTILINE))

        if fails > 0:
            print(f"FAILED ({fails} failures)")
            fail_lines = [line for line in output.splitlines() if line.startswith("FAIL:")]
            all_errors.append(f"--- {test_name} ---")
            all_errors.extend(fail_lines)
            total_failed += fails
            total_passed += passes
        else:
            print(f"ok ({passes} assertions)")
            total_passed += passes

    # Summary
    print()
    print(f"==> Results: {total_passed} passed, {total_failed} failed")

    if total_failed > 0:
        print()
        print("==> Failures:")
        for line in all_errors:
            print(line)
        sys.exit(1)

    print("==> All database tests passed.")


if __name__ == "__main__":
    main()
