# End-to-End (Playwright) Tests

Browser-driven tests that exercise the full stack — frontend, backend, MySQL —
the way a real user would. Complements the lower-level test tiers:

| Tier | Tool | What it tests |
|------|------|---------------|
| Database | `database/tests/*.sql` | Schema, constraints, triggers |
| Backend integration | `backend/tests/test_*.py` | HTTP API, controllers, filters |
| **End-to-end** | **`frontend/tests/e2e/*.spec.ts`** | **Real browser → frontend → backend → DB** |

E2E tests are the most expensive to run and the most representative of user
experience. Use them for flows where the frontend's behavior matters
(rendering, routing, click handlers), and lean on backend tests for
permission/data-correctness assertions where they're cheaper.

## Prerequisites

- Docker Compose stack running: `docker compose up -d` and wait for
  `Annotated Maps backend starting on port 8080` in the backend logs.
- Frontend dependencies installed: `cd frontend && npm install`.
- Playwright browser binaries installed: `cd frontend && npx playwright install chromium`.

The browser install is a one-time ~100 MB download to
`~/Library/Caches/ms-playwright/` (macOS) or `~/.cache/ms-playwright/` (Linux).

## Running tests

```bash
cd frontend
npm run test:e2e            # all suites, headless
npx playwright test smoke   # one file
npx playwright test --ui    # interactive UI mode
npx playwright test --debug # step through with inspector
```

After a failing run, view the rendered HTML report:

```bash
npx playwright show-report
```

## Where tests live

```
frontend/
├── playwright.config.ts        # config
├── tests/
│   └── e2e/
│       ├── helpers.ts          # shared utilities (e.g. makeUser())
│       ├── smoke.spec.ts       # minimal: login page renders
│       ├── auth.spec.ts        # registration / login / logout (#34)
│       ├── maps.spec.ts        # map create / view (#35); edit/delete fixme'd until #70
│       └── *.spec.ts           # one file per feature area
└── ...
```

Per-area suites land incrementally — `auth.spec.ts` is in (#34),
`maps.spec.ts` is in (#35, with edit/delete deferred to #70 until the
UI exists); annotations, notes, and cross-tenant are tracked in #36–#38.

## Configuration

[`frontend/playwright.config.ts`](../frontend/playwright.config.ts) sets:

- **`baseURL`**: `http://localhost:5173` (the Vite dev server in the
  Docker stack). Override with `PLAYWRIGHT_BASE_URL=...` for a deployed
  environment.
- **`workers`**: 1 locally (sequential — easier to follow when watching),
  Playwright's default in CI.
- **`retries`**: 0 locally, 1 in CI (absorbs occasional network flakes
  without masking real failures).
- **`trace`/`screenshot`/`video`**: only on retry/failure. Cheap by
  default, useful when you need them.
- **`projects`**: `chromium` only. Cross-browser is unnecessary at v0.1
  scope; add Firefox/WebKit projects later if a specific compatibility
  concern surfaces.

## Conventions

- **Test by accessible role/label**, not CSS selector. Survives DOM
  restructuring and forces accessibility hygiene:
  - ✅ `page.getByRole('button', { name: /sign in/i })`
  - ❌ `page.locator('.btn-primary')`
- **One assertion per behavior**, not one per element. A test that
  asserts "the form rendered" should make several assertions in one
  test, not three separate tests.
- **No mocking** — tests run against the real backend and real DB. If you
  need a starting state, register a fresh user in test setup. Don't
  share state between tests; each test should set up what it needs.
- **No sleeps**. Use Playwright's auto-waiting (`expect(locator).toBeVisible()`
  waits up to `expect.timeout`). If you find yourself reaching for
  `page.waitForTimeout(...)`, you're probably awaiting something
  observable instead — wait for *that*.

## CI integration

The full E2E suite runs on every PR via `.github/workflows/pr-tests.yml`,
in the `test` job after the database and backend integration tests pass.
The frontend container (already part of the Docker Compose stack the
job uses) serves the app at port 5173, and Playwright runs against
that. The chromium browser binary is cached across runs (~100 MB,
keyed on `frontend/package-lock.json`).

If the E2E suite fails, the workflow uploads `frontend/playwright-report/`
as a `playwright-report` artifact. Download it from the run page and
open `index.html` to see traces, screenshots, and videos.

Nightly/weekend integration is deferred — the suite is fast enough
(<10s on the current set) that running it on every PR is the only
tier currently needed. Tracked in #40/#41 if/when the suite grows
slow enough to warrant a separate cadence.

## Troubleshooting

**`Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/login`**
The frontend isn't running. `docker compose up -d` and wait for the
Vite dev server to log `ready in N ms`.

**`Error: Browser closed`**
Browser binary missing or out of date.
`cd frontend && npx playwright install chromium` to (re)install.

**Test passes locally but fails in CI**
Almost always a race condition. Add an `await expect(...).toBeVisible()`
on the element you're about to interact with — Playwright's auto-wait
will absorb the timing difference.

**A "Sign Up" or other duplicate element causes "strict mode violation"**
Playwright requires unambiguous selectors. The page probably has the
element in two places (e.g., navbar + form footer). Scope by parent:
`page.getByText(/don't have an account/i).getByRole('link', { name: /sign up/i })`.
