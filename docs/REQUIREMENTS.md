# Annotated Maps — Requirements v0.2

## 1. Overview

Annotated Maps is a multi-tenant, collaborative map annotation platform.
Users create maps, mark places as a tree of *nodes*, attach *notes* and
media to those nodes, and group them into narrative *plots* that span
multiple maps. The platform supports both standalone personal use and
organizational deployments with departmental SSO.

---

## 2. System Capabilities

### 2.1 Maps

- Each map has a title, description, and a **coordinate system** that
  determines how content positions are interpreted and rendered.
- Three coordinate systems are supported (see 2.2).
- Maps belong to exactly one tenant. Map-level permissions allow other
  members of the same organization to be granted access.

### 2.2 Coordinate Systems

The map's `coordinateSystem` is a discriminated union on `type`:

- **`wgs84`** — real-world geographic coordinates rendered with a
  Leaflet tile layer. Carries `center {lat, lng}` and `zoom`.
- **`pixel`** — an uploaded image used as the map plane. Carries
  `image_url`, `width`, `height`, and a `viewport {x, y, zoom}`. Node
  geometry is interpreted in image-pixel coordinates.
- **`blank`** — an unbounded blank canvas. Carries `extent {x, y}`.
  Node geometry is in canvas units.

The active coordinate system is fixed at map creation. The renderer is
selected from `coordinateSystem.type` at view time.

### 2.3 Nodes

- A *node* is a place marker on a map. Nodes form a tree per-map via
  `parent_id` (NULL = root).
- Each node carries a name, optional description, optional GeoJSON
  geometry, optional color, and a per-node visibility-override flag.
- GeoJSON `type` is one of `Point`, `LineString`, `Polygon`. Coordinate
  meaning is determined by the parent map's `coordinateSystem`.
- Nodes can be moved (re-parented) and copied (subtree copy with
  geometry/visibility rebinding) within the same map.
- Tree depth is capped (currently 16) and cycles are rejected on move.
- Subtree fetches are paginated by cursor.

### 2.4 Notes

- A *note* is a text entry attached to a *node* (notes inherit position
  from the parent node — no own lat/lng).
- A note has an optional title, required text body, optional color,
  optional `pinned` flag, and a per-note visibility-override flag.
- Notes can be created by any user with view access to the map; edit
  and delete are allowed for the note creator, the map owner, or any
  member with edit-level access.
- Notes are listed under their parent node.

### 2.5 Media

- Both nodes and notes can have media attachments stored in parallel
  tables (`node_media`, `note_media`).
- Each media row has a `media_type` (`image` or `link`), `url`, and
  optional caption.
- URLs must use `http` or `https` scheme; other schemes
  (`javascript:`, `data:`) are rejected.

### 2.6 Plots

- A *plot* is a tenant-scoped narrative grouping that can contain both
  nodes and notes from any map in the tenant.
- Plots are many-to-many to both nodes and notes via parallel junction
  tables (`plot_nodes`, `plot_notes`).
- Plots are useful for collecting related places or observations
  across multiple maps (e.g., "Field Survey 2025-Q1").

### 2.7 Visibility Groups

- A *visibility group* is a tenant-scoped named subset of users.
- Nodes and notes can be tagged with one or more visibility groups; an
  entity is visible only to users in at least one of its tagged
  groups (with override / inherit semantics).
- Without explicit tagging, an entity inherits effective visibility
  from its parent chain (parent node for nodes; attached node for
  notes). Setting `override = true` makes the entity's tag set
  authoritative.
- The effective visibility of any node/note is computed at read time
  via a recursive CTE that walks the parent chain.
- A map's `owner_xray` flag, when enabled, lets the map owner see
  every entity on the map regardless of visibility tags. Useful for
  authoring workflows.
- Cross-organization members cannot be added to a visibility group.

### 2.8 Multi-tenancy

- An *organization* is the top-level unit of identity isolation. One
  company = one org.
- Each organization contains one or more *tenants* (departments,
  teams, or projects). A tenant is the unit of data isolation.
- All maps, nodes, notes, plots, and visibility groups are scoped to
  exactly one tenant.
- A user may be a member of multiple tenants within the same
  organization, with an independent role per tenant.
- Cross-organization data access is not permitted.

### 2.9 Personal Tenants

- A user registering without an organizational affiliation receives a
  personal organization and a single "Personal" tenant automatically.
- Personal-tenant users authenticate with email and password (not
  SSO). Personal tenants behave identically to organizational tenants
  from the API's perspective.

### 2.10 Single Sign-On (SSO)

- An organization may configure an OIDC-compliant identity provider.
- The platform implements the OIDC Authorization Code Flow.
- SSO users in the same organization share a single platform identity,
  matched on `external_id` (OIDC `sub` claim).
- A single SSO identity may be assigned to multiple tenants within the
  same organization with different roles.
- The user record is upserted on each SSO login (email and username
  kept in sync with the IdP).
- After successful SSO authentication, the platform issues its own
  app-level JWT to the frontend.

### 2.11 Tenant Roles

- Tenant membership carries one of three roles: `admin`, `editor`,
  `viewer`.
- `admin` — full access including member management and all map
  operations.
- `editor` — can create maps and nodes; can edit/delete their own;
  cannot manage members.
- `viewer` — read-only access to all tenant maps and their content.
- Per-map `map_permissions` rows function as fine-grained overrides
  (e.g., a `viewer`-role member can be granted `level='edit'` on a
  specific map).
- Only `admin`-role members may manage tenant membership.

### 2.12 Map Permissions

- Each map has a permission table. A row with `user_id = NULL`
  represents public (unauthenticated) access.
- The map owner always has full access; no permission row is needed.
- Permissions are hierarchical with the levels:
  `none < view < comment < edit < moderate < admin`. Higher levels
  imply lower ones.
- Permission grants validate that the target user belongs to the same
  organization as the map owner.

### 2.13 Tenant Branding

- Each tenant may have custom branding stored as a JSON object on the
  `tenants` table.
- Supported branding properties: `logo_url`, `favicon_url`,
  `primary_color`, `accent_color`, `display_name`.
- All properties are optional; the frontend falls back to platform
  defaults for missing values.
- Color values are validated as hex format (`#RGB`, `#RRGGBB`, or
  `#RRGGBBAA`). URLs must use `https://` scheme. `display_name` is
  truncated to 255 characters.
- Any tenant member can read branding; only `admin`-role members can
  update it.
- Branding is applied dynamically via CSS custom properties
  (`--brand-primary`, `--brand-accent`), page title, and favicon.

### 2.14 Audit Log

- Security-relevant events are recorded to the `audit_log` table:
  login success/failure, registration, SSO login, member add/remove,
  and permission changes.
- Audit inserts are fire-and-forget (async, non-blocking). Failures
  are logged and counted via atomic counters
  (`AuditLog::failureCount()`, `AuditLog::successCount()`) but do not
  affect user-facing flows.
- Each event records: event type, acting user, target user (if
  applicable), tenant, client IP, and freeform JSON detail.

### 2.15 Resource Limits

- Per-tenant map limit: 1,000 maps. Enforced on map creation.
- Map-tree depth limit: 16. Enforced on node create and node move.
- Per-map node count limit: 5,000 nodes. Enforced on node create and
  node copy (a copy that would push the destination over the limit is
  rejected before any inserts). Bounds DOS surface on a single hot map
  that the per-tenant map cap doesn't cover.
- Map list pagination: `pageSize` is clamped to 1–100. Invalid values
  default to 20.
- Node subtree responses are cursor-paginated to bound payload size.

---

## 3. Security Requirements

### 3.1 Transport Security

- All production deployments must run with TLS enabled, either via
  Drogon's listener config or behind a TLS-terminating reverse proxy.

### 3.2 CORS

- CORS uses an origin whitelist loaded from
  `custom_config.allowed_origins` in the config file, plus the
  configured `frontend_url`. Unrecognized origins receive no CORS
  headers.

### 3.3 Security Headers

- All responses include `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, and
  `Referrer-Policy: strict-origin-when-cross-origin`.

### 3.4 Password Security

- Passwords are hashed with Argon2id using libsodium's
  `crypto_pwhash_str`. Development uses `OPSLIMIT_MIN`/`MEMLIMIT_MIN`
  parameters for compatibility with emulated Docker environments;
  production on native hardware should use
  `OPSLIMIT_INTERACTIVE`/`MEMLIMIT_INTERACTIVE`.
- Legacy SHA-256 hashes (64-char hex, no leading `$`) are rejected at
  login. Affected users must reset their password.

### 3.5 Secrets Management

- The JWT secret can be overridden via the `JWT_SECRET` environment
  variable (minimum 32 characters). If the config file value contains
  `CHANGE_ME`, a startup warning is printed.
- The `frontend_url` config value is validated at startup; non-HTTPS,
  non-localhost values produce a warning.
- Database credentials in Docker Compose are parameterized via
  environment variables with local-dev defaults.

### 3.6 Authentication

- Stateless JWT authentication via `JwtFilter` on all protected
  endpoints.
- JWT payload includes `sub` (userId), `username`, `orgId`, and `aud`
  (audience: `annotated-maps`).
- `JwtFilter` validates issuer, audience, signature, and expiry.
- `tenantId` is not in the JWT; it is provided by the URL path and
  verified per-request by `TenantFilter`.
- `JwtFilter` verifies the user still exists and has
  `status = 'active'` on every authenticated request. Non-active users
  (suspended, deactivated, pending, locked) are rejected immediately
  with 401, regardless of JWT expiry. The user's `platform_role` is
  also injected into the request attributes.
- Registration error messages are generic ("Registration failed") to
  prevent account enumeration.

### 3.7 Authorization

- Every mutating endpoint requires a valid JWT.
- Every tenant-scoped endpoint validates tenant membership via
  `TenantFilter`, which checks `tenant_members` and injects
  `tenantRole` into the request.
- `setPermission` validates that the target user's `org_id` matches
  the caller's organization.
- Node and note write paths verify the caller has `level='edit'` or
  higher on the parent map (or is the map owner / entity creator
  where applicable).
- Visibility-group membership changes verify the target user belongs
  to the same organization as the group's tenant.
- Read endpoints filter results through the effective-visibility CTE
  so users only see entities tagged for their groups (with
  `owner_xray` bypass for the map owner).

### 3.8 Rate Limiting

- `RateLimitFilter` applies a sliding-window rate limit to
  `/auth/login`, `/auth/register`, and both SSO endpoints.
- Configurable via `custom_config.rate_limit.max_requests` and
  `custom_config.rate_limit.window_seconds` in the config file.
  Development default: 100 requests per 60 seconds. Production
  recommendation: 5 requests per 300 seconds.
- Returns HTTP 429 with a `Retry-After` header when the limit is
  exceeded.

### 3.9 Input Validation

- GeoJSON: `type` must be `Point`, `LineString`, or `Polygon`;
  `coordinates` must be a non-empty array. Coordinate semantics are
  determined by the map's coordinate system.
- Coordinate-system payloads validated as the discriminated union of
  `wgs84`/`pixel`/`blank` shapes.
- Media URLs: scheme must be `http` or `https`.
- Branding colors: must match hex format (`#[0-9a-fA-F]{3,8}`).
  Branding URLs must use `https`.
- Pagination: `page` >= 1, `pageSize` clamped to 1–100.
- SSO error responses are generic ("SSO is not available") to prevent
  organization slug enumeration.

---

## 4. Data Model

### 4.1 Tables

| Table | Purpose |
|---|---|
| `organizations` | Top-level identity unit. One per company. |
| `users` | User accounts. Local (password) or SSO (`external_id`). `status` ENUM, `platform_role` ENUM. |
| `org_members` | User-to-org role mapping (`owner` / `admin` / `member`). |
| `tenants` | Department/team within an org. Unit of data isolation. Optional `branding` JSON column. |
| `tenant_members` | User-to-tenant mapping with role (`admin` / `editor` / `viewer`). |
| `sso_providers` | OIDC provider config per organization. |
| `maps` | Map records scoped to a tenant. Carries `coordinate_system` JSON and `owner_xray` flag. |
| `map_permissions` | Per-map, per-user permission grants. `user_id = NULL` = public. Trigger-enforced single-public-row invariant. |
| `nodes` | Tree-structured place markers per map. `parent_id` self-FK. Optional GeoJSON, color, visibility override. |
| `node_visibility` | Tagging table linking nodes ↔ visibility groups. |
| `node_media` | Image / link attachments on nodes. |
| `notes` | Text entries attached to a node. Optional title, color, pinned, visibility override. |
| `note_visibility` | Tagging table linking notes ↔ visibility groups. |
| `note_media` | Image / link attachments on notes. |
| `plots` | Tenant-scoped narrative groupings. |
| `plot_nodes` | Junction: plots ↔ nodes (many-to-many). |
| `plot_notes` | Junction: plots ↔ notes (many-to-many). |
| `visibility_groups` | Tenant-scoped named user subsets. |
| `visibility_group_members` | Junction: groups ↔ users. |
| `audit_log` | Security event log. FKs use `ON DELETE SET NULL` so records survive entity deletion. |

### 4.2 Key Relationships

```
organizations ──< tenants ──< tenant_members >── users
organizations ──< org_members >── users
organizations ──< sso_providers
                  tenants ──< maps ──< nodes ──< notes
                                       nodes ──< node_media
                                       notes ──< note_media
                              maps ──< map_permissions >── users
                  tenants ──< plots ──< plot_nodes >── nodes
                                       plot_notes >── notes
                  tenants ──< visibility_groups ──< visibility_group_members >── users
                              nodes ──< node_visibility >── visibility_groups
                              notes ──< note_visibility >── visibility_groups
```

---

## 5. API

All routes are mounted under `/api/v1`. Tenant-scoped routes pass the
tenantId in the URL path and run through `JwtFilter` + `TenantFilter`.

### 5.1 Authentication

| Method | Path | Auth | Rate Limited | Description |
|---|---|---|---|---|
| POST | `/auth/register` | None | Yes | Create account + personal org/tenant |
| POST | `/auth/login` | None | Yes | Verify credentials, return JWT + tenant list |
| POST | `/auth/refresh` | JWT | No | Exchange valid token for a fresh one |
| POST | `/auth/logout` | JWT | No | Stateless — client discards token |
| GET | `/auth/sso/{orgSlug}` | None | Yes | Initiate OIDC authorization flow |
| GET | `/auth/sso/{orgSlug}/callback` | None | Yes | OIDC callback — exchange code, issue JWT |
| POST | `/auth/sso/exchange` | None | Yes | Exchange one-time SSO ticket for JWT |

### 5.2 Tenants

| Method | Path | Description |
|---|---|---|
| GET | `/tenants` | List caller's tenants |
| GET | `/tenants/{tenantId}/branding` | Get tenant branding |
| PUT | `/tenants/{tenantId}/branding` | Update branding (admin only) |
| GET | `/tenants/{tenantId}/members` | List tenant members (admin only) |
| POST | `/tenants/{tenantId}/members` | Add member with role (admin only) |
| DELETE | `/tenants/{tenantId}/members/{userId}` | Remove member (admin only) |

### 5.3 Maps

| Method | Path | Description |
|---|---|---|
| GET | `/tenants/{tenantId}/maps` | List maps visible to caller |
| POST | `/tenants/{tenantId}/maps` | Create map |
| GET | `/tenants/{tenantId}/maps/{id}` | Get map detail |
| PUT | `/tenants/{tenantId}/maps/{id}` | Update map (owner only) |
| DELETE | `/tenants/{tenantId}/maps/{id}` | Delete map (owner only) |
| GET | `/tenants/{tenantId}/maps/{id}/permissions` | List permissions (owner only) |
| PUT | `/tenants/{tenantId}/maps/{id}/permissions` | Set permission (owner only) |
| DELETE | `/tenants/{tenantId}/maps/{id}/permissions/{target}` | Remove permission (owner only) |

### 5.4 Nodes

| Method | Path | Description |
|---|---|---|
| GET | `/tenants/{tenantId}/maps/{mapId}/nodes` | List visible nodes on a map |
| POST | `/tenants/{tenantId}/maps/{mapId}/nodes` | Create node (edit perm) |
| GET | `/tenants/{tenantId}/maps/{mapId}/nodes/{id}` | Get node |
| PUT | `/tenants/{tenantId}/maps/{mapId}/nodes/{id}` | Update node (edit perm) |
| DELETE | `/tenants/{tenantId}/maps/{mapId}/nodes/{id}` | Delete node (edit perm) |
| GET | `/tenants/{tenantId}/maps/{mapId}/nodes/{id}/children` | Direct children |
| GET | `/tenants/{tenantId}/maps/{mapId}/nodes/{id}/subtree` | Cursor-paginated subtree |
| POST | `/tenants/{tenantId}/maps/{mapId}/nodes/{id}/move` | Re-parent (cycle / depth checked) |
| POST | `/tenants/{tenantId}/maps/{mapId}/nodes/{id}/copy` | Subtree copy with rebinding |
| GET | `/tenants/{tenantId}/maps/{mapId}/nodes/{id}/visibility` | Get raw visibility state |
| PUT | `/tenants/{tenantId}/maps/{mapId}/nodes/{id}/visibility` | Set override + group ids |

### 5.5 Notes

| Method | Path | Description |
|---|---|---|
| GET | `/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/notes` | List notes on a node |
| POST | `/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/notes` | Create note (view perm) |
| GET | `/tenants/{tenantId}/maps/{mapId}/notes/{id}` | Get note |
| PUT | `/tenants/{tenantId}/maps/{mapId}/notes/{id}` | Update note (creator / owner / editor) |
| DELETE | `/tenants/{tenantId}/maps/{mapId}/notes/{id}` | Delete note (creator / owner / editor) |
| GET | `/tenants/{tenantId}/maps/{mapId}/notes/{id}/visibility` | Get raw visibility state |
| PUT | `/tenants/{tenantId}/maps/{mapId}/notes/{id}/visibility` | Set override + group ids |

### 5.6 Media

| Method | Path | Description |
|---|---|---|
| GET | `/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/media` | List node media |
| POST | `/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/media` | Add node media (edit perm) |
| PUT | `/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/media/{id}` | Edit media caption |
| DELETE | `/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/media/{id}` | Delete node media |
| GET | `/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/media` | List note media |
| POST | `/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/media` | Add note media (edit perm) |
| PUT | `/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/media/{id}` | Edit media caption |
| DELETE | `/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/media/{id}` | Delete note media |

### 5.7 Plots

| Method | Path | Description |
|---|---|---|
| GET | `/tenants/{tenantId}/plots` | List plots in tenant |
| POST | `/tenants/{tenantId}/plots` | Create plot |
| GET | `/tenants/{tenantId}/plots/{id}` | Get plot |
| PUT | `/tenants/{tenantId}/plots/{id}` | Update plot |
| DELETE | `/tenants/{tenantId}/plots/{id}` | Delete plot |
| GET | `/tenants/{tenantId}/plots/{id}/members` | List node + note members |
| POST | `/tenants/{tenantId}/plots/{id}/nodes` | Attach a node to the plot |
| DELETE | `/tenants/{tenantId}/plots/{id}/nodes/{nodeId}` | Detach a node |
| POST | `/tenants/{tenantId}/plots/{id}/notes` | Attach a note to the plot |
| DELETE | `/tenants/{tenantId}/plots/{id}/notes/{noteId}` | Detach a note |
| GET | `/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/plots` | List plots that contain this node |
| GET | `/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/plots` | List plots that contain this note |

### 5.8 Visibility Groups

| Method | Path | Description |
|---|---|---|
| GET | `/tenants/{tenantId}/visibility-groups` | List visibility groups |
| POST | `/tenants/{tenantId}/visibility-groups` | Create group |
| GET | `/tenants/{tenantId}/visibility-groups/{id}` | Get group |
| PUT | `/tenants/{tenantId}/visibility-groups/{id}` | Update group |
| DELETE | `/tenants/{tenantId}/visibility-groups/{id}` | Delete group |
| GET | `/tenants/{tenantId}/visibility-groups/{id}/members` | List group members |
| POST | `/tenants/{tenantId}/visibility-groups/{id}/members` | Add member (same-org check) |
| DELETE | `/tenants/{tenantId}/visibility-groups/{id}/members/{userId}` | Remove member |

---

## 6. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Leaflet, Zustand, Zod, PWA |
| Backend | C++20, Drogon framework (v1.9.3), jwt-cpp (v0.7.0), libsodium (Argon2id) |
| Database | MySQL 8 (MariaDB connector for async I/O) |
| Dev Environment | Docker Compose (Ubuntu 22.04 containers) |
| Backend tests | Python 3 (stdlib only — urllib, json, subprocess) |
| E2E tests | Playwright (Chromium) |

### 6.1 Configuration

Backend configuration uses Drogon's JSON config format. Custom
application settings (JWT, rate limiting, CORS, frontend URL) are
placed under the `custom_config` key and accessed via
`drogon::app().getCustomConfig()`.

---

## 7. Database Migrations

| Migration | Description |
|---|---|
| 001 | Consolidated schema — all domain tables (organizations, users, tenants, tenant_members, org_members, sso_providers, maps with `coordinate_system` + `owner_xray`, map_permissions with public-row trigger, visibility_groups + members, nodes + node_visibility + node_media, notes + note_visibility + note_media, plots + plot_nodes + plot_notes) |
| 002 | Audit log table |

The pre-rebuild migration history (annotations, note groups, etc.)
was collapsed into 001 during the rebuild.

---

## 8. Known Limitations

- **TLS not configured by default** — `config.json` ships with
  `"https": false`. Production deployments must enable TLS in
  Drogon's listener config or deploy behind a TLS-terminating reverse
  proxy.
- **No SAML support** — only OIDC is supported for SSO.
- **Single IdP per organization** — multi-IdP is not supported.
- **No audit log retention policy** — the `audit_log` table grows
  unbounded. A cron-based cleanup of old rows is recommended for
  production.
- **No subdomain-based tenant routing** — tenants are identified by
  path (`/tenants/{tenantId}/`), not subdomain.
- **Rate limiter is in-process** — the sliding-window state is held
  in memory. In a multi-instance deployment, each instance has an
  independent counter. For shared rate limiting across instances, use
  a reverse proxy (e.g., nginx `limit_req`) or Redis.
- **Argon2id uses minimum parameters** — development Docker config
  uses `OPSLIMIT_MIN`/`MEMLIMIT_MIN` for compatibility with x86_64
  emulation on Apple Silicon. Production deployments on native
  hardware should increase to `OPSLIMIT_INTERACTIVE`/`MEMLIMIT_INTERACTIVE`.
- **OIDC nonce not verified** — the SSO flow generates a nonce but
  does not verify it against the ID token.
- **JWT stored in localStorage** — vulnerable to XSS. Mitigated by
  security headers and input validation.
- **SSO token passed in URL fragment** — can leak via browser history
  and Referer headers.
