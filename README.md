# Annotated Maps

A collaborative, mobile-friendly map annotation platform. Users can create maps, draw markers, lines, polygons, and attach rich notes and media — all with fine-grained per-user permissions including public (unauthenticated) access.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript, Vite, Leaflet + Leaflet.draw, Zustand, PWA |
| Backend | C++20, Drogon framework, JWT authentication |
| Database | MySQL 8 |
| Dev Environment | Docker Compose |

## Project Structure

```
annotated-maps/
├── frontend/          # React PWA
│   ├── src/
│   │   ├── components/  Map, Auth, Layout components
│   │   ├── hooks/       useAuth, useMap
│   │   ├── pages/       MapListPage, MapDetailPage
│   │   ├── services/    REST API clients
│   │   ├── store/       Zustand stores (auth, map)
│   │   └── types/       Shared TypeScript types
│   └── vite.config.ts
├── backend/           # C++ Drogon REST API
│   ├── src/
│   │   ├── controllers/ Auth, Map, Annotation controllers
│   │   ├── filters/     JwtFilter (Bearer token validation)
│   │   └── main.cpp
│   ├── CMakeLists.txt
│   └── config.json      ← copy and fill in secrets before running
├── database/
│   ├── migrations/      001–004 SQL migration scripts
│   └── run_migrations.py
└── docker-compose.yml
```

## Quick Start (Docker)

```bash
# 1. Clone and enter
git clone https://github.com/YOUR_USERNAME/annotated-maps.git
cd annotated-maps

# 2. Start all services
docker compose up --build

# 3. Open the app
open http://localhost:5173
```

> The MySQL container runs migrations automatically on first boot via
> `docker-entrypoint-initdb.d`.

## Local Development (without Docker)

### Prerequisites

- Node.js 24+
- CMake 3.20+, a C++20 compiler
- Drogon installed ([docs](https://github.com/drogonframework/drogon/wiki/ENG-02-Installation))
- jwt-cpp installed (`vcpkg install jwt-cpp` or from source)
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
cp config.json config.local.json
# Edit config.local.json with your values

cmake -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j$(nproc)
./build/annotated_maps config.local.json
```

### Database

```bash
cd database
DB_PASS=yourpassword python3 run_migrations.py
```

## Permission Model

Every map has a permission table. A row with `user_id = NULL` represents public
(unauthenticated) access.

| Scenario | Row |
|----------|-----|
| Publicly viewable map | `user_id=NULL, can_view=true, can_edit=false` |
| Collaborator with edit | `user_id=42, can_view=true, can_edit=true` |
| Read-only collaborator | `user_id=42, can_view=true, can_edit=false` |
| Map owner | No row needed — owner always has full access |

## API Reference

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/register` | Create account |
| POST | `/api/v1/auth/login` | Login, receive JWT |
| POST | `/api/v1/auth/refresh` | Refresh token (auth required) |
| POST | `/api/v1/auth/logout` | Logout (client drops token) |

### Maps

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/maps` | Optional | List accessible maps |
| POST | `/api/v1/maps` | Required | Create map |
| GET | `/api/v1/maps/:id` | Optional | Get map (respects permissions) |
| PUT | `/api/v1/maps/:id` | Required | Update map (owner only) |
| DELETE | `/api/v1/maps/:id` | Required | Delete map (owner only) |
| GET | `/api/v1/maps/:id/permissions` | Owner | List permissions |
| PUT | `/api/v1/maps/:id/permissions` | Owner | Set permission |
| DELETE | `/api/v1/maps/:id/permissions/:target` | Owner | Remove permission |

### Annotations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/maps/:mapId/annotations` | Optional | List annotations |
| POST | `/api/v1/maps/:mapId/annotations` | Required + edit perm | Create annotation |
| GET | `/api/v1/maps/:mapId/annotations/:id` | Optional | Get annotation |
| PUT | `/api/v1/maps/:mapId/annotations/:id` | Required | Update annotation |
| DELETE | `/api/v1/maps/:mapId/annotations/:id` | Required | Delete annotation |
| POST | `/api/v1/maps/:mapId/annotations/:id/media` | Required | Attach media |
| DELETE | `/api/v1/maps/:mapId/annotations/:id/media/:mediaId` | Required | Remove media |

## Security Notes

- **Change the JWT secret** in `config.json` before any deployment. Use a
  cryptographically random string of at least 32 bytes.
- Passwords are stored as SHA-256 hashes. For production, migrate to bcrypt or
  Argon2 (add `libsodium` or `bcrypt` as a dependency).
- The `config.json` file contains secrets. It is listed in `.gitignore` as a
  reminder — do not commit real credentials.

## PWA / Mobile

The frontend is a Progressive Web App. On mobile browsers, users can "Add to
Home Screen" to install it as a native-feeling app. Map tiles are cached via
Workbox for offline viewing of previously visited areas.

## License

MIT
