"""
helpers.py — Shared functions for backend integration tests.
Imported by each test file. Uses only Python standard library (no pip install needed).
"""

import json
import os
import subprocess
import sys
import urllib.request
import urllib.error

API = os.environ.get("API_URL", "http://localhost:8080/api/v1")
CURL_TIMEOUT = int(os.environ.get("CURL_TIMEOUT", "30"))
REPO_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

_passed = 0
_failed = 0
_errors = []


# ─── Assertions ───────────────────────────────────────────────────────────────

def assert_status(test_name: str, expected: int, actual: int):
    global _passed, _failed
    if expected == actual:
        print(f"PASS: {test_name}")
        _passed += 1
    else:
        msg = f"FAIL: {test_name} — expected HTTP {expected}, got {actual}"
        print(msg)
        _failed += 1
        _errors.append(msg)


def assert_json_field(test_name: str, body: dict, keys: list, expected):
    global _passed, _failed
    try:
        val = body
        for k in keys:
            val = val[k]
        if str(val) == str(expected):
            print(f"PASS: {test_name}")
            _passed += 1
        else:
            msg = f"FAIL: {test_name} — expected {expected}, got {val}"
            print(msg)
            _failed += 1
            _errors.append(msg)
    except (KeyError, IndexError, TypeError):
        msg = f"FAIL: {test_name} — field {keys} missing"
        print(msg)
        _failed += 1
        _errors.append(msg)


def assert_json_exists(test_name: str, body: dict, keys: list):
    global _passed, _failed
    try:
        val = body
        for k in keys:
            val = val[k]
        if val:
            print(f"PASS: {test_name}")
            _passed += 1
        else:
            msg = f"FAIL: {test_name} — field {keys} empty"
            print(msg)
            _failed += 1
            _errors.append(msg)
    except (KeyError, IndexError, TypeError):
        msg = f"FAIL: {test_name} — field {keys} missing or empty"
        print(msg)
        _failed += 1
        _errors.append(msg)


def assert_true(test_name: str, condition: bool):
    global _passed, _failed
    if condition:
        print(f"PASS: {test_name}")
        _passed += 1
    else:
        msg = f"FAIL: {test_name}"
        print(msg)
        _failed += 1
        _errors.append(msg)


# ─── HTTP helpers ─────────────────────────────────────────────────────────────

def _request(method: str, path: str, data: dict = None, token: str = None) -> tuple:
    """Make an HTTP request. Returns (status_code: int, body: dict or str)."""
    url = f"{API}{path}"
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    body_bytes = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        body_bytes = json.dumps(data).encode("utf-8")

    req = urllib.request.Request(url, data=body_bytes, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=CURL_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw
    except Exception:
        return 0, {}


def http_post(path: str, data: dict = None, token: str = None) -> tuple:
    return _request("POST", path, data, token)


def http_get(path: str, token: str = None) -> tuple:
    return _request("GET", path, token=token)


def http_put(path: str, data: dict = None, token: str = None) -> tuple:
    return _request("PUT", path, data, token)


def http_delete(path: str, token: str = None) -> tuple:
    return _request("DELETE", path, token=token)


def http_get_headers(path: str) -> dict:
    """Make a POST request and return response headers as a dict.
    Uses POST with an empty body to trigger a 400, which goes through
    our middleware (and thus includes security headers)."""
    url = f"{API}{path}"
    req = urllib.request.Request(url, data=b'{}', method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=CURL_TIMEOUT) as resp:
            return dict(resp.headers)
    except urllib.error.HTTPError as e:
        return dict(e.headers)
    except Exception as ex:
        print(f"  DEBUG: http_get_headers failed: {type(ex).__name__}: {ex}")
        return {}


# ─── Setup helpers ────────────────────────────────────────────────────────────

def register_user(username: str, email: str, password: str) -> str:
    """Register a user and return the JWT token. Falls back to login if user exists."""
    status, body = http_post("/auth/register", {
        "username": username, "email": email, "password": password
    })
    token = ""
    if isinstance(body, dict):
        token = body.get("token", "")
    if not token:
        token = login_user(email, password)
    return token


def login_user(email: str, password: str) -> str:
    """Login and return the JWT token."""
    status, body = http_post("/auth/login", {"email": email, "password": password})
    if isinstance(body, dict):
        return body.get("token", "")
    return ""


def json_field(body: dict, keys: list):
    """Extract a nested field from a dict."""
    val = body
    try:
        for k in keys:
            val = val[k]
        return val
    except (KeyError, IndexError, TypeError):
        return None


# ─── MySQL helper ─────────────────────────────────────────────────────────────

def mysql_query(query: str) -> str:
    """Run a SQL query against the database via docker compose exec."""
    password = os.environ.get("MYSQL_ROOT_PASSWORD", "rootpassword")
    result = subprocess.run(
        ["docker", "compose", "-f", f"{REPO_DIR}/docker-compose.yml",
         "exec", "-T", "mysql",
         "mysql", f"-uroot", f"-p{password}", "annotated_maps",
         "-N", "-e", query],
        capture_output=True, text=True, timeout=10
    )
    return result.stdout.strip()


# ─── Report ───────────────────────────────────────────────────────────────────

def report() -> bool:
    """Print summary and return True if all passed."""
    print(f"\n  {_passed} passed, {_failed} failed")
    return _failed == 0


def reset_counters():
    """Reset pass/fail counters (call at start of each test file)."""
    global _passed, _failed, _errors
    _passed = 0
    _failed = 0
    _errors = []
