# Backend Integration Tests

HTTP-based integration tests that run against the live Docker Compose stack.
Tests exercise the full request path: rate limiter, JWT filter, tenant filter,
controller logic, database, and audit log.

## Prerequisites

- Docker Compose stack running (`docker compose up`)
- Python 3 (pre-installed on macOS)

## Running the tests

```bash
# Fast tier (default) — ~60 seconds
python3 backend/tests/run-tests.py

# Nightly tier — ~6 minutes (adds 300s rate limit window expiry test)
python3 backend/tests/run-tests.py --tier nightly

# Extended tier — ~17 minutes (adds 10-minute soak test)
python3 backend/tests/run-tests.py --tier extended

# Run a single test
python3 backend/tests/run-tests.py --only 1
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
| `test_01_auth.py` | fast | Registration, login, refresh, deactivated user, error messages |
| `test_02_filters.py` | fast | JwtFilter (missing/bad/expired token, deactivated user), TenantFilter (membership, cross-org) |
| `test_03_maps.py` | fast | Map CRUD, tenant scoping, pagination bounds, cross-org isolation |
| `test_04_annotations.py` | fast | Annotation CRUD, GeoJSON validation, media URL scheme validation |
| `test_05_tenants.py` | fast | Member add/remove, cross-org member rejection, branding validation |
| `test_06_rate_limit_fast.py` | fast | Rate limiter blocks after limit, 429 has Retry-After header |
| `test_07_rate_limit_slow.py` | nightly | Exhausts limit, waits 300s, verifies requests succeed again |
| `test_08_audit.py` | fast | Audit log entries created for login failure, registration, login success |
| `test_09_security.py` | fast | Cross-org isolation (maps, annotations, permissions, members), security headers |
| `test_10_soak.py` | extended | 10-minute continuous load verifying rate limiter never over-admits |
| `test_11_notes.py` | fast | Notes CRUD, cross-org isolation |
| `test_12_annotation_edit_delete_move.py` | fast | Annotation edit, delete, move for all geometry types |
| `test_13_note_groups.py` | fast | Note group CRUD, note-group assignment, filtering, permissions |

## How it works

Tests use Python's `urllib.request` (standard library) to make HTTP requests to
the backend running in Docker. Each test file imports `helpers.py` which provides:

- `http_get`, `http_post`, `http_put`, `http_delete` — make requests, return `(status, body)`
- `assert_status` — verify HTTP status code
- `assert_json_field` — verify a JSON field value
- `assert_json_exists` — verify a JSON field is present and non-empty
- `assert_true` — verify a boolean condition
- `register_user`, `login_user` — convenience functions that return JWT tokens
- `mysql_query` — run SQL against the database (for audit log checks and setup)

Each test file uses a unique prefix for its test data (`t01_`, `t02_`, etc.)
combined with the process ID to avoid collisions when tests run against the
same database.

## Writing new tests

1. Create `backend/tests/test_NN_description.py`
2. Start with:
   ```python
   import os, sys
   sys.path.insert(0, os.path.dirname(__file__))
   from helpers import reset_counters, report, ...
   reset_counters()
   ```
3. Use the assertion helpers from `helpers.py`
4. End with `sys.exit(0 if report() else 1)`
5. Add the filename to the `FAST_TESTS`, `NIGHTLY_EXTRA`, or `EXTENDED_EXTRA` list in `run-tests.py`

## CI / GitHub Actions

### Pull request gate

Every pull request to `main` runs the fast test suite automatically via
`.github/workflows/pr-tests.yml`. Both database tests and backend integration
tests (fast tier) must pass before the PR can be merged.

To enable merge blocking, configure branch protection on `main`:
1. Go to Settings → Branches → Add rule for `main`
2. Enable "Require status checks to pass before merging"
3. Select the "test" check from the PR Tests workflow

### Nightly (e.g., 3am weekdays)

```bash
# crontab -e
0 3 * * 1-5 cd /path/to/annotated-maps && python3 backend/tests/run-tests.py --tier nightly >> /var/log/annotated-maps-tests.log 2>&1
```

### Weekly (e.g., Saturday 2am)

```bash
# crontab -e
0 2 * * 6 cd /path/to/annotated-maps && python3 backend/tests/run-tests.py --tier extended >> /var/log/annotated-maps-tests.log 2>&1
```

For CI systems (GitHub Actions, GitLab CI), use the `--tier` flag in your
pipeline config. Fast tier runs on every push; nightly and extended run on
scheduled triggers.

## Troubleshooting

**"Backend is not reachable"**
Run `docker compose up` first and wait for the `starting on port 8080` log line.

**Rate limit tests fail with "skipped"**
Previous tests exhausted the rate limit. The runner automatically restarts the
backend before rate-limit-sensitive tests, but if running individually, restart
manually: `docker compose restart backend`.

**Audit tests fail with count mismatches**
The tests clear `audit_log` at the start, but if another process is hitting the
API simultaneously, extra entries may appear. Run tests in isolation.

**Tests create leftover data**
Test data (users with PID-based names) accumulates in the database.
To reset: `docker compose down -v && docker compose up --build`.
