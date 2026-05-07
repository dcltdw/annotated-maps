# Annotated Maps

A multi-tenant, collaborative map annotation platform. Users create
maps, mark places as a tree of *nodes*, attach *notes* and media,
group nodes and notes into narrative *plots* across maps, and control
who sees what via *visibility groups* and per-map permissions.
Supports organizational deployments with departmental SSO.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript, Vite, Leaflet, Zustand, Zod, PWA |
| Backend | C++20, Drogon framework (v1.9.3), jwt-cpp (v0.7.0), libsodium (Argon2id) |
| Database | MySQL 8 (MariaDB connector for async I/O) |
| Dev Environment | Docker Compose (Ubuntu 22.04 containers) |
| Backend tests | Python 3 (stdlib only) |
| E2E tests | Playwright (Chromium) |

## Project Structure

```
annotated-maps/
├── frontend/              # React PWA
│   ├── src/
│   │   ├── api/           Zod schemas + axios client
│   │   ├── components/    Map, Tree, Detail, Visibility, Auth, Layout
│   │   ├── hooks/
│   │   ├── pages/         MapListPage, MapDetailPage, PlotsPage,
│   │   │                  VisibilityGroupsPage, TenantAdminPage,
│   │   │                  TenantMembersPage, SsoCallbackPage
│   │   ├── services/      REST API clients (auth, maps + nested resources)
│   │   ├── store/         Zustand stores (auth, map)
│   │   ├── types/         Hand-written types not yet covered by Zod
│   │   └── utils/         errors.ts and other shared helpers
│   ├── tests/e2e/         Playwright specs
│   └── Dockerfile.dev
├── backend/               # C++ Drogon REST API
│   ├── src/
│   │   ├── controllers/   Auth, Map, Node, NodeMedia, Note, NoteMedia,
│   │   │                  Plot, Tenant, VisibilityGroup, SSO
│   │   ├── filters/       JwtFilter, TenantFilter, RateLimitFilter
│   │   ├── AuditLog.cpp   Fire-and-forget security event logging
│   │   ├── ErrorResponse.h
│   │   └── main.cpp
│   ├── tests/             Backend integration tests (Python)
│   ├── CMakeLists.txt
│   ├── Dockerfile
│   └── config.json
├── database/
│   ├── migrations/        001 (consolidated schema) + 002 (audit log)
│   ├── tests/             Schema tests (SQL + Python runner)
│   ├── run_migrations.py
│   └── seed-local-dev.py
├── docs/                  Requirements, security audit, setup, test docs
├── .github/workflows/     PR gate, nightly + weekend CI
└── docker-compose.yml
```

## Quick Start (Docker)

```bash
git clone https://github.com/dcltdw/annotated-maps.git
cd annotated-maps
docker compose up --build
open http://localhost:5173
```

> The MySQL container runs migrations automatically on first boot via
> `docker-entrypoint-initdb.d`.

For detailed setup including test data seeding, see
[docs/SETUP-LOCAL-DEV.md](docs/SETUP-LOCAL-DEV.md).

## Local Development (without Docker)

### Prerequisites

- Node.js 24+
- CMake 3.20+, a C++20 compiler
- Drogon installed ([docs](https://github.com/drogonframework/drogon/wiki/ENG-02-Installation))
- jwt-cpp installed (`vcpkg install jwt-cpp` or from source)
- libsodium installed (`brew install libsodium` or from source)
- MySQL 8 running locally

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

### Backend

```bash
cd backend
cp config.json config.local.json
# edit config.local.json: DB credentials and a strong JWT secret under
# the "custom_config" key

cmake -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j$(nproc)
./build/annotated_maps config.local.json
```

### Database

```bash
cd database
DB_PASS=yourpassword python3 run_migrations.py
```

## Domain Concepts

- **Map** — a coordinate plane (real-world WGS84, an uploaded image, or
  a blank canvas) that holds a tree of nodes.
- **Node** — a place marker on a map. Nodes form a tree per-map; each
  node may carry GeoJSON geometry (Point / LineString / Polygon).
- **Note** — a text entry attached to a node; inherits position from
  its parent node.
- **Media** — image or link attachments on nodes or notes.
- **Plot** — a tenant-scoped narrative grouping that can contain nodes
  and notes from multiple maps.
- **Visibility group** — a tenant-scoped subset of users; nodes/notes
  tagged with a group are visible only to members of that group, with
  inherit-from-parent semantics.

## Multi-tenancy

- An **organization** is the top-level identity unit (one company =
  one org).
- Each organization has one or more **tenants** (departments, teams,
  projects).
- All maps, nodes, notes, plots, and visibility groups are scoped to a
  tenant.
- A user may belong to multiple tenants with independent roles
  (`admin`, `editor`, `viewer`).
- Cross-organization data access is not permitted.
- New users get a personal organization and tenant automatically on
  registration.

## Permission Model

Two layers stack:

1. **Tenant role** — base level (`admin` / `editor` / `viewer`)
   granting access to all maps in the tenant.
2. **Per-map permissions** — fine-grained overrides. Levels:
   `none < view < comment < edit < moderate < admin`. A row with
   `user_id = NULL` represents public (unauthenticated) access. Map
   owners always have full access without a row.

A third layer — **visibility groups** — filters which nodes and notes
are visible to which users *within* a map they have access to.

## API Reference

All routes are mounted under `/api/v1`. Tenant-scoped routes pass
`{tenantId}` in the URL path and run through `JwtFilter` +
`TenantFilter`.

### Auth

| Method | Path | Auth |
|--------|------|------|
| POST | `/auth/register` | None (rate limited) |
| POST | `/auth/login` | None (rate limited) |
| POST | `/auth/refresh` | JWT |
| POST | `/auth/logout` | JWT |
| GET | `/auth/sso/{orgSlug}` | None (rate limited) |
| GET | `/auth/sso/{orgSlug}/callback` | None (rate limited) |
| POST | `/auth/sso/exchange` | None (rate limited) |

### Tenants

| Method | Path |
|--------|------|
| GET | `/tenants` |
| GET / PUT | `/tenants/{tenantId}/branding` |
| GET / POST | `/tenants/{tenantId}/members` |
| DELETE | `/tenants/{tenantId}/members/{userId}` |

### Maps

| Method | Path |
|--------|------|
| GET / POST | `/tenants/{tenantId}/maps` |
| GET / PUT / DELETE | `/tenants/{tenantId}/maps/{id}` |
| GET / PUT | `/tenants/{tenantId}/maps/{id}/permissions` |
| DELETE | `/tenants/{tenantId}/maps/{id}/permissions/{target}` |

### Nodes

| Method | Path |
|--------|------|
| GET / POST | `/tenants/{tenantId}/maps/{mapId}/nodes` |
| GET / PUT / DELETE | `/tenants/{tenantId}/maps/{mapId}/nodes/{id}` |
| GET | `/tenants/{tenantId}/maps/{mapId}/nodes/{id}/children` |
| GET | `/tenants/{tenantId}/maps/{mapId}/nodes/{id}/subtree` |
| POST | `/tenants/{tenantId}/maps/{mapId}/nodes/{id}/move` |
| POST | `/tenants/{tenantId}/maps/{mapId}/nodes/{id}/copy` |
| GET / PUT | `/tenants/{tenantId}/maps/{mapId}/nodes/{id}/visibility` |

### Notes

| Method | Path |
|--------|------|
| GET / POST | `/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/notes` |
| GET / PUT / DELETE | `/tenants/{tenantId}/maps/{mapId}/notes/{id}` |
| GET / PUT | `/tenants/{tenantId}/maps/{mapId}/notes/{id}/visibility` |

### Media

| Method | Path |
|--------|------|
| GET / POST | `/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/media` |
| PUT / DELETE | `/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/media/{id}` |
| GET / POST | `/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/media` |
| PUT / DELETE | `/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/media/{id}` |

### Plots

| Method | Path |
|--------|------|
| GET / POST | `/tenants/{tenantId}/plots` |
| GET / PUT / DELETE | `/tenants/{tenantId}/plots/{id}` |
| GET | `/tenants/{tenantId}/plots/{id}/members` |
| POST | `/tenants/{tenantId}/plots/{id}/nodes` |
| DELETE | `/tenants/{tenantId}/plots/{id}/nodes/{nodeId}` |
| POST | `/tenants/{tenantId}/plots/{id}/notes` |
| DELETE | `/tenants/{tenantId}/plots/{id}/notes/{noteId}` |
| GET | `/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/plots` |
| GET | `/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/plots` |

### Visibility Groups

| Method | Path |
|--------|------|
| GET / POST | `/tenants/{tenantId}/visibility-groups` |
| GET / PUT / DELETE | `/tenants/{tenantId}/visibility-groups/{id}` |
| GET / POST | `/tenants/{tenantId}/visibility-groups/{id}/members` |
| DELETE | `/tenants/{tenantId}/visibility-groups/{id}/members/{userId}` |

See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for the full route
table including descriptions and authorization requirements.

## Security

- Passwords hashed with **Argon2id** via libsodium. Legacy SHA-256
  hashes are rejected at login.
- JWT includes `sub`, `username`, `orgId`, and `aud` (audience)
  claims. Validated per-request including a `status` DB check (must
  be `active`).
- CORS uses an origin whitelist (not echo). Security headers
  (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) on
  all responses.
- Rate limiting on auth endpoints (configurable, default 100 req/60s
  for dev, recommend 5 req/300s for production).
- JWT secret overridable via `JWT_SECRET` environment variable.
- See [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md) for the full
  audit report.

## Testing

```bash
# Database schema tests
python3 database/tests/run-db-tests.py

# Backend integration tests (fast tier, ~60s)
python3 backend/tests/run-tests.py
python3 backend/tests/run-tests.py --only 14   # single test

# Frontend E2E (Playwright)
cd frontend && npm run test:e2e
```

See [docs/TESTING-BACKEND.md](docs/TESTING-BACKEND.md),
[docs/TESTING-E2E.md](docs/TESTING-E2E.md), and
[docs/TESTING-DATABASE.md](docs/TESTING-DATABASE.md) for details.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Full requirements specification |
| [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md) | Backend + frontend conventions |
| [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md) | Security audit with open findings |
| [docs/SECURITY-AUDIT-NODES-REBUILD.md](docs/SECURITY-AUDIT-NODES-REBUILD.md) | Post-nodes-rebuild audit findings (#46) |
| [docs/SETUP-LOCAL-DEV.md](docs/SETUP-LOCAL-DEV.md) | Local development setup with test data |
| [docs/TESTING-BACKEND.md](docs/TESTING-BACKEND.md) | Backend test tiers and usage |
| [docs/TESTING-E2E.md](docs/TESTING-E2E.md) | Playwright E2E suite |
| [docs/TESTING-DATABASE.md](docs/TESTING-DATABASE.md) | Database test framework |
| `docs/flow-*.md` | Mermaid sequence diagrams for key flows |
| `docs/howto-*.md` | Step-by-step guides for common tasks |

## PWA / Mobile

The frontend is a Progressive Web App. On mobile browsers, users can
"Add to Home Screen" to install it as a native-feeling app. Map tiles
are cached via Workbox for offline viewing of previously visited
areas.

## License

MIT
