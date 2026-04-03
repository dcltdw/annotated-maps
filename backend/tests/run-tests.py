#!/usr/bin/env python3
"""
run-tests.py — Backend integration test runner (Python version).

Runs Python test files against the running Docker Compose stack.
Prerequisites: docker compose up (all 3 containers running)

Usage:
    python3 backend/tests/run-tests.py                     # fast tier (default)
    python3 backend/tests/run-tests.py --tier fast          # same as above
    python3 backend/tests/run-tests.py --tier nightly       # fast + 300s rate limit test
    python3 backend/tests/run-tests.py --tier extended      # nightly + 10-minute soak
    python3 backend/tests/run-tests.py --only 1             # run only test_01_*.py
    python3 backend/tests/run-tests.py --only 3 --tier nightly  # combinable
"""

import argparse
import glob
import os
import subprocess
import sys
import time
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
API = os.environ.get("API_URL", "http://localhost:8080/api/v1")

# Tests that need a fresh rate limiter (previous tests may have exhausted it)
NEEDS_RESTART = {
    "test_01_auth.py", "test_06_rate_limit_fast.py", "test_07_rate_limit_slow.py",
    "test_08_audit.py", "test_09_security.py", "test_10_soak.py",
}

FAST_TESTS = [
    "test_01_auth.py",
    "test_02_filters.py",
    "test_03_maps.py",
    "test_04_annotations.py",
    "test_05_tenants.py",
    "test_06_rate_limit_fast.py",
    "test_08_audit.py",
    "test_09_security.py",
    "test_11_notes.py",
    "test_12_annotation_edit_delete_move.py",
    "test_13_note_groups.py",
]

NIGHTLY_EXTRA = ["test_07_rate_limit_slow.py"]
EXTENDED_EXTRA = ["test_10_soak.py"]

TEST_DESCRIPTIONS = {
    1: "Auth (registration, login, refresh, deactivation)",
    2: "Filters (JwtFilter, TenantFilter)",
    3: "Maps (CRUD, scoping, pagination, permissions)",
    4: "Annotations (CRUD, GeoJSON validation, media URLs)",
    5: "Tenants (members, branding)",
    6: "Rate limit — fast (enforcement, Retry-After header)",
    7: "Rate limit — slow (300s window expiry) [nightly+]",
    8: "Audit log (event recording, IP presence)",
    9: "Security (cross-org isolation, headers)",
    10: "Rate limit — soak (10min continuous) [extended]",
    11: "Notes (CRUD, cross-org isolation)",
    12: "Annotation edit, delete, and move",
    13: "Note groups (CRUD, assignment, filtering, permissions)",
}


def wait_for_backend(max_wait=30):
    """Wait for the backend to be reachable."""
    url = f"{API}/../"
    print(f"  DEBUG: checking {url}")
    for i in range(max_wait // 5):
        try:
            req = urllib.request.Request(url, method="GET")
            resp = urllib.request.urlopen(req, timeout=5)
            print(f"  DEBUG: got HTTP {resp.status}")
            return True
        except urllib.error.HTTPError as e:
            # Any HTTP response (even 404) means the server is up
            print(f"  DEBUG: got HTTP {e.code} (server is up)")
            return True
        except Exception as e:
            print(f"  DEBUG: attempt {i+1} failed: {type(e).__name__}: {e}")
            if i < (max_wait // 5) - 1:
                print(f"  not ready yet, retrying in 5s...")
                time.sleep(5)
    return False


def restart_backend():
    """Restart the backend container to clear rate limiter state."""
    subprocess.run(
        ["docker", "compose", "-f", f"{REPO_DIR}/docker-compose.yml",
         "restart", "backend"],
        capture_output=True, timeout=30
    )


def clear_audit_log():
    """Clear the audit_log table."""
    password = os.environ.get("MYSQL_ROOT_PASSWORD", "rootpassword")
    subprocess.run(
        ["docker", "compose", "-f", f"{REPO_DIR}/docker-compose.yml",
         "exec", "-T", "mysql",
         "mysql", f"-uroot", f"-p{password}", "annotated_maps",
         "-e", "DELETE FROM audit_log;"],
        capture_output=True, timeout=10
    )


def main():
    parser = argparse.ArgumentParser(description="Backend integration test runner")
    parser.add_argument("--tier", choices=["fast", "nightly", "extended"], default="fast",
                        help="Test tier (default: fast)")
    parser.add_argument("--only", type=int, metavar="N",
                        help="Run only test_0N_*.py")
    args = parser.parse_args()

    # Select tests
    if args.only:
        padded = f"{args.only:02d}"
        matches = glob.glob(os.path.join(SCRIPT_DIR, f"test_{padded}_*.py"))
        if not matches:
            print(f"ERROR: No test file matching test_{padded}_*.py")
            print("\nAvailable tests:")
            for num, desc in sorted(TEST_DESCRIPTIONS.items()):
                print(f"  {num:>2}  {desc}")
            sys.exit(1)
        tests = [os.path.basename(matches[0])]
    else:
        tests = list(FAST_TESTS)
        if args.tier in ("nightly", "extended"):
            tests.extend(NIGHTLY_EXTRA)
        if args.tier == "extended":
            tests.extend(EXTENDED_EXTRA)

    # Header
    if args.only:
        print("=" * 40)
        print(f"Backend Integration Tests — test {args.only} only")
        print("=" * 40)
    else:
        print("=" * 40)
        print(f"Backend Integration Tests — tier: {args.tier}")
        print("=" * 40)
    print()

    # Check backend — if not reachable, try restarting it
    print("Checking backend...")
    if not wait_for_backend(10):
        print("  Backend not responding, attempting restart...")
        restart_backend()
        if not wait_for_backend(30):
            print(f"ERROR: Backend is not reachable at {API}")
            print("       Run 'docker compose up' first.")
            sys.exit(1)
    print(f"Backend reachable at {API}")
    print()

    # Prepare
    print("Preparing test state...")
    clear_audit_log()
    print()

    # Run
    failed_suites = []
    start_time = time.time()

    for test_file in tests:
        # Restart backend if needed for clean rate limiter
        if test_file in NEEDS_RESTART:
            print(f"(restarting backend for {test_file})")
            restart_backend()
            if not wait_for_backend():
                print("ERROR: Backend not reachable after restart")
                failed_suites.append(test_file)
                continue

        print(f"--- {test_file} ---")
        result = subprocess.run(
            [sys.executable, os.path.join(SCRIPT_DIR, test_file)],
            timeout=600  # 10 min max per test
        )
        print()

        if result.returncode != 0:
            failed_suites.append(test_file)

    # Summary
    elapsed = int(time.time() - start_time)
    print("=" * 40)
    if args.only:
        print(f"Test: {tests[0]}")
    else:
        print(f"Tier: {args.tier}")
    print(f"Duration: {elapsed}s")

    if failed_suites:
        print(f"FAILED suites: {' '.join(failed_suites)}")
        print("=" * 40)
        sys.exit(1)
    else:
        print("All test suites passed.")
        print("=" * 40)
        sys.exit(0)


if __name__ == "__main__":
    main()
