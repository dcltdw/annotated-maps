# Security Audit Notes — 2026-04-17 cycle

Companion document to [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md). The audit
report itself is the deliverable; this file records the *process* and
*reasoning* behind it. Future auditors should be able to reproduce or
challenge any decision from these notes.

## Why this audit happened

GitHub issue [#45](https://github.com/dcltdw/annotated-maps/issues/45)
called for a clean-sheet audit after the pre-release refactor cycle
(#42 backend, #43 frontend, #44 database migration consolidation).
Goals:

1. Re-verify the existing audit's claims against the post-refactor code
   so we don't carry stale "fixed" markers for items that may have
   regressed.
2. Find issues introduced or unmasked by the refactor.
3. Triage every finding into one of: must-fix-before-release,
   should-fix-before-production, track, or rejected/intentional.

The previous audit (2026-03-31) had 5 open Mediums, all SSO-related.
Those needed re-verification. New surface area to audit included the
consolidated database schema, the frontend's `extractApiError()` /
`utils/errors.ts` helpers, and the backend's shared `ErrorResponse.h`.

## Methodology

**Three parallel Explore agents.** Backend, frontend, and database were
audited independently and in parallel, each by a dedicated agent with a
detailed prompt covering all relevant categories (SQL injection,
authorization bypass, input validation, JWT handling, password hashing,
error leakage, rate limiting, CORS, security headers, secrets,
race conditions, audit log coverage for backend; XSS, token storage,
CORS, client state, SSO callback, CSP for frontend; access control,
foreign key behaviors, triggers, indexes, sensitive data, MySQL config
for database).

**Why parallel:** independent passes reduce confirmation bias. If a
human auditor read the backend first, the same person reading the
frontend would already be biased about which areas matter.

**Verification step.** Every finding cited file:line references. After
the agents returned, I re-read the most impactful claims directly
(the XSS popup HTML templates, the `RAND_bytes` ignore, the
`sso_providers.config` plaintext storage, the JWT placeholder check).
This was non-negotiable: agent reports are starting points, not facts.

**Severity calibration.** Agents tend to be generous with "Critical"
and to under-document why something matters. I rescored every finding
based on:

- **Exploitability** — does it require special access (e.g., editor
  permission)? Authentication? A specific deployment configuration?
- **Blast radius** — one user, one tenant, the whole platform?
- **Mitigations in place** — does another control reduce the impact?
- **Realistic threat model** — is the attack scenario credible for a
  pre-release multi-tenant collaboration tool?

## Severity calibration examples

### Downgraded findings

- **Agent: "Critical — hardcoded passwords in docker-compose.yml"** →
  My ruling: documented dev-only defaults, not a finding. The README
  and SETUP-LOCAL-DEV docs are explicit that production must override
  via `.env`. Removed from report. (If a separate
  doc-warning issue is wanted, it would be Low.)

- **Agent: "Critical — `listTenants` missing TenantFilter"** →
  Rejected. Correct behavior: `listTenants` is `/api/v1/tenants`, with
  no `tenantId` in the path, so `TenantFilter` (which validates a
  specific `tenantId`) does not apply. `JwtFilter` extracts the
  authenticated user, and the SQL filters by user. Read the controller
  to confirm — no leak.

- **Agent: "Critical — axios CVE in package.json"** → Already fixed in
  PR [#49](https://github.com/dcltdw/annotated-maps/pull/49). Verified
  by checking current `package-lock.json`.

- **Agent: "High — admin check race condition in NoteGroupController"** →
  Rejected. The "race" relies on user-controlled mutation of a request
  attribute set by `TenantFilter`. Attributes are server-side state, not
  user-mutable. False positive.

### Upgraded findings

- **Agent: "Medium — XSS via Leaflet popup HTML templates"** → Promoted
  to High (H1). The agent didn't emphasize that this is exploitable by
  any editor-role user against any viewer of the same map, with no
  additional access required. The proof-of-concept payload is one line.
  The blast radius is every viewer of any annotation on any map the
  attacker can edit — that's the entire collaborative model. Bumped.

- **Agent: "Medium — `RAND_bytes` return ignored"** → Promoted to High
  (H2). The agent rated this Medium because RNG failure is rare, but
  when it happens the failure mode is a deterministic SSO state and
  nonce, which defeats every CSRF and replay defense in the SSO flow.
  And the fix is one line. Bumped.

### Rejected findings (not in the report)

- **"User enumeration via `email_taken` / `username_taken` distinction."**
  Documented as a deliberate trade-off, not a finding. The user
  explicitly requested distinct error codes earlier in development for
  better registration UX. Email enumeration is generally possible via
  any password-reset flow that supports it, so the rate-limited
  registration endpoint is not a meaningful additional disclosure
  vector for this v0.1 product.

- **"No row-level tenant isolation in the database."** Architectural
  trade-off, documented as such. Adding row-level security would add
  significant operational complexity (per-tenant DB roles or VIEWs)
  without meaningful additional protection if the application layer is
  correctly audited — which it is, via `test_09_security.py` which
  validates cross-org isolation across maps, annotations, permissions,
  and members.

- **"`TEXT` columns are 64KB max."** Not a security issue at all; a
  product-decision question. Documented under deliberate trade-offs.

## Findings retained and how they were scored

| ID | Severity | Why this severity (not higher / lower) |
|---|---|---|
| H1 | High | Editor-role user → script execution in viewer browser. Auth required, but that requirement is met by the collaboration model itself. Not Critical because it requires write access first. |
| H2 | High | Deterministic security tokens on RNG failure → defeats SSO CSRF/replay defenses. Rare trigger, catastrophic when triggered. |
| H3 | High | Single missed log line at deploy → known-secret JWT signing → token forgery against any account. Trivial to exploit, trivial to fix. |
| H4 | High | Production-only impact: weak Argon2id parameters mean cracked credentials on any DB compromise. Acceptable severity rating because dev workflow won't trigger it. |
| H5 | High | Plaintext IdP credentials in DB → cross-tenant SSO compromise from any DB read access. |
| M1 | Medium | OIDC nonce — replay possible but requires capturing a real ID token first. |
| M2 | Medium | Token in localStorage — only exploitable if XSS exists. With H1 fixed, no known XSS vector. |
| M3 | Medium | Token in URL fragment — leakage paths exist but each requires an additional vector (browser extensions, history scraping). |
| M4 | Medium | SSO upsert overwrite — depends on IdP misbehavior. Real but unusual. |
| M5 | Medium | In-process rate limiter — only matters when running multi-instance. v0.1 deployment is single-instance. |
| M6 | Medium | No CSP — defense-in-depth gap when other defenses fail. |
| M7 | Medium | No HSTS — initial-connection MITM risk in production. |
| M8 | Medium | No length limits — DoS-via-storage is the realistic worst case, not RCE. |
| M9 | Medium | Resource-limit races — at most a few resources over the cap, not unlimited. |
| M10 | Medium | No rate limit on content endpoints — authenticated abuse, bounded by resource cap. |
| M11 | Medium | X-Forwarded-For trust — depends on deployment topology. Mitigatable at the proxy layer. |
| M12 | Medium | Audit log gaps — slows incident investigation, doesn't enable attack. |
| M13 | Medium | Frontend scheme check — defense-in-depth for an already-validated input. |
| L1-L2 | Low | Coordinate validation — stored in DECIMAL columns, no injection or RCE path. Cosmetic data quality. |
| L3 | Low | Missing index — performance issue for incident investigation, not security per se. |
| L4 | Low | Permissions-Policy — disables features that aren't used anyway. |
| L5 | Low | leaflet-draw unmaintained — no current CVE. Risk only materializes if/when one is published. |

## Issues filed and grouping rationale

Four issues, grouped by severity tier and shared edit areas:

- **#55** — H1, H2, H3 grouped because all three are small, targeted
  patches that should land in a single security-fix PR before any
  release. Combining them avoids having three small PRs in flight when
  a reviewer can validate them together.

- **#56** — H4, H5 grouped because both are production-deployment
  concerns (not strictly v0.1-blocking for non-production releases) and
  share deployment-runbook implications.

- **#57** — M6-M12 grouped because most touch `backend/src/main.cpp`
  (CSP, HSTS, rate limit registration) or shared controller patterns
  (length limits, audit log calls, resource-limit races). Several can
  ship in one PR; large enough to split if a contributor prefers
  smaller bites.

- **#58** — M1, M3, M4 grouped because all three modify
  `SsoController.cpp` and share test infrastructure (`test_14_sso.py`
  if added). M2 is intentionally excluded from this grouping because
  it's a much larger refactor (HttpOnly cookies + CSRF tokens) and
  best done as its own focused effort.

**Not filed:** M2 (JWT in localStorage), M5 (in-process rate limiter),
all five Lows. These are tracked in `SECURITY-AUDIT.md` but the
mitigations in place make them acceptable for v0.1. Filing them as
issues would create noise without driving action.

## Trust-but-verify on agent output

Three areas where I diverged from agent recommendations after reading
source directly:

1. **Agent suggested DOMPurify for the popup XSS fix.** Both DOMPurify
   and DOM-construction (`document.createElement` + `textContent`) are
   valid. I left the choice open in the issue body because adding a
   dependency for a 30-line problem isn't always the right answer.
   Whichever the implementer picks, the fix needs the same test:
   storing `<img src=x onerror=alert(1)>` in a title and verifying it
   renders as text.

2. **Agent suggested blocking private IPs in media URL validation.**
   Rejected. The `annotation_media.url` field is currently never fetched
   server-side, so SSRF is not a current threat. If a future feature
   adds server-side fetching (link previews, image proxy), then the
   private-IP filter becomes necessary — but adding it now is
   speculative defense.

3. **Agent suggested global error-message sanitization.** Rejected as a
   blanket fix. Specific error messages (e.g., "Invalid email or
   password") are fine. The actual issue is more narrow: SSO
   error-passthrough leaks IdP configuration (M-flagged narrowly), and
   DB exception messages should be logged not surfaced (also flagged).
   Sanitizing every error message would be over-engineering and would
   hurt debuggability without a corresponding security gain.

## What I'd do differently next time

- **Add a deployment-config audit pass.** This audit covered code; it
  did not deeply audit `config.docker.json`, `docker-compose.yml`, or
  the production deployment story (which doesn't exist yet but should).
  When a `SETUP-PRODUCTION.md` lands, it should get its own audit.

- **Test reproducibility on findings.** For each High and Medium I
  documented a "Test plan" in the follow-up issues, but I didn't write
  any of the tests as part of the audit itself. A future audit could
  ship a `test_security_findings.py` that ratchets — every fixed
  finding gets a regression test that fails until the fix lands.

- **Audit the audit.** No second auditor reviewed my severity
  calibrations. If a security expert is brought in for v0.1, they
  should re-rate the findings from scratch and we should reconcile any
  divergences. Self-audit has known blind spots.

## Pointers for future auditors

- The application has `test_09_security.py` (cross-org isolation,
  security headers) and `test_02_filters.py` (JWT, TenantFilter
  behavior). Run these first to confirm the application-layer
  enforcement is intact before assessing schema-level controls.
- `docs/DEVELOPER-GUIDE.md` documents the conventions for error
  responses, filter callbacks, and frontend error handling. Audit
  against the conventions, not just the code — drift from the
  conventions is itself a finding.
- `docs/REQUIREMENTS.md` is the source of truth for intended threat
  model. Cross-check audit findings against intended security
  guarantees there.
