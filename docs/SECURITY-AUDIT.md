# Security Audit Report

**Project:** Annotated Maps
**Date:** 2026-03-31
**Scope:** Full codebase — backend (C++/Drogon), frontend (React/TypeScript), database (MySQL), infrastructure (Docker)

---

## Summary

| Severity | Count |
|---|---|
| Medium | 5 |

All critical, high, and low findings have been addressed. Five medium-severity items remain open, all related to SSO hardening or architectural choices that require moderate-to-hard effort.

---

## Current security posture

The application implements the following security controls:

- **No SQL injection:** All database queries use parameterized statements via Drogon ORM.
- **Strong password hashing:** Argon2id via libsodium (`crypto_pwhash_str`, interactive parameters). Legacy SHA-256 hashes are detected and rejected at login.
- **Per-request user verification:** `JwtFilter` checks `users.is_active` against the database on every authenticated request. Deactivated users are rejected immediately regardless of JWT expiry.
- **JWT scoping:** Tokens include `issuer`, `audience` (`annotated-maps`), and `orgId` claims. The verifier validates all three plus signature and expiry.
- **Secrets management:** JWT secret is overridable via `JWT_SECRET` environment variable (minimum 32 characters). Config file placeholders trigger startup warnings. Database credentials in Docker Compose are parameterized via environment variables.
- **CORS whitelist:** Only origins listed in the `allowed_origins` config array (plus `frontend_url`) receive CORS headers. Unrecognized origins get no `Access-Control-Allow-Origin`.
- **Security headers:** All responses include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: strict-origin-when-cross-origin`.
- **Tenant isolation:** All data-access queries include `tenant_id` scoping, enforced per-request by `TenantFilter` which verifies `tenant_members` before any controller code runs.
- **Cross-org permission guard:** `setPermission` validates that the target user's `org_id` matches the caller's organization.
- **Media authorization:** `addMedia` checks edit permission on the parent map. `deleteMedia` verifies the caller is the map owner, map editor, or annotation creator.
- **Rate limiting:** `RateLimitFilter` applies a sliding-window limit (default: 5 requests per 300 seconds per IP) to login, registration, and SSO endpoints. Returns 429 with `Retry-After` header.
- **Input validation:** GeoJSON structure (type + non-empty coordinates), media URL schemes (`http`/`https` only), branding colors (hex format), branding URLs (`https` only), display name length (255 max), and pagination bounds (`pageSize` clamped 1-100) are all validated server-side.
- **Resource limits:** Per-tenant map cap (1,000) and per-map annotation cap (5,000) prevent storage exhaustion.
- **Audit logging:** Security events (login success/failure, registration, SSO login, member add/remove, permission changes) are recorded to `audit_log` with atomic success/failure counters for monitoring.
- **SSO redirect validation:** `frontend_url` is validated at startup; non-HTTPS, non-localhost values produce a warning.
- **Dependency pinning:** Drogon (v1.9.3) and jwt-cpp (v0.7.0) are pinned to specific versions in the Dockerfile.
- **Registration privacy:** Duplicate-key errors return a generic "Registration failed" message without revealing whether the email or username is taken.
- **SSO enumeration resistance:** The SSO initiate endpoint returns a generic "SSO is not available" for all error cases (unknown org, no provider configured).
- **Foreign key integrity:** Proper CASCADE/SET NULL behavior on all relationships. Audit log records survive entity deletion via SET NULL.
- **Unique constraints:** Enforced at the database level for usernames, emails, org-scoped external IDs, tenant memberships, and map permissions.

---

## Open findings

### 1. OIDC nonce not verified against ID token

**Severity:** Medium
**File:** `backend/src/controllers/SsoController.cpp`

The SSO initiate flow generates a nonce and stores it in the pending-states map, but the callback never checks the nonce against the ID token's `nonce` claim. Without this check, the OIDC flow is vulnerable to token replay attacks where an attacker reuses a previously captured ID token.

**Fix difficulty:** Moderate. Requires decoding the ID token (not just the access token) in the callback and comparing its `nonce` claim against the stored value. The implementation depends on the IdP's token response format (~20 lines).

---

### 2. JWT stored in localStorage

**Severity:** Medium
**File:** `frontend/src/store/authStore.ts`

The JWT is persisted to `localStorage` via Zustand's `persist` middleware. If an XSS vulnerability is introduced (e.g., through a future frontend dependency or user-generated content), an attacker can read the token with `localStorage.getItem('auth-storage')`.

**Mitigations in place:** Security headers reduce the XSS surface. Branding colors are validated as hex-only. Media URLs require `http`/`https` scheme. Branding URLs require `https`.

**Fix difficulty:** Hard. Moving to `httpOnly` cookies requires server-side cookie issuance, CSRF token implementation, and changes to `JwtFilter` to read cookies instead of the `Authorization` header (~100+ lines across backend and frontend).

---

### 3. SSO token passed in URL fragment

**Severity:** Medium
**Files:** `backend/src/controllers/SsoController.cpp`, `frontend/src/pages/SsoCallbackPage.tsx`

After the OIDC code exchange, the backend redirects to `/sso/callback#token=<jwt>&tenantId=<id>`. URL fragments are not sent to servers, but they can leak via browser history, `Referer` headers on outbound link clicks, and browser extensions.

**Fix difficulty:** Moderate. The standard alternative is a short-lived authorization code: the backend stores the JWT server-side keyed by a one-time code, redirects with the code in a query parameter, and the frontend exchanges it for the JWT via a POST request (~50 lines of backend changes).

---

### 4. SSO user upsert race condition

**Severity:** Medium
**File:** `backend/src/controllers/SsoController.cpp`

The `ON DUPLICATE KEY UPDATE username=VALUES(username), email=VALUES(email)` clause silently overwrites a user's email and username when their `(org_id, external_id)` matches. If an identity provider reuses subject identifiers (against spec but known to happen with some providers), this could assign a new person's identity to an existing user account.

**Fix difficulty:** Moderate. Options: log a warning when an upsert updates an existing row with a different email; require admin approval for email changes on SSO-linked accounts; or detect the email change and create a new account instead of updating (~15-30 lines).

---

### 5. Rate limiter is in-process only

**Severity:** Medium
**File:** `backend/src/filters/RateLimitFilter.cpp`

The sliding-window rate limiter stores state in a `static std::unordered_map` within the process. In a multi-instance deployment behind a load balancer, each instance maintains an independent counter. An attacker can multiply their effective rate by the number of backend instances.

**Fix difficulty:** Moderate. Options: replace the in-memory map with a Redis `INCR`/`EXPIRE` pattern (requires adding a Redis client dependency), or apply rate limiting at the reverse proxy layer (e.g., nginx `limit_req`, no code changes). For single-instance deployments, the current implementation is sufficient.
