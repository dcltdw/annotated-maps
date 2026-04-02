#!/usr/bin/env python3
"""
run-notes-tests.py — Run all notes-related tests (database + backend).

Runs the database schema tests, then the backend integration tests for notes.
Restarts the backend before integration tests to clear rate limiter state.

Prerequisites: Docker Compose stack running (docker compose up)

Usage:
    python3 backend/tests/run-notes-tests.py
"""

import glob
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
API = os.environ.get("API_URL", "http://localhost:8080/api/v1")
DB_PASS = os.environ.get("MYSQL_ROOT_PASSWORD", "rootpassword")


def wait_for_backend(max_wait=30):
    """Wait for the backend to be reachable."""
    for i in range(max_wait // 5):
        try:
            req = urllib.request.Request(f"{API}/../", method="GET")
            urllib.request.urlopen(req, timeout=5)
            return True
        except urllib.error.HTTPError:
            return True  # any HTTP response means server is up
        except Exception:
            if i < (max_wait // 5) - 1:
                print(f"  not ready yet, retrying in 5s...")
                time.sleep(5)
    return False


def restart_backend():
    """Restart the backend container to clear rate limiter state."""
    print("Restarting backend...")
    subprocess.run(
        ["docker", "compose", "-f", f"{REPO_DIR}/docker-compose.yml",
         "restart", "backend"],
        capture_output=True, timeout=30
    )


def run_db_note_tests():
    """Run the database-level notes test (test_09_notes.sql)."""
    print("=" * 50)
    print("Database Tests: Notes")
    print("=" * 50)
    print()

    migrations_dir = os.path.join(REPO_DIR, "database", "migrations")
    tests_dir = os.path.join(REPO_DIR, "database", "tests")
    test_db = f"annotated_maps_notes_test_{os.getpid()}"

    def mysql_run(sql, database=None, force=False):
        cmd = [
            "docker", "compose", "-f", f"{REPO_DIR}/docker-compose.yml",
            "exec", "-T", "mysql",
            "mysql", "-uroot", f"-p{DB_PASS}"
        ]
        if force:
            cmd.append("--force")
        if database:
            cmd.append(database)
        result = subprocess.run(cmd, input=sql, capture_output=True, text=True, timeout=30)
        return result.returncode == 0, result.stdout + result.stderr

    # Create temp database
    print(f"Creating test database: {test_db}")
    ok, out = mysql_run(
        f"CREATE DATABASE `{test_db}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    )
    if not ok:
        print(f"FATAL: Could not create database: {out}")
        return False

    try:
        # Apply migrations
        print("Applying migrations...")
        for filepath in sorted(glob.glob(os.path.join(migrations_dir, "*.sql"))):
            basename = os.path.basename(filepath)
            print(f"  {basename} ", end="", flush=True)
            with open(filepath) as f:
                sql = f.read()
            ok, out = mysql_run(sql, test_db)
            if ok:
                print("ok")
            else:
                print("FAILED")
                print(out)
                return False

        # Run notes test
        print()
        print("Running test_09_notes.sql...")
        helpers_path = os.path.join(tests_dir, "helpers.sql")
        test_path = os.path.join(tests_dir, "test_09_notes.sql")

        with open(helpers_path) as f:
            helpers_sql = f.read()
        with open(test_path) as f:
            test_sql = f.read()
        test_sql = re.sub(r'^SOURCE .*$', '', test_sql, flags=re.MULTILINE)
        combined = helpers_sql + "\n" + test_sql

        _, output = mysql_run(combined, test_db, force=True)

        passes = len(re.findall(r'^PASS:', output, re.MULTILINE))
        fails = len(re.findall(r'^FAIL:', output, re.MULTILINE))

        # Print all PASS/FAIL lines
        for line in output.splitlines():
            if line.startswith("PASS:") or line.startswith("FAIL:"):
                print(f"  {line}")

        print(f"\n  {passes} passed, {fails} failed")
        return fails == 0

    finally:
        print(f"\nDropping test database {test_db}...")
        mysql_run(f"DROP DATABASE IF EXISTS `{test_db}`;")


def run_backend_note_tests():
    """Run the backend integration notes test (test_11_notes.py)."""
    print()
    print("=" * 50)
    print("Backend Integration Tests: Notes")
    print("=" * 50)
    print()

    restart_backend()
    print("Waiting for backend...")
    if not wait_for_backend():
        print("ERROR: Backend not reachable after restart")
        return False

    print()
    test_path = os.path.join(SCRIPT_DIR, "test_11_notes.py")
    result = subprocess.run([sys.executable, test_path], timeout=120)
    return result.returncode == 0


def main():
    print("=" * 50)
    print("Notes Test Suite (Phase 1)")
    print("=" * 50)
    print()

    # Check backend is running
    print("Checking backend...")
    if not wait_for_backend(10):
        print(f"ERROR: Backend is not reachable at {API}")
        print("       Run 'docker compose up' first.")
        sys.exit(1)
    print(f"Backend reachable at {API}")
    print()

    start = time.time()
    db_ok = run_db_note_tests()
    backend_ok = run_backend_note_tests()
    elapsed = int(time.time() - start)

    print()
    print("=" * 50)
    print(f"Duration: {elapsed}s")
    print(f"Database tests:  {'PASSED' if db_ok else 'FAILED'}")
    print(f"Backend tests:   {'PASSED' if backend_ok else 'FAILED'}")
    print("=" * 50)

    sys.exit(0 if (db_ok and backend_ok) else 1)


if __name__ == "__main__":
    main()
