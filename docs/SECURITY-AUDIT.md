# Security Audit Report

**Project:** Annotated Maps
**Audit date:** 2026-04-17
**Previous audit:** 2026-03-31
**Scope:** Full codebase — backend (C++/Drogon), frontend (React/TypeScript), database (MySQL), infrastructure (Docker). Post-refactor clean-sheet audit.

---

## Summary

| Severity | Total open | Fixed since audit |
|---|---:|---:|
| High | 0 | 5 (H1, H2, H3 in #55; H4, H5 in #56) |
| Medium | 2 | 11 (M1, M3, M4 in #58; M6-M12 in #57; M13 with H1 in #55) |
| Low | 4 | 1 (L4 — fixed with M6/M7 in #57) |

Remaining open items are M2 (JWT in localStorage, deferred — large refactor) and M5 (in-process rate limiter, deferred — only matters multi-instance), plus four Lows.

Deliberate design trade-offs are listed separately below.

Closed findings are preserved at the bottom of the document for audit trail.

---

## Current security posture

The application implements the following security controls (verified in this audit):

### Backend
- **Parameterized queries:** All SQL uses Drogon's `execSqlAsync` bind arguments. No string concatenation, no dynamic column names.
- **Argon2id password hashing:** libsodium's `crypto_pwhash_str`. Cost parameters (`OPSLIMIT`/`MEMLIMIT`) are configurable via `ARGON2_OPSLIMIT`/`ARGON2_MEMLIMIT` env vars; defaults are dev-safe MIN values. Production must set at least INTERACTIVE (4 ops, 64 MiB). Legacy SHA-256 hashes rejected at login.
- **Per-request user verification:** `JwtFilter` checks `users.status` against the database on every authenticated request. Status changes take effect immediately.
- **JWT scoping:** HS256, `issuer` + `audience` (`annotated-maps`) + `orgId` claims all validated.
- **Shared error helpers:** `ErrorResponse.h` provides `errorJson()`/`errorResponse()` — removes duplication and ensures consistent `{error, message}` shape.
- **Tenant isolation:** `TenantFilter` runs before every tenant-scoped endpoint and verifies `tenant_members` membership before any controller code runs. Superuser bypass is explicit.
- **Rate limiting:** `RateLimitFilter` applies a sliding-window limit to auth/SSO endpoints (IP-keyed) and to all content POST/PUT/DELETE endpoints (user-keyed when JWT is present, IP-keyed otherwise). Returns 429 with `Retry-After`. Configurable via `custom_config.rate_limit`.
- **Input validation:** GeoJSON structure, media URL schemes (`http`/`https`), branding colors (hex), branding URLs (HTTPS-only), display-name length, pagination bounds, and per-field length limits (title/name ≤ 255, description/text ≤ 10 KB) all validated server-side via `checkMaxLen()` and field-specific checks.
- **Resource limits:** 1,000 maps/tenant, 5,000 annotations/map, 10,000 notes/map. Enforced by atomic `INSERT ... SELECT WHERE COUNT < limit` so concurrent creates can't race past the cap.
- **Audit logging:** `audit_log` records auth events (login success/failure, registration, SSO login), membership/permission changes (member add/remove, permission_change), and content mutations (map/annotation/note/notegroup update + delete, branding update). Atomic success/failure counters for monitoring.
- **Security headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Permissions-Policy: geolocation=(), microphone=(), camera=(), usb=()`. HSTS (`Strict-Transport-Security: max-age=31536000; includeSubDomains`) is emitted only when `PRODUCTION=1` and `X-Forwarded-Proto: https`.
- **CORS allowlist:** Origins listed in `allowed_origins` config; unknown origins receive no CORS headers.
- **Proxy trust:** `RateLimitFilter` and HSTS read `X-Forwarded-For`/`X-Forwarded-Proto` from a trusted reverse proxy. Production deployments must put a proxy in front that strips client-supplied values; documented in `docs/DEVELOPER-GUIDE.md` "Proxy trust".
- **Secrets management:** `JWT_SECRET` env var overrides config, minimum 32 characters enforced. Config placeholders (`CHANGE_ME...`) cause fatal startup exit unless `ALLOW_PLACEHOLDER_SECRETS=1` is explicitly set (dev-only). SSO `client_secret` is read from `SSO_CLIENT_SECRET_<ORG_ID>` env vars and never stored in the database.
- **Registration privacy at the login endpoint:** Login returns identical error for wrong password and nonexistent email.
- **SSO enumeration resistance:** SSO initiate returns generic "SSO is not available" for all error cases.

### Frontend
- **No `dangerouslySetInnerHTML`, no `eval`, no `innerHTML` assignments** in component code (React's default escaping handles all component output safely).
- **Shared error extraction:** `utils/errors.ts` provides `extractApiError()` — removes scattered AxiosError handling and ensures errors reach the UI consistently.
- **401 interceptor:** Axios interceptor clears auth state and redirects to login, skipping `/auth/*` endpoints so wrong-password errors don't cause mid-form redirects.
- **PKCE-like state protection on backend:** SSO state parameter validated before issuing JWT in callback. **Nonce verification:** ID token's `nonce` claim is checked against the value generated at initiate, blocking replay (#58 / M1). **Authorization-code token delivery:** SSO callback redirects to `/sso/callback?code=<one-time-code>`; the frontend POSTs the code to `/auth/sso/exchange` to retrieve the JWT, eliminating fragment-based leakage paths (#58 / M3). **Identity collision detection:** SSO user upsert fails closed if an existing `(org_id, external_id)` row's email differs from the IdP's payload, audited as `sso_identity_collision` (#58 / M4).

### Database
- **Foreign key integrity:** CASCADE/SET NULL/RESTRICT chosen appropriately per table. Audit log records survive entity deletion via SET NULL.
- **Unique constraints:** Usernames, emails, org-scoped external IDs, tenant memberships, and map permissions enforced at the DB level.
- **Public-permission uniqueness:** Enforced by BEFORE INSERT/UPDATE triggers since MySQL's UNIQUE treats each NULL as distinct.
- **Schema consolidated** (#44): Single clean `001_schema.sql` eliminates `ALTER TABLE` history and makes the final shape easy to review.

---

## Open findings

### Medium

#### M2 (CARRIED): JWT stored in localStorage

**File:** `frontend/src/store/authStore.ts`

Persisted via Zustand's `persist` middleware. Any XSS reads the token.

**Mitigations:** Security headers, input validation, and the popup-XSS fix in #55 (H1, now closed) removed the most exploitable XSS vector.

**Fix:** HttpOnly cookies require CSRF token infrastructure and backend changes (~100+ lines). Lower-effort intermediate: move to sessionStorage so the token is cleared on tab close.

---

#### M5 (CARRIED): Rate limiter is in-process only

**File:** `backend/src/filters/RateLimitFilter.cpp`

Multi-instance deployments each keep independent counters; attacker multiplies effective rate by instance count.

**Fix:** Redis-backed `INCR`/`EXPIRE` or enforce at reverse proxy. Fine as-is for single-instance deployments.

---

### Low

#### L1 (NEW): GeoJSON coordinate ranges not validated

Controllers accept any numeric coordinates. Stored as `DECIMAL(10,7)` which cannot overflow but nonsense data (e.g., `lng=500`) reaches the map. Cosmetic, not exploitable.

#### L2 (NEW): Note `lat`/`lng` ranges not validated

Same as L1 for notes. `DECIMAL(10,7)` field prevents worse outcomes.

#### L3 (NEW): Missing composite index on `audit_log(event_type, created_at)`

Separate indexes exist on each column. Time-range queries filtered by event type will use one index and filter with the other in memory. Performance concern, not security, but matters for incident-investigation workflows.

#### L5 (NEW): `leaflet-draw` is effectively unmaintained

`leaflet-draw` (last meaningful release 2018) has no open CVEs at the time of this audit, but the upstream is dormant. Future vulns will not be patched. Low operational risk until a CVE appears.

**Fix:** Track; consider replacement if an issue surfaces.

---

## Deliberate design trade-offs

These are known decisions, not findings. Documented for future auditors.

- **`email_taken` / `username_taken` distinct error codes** (`backend/src/controllers/AuthController.cpp:165-176`): The frontend shows specific error messages on registration ("this email is already registered" vs. "this username is already taken") for UX. This trades a small amount of user-enumeration resistance for clearer feedback. Acceptable because the registration endpoint is rate-limited and email enumeration is generally possible via the password-reset flow of any auth system that supports it. Not introducing password reset yet; re-evaluate if/when it ships.

- **Single-process rate limiter** (M5): Acceptable for the current single-instance deployment target. Revisit when scaling horizontally.

- **No row-level tenant isolation in the database**: Tenant isolation is enforced exclusively by `TenantFilter` at the controller layer. This is a pragmatic choice — row-level security adds operational complexity without meaningful additional protection if the application layer is correctly audited (which it is, via `test_09_security.py`).

- **Dev defaults in `docker-compose.yml`** (`rootpassword`, `annmaps_pass`): Hardcoded for local development. Production deployment is expected to override via `.env` file.

- **`ON DELETE CASCADE` on map owner**: Deleting a user cascades their maps (and therefore all annotations/notes/permissions). This matches the v0.1 model of "maps are owned by one user." If the product later supports org-owned maps, this should change.

---

## Remediation plan

### Must fix before v0.1 release

- H1 — XSS in Leaflet popups (exploitable by any user with edit permission on a map)
- H2 — `RAND_bytes` return value check (trivial; prevents deterministic state generation under RNG failure)
- H3 — Make JWT placeholder fatal at startup (prevents a specific deployment mistake)

### Should fix before v0.1 production deployment

- H4 — Argon2id parameters configurable + production values documented
- H5 — Encrypt or externalize SSO `client_secret`
- M6, M7 — CSP and HSTS headers
- M8 — Input length limits

### Fix opportunistically (milestones permitting)

- M1, M3, M4 — SSO hardening
- M9, M10, M12 — Resource limits, content-endpoint rate limits, audit log coverage
- M13 — Frontend scheme validation (shares fix file with H1)

### Track but don't block release

- M2 — JWT storage (large refactor; current mitigations acceptable given H1 fix)
- M5 — Rate limiter scope (single-instance for now)
- M11 — X-Forwarded-For trust (documentation; enforce at deployment)
- All Low findings

---

## Audit methodology

Three parallel explore agents independently audited backend, frontend, and database layers. Their raw findings were cross-checked against source code by reading the cited file:line references. Findings that turned out to be non-issues (e.g., agents flagged `listTenants` as missing `TenantFilter` — correct behavior, no tenantId in path; flagged `username_taken` distinction as user-enumeration — intentional trade-off documented above) were removed. Severities were calibrated downward where agents were generous, and upward for a few items where agents underestimated exploitability.

---

## Closed findings (audit trail)

### H1 — XSS via Leaflet popup HTML templates

**Closed by PR #55 (2026-04-18).**

Popup content for annotations and notes was built via template-literal
interpolation of user fields (`annotation.title`, `annotation.description`,
media URLs, note text, usernames) into HTML strings passed to
`layer.bindPopup()`. Leaflet renders those strings as HTML, so an
editor-role user could inject `<img src=x onerror=...>` payloads that ran
in every viewer's browser.

**Fix applied:** `AnnotationLayer.tsx` and `NoteMarkers.tsx` now build
popup content as DOM nodes using `document.createElement` +
`textContent`. Leaflet's `bindPopup` accepts HTMLElement directly.
Event listeners for Edit/Move/Delete buttons are pre-attached to the
elements during construction rather than re-queried inside a
`popupopen` handler. This also closed M13 (frontend media URL scheme
check) since the DOM-construction path explicitly validates `http:` /
`https:` via `new URL(...).protocol` before rendering `<img>` or `<a>`.

### H2 — `RAND_bytes()` return value not checked

**Closed by PR #55 (2026-04-18).**

`SsoController::generateRandom` ignored OpenSSL's `RAND_bytes` return
value. On RNG failure the buffer stayed zero-initialized and state/nonce
became deterministic, defeating the SSO CSRF and replay protections.

**Fix applied:** `generateRandom` now throws on non-1 return. The
`initiate` caller wraps state/nonce generation in try/catch and returns
a generic `500 SSO is not available` on failure, consistent with the
SSO enumeration-resistance posture.

### H3 — JWT secret placeholder warning not fatal

**Closed by PR #55 (2026-04-18).**

Running the backend with `CHANGE_ME_...` as the JWT secret printed a
`WARNING:` to stderr and kept going. A missed startup log during a
production deployment would allow token forgery with a well-known
secret.

**Fix applied:** Placeholder detection at startup now exits non-zero
unless `ALLOW_PLACEHOLDER_SECRETS=1` is explicitly set. The dev
`docker-compose.yml` sets this env var with a comment explaining it
must never appear in production compose/env files. An env var
`JWT_SECRET` shorter than 32 characters also now exits fatally instead
of silently falling back to the config value.

### H4 — Argon2id parameters at `*_MIN` values

**Closed by PR #56 (2026-04-21).**

Password hashing used `crypto_pwhash_OPSLIMIT_MIN` / `crypto_pwhash_MEMLIMIT_MIN`
(1 iteration, 8 MiB) hardcoded. The MIN values were chosen to work
around x86_64-on-ARM emulation slowness during local dev but are far
weaker than the recommended INTERACTIVE values (4 iterations, 64 MiB)
for online authentication.

**Fix applied:** `hashPassword()` now reads `ARGON2_OPSLIMIT` and
`ARGON2_MEMLIMIT` from the environment and falls back to MIN if unset.
`docker-compose.yml` comments document the expected production values
(`ARGON2_OPSLIMIT=4`, `ARGON2_MEMLIMIT=67108864`). Dev/CI defaults
remain MIN for performance.

### H5 — SSO `client_secret` stored in plaintext in the database

**Closed by PR #56 (2026-04-21).**

The `sso_providers.config` JSON column held `client_secret` in
plaintext. Any actor with database read access (DBAs, backups, replicas,
compromised backend) could retrieve every tenant's IdP credential.

**Fix applied:** `SsoController::callback` now reads the client secret
from the `SSO_CLIENT_SECRET_<ORG_ID>` environment variable (e.g.
`SSO_CLIENT_SECRET_1`) instead of the DB. If the env var is missing or
empty, the controller returns a generic 500 "SSO is not available",
consistent with the SSO enumeration-resistance posture. The
`sso_providers.config` JSON is no longer expected to contain
`client_secret` — any legacy value is ignored. No DB migration is
required for v0.1 because no production SSO data exists yet.

### M6 — Content-Security-Policy header

**Closed by PR #57 (2026-04-22).**

**Fix applied:** Backend pre-send advice now emits
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.
The backend serves a JSON API; `default-src 'none'` is the tightest
possible default. The frontend bundle is served by Vite/nginx in a
separate origin and configures its own CSP there.

### M7 — HSTS header

**Closed by PR #57 (2026-04-22).**

**Fix applied:** Backend emits `Strict-Transport-Security: max-age=31536000;
includeSubDomains` only when `PRODUCTION=1` env var is set AND the
request arrived with `X-Forwarded-Proto: https`. Avoids caching the
requirement on localhost during dev.

### M8 — Server-side length limits

**Closed by PR #57 (2026-04-22).**

**Fix applied:** New `checkMaxLen()` helper in `ErrorResponse.h`
(constants `MAX_TITLE_LEN=255`, `MAX_NAME_LEN=255`,
`MAX_DESCRIPTION_LEN=10000`, `MAX_TEXT_LEN=10000`). Applied at the
entry of every create and update path in MapController,
AnnotationController, NoteController, NoteGroupController. Returns
400 with field name and limit.

### M9 — Resource-limit race conditions

**Closed by PR #57 (2026-04-22).**

**Fix applied:** Replaced separate `SELECT COUNT(*)` + `INSERT` with
atomic `INSERT ... SELECT ... FROM dual WHERE (SELECT COUNT(*) ...) <
limit` in MapController, AnnotationController, NoteController. The
INSERT either succeeds (and `affectedRows() > 0`) or is rejected
(`affectedRows() == 0` triggers the limit-exceeded response). Eliminates
the COUNT-then-INSERT window.

### M10 — Per-user rate limit on content endpoints

**Closed by PR #57 (2026-04-22).**

**Fix applied:** `RateLimitFilter` now keys by `user:<id>` when the
upstream JwtFilter has set a `userId` request attribute, falling back
to `ip:<ip>` otherwise. `RateLimitFilter` added to POST/PUT/DELETE
routes on Map, Annotation, Note, and NoteGroup controllers (after
JwtFilter+TenantFilter so the user attribute is available). Same
config knob (`custom_config.rate_limit`) governs both auth and content
limits.

### M11 — `X-Forwarded-For` trust documentation

**Closed by PR #57 (2026-04-22).**

**Fix applied:** New "Proxy trust and `X-Forwarded-For`" section in
`docs/DEVELOPER-GUIDE.md` covering deployment requirements (trusted
proxy must strip client-supplied XFF, set XFF to real client IP, set
`X-Forwarded-Proto: https` on TLS connections) and warns against
`$proxy_add_x_forwarded_for` in nginx. Code unchanged — the leftmost-
entry behavior was already correct under the documented model.

### M12 — Audit log coverage for delete/update operations

**Closed by PR #57 (2026-04-22).**

**Fix applied:** Added `AuditLog::record(...)` calls to the success
path of: `MapController::updateMap`, `MapController::deleteMap`,
`AnnotationController::updateAnnotation`,
`AnnotationController::deleteAnnotation`, `NoteController::updateNote`,
`NoteController::deleteNote`, `NoteGroupController::updateGroup`,
`NoteGroupController::deleteGroup`, `TenantController::updateBranding`.
Detail JSON includes `mapId` and the resource's own ID where applicable.
Event types: `map_update`, `map_delete`, `annotation_update`,
`annotation_delete`, `note_update`, `note_delete`, `notegroup_update`,
`notegroup_delete`, `branding_update`.

### L4 — `Permissions-Policy` header

**Closed by PR #57 (2026-04-22).**

**Fix applied:** Backend pre-send advice now emits
`Permissions-Policy: geolocation=(), microphone=(), camera=(), usb=()`.
Done opportunistically while editing the same code block for M6/M7.

### M1 — OIDC nonce not verified

**Closed by PR #58 (2026-04-24).**

**Fix applied:** `SsoController::callback` now extracts the `id_token` from
the IdP's token-endpoint response, decodes the JWT (no signature check —
sufficient for nonce comparison since the value is server-secret), and
compares the `nonce` payload claim to the value stored in `pendingStates_`
at initiate. Mismatched/missing nonce → 400 `invalid_nonce`. The
backend already required `id_token` to be present in the token-endpoint
response.

### M3 — SSO token passed in URL fragment

**Closed by PR #58 (2026-04-24).**

**Fix applied:** Replaced the URL-fragment delivery with a one-time
authorization-code pattern. After successful login the backend mints
the JWT, stores it under a 32-byte random `code` in a new in-process
`pendingAppCodes_` map (2-minute TTL, one-time use), and redirects to
`/sso/callback?code=<code>`. New endpoint `POST /api/v1/auth/sso/exchange`
accepts the code, returns `{token, tenantId}` once, and erases the
entry. Frontend `SsoCallbackPage` reads `?code=` from the query string
(no fragment touched) and POSTs to the exchange endpoint. Code is
rate-limited via `RateLimitFilter`.

### M4 — SSO user upsert silently overwrote identity

**Closed by PR #58 (2026-04-24).**

**Fix applied:** Replaced `INSERT ... ON DUPLICATE KEY UPDATE` with a
SELECT-then-INSERT-or-UPDATE pattern. When the
`(org_id, external_id)` row already exists, the controller compares
the stored email to the IdP-supplied email. Mismatch → 409
`identity_collision`, with an `sso_identity_collision` audit log entry
containing both emails for admin reconciliation. Matching email →
username refresh proceeds normally. New `(org_id, external_id)` →
INSERT.
