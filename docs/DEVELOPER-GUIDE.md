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
  For Leaflet popup handlers where React state isn't available, use the
  `showMapError()` helper in [`AnnotationLayer.tsx`](../frontend/src/components/Map/AnnotationLayer.tsx).
