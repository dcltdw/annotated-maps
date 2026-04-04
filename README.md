# Annotated Maps

A multi-tenant, collaborative map annotation platform. Users create maps, draw markers, lines, and polygons, attach notes and media, and manage access with fine-grained per-user permissions. Supports organizational deployments with departmental SSO.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript, Vite, Leaflet + Leaflet.draw, Zustand, PWA |
| Backend | C++20, Drogon framework (v1.9.3), jwt-cpp (v0.7.0), libsodium (Argon2id) |
| Database | MySQL 8 (MariaDB connector for async I/O) |
| Dev Environment | Docker Compose (Ubuntu 22.04 containers) |
| Testing | Python 3 (stdlib only) |

## Project Structure

```
annotated-maps/
├── frontend/              # React PWA
│   ├── src/
│   │   ├── components/    Map, Auth, Layout components
│   │   ├── hooks/         useAuth, useMap, useBranding
│   │   ├── pages/         MapListPage, MapDetailPage, SsoCallbackPage
│   │   ├── services/      REST API clients
│   │   ├── store/         Zustand stores (auth, map)
│   │   └── types/         Shared TypeScript types
│   └── Dockerfile.dev
├── backend/               # C++ Drogon REST API
│   ├── src/
│   │   ├── controllers/   Auth, Map, Annotation, Note, Tenant, SSO
│   │   ├── filters/       JwtFilter, TenantFilter, RateLimitFilter
│   │   ├── AuditLog.cpp   Fire-and-forget security event logging
│   │   └── main.cpp
│   ├── tests/             Backend integration tests (Python)
│   ├── CMakeLists.txt
│   ├── Dockerfile
│   └── config.json
├── database/
│   ├── migrations/        001–007 SQL migration scripts
│   ├── tests/             Database schema tests (SQL + Python runner)
│   ├── run_migrations.py
│   └── seed-local-dev.py
├── docs/                  Requirements, security audit, setup guides, test docs
├── .github/workflows/     PR gate, nightly + weekend CI (GitHub Actions)
└── docker-compose.yml
```

## Quick Start (Docker)

```bash
# 1. Clone and enter
git clone https://github.com/dcltdw/annotated-maps.git
cd annotated-maps

# 2. Start all services
docker compose up --build

# 3. Open the app
open http://localhost:5173
```

> The MySQL container runs migrations automatically on first boot via
> `docker-entrypoint-initdb.d`.

For detailed setup including test data seeding, see `docs/SETUP-LOCAL-DEV.md`.

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
# Edit config.json — set DB credentials and a strong JWT secret
# Custom settings go under the "custom_config" key
cp config.json config.local.json

cmake -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j$(nproc)
./build/annotated_maps config.local.json
```

### Database

```bash
cd database
DB_PASS=yourpassword python3 run_migrations.py
```

## Multi-tenancy

- An **organization** is the top-level identity unit (one company = one org).
- Each organization has one or more **tenants** (departments, teams, projects).
- All maps, annotations, and notes are scoped to a tenant.
- A user may belong to multiple tenants with independent roles (`admin`, `editor`, `viewer`).
- Cross-organization data access is not permitted.
- New users get a personal organization and tenant automatically on registration.

## Permission Model

Every map has a permission table. A row with `user_id = NULL` represents public
(unauthenticated) access.

| Scenario | Row |
|----------|-----|
| Publicly viewable map | `user_id=NULL, level='view'` |
| Collaborator with edit | `user_id=42, level='edit'` |
| Read-only collaborator | `user_id=42, level='view'` |
| Map owner | No row needed — owner always has full access |

## API Reference

All map, annotation, and note endpoints are tenant-scoped under `/api/v1/tenants/{tenantId}/`.

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/register` | None (rate limited) | Create account + personal org/tenant |
| POST | `/api/v1/auth/login` | None (rate limited) | Login, receive JWT + tenant list |
| POST | `/api/v1/auth/refresh` | JWT | Refresh token |
| POST | `/api/v1/auth/logout` | JWT | Logout (client drops token) |
| GET | `/api/v1/auth/sso/{orgSlug}` | None (rate limited) | Initiate OIDC SSO flow |
| GET | `/api/v1/auth/sso/{orgSlug}/callback` | None (rate limited) | OIDC callback |

### Tenants

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/tenants` | JWT | List caller's tenants |
| GET | `.../tenants/{tenantId}/branding` | JWT + Tenant | Get branding |
| PUT | `.../tenants/{tenantId}/branding` | JWT + Tenant(admin) | Update branding |
| GET | `.../tenants/{tenantId}/members` | JWT + Tenant(admin) | List members |
| POST | `.../tenants/{tenantId}/members` | JWT + Tenant(admin) | Add member |
| DELETE | `.../tenants/{tenantId}/members/{userId}` | JWT + Tenant(admin) | Remove member |

### Maps

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `.../tenants/{tenantId}/maps` | JWT + Tenant | List maps |
| POST | `.../tenants/{tenantId}/maps` | JWT + Tenant | Create map |
| GET | `.../tenants/{tenantId}/maps/{id}` | JWT + Tenant | Get map |
| PUT | `.../tenants/{tenantId}/maps/{id}` | JWT + Tenant | Update map (owner) |
| DELETE | `.../tenants/{tenantId}/maps/{id}` | JWT + Tenant | Delete map (owner) |
| GET | `.../maps/{id}/permissions` | JWT + Tenant | List permissions (owner) |
| PUT | `.../maps/{id}/permissions` | JWT + Tenant | Set permission (owner) |
| DELETE | `.../maps/{id}/permissions/{target}` | JWT + Tenant | Remove permission (owner) |

### Annotations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `.../maps/{mapId}/annotations` | JWT + Tenant | List annotations |
| POST | `.../maps/{mapId}/annotations` | JWT + Tenant | Create (edit perm) |
| GET | `.../maps/{mapId}/annotations/{id}` | JWT + Tenant | Get annotation |
| PUT | `.../maps/{mapId}/annotations/{id}` | JWT + Tenant | Update |
| DELETE | `.../maps/{mapId}/annotations/{id}` | JWT + Tenant | Delete |
| POST | `.../maps/{mapId}/annotations/{id}/media` | JWT + Tenant | Attach media |
| DELETE | `.../maps/{mapId}/annotations/{id}/media/{mId}` | JWT + Tenant | Remove media |

### Notes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `.../maps/{mapId}/notes` | JWT + Tenant | List notes |
| POST | `.../maps/{mapId}/notes` | JWT + Tenant | Create note |
| GET | `.../maps/{mapId}/notes/{id}` | JWT + Tenant | Get note |
| PUT | `.../maps/{mapId}/notes/{id}` | JWT + Tenant | Update note |
| DELETE | `.../maps/{mapId}/notes/{id}` | JWT + Tenant | Delete note |

### Note Groups

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `.../maps/{mapId}/note-groups` | JWT + Tenant | List groups |
| POST | `.../maps/{mapId}/note-groups` | JWT + Tenant(admin) | Create group |
| PUT | `.../maps/{mapId}/note-groups/{id}` | JWT + Tenant(admin) | Update group |
| DELETE | `.../maps/{mapId}/note-groups/{id}` | JWT + Tenant(admin) | Delete group |

## Security

- Passwords hashed with **Argon2id** via libsodium. Legacy SHA-256 hashes are rejected at login.
- JWT includes `sub`, `username`, `orgId`, and `aud` (audience) claims. Validated per-request including `status` DB check (must be `active`).
- CORS uses an origin whitelist (not echo). Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) on all responses.
- Rate limiting on auth endpoints (configurable, default: 100 req/60s for dev, recommend 5 req/300s for production).
- JWT secret overridable via `JWT_SECRET` environment variable.
- See `docs/SECURITY-AUDIT.md` for the full audit report.

## Testing

```bash
# Database schema tests
python3 database/tests/run-db-tests.py

# Backend integration tests (fast tier, ~60s)
python3 backend/tests/run-tests.py

# Run a single test suite
python3 backend/tests/run-tests.py --only 1

# Notes-specific tests
python3 backend/tests/run-notes-tests.py
```

See `docs/TESTING-BACKEND.md` and `docs/TESTING-DATABASE.md` for details.

## Documentation

| Document | Description |
|----------|-------------|
| `docs/REQUIREMENTS.md` | Full requirements specification |
| `docs/SECURITY-AUDIT.md` | Security audit with open findings |
| `docs/SETUP-LOCAL-DEV.md` | Local development setup with test data |
| `docs/TESTING-BACKEND.md` | Backend test tiers and usage |
| `docs/TESTING-DATABASE.md` | Database test framework |
| `docs/TESTING-NOTES.md` | Notes feature test guide |
| `docs/flow-*.md` | Mermaid sequence diagrams for key flows |

## PWA / Mobile

The frontend is a Progressive Web App. On mobile browsers, users can "Add to
Home Screen" to install it as a native-feeling app. Map tiles are cached via
Workbox for offline viewing of previously visited areas.

## License

MIT
