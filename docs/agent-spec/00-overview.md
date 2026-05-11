# System overview

Read at the start of any agent session that touches this repo. The narrative companion at [docs/REQUIREMENTS.md](../REQUIREMENTS.md) goes deeper on capabilities; this doc is the **orientation layer** — what the system is, how the code is laid out, and the mental model an agent needs to make sense of any specific spec.

## What this is

**Annotated Maps** is a multi-tenant collaborative map annotation platform. Users create maps, mark places as a tree of *nodes*, attach *notes* and media to those nodes, draw *edges* between nodes, group nodes into narrative *plots* that can span multiple maps, and tag content with *visibility groups* that gate who can see what.

The platform supports both standalone personal use (each user gets a "personal" tenant) and organizational deployments with departmental SSO.

## Top-level architecture

```
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│  React + Vite    │  HTTPS  │   Drogon C++     │   SQL   │     MySQL        │
│  + react-leaflet │ ──────► │   (REST API)     │ ──────► │   (with FTS)     │
│  + Zod + zustand │  + JWT  │   + JwtFilter    │         │                  │
└──────────────────┘         │   + TenantFilter │         └──────────────────┘
                             │   + RateLimit    │
                             └──────────────────┘
```

- **Backend**: Drogon C++ HTTP framework, JWT-authenticated REST API, MySQL persistence, recursive CTEs for tree + visibility resolution.
- **Frontend**: React + Vite + react-leaflet for the map UI, Zod at the API boundary for typed parsing, zustand stores for client state.
- **Tests**: backend integration tests (Python via `backend/tests/run-tests.py`), frontend E2E via Playwright (`frontend/tests/e2e/`), CI matrix at `pr-tests.yml` / `nightly.yml` / `weekend.yml`.

## Repo layout

| Path | What lives here |
|---|---|
| `backend/src/controllers/` | Drogon controllers (one per resource: `MapController`, `NodeController`, `EdgeController`, `NoteController`, `PlotController`, `TenantController`, `AuthController`, `VisibilityGroupController`, `MediaController`, …) |
| `backend/src/filters/` | `JwtFilter`, `TenantFilter`, `RateLimitFilter` — request-time auth/scope/limit checks |
| `backend/src/models/` | Drogon ORM models matching the schema |
| `backend/tests/` | Integration tests in Python; `run-tests.py` is the orchestrator; tests numbered `test_NN_<area>.py` |
| `database/migrations/` | SQL migrations: `001_schema.sql`, `002_<…>.sql`, `003_edges.sql`, … |
| `frontend/src/components/` | React components grouped by area: `Map/`, `Tree/`, `Detail/`, `Auth/`, `Modal/` |
| `frontend/src/services/` | API service layer — one file per resource; Zod parsing happens here |
| `frontend/src/api/schemas.ts` | Zod schemas for API responses (the typed boundary) |
| `frontend/src/store/` | zustand stores (`authStore`, `mapsStore`, etc.) |
| `frontend/src/hooks/` | Custom hooks (`useMap`, `useAuth`, etc.) |
| `frontend/tests/e2e/` | Playwright specs; helpers at `helpers.ts` |
| `docs/` | Conventions, requirements, security audits, setup guides |
| `docs/agent-spec/` | This directory — machine-greppable specs (you are here) |
| `.github/workflows/` | CI definitions: `pr-tests.yml` (every PR), `nightly.yml`, `weekend.yml` (heavier soak) |

## Mental model — the domain primitives

The relationships between core entities, in dependency order:

1. **`users`** — accounts. Auth via password (bcrypt) or SSO.
2. **`tenants`** — organizations (or "personal" tenants, one per user). Every other entity is scoped to a tenant.
3. **`tenant_memberships`** — `(user, tenant, role)` where role ∈ `viewer | editor | admin`. Drives write authorization.
4. **`maps`** — owned by a user, scoped to a tenant. Each has a `coordinate_system` discriminated on `type` ∈ `wgs84 | pixel | blank`.
5. **`map_permissions`** — per-map sharing, separate from tenant role. `(map, user_or_null, level)` where `user_id IS NULL` means "public" and `level` ∈ `view | comment | edit | moderate | admin`. The owner has implicit admin.
6. **`nodes`** — places on a map. Tree structure via `parent_id`. Optional GeoJSON geometry interpreted per the map's coord system. Cycles rejected on move; depth capped (16).
7. **`node_edges`** — connections between two nodes on the same map. Directed flag; visibility derived from endpoint visibility (see NF-permissions-and-visibility once written).
8. **`notes`** — attached to nodes. Title + rich text + pinned flag + per-note color. Searchable via FTS.
9. **`note_media`** — uploaded files attached to notes.
10. **`plots`** — narrative groupings that can span multiple maps. `plot_nodes` is the membership table.
11. **`visibility_groups`** + **`node_visibility_tags`** — tagging system gating who can see which nodes. Recursive CTE resolves effective visibility through the tree.
12. **`audit_log`** — append-only log of sensitive writes.

The most complex semantic in the system is **visibility**:

- Nodes can be tagged with one or more visibility groups.
- A node inherits visibility from its parent unless `visibility_override = TRUE`.
- A recursive CTE (`VISIBILITY_RESOLVE_CTE`) walks the tree to compute the effective set of visibility groups for each node.
- A request can see a node iff: the caller is the map owner with owner-xray enabled, OR the caller is in at least one of the node's effective visibility groups, OR the node has no effective visibility tags (untagged is admin-only by current convention).
- Edges are visible iff **both** endpoints are visible — there are no per-edge tags.

When this is captured as a spec, it will be `NF-permissions-and-visibility` (forthcoming).

## Coordinate systems

The map's `coordinate_system` is a tagged union. Three renderers:

- **`wgs84`** — real-world geo coords. Leaflet tile layer. `center {lat, lng}` + `zoom`.
- **`pixel`** — an uploaded image as the map plane. `image_url`, `width`, `height`, `viewport {x, y, zoom}`. Node geometry is in pixel coords.
- **`blank`** — an unbounded blank canvas. `extent {x, y}`. Node geometry is in canvas units.

The coord system is **fixed at map creation**. The renderer is dispatched at view time from `coordinate_system.type`. See `frontend/src/components/Map/` for the per-renderer code.

## Where to look for…

- **The endpoint that handles X** — `backend/src/controllers/<X>Controller.cpp` is exhaustive.
- **The Zod schema for an API response** — `frontend/src/api/schemas.ts`.
- **The visibility-resolution SQL** — search for `VISIBILITY_RESOLVE_CTE` (it's a shared constant across controllers).
- **Test fixtures** — `backend/tests/helpers.py` (registration, map creation, etc.); `frontend/tests/e2e/helpers.ts` (browser-side equivalents).
- **CI behaviour** — `.github/workflows/pr-tests.yml` is what every PR runs against.

## What's NOT in scope of this overview

- The reasoning behind specific architectural decisions — see `decisions/` for ADRs.
- Detailed per-feature behaviour — see the relevant `F-NNN` or `NF-NNN` spec.
- Conventions for how PRs / tickets / branches work — see [docs/AI-COLLABORATION-CONVENTIONS.md](../AI-COLLABORATION-CONVENTIONS.md).
- The deployment / hosting story — currently local-dev only; Wave 7 (#235-#248) addresses public hosting.
