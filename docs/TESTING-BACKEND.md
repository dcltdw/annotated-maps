# Backend Integration Tests

HTTP-based integration tests that run against the live Docker Compose stack.
Tests exercise the full request path: rate limiter, JWT filter, tenant filter,
controller logic, database, and audit log.

## Prerequisites

- Docker Compose stack running (`docker compose up`)
- `curl` and `python3` (pre-installed on macOS)

## Running the tests

```bash
# Fast tier (default) — ~60 seconds
./backend/tests/run-tests.sh

# Nightly tier — ~6 minutes (adds 300s rate limit window expiry test)
./backend/tests/run-tests.sh --tier nightly

# Extended tier — ~17 minutes (adds 10-minute soak test)
./backend/tests/run-tests.sh --tier extended
```

## Test tiers

| Tier | Duration | When to run | What's included |
|---|---|---|---|
| `fast` | ~60s | Every commit, local dev | Auth, filters, CRUD, permissions, input validation, security headers, audit log, rate limit enforcement |
| `nightly` | ~6min | Scheduled CI (e.g., 3am) | Everything in fast + rate limit window expiry with real 300s wait |
| `extended` | ~17min | Weekly or manual | Everything in nightly + 10-minute rate limiter soak test |

## Test files

| File | Tier | What it tests |
|---|---|---|
| `test_01_auth.sh` | fast | Registration, login, refresh, deactivated user, error messages |
| `test_02_filters.sh` | fast | JwtFilter (missing/bad/expired token, deactivated user), TenantFilter (membership, cross-org) |
| `test_03_maps.sh` | fast | Map CRUD, tenant scoping, pagination bounds, cross-org isolation |
| `test_04_annotations.sh` | fast | Annotation CRUD, GeoJSON validation, media URL scheme validation |
| `test_05_tenants.sh` | fast | Member add/remove, cross-org member rejection, branding validation |
| `test_06_rate_limit_fast.sh` | fast | Rate limiter blocks after limit, 429 has Retry-After header |
| `test_07_rate_limit_slow.sh` | nightly | Exhausts limit, waits 300s, verifies requests succeed again |
| `test_08_audit.sh` | fast | Audit log entries created for login failure, registration, login success |
| `test_09_security.sh` | fast | Cross-org isolation (maps, annotations, permissions, members), security headers |
| `test_10_soak.sh` | extended | 10-minute continuous load verifying rate limiter never over-admits |

## How it works

Tests use `curl` to make HTTP requests to the backend running in Docker.
Each test file sources `helpers.sh` which provides:

- `http_get`, `http_post`, `http_put`, `http_delete` — make requests, set `HTTP_STATUS` and `HTTP_BODY`
- `assert_status` — verify HTTP status code
- `assert_json_field` — verify a JSON field value
- `assert_json_exists` — verify a JSON field is present and non-empty
- `assert_true` — verify a boolean condition
- `register_user`, `login_user` — convenience functions that return JWT tokens
- `mysql_query` — run SQL against the database (for audit log checks and setup)

Each test file uses a unique prefix for its test data (`t01_`, `t02_`, etc.)
to avoid collisions when tests run against the same database.

## Writing new tests

1. Create `backend/tests/test_NN_description.sh`
2. Start with:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
   source "$SCRIPT_DIR/helpers.sh"
   echo "=== Your Test Suite ==="
   ```
3. Use the assertion helpers from `helpers.sh`
4. End with `report` (prints summary and exits with correct code)
5. Add the filename to the `TESTS` array in `run-tests.sh` under the appropriate tier

## Scheduling

### Nightly (e.g., 3am weekdays)

```bash
# crontab -e
0 3 * * 1-5 cd /path/to/annotated-maps && ./backend/tests/run-tests.sh --tier nightly >> /var/log/annotated-maps-tests.log 2>&1
```

### Weekly (e.g., Saturday 2am)

```bash
# crontab -e
0 2 * * 6 cd /path/to/annotated-maps && ./backend/tests/run-tests.sh --tier extended >> /var/log/annotated-maps-tests.log 2>&1
```

For CI systems (GitHub Actions, GitLab CI), use the `--tier` flag in your
pipeline config. Fast tier runs on every push; nightly and extended run on
scheduled triggers.

## Troubleshooting

**"Backend is not reachable"**
Run `docker compose up` first and wait for the `starting on port 8080` log line.

**Rate limit tests fail with "skipped"**
Previous tests exhausted the rate limit. Either wait for the window to expire
(300s) or restart the backend: `docker compose restart backend`.

**Audit tests fail with count mismatches**
The tests clear `audit_log` at the start, but if another process is hitting the
API simultaneously, extra entries may appear. Run tests in isolation.

**Tests create leftover data**
Test data (users like `t01_alice`, `t03_bob`, etc.) accumulates in the database.
To reset: `docker compose down -v && docker compose up --build`.
