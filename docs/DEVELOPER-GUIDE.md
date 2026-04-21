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
  await mapsService.createMap(data);
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

The service layer uses dedicated TypeScript types for each request:

- `CreateMapRequest` / `UpdateMapRequest`
- `CreateAnnotationRequest` / `UpdateAnnotationRequest`
- `CreateNoteRequest` / `UpdateNoteRequest`
- `CreateNoteGroupRequest` / `UpdateNoteGroupRequest`

**Do not** use `Partial<CreateXRequest>` as an update type. The `Update*`
variant exists to express fields that are genuinely optional on update
(e.g., `color: string | null` for "clear this field") versus fields that
are simply unset (`undefined`).

### Component decomposition

Feature panels that grow past ~300 lines should be decomposed into
focused subcomponents that sit alongside the parent in the same folder.
See [`frontend/src/components/Notes/`](../frontend/src/components/Notes/)
for the pattern: `NotesPanel.tsx` coordinates, while `NoteCard.tsx`,
`NoteForm.tsx`, and `GroupForm.tsx` handle the leaf UI.

### No `alert()` or silent catches

- Errors must be displayed to the user (inline banner, toast, etc.).
- Don't use `alert()` — use the component's error state instead.
- Don't `catch` and only `console.error()` — that's a silent failure.

This is a convention, not a lint rule, so review PRs for it.

### Errors from Leaflet popup handlers

Leaflet popup button handlers run outside React, so you can't call
`setState` from them. Use the `showMapError(map, message)` helper in
[`AnnotationLayer.tsx`](../frontend/src/components/Map/AnnotationLayer.tsx):

```ts
try {
  await annotationsService.updateAnnotation(...);
} catch {
  showMapError(leafletMap, 'Failed to update annotation.');
}
```

It appends a `.map-error-banner` div to the map container and auto-removes
it after 5 seconds. The CSS lives in [`frontend/src/index.css`](../frontend/src/index.css).
Only use this pattern for Leaflet event handlers — React components
should use component-local error state with inline banner display.

### Building Leaflet popup content — DOM nodes, not HTML strings

**Never pass an HTML string built from user-controlled fields to
`layer.bindPopup(...)`.** Leaflet renders strings as HTML, so
`title: '<img src=x onerror=...>'` in an annotation executes for every
viewer.

Build popup content as DOM nodes using `document.createElement` and
`textContent`, then pass the element to `bindPopup`. `textContent` is
parsed as literal text, not HTML, so injection is impossible:

```ts
const popupEl = document.createElement('div');
popupEl.className = 'annotation-popup';

const h3 = document.createElement('h3');
h3.textContent = annotation.title;  // ✓ safe even if title contains HTML
popupEl.appendChild(h3);

layer.bindPopup(popupEl);
```

For links and images, also validate the URL scheme (defense in depth
against backend validation gaps):

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

See [`AnnotationLayer.tsx`](../frontend/src/components/Map/AnnotationLayer.tsx)
and [`NoteMarkers.tsx`](../frontend/src/components/Map/NoteMarkers.tsx)
for the pattern in context.

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
