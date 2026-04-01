#!/usr/bin/env python3
"""
seed-local-dev.py

Registers test users via the running backend (to get real Argon2id hashes),
then applies the SQL seed to set up orgs, tenants, and memberships.

Prerequisites: the Docker Compose stack must be running (docker compose up).

Usage:
    python3 database/seed-local-dev.py
"""

import json
import os
import subprocess
import sys
import urllib.request
import urllib.error

API = "http://localhost:8080/api/v1"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))

USERS = [
    ("alice", "alice@acme.test"),
    ("bob",   "bob@acme.test"),
    ("carol", "carol@acme.test"),
    ("dan",   "dan@beta.test"),
    ("eve",   "eve@beta.test"),
]


def register_user(username: str, email: str, password: str) -> int:
    """Register a user via the API. Returns the HTTP status code."""
    url = f"{API}/auth/register"
    data = json.dumps({
        "username": username, "email": email, "password": password
    }).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as ex:
        print(f"    ERROR: {ex}")
        return 0


def run_sql_file(filepath: str):
    """Run a SQL file via docker compose exec."""
    password = os.environ.get("MYSQL_ROOT_PASSWORD", "rootpassword")
    with open(filepath, "r") as f:
        sql = f.read()
    result = subprocess.run(
        ["docker", "compose", "-f", os.path.join(REPO_DIR, "docker-compose.yml"),
         "exec", "-T", "mysql",
         "mysql", "-uroot", f"-p{password}", "annotated_maps"],
        input=sql, capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        print(f"ERROR: {result.stderr}")
        sys.exit(1)


def main():
    print("==> Registering test users via the API...")
    for username, email in USERS:
        print(f"  {email:<20} ", end="", flush=True)
        status = register_user(username, email, "password")
        if status == 201:
            print("registered")
        elif status == 409:
            print("already exists (ok)")
        else:
            print(f"HTTP {status} (unexpected)")

    print()
    print("==> Applying org/tenant seed SQL...")
    run_sql_file(os.path.join(SCRIPT_DIR, "seed-local-dev.sql"))

    print()
    print("==> Done. Test accounts:")
    print("    alice@acme.test / password  (Acme: Engineering=admin, Sales=viewer)")
    print("    bob@acme.test   / password  (Acme: Engineering=editor, Support=admin)")
    print("    carol@acme.test / password  (Acme: Sales=admin)")
    print("    dan@beta.test   / password  (Beta: Engineering=admin, Marketing=editor)")
    print("    eve@beta.test   / password  (Beta: Marketing=admin, Operations=viewer)")
    print()
    print("    Open http://localhost:5173 and log in.")


if __name__ == "__main__":
    main()
