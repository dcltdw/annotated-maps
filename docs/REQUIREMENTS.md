# Annotated Maps — Requirements v0.1

## 1. Overview

Annotated Maps is a multi-tenant, collaborative map annotation platform. Users create maps, draw markers, lines, and polygons, and attach notes and media. The platform supports both standalone personal use and organizational deployments with departmental SSO.

---

## 2. System Capabilities

### 2.1 Map Annotation

- Users create maps with a title, description, center coordinates, and zoom level.
- Annotations (markers, polylines, polygons) are placed on maps with GeoJSON geometry.
- Annotations support rich-text descriptions and media attachments (images, links).

### 2.2 Multi-tenancy

- An *organization* is the top-level unit of identity isolation. One company = one org.
- Each organization contains one or more *tenants* (departments, teams, or projects). A tenant is the unit of data isolation.
- All maps and annotations are scoped to exactly one tenant.
- A user may be a member of multiple tenants within the same organization, with an independent role per tenant.
- Cross-organization data access is not permitted.

### 2.3 Personal Tenants

- A user registering without an organizational affiliation receives a personal organization and a single "Personal" tenant automatically.
- Personal-tenant users authenticate with email and password (not SSO).
- Personal tenants behave identically to organizational tenants from the API's perspective.

### 2.4 Single Sign-On (SSO)

- An organization may configure an OIDC-compliant identity provider.
- The platform implements the OIDC Authorization Code Flow.
- SSO users in the same organization share a single platform identity, matched on `external_id` (OIDC `sub` claim).
- A single SSO identity may be assigned to multiple tenants within the same organization with different roles.
- The user record is upserted on each SSO login (email and username kept in sync with the IdP).
- After successful SSO authentication, the platform issues its own app-level JWT to the frontend.

### 2.5 Tenant Roles

- Tenant membership carries one of three roles: `admin`, `editor`, `viewer`.
- `admin` — full access including member management and all map operations.
- `editor` — can create maps and annotations; can edit/delete their own; cannot manage members.
- `viewer` — read-only access to all tenant maps and annotations.
- Per-map `map_permissions` rows function as fine-grained overrides within the tenant role floor (e.g., a `viewer`-role member can be granted `can_edit` on a specific map).
- Only `admin`-role members may manage tenant membership.

### 2.6 Permissions

- Each map has a permission table. A row with `user_id = NULL` represents public (unauthenticated) access.
- The map owner always has full access; no permission row is needed.
- Permissions are additive: `can_edit` implies `can_view`.
- Permission grants validate that the target user belongs to the same organization as the map owner.

### 2.7 Tenant Branding

- Each tenant may have custom branding stored as a JSON object on the `tenants` table.
- Supported branding properties: `logo_url`, `favicon_url`, `primary_color`, `accent_color`, `display_name`.
- All properties are optional; the frontend falls back to platform defaults for missing values.
- Any tenant member can read branding; only `admin`-role members can update it.
- Branding is applied dynamically via CSS custom properties (`--brand-primary`, `--brand-accent`), page title, and favicon.

### 2.8 Audit Log

- All security-relevant events are recorded to the `audit_log` table: login success/failure, registration, SSO login, member add/remove, and permission changes.
- Audit inserts are fire-and-forget (async, non-blocking). Failures are logged but do not affect user-facing flows.
- Each event records: event type, acting user, target user (if applicable), tenant, client IP, and freeform JSON detail.

---

## 3. Security Requirements

### 3.1 Transport Security

- All production deployments must run with TLS enabled, either via Drogon's listener config or behind a TLS-terminating reverse proxy.
- The CORS policy must be tightened in production (replace wildcard `Origin` echo with an allowlist).

### 3.2 Password Security

- Passwords are hashed with Argon2id using libsodium's `crypto_pwhash_str` (interactive parameter set).
- Legacy SHA-256 hashes (64-char hex, no leading `$`) are rejected at login. Affected users must reset their password.

### 3.3 Authentication

- Stateless JWT authentication via `JwtFilter` on all protected endpoints.
- JWT payload includes `sub` (userId), `username`, and `orgId`.
- `tenantId` is not in the JWT; it is provided by the URL path and verified per-request by `TenantFilter`.
- `JwtFilter` verifies the user still exists and is active (`users.is_active`) on every authenticated request. Deactivated users are rejected immediately with 401, regardless of JWT expiry.

### 3.4 Authorization

- Every mutating endpoint requires a valid JWT.
- Every tenant-scoped endpoint validates tenant membership via `TenantFilter`, which checks `tenant_members` and injects `tenantRole` into the request.
- `addMedia` verifies the caller has `can_edit` on the parent map before inserting.
- `deleteMedia` verifies the caller is the map owner, map editor, or annotation creator before deleting.

### 3.5 Rate Limiting

- `RateLimitFilter` applies a sliding-window rate limit to `/auth/login`, `/auth/register`, and both SSO endpoints.
- Default: 10 requests per 60 seconds per client IP. Configurable via `rate_limit.max_requests` and `rate_limit.window_seconds` in `config.json`.
- Returns HTTP 429 with a `Retry-After` header when the limit is exceeded.

---

## 4. Data Model

### 4.1 Tables

| Table | Purpose |
|---|---|
| `users` | User accounts. Supports local (password) and SSO (`external_id`) authentication. `is_active` flag for deactivation. |
| `organizations` | Top-level identity unit. One per company. |
| `tenants` | Department/team within an org. Unit of data isolation. Optional `branding` JSON column for visual customization. |
| `tenant_members` | User-to-tenant mapping with role (`admin`/`editor`/`viewer`). |
| `sso_providers` | OIDC provider config per organization (JSON: issuer, client_id, client_secret, endpoints). |
| `maps` | Map records scoped to a tenant via `tenant_id`. |
| `map_permissions` | Per-map, per-user permission grants. `user_id = NULL` = public access. Database triggers enforce at most one public row per map. |
| `annotations` | GeoJSON annotations on maps (marker, polyline, polygon). |
| `annotation_media` | Media attachments (image, link) on annotations. |
| `audit_log` | Security event log. FKs use `ON DELETE SET NULL` so records survive entity deletion. |

### 4.2 Key Relationships

```
organizations ──< tenants ──< tenant_members >── users
                  tenants ──< maps ──< annotations ──< annotation_media
                              maps ──< map_permissions >── users
organizations ──< sso_providers
```

---

## 5. API

### 5.1 Authentication

| Method | Path | Auth | Rate Limited | Description |
|---|---|---|---|---|
| POST | `/api/v1/auth/register` | None | Yes | Create account + personal org/tenant |
| POST | `/api/v1/auth/login` | None | Yes | Verify credentials, return JWT + tenant list |
| POST | `/api/v1/auth/refresh` | JWT | No | Exchange valid token for a fresh one |
| POST | `/api/v1/auth/logout` | JWT | No | Stateless — client discards token |
| GET | `/api/v1/auth/sso/{orgSlug}` | None | Yes | Initiate OIDC authorization flow |
| GET | `/api/v1/auth/sso/{orgSlug}/callback` | None | Yes | OIDC callback — exchange code, issue JWT |

Auth response format (register and login):
```json
{
  "user": { "id": 1, "username": "alice", "email": "alice@example.com" },
  "token": "<jwt>",
  "orgId": 1,
  "tenantId": 1,
  "tenants": [{ "id": 1, "name": "Personal", "slug": "personal", "role": "admin" }]
}
```

### 5.2 Tenants

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/tenants` | JWT | List caller's tenants |
| GET | `/api/v1/tenants/{tenantId}/branding` | JWT + Tenant | Get tenant branding |
| PUT | `/api/v1/tenants/{tenantId}/branding` | JWT + Tenant(admin) | Update tenant branding |
| GET | `/api/v1/tenants/{tenantId}/members` | JWT + Tenant(admin) | List tenant members |
| POST | `/api/v1/tenants/{tenantId}/members` | JWT + Tenant(admin) | Add member with role |
| DELETE | `/api/v1/tenants/{tenantId}/members/{userId}` | JWT + Tenant(admin) | Remove member |

### 5.3 Maps (tenant-scoped)

All routes require JWT + TenantFilter.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/tenants/{tenantId}/maps` | List maps visible to caller |
| POST | `/api/v1/tenants/{tenantId}/maps` | Create map |
| GET | `/api/v1/tenants/{tenantId}/maps/{id}` | Get map detail |
| PUT | `/api/v1/tenants/{tenantId}/maps/{id}` | Update map (owner only) |
| DELETE | `/api/v1/tenants/{tenantId}/maps/{id}` | Delete map (owner only) |
| GET | `/api/v1/tenants/{tenantId}/maps/{id}/permissions` | List permissions (owner only) |
| PUT | `/api/v1/tenants/{tenantId}/maps/{id}/permissions` | Set permission (owner only) |
| DELETE | `/api/v1/tenants/{tenantId}/maps/{id}/permissions/{target}` | Remove permission (owner only) |

### 5.4 Annotations (tenant-scoped)

All routes require JWT + TenantFilter.

| Method | Path | Description |
|---|---|---|
| GET | `.../maps/{mapId}/annotations` | List annotations |
| POST | `.../maps/{mapId}/annotations` | Create annotation (edit perm required) |
| GET | `.../maps/{mapId}/annotations/{id}` | Get annotation |
| PUT | `.../maps/{mapId}/annotations/{id}` | Update annotation |
| DELETE | `.../maps/{mapId}/annotations/{id}` | Delete annotation |
| POST | `.../maps/{mapId}/annotations/{id}/media` | Attach media (edit perm required) |
| DELETE | `.../maps/{mapId}/annotations/{id}/media/{mediaId}` | Remove media |

---

## 6. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Leaflet + Leaflet.draw, Zustand, PWA |
| Backend | C++20, Drogon framework, jwt-cpp, libsodium (Argon2id) |
| Database | MySQL 8 |
| Dev Environment | Docker Compose |

---

## 7. Database Migrations

| Migration | Description |
|---|---|
| 001 | Create `users` table |
| 002 | Create `maps` and `map_permissions` tables |
| 003 | Create `annotations` and `annotation_media` tables |
| 004 | Development seed data (placeholder) |
| 005 | Create `organizations`, `tenants`, `tenant_members`, `sso_providers` tables |
| 006 | Alter `users` (add `org_id`, `external_id`, nullable `password_hash`) and `maps` (add `tenant_id`); backfill personal orgs/tenants for existing users |
| 007 | Create `audit_log` table |
| 008 | Add `is_active` column to `users` |
| 009 | Add `branding` JSON column to `tenants` |
| 010 | Fix NULL uniqueness gap in `map_permissions` via triggers |

---

## 8. Known Limitations

- **TLS not configured by default** — `config.json` ships with `"https": false`. Production deployments must enable TLS in Drogon's listener config or deploy behind a TLS-terminating reverse proxy.
- **No SAML support** — only OIDC is supported for SSO.
- **Single IdP per organization** — multi-IdP is not supported.
- **No audit log retention policy** — the `audit_log` table grows unbounded. A cron-based cleanup of old rows is recommended for production.
- **No subdomain-based tenant routing** — tenants are identified by path (`/tenants/{tenantId}/`), not subdomain.
- **Rate limiter is in-process** — the sliding-window state is held in memory. In a multi-instance deployment, each instance has an independent counter. For shared rate limiting across instances, use a reverse proxy (e.g., nginx `limit_req`) or Redis.
