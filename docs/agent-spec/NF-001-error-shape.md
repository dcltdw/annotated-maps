---
id: NF-001
title: Backend error response shape
type: non-functional
status: shipped
issue: 52
pr: 191
depends_on: []
owner: dcltdw
last_updated: 2026-05-11
---

## Summary

Every backend error response uses the same JSON envelope: `{"error": "<code>", "message": "<text>"}`. The `error` field is a short stable machine-readable code (e.g. `bad_request`, `not_found`, `unauthorized`, `forbidden`, `conflict`, `limit_exceeded`, `db_error`); the `message` is a human-readable string. The frontend's `extractApiError(err, fallback)` helper depends on this shape — controllers that drift to a different structure (`{"detail": "…"}`, raw strings, etc.) silently show generic fallbacks. Shared `errorJson(code, msg)` and `errorResponse(status, code, msg)` helpers in `backend/src/ErrorResponse.h` are the only sanctioned way to build error responses; new controllers must include the header and use them. This is a retroactive spec capturing the shape that's been the de-facto standard since the rebuild and was explicitly locked in by #52 / PR #191 (the `assert_error_shape` test helper).

## Inputs

- Any error path in any backend controller.
- The `ErrorResponse.h` helpers: `errorJson(code, msg)` (returns a `Json::Value`) and `errorResponse(status, code, msg)` (returns a `drogon::HttpResponsePtr` with the status code set).

## Properties

1. Every 4xx and 5xx response body is JSON with exactly two top-level fields: `error` (string) and `message` (string).
2. The HTTP status code is set independently of the `error` code — both must be correct (e.g., `bad_request` with 400, `not_found` with 404, `unauthorized` with 401).
3. The `error` code value is short, snake_case, machine-stable, and may be matched on by the frontend (e.g., `email_taken`, `username_taken` drive specific form-field error rendering).
4. The `message` is human-readable and may change wording without notice; the frontend treats it as fallback display text, not a stable identifier.
5. Controllers must include `backend/src/ErrorResponse.h` and use `errorJson()` / `errorResponse()`; ad-hoc `Json::Value` construction for error bodies is forbidden by review.
6. Tests in `backend/tests/test_27_error_shape.py` exercise the shape across all known 4xx paths (`bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`) on representative controllers.
7. The `assert_error_shape(test_name, body, expected_code=None)` helper in `backend/tests/helpers.py` is used by error-path assertions in all backend integration tests touching error responses.

## Outputs

- A JSON body with `error` + `message` on every 4xx/5xx response.
- A predictable surface the frontend's `extractApiError()` in `frontend/src/utils/errors.ts` can rely on without per-endpoint fallback logic.
- Test failures (via `assert_error_shape`) when a controller drifts from the shape.

## Edge cases

- **5xx server errors**: same shape applies. `db_error` is the canonical code for unexpected DB failures.
- **JWT validation failure** (handled by `JwtFilter` before the controller runs): the filter still emits the canonical shape with `error: "unauthorized"`.
- **Rate-limit rejection** (handled by `RateLimitFilter`): emits the canonical shape with `error: "limit_exceeded"`.
- **Drogon framework errors before any filter runs** (e.g., malformed JSON body): Drogon's default error rendering may produce a non-canonical body. The current convention is to trap these at the controller layer where possible; truly framework-level errors are accepted as out-of-band (the frontend's fallback path covers them).
- **CORS preflight / OPTIONS responses**: no body; CORS headers only.
- **Empty `message`**: forbidden by review; the helper signature requires both arguments.

## Out of scope

- A separate `ERROR-CODES.md` documenting every code: the codes are visible in controller source and the frontend only branches on specific ones (`email_taken`, `username_taken`). Adding a doc creates another source of drift.
- Internationalisation of `message`: messages are English-only by current design.
- Trace IDs or structured error metadata beyond `error` + `message`: deferred until a concrete need (e.g., audit/observability follow-up).
- Replacing Drogon's default framework-level error responses: too invasive for the marginal benefit.

## Verification

- `backend/tests/test_27_error_shape.py` — walks through all known 4xx paths on representative controllers (auth, maps, cross-tenant, missing-map, duplicate-register, bogus-token). Asserts shape + expected code on each.
- `backend/tests/helpers.py::assert_error_shape` — used inline by other test files (`test_01_auth.py`, `test_03_maps.py`, `test_05_tenants.py`, etc.) at error-path assertion points.
- Manual: `curl -i -X POST http://localhost:8080/api/v1/maps -H 'Content-Type: application/json' -d '{}'` returns a 4xx with `{"error": "…", "message": "…"}`.

## Open questions

_None._
