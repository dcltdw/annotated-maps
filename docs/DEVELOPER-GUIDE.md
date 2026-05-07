# Developer Guide

Conventions and shared utilities used across the codebase. Follow these
patterns when adding new controllers, components, or services so the
codebase stays internally consistent.

## Backend (C++)

### Error responses

All controllers emit errors as JSON via the shared helpers in
[`backend/src/ErrorResponse.h`](../backend/src/ErrorResponse.h):

```cpp
#include "ErrorResponse.h"

// In a controller, for a one-liner:
callback(errorResponse(drogon::k404NotFound, "not_found", "Map not found"));

// Or build the JSON first (useful if you need to attach extra fields):
auto body = errorJson("bad_request", "Invalid input");
body["field"] = "title";
auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
resp->setStatusCode(drogon::k400BadRequest);
callback(resp);
```

Every error response has the shape `{"error": "<code>", "message": "<text>"}`.
The frontend relies on this — don't construct error JSON inline with other
keys.

**Do not** define local `static Json::Value errorJson(...)` helpers in new
controllers. Always include the shared header.

### Filter failure callbacks

Filters (`JwtFilter`, `TenantFilter`, etc.) that use `execSqlAsync` must
wrap `failCb` in a `shared_ptr<FilterCallback>` before capturing it into
both the success and error lambdas. A plain `std::move` into two captures
causes a `std::bad_function_call` crash because the second lambda moves
from a moved-from object.

See the pattern in [`backend/src/filters/JwtFilter.cpp`](../backend/src/filters/JwtFilter.cpp).

### Audit logging

All auditable events use `AuditLog::record(...)` and are fire-and-forget
(no callback chain). See [`backend/src/AuditLog.h`](../backend/src/AuditLog.h)
for the signature.

Currently audited:

- Auth: `register`, `login_success`, `login_failure`, `sso_login`,
  `sso_identity_collision`
- Membership / permissions: `member_add`, `member_remove`,
  `permission_change`, `branding_update`
- Maps: `map_update`, `map_delete`
- Nodes: `node_create`, `node_update`, `node_delete`,
  `node_visibility_set`, `node_move`, `node_copy`
- Notes: `note_update`, `note_delete`, `note_visibility_set`
- Plots: `plot_create`, `plot_update`, `plot_delete`,
  `plot_node_add`, `plot_node_remove`, `plot_note_add`,
  `plot_note_remove`

Add a new event when introducing any destructive or privilege-changing
operation. Read paths (GET) are not audited.

### Proxy trust and `X-Forwarded-For`

Several controls (rate limiting in [`RateLimitFilter`](../backend/src/filters/RateLimitFilter.cpp),
HSTS conditional emission, future client-IP-based audit) read the
`X-Forwarded-For` and `X-Forwarded-Proto` headers. **These headers are
client-supplied unless a trusted reverse proxy strips and rewrites them.**

Deployment requirements:

- The backend must only accept traffic via a trusted reverse proxy
  (nginx, Caddy, ALB, etc.) on the production host. Direct connections
  to the backend port from outside the host should be blocked at the
  network layer.
- The proxy must:
  - Strip any client-supplied `X-Forwarded-For` and `X-Forwarded-Proto`
    headers before forwarding.
  - Set `X-Forwarded-For` to the real client IP it observed.
  - Set `X-Forwarded-Proto` to `https` when the client connected via TLS.
- For `nginx`, the standard recipe is `proxy_set_header X-Forwarded-For
  $remote_addr;` (note: `$proxy_add_x_forwarded_for` would *append* and
  preserve any client-supplied value — don't use it here).

`RateLimitFilter` uses only the leftmost entry of `X-Forwarded-For`,
which is the IP injected by the trusted proxy. Without the proxy
discipline above, an attacker can spoof IPs by setting the header
themselves and rotate around per-IP rate limits.

For local dev (no proxy), `X-Forwarded-For` is empty and the filter
falls back to `req->getPeerAddr()`, so dev workflow is unaffected.

## CI / Docker

### `docker-compose.ci.yml`

The [`docker-compose.ci.yml`](../docker-compose.ci.yml) override is used by
the PR and nightly workflows. It maps pre-built image tags
(`annotated-maps-backend:latest`, `annotated-maps-frontend:latest`) onto the
backend and frontend services so that `docker compose up` uses images the
workflow just built via `docker/build-push-action` (with GHA cache) instead
of rebuilding from scratch. Local development uses `docker-compose.yml`
alone — the override is CI-only.

### Soak test duration vs. runner timeout

`backend/tests/test_10_soak.py` has `DURATION = 300` (5 minutes of
continuous load). The test runner in `run-tests.py` gives each test a
900-second subprocess timeout. These are set independently: 300s is the
minimum window to catch rate-limiter over-admission under sustained load,
and 900s gives headroom for stack-up and teardown without masking real
soak failures. Don't change one without considering the other — see #21
for the history.

## Frontend (React / TypeScript)

### Handling API errors in components

Use the helpers in [`frontend/src/utils/errors.ts`](../frontend/src/utils/errors.ts)
instead of inline axios/AxiosError handling:

```tsx
import { extractApiError, getApiErrorCode } from '@/utils/errors';

try {
  await mapsService.createMap(tenantId, data);
} catch (err) {
  setError(extractApiError(err, 'Failed to create map.'));
}
```

When you need custom UX for specific backend error codes (e.g.,
`email_taken`, `username_taken`), use `getApiErrorCode(err)` to get the
machine-readable code and fall back to `extractApiError` for unknown cases.

**Do not** reach into `(err as AxiosError<ApiError>).response?.data` directly
in component code — keep that knowledge in the `utils/errors.ts` helpers.

### Service layer request types

The service layer uses dedicated TypeScript types for each request,
defined alongside the Zod schemas in
[`frontend/src/api/schemas.ts`](../frontend/src/api/schemas.ts):

- `CreateMapRequest` / `UpdateMapRequest`
- `CreateNodeRequest` / `UpdateNodeRequest`
- `CreateNoteRequest` / `UpdateNoteRequest`
- `CreatePlotRequest` / `UpdatePlotRequest`
- `CreateVisibilityGroupRequest` / `UpdateVisibilityGroupRequest`
- `CreateMediaRequest` / `UpdateMediaRequest` (shared between node and
  note media)

The `Update*` variants are deliberate: they express fields that are
genuinely optional on update (e.g., `color: string | null` for "clear
this field") versus fields that are simply unset (`undefined`). Don't
collapse them to `Partial<CreateXRequest>` — you'll lose that
distinction.

### Validating API responses with Zod

Service-layer reads parse JSON through the Zod schemas in
[`frontend/src/api/schemas.ts`](../frontend/src/api/schemas.ts) before
returning to callers. The TypeScript type comes from `z.infer<>` on
the same schema, so the runtime guarantee and the static type can't
drift. New endpoints should add a schema to that file rather than
hand-writing a TypeScript type — see #92 for the rationale.

### Component decomposition

Feature panels that grow past ~300 lines should be decomposed into
focused subcomponents that sit alongside the parent in the same folder.
See [`frontend/src/components/Detail/`](../frontend/src/components/Detail/)
and [`frontend/src/components/Tree/`](../frontend/src/components/Tree/)
for the pattern: a coordinator component owns state and data fetching
while focused leaves handle a single piece of UI.

### No `alert()` or silent catches

- Errors must be displayed to the user (inline banner, toast, etc.).
- Don't use `alert()` — use the component's error state instead.
- Don't `catch` and only `console.error()` — that's a silent failure.

This is a convention, not a lint rule, so review PRs for it.

### Rendering user-controlled content safely

User-controlled fields (node names, note titles, captions, descriptions)
must never be interpolated into raw HTML strings. React's JSX escaping
handles this for ordinary component children, but two paths still
warrant care:

- Leaflet APIs that accept HTML strings (e.g., `layer.bindTooltip(html)`)
  must be passed DOM nodes built with `document.createElement` +
  `textContent`, never a `${user.field}` template literal.
- Media URLs must be validated as `http`/`https` on the client even
  though the backend also validates — defense in depth keeps a backend
  validation regression from becoming an XSS payload:

```ts
function isSafeMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
```

### JWT secret placeholder is fatal at startup

The backend refuses to start when `config.json` contains a
`CHANGE_ME...` JWT secret and `JWT_SECRET` is not set in the
environment. Local dev and CI override this by setting
`ALLOW_PLACEHOLDER_SECRETS=1` in `docker-compose.yml` — this env var
**must never** be set in production compose/env files. Production
deployment must supply a real `JWT_SECRET` (min 32 chars).

### Argon2id cost parameters

Password hashing cost is configurable via environment variables read
at hash time (not startup) in `AuthController.cpp`:

- `ARGON2_OPSLIMIT` — iteration count. Default: `crypto_pwhash_OPSLIMIT_MIN` (1).
- `ARGON2_MEMLIMIT` — memory in bytes. Default: `crypto_pwhash_MEMLIMIT_MIN` (8 MiB).

Dev/CI uses the MIN defaults because `OPSLIMIT_INTERACTIVE`
(4 iterations, 64 MiB) hangs under x86_64 emulation on Apple Silicon.

**Production MUST set at least INTERACTIVE:**

```
ARGON2_OPSLIMIT=4
ARGON2_MEMLIMIT=67108864   # 64 MiB
```

Higher values (`SENSITIVE`: 8 ops, 256 MiB) are appropriate if you
have the CPU budget. Measure login latency at whatever value you
choose — you want it to be a couple hundred ms, not many seconds.

### SSO `client_secret` storage

`sso_providers.config` in the database holds SSO provider metadata
(endpoints, `client_id`, `redirect_uri`) but **NEVER** the client
secret. The backend reads `client_secret` from the environment variable
`SSO_CLIENT_SECRET_<ORG_ID>` (e.g. `SSO_CLIENT_SECRET_1`) at request
time. If the env var is missing or empty, the SSO flow returns a
generic `500 SSO is not available`.

This moves the highest-value secret out of the DB. Production
deployments typically wire these env vars up via the platform's secret
manager (Kubernetes Secrets, AWS Secrets Manager + External Secrets,
Docker Secrets, etc.). Never commit real client secrets to `.env`
files that are tracked by git.

For local dev against a test IdP, add a `docker-compose.override.yml`
(gitignored) with entries like:

```yaml
services:
  backend:
    environment:
      - SSO_CLIENT_SECRET_1=your-real-test-idp-secret
```

### SSO authorization-code flow (frontend ↔ backend handshake)

The backend never delivers the application JWT in a URL fragment.
After a successful OIDC callback it stores the JWT under a one-time
random code (32-byte hex, 2-minute TTL, in-process map) and redirects:

```
GET  /api/v1/auth/sso/{slug}/callback?code=<idp-code>&state=<state>
  ↓ backend exchanges with IdP, verifies nonce, upserts user
  ↓ stores JWT under <app-code>
302 Location: <frontend>/sso/callback?code=<app-code>
```

The frontend's `SsoCallbackPage` reads `?code=` from the query string
and POSTs to `/api/v1/auth/sso/exchange`:

```
POST /api/v1/auth/sso/exchange   { "code": "<app-code>" }
  ↓ backend pops the entry from pendingAppCodes_
200 { "token": "<jwt>", "tenantId": <int> }
```

The exchange endpoint is rate-limited (`RateLimitFilter`) and
single-use — a second POST with the same code returns `400 invalid_code`.

### SSO identity collision

The OIDC spec requires `sub` claims to be stable per-user, but in
practice some IdPs reuse them when an account is recreated. The
backend guards against this: on every SSO login, if a user row already
exists for `(org_id, external_id)` and the IdP-supplied email differs
from the stored email, the controller returns `409 identity_collision`
and writes an `sso_identity_collision` audit log entry containing both
emails. An admin must reconcile manually before that user can log in
again. Resolution depends on which side is "right" — typically delete
the stale `users` row (after migrating their content) so the next SSO
login creates a fresh account.
