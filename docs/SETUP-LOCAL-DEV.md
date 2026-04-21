# Local Development Setup (Single Laptop)

Instructions for running the full Annotated Maps stack on a single macOS machine
for end-to-end testing. This setup simulates two organizations (Acme Corp and
Beta Inc), each with three tenants (Engineering, Sales/Marketing,
Support/Operations).

For production deployment, see `SETUP-PRODUCTION.md` (planned).

---

## Prerequisites

- **Docker Desktop for Mac** (includes Docker Compose)
- **curl** (pre-installed on macOS)

No other software is required. The Docker Compose stack provides MySQL, the C++
backend, and the Vite frontend dev server.

---

## 1. Start the stack

```bash
cd annotated-maps
docker compose up --build
```

Wait until the logs show `Annotated Maps backend starting on port 8080`.

Three containers are running:

| Service | Port | Purpose |
|---|---|---|
| `mysql` | 3306 | MySQL 8. Migrations in `database/migrations/` run automatically on first boot. |
| `backend` | 8080 | Drogon C++ REST API |
| `frontend` | 5173 | Vite dev server with hot module replacement |

---

## 2. Seed test data

Open a **new terminal tab** and run the seed script:

```bash
cd annotated-maps
python3 database/seed-local-dev.py
```

This does two things:
1. Registers five test users through the API (so passwords get real Argon2id
   hashes — these cannot be hardcoded in SQL).
2. Applies `seed-local-dev.sql` to create the orgs, tenants, and memberships,
   reassigning the users to the correct organizations.

The result:

| Organization | Tenant | User | Password | Tenant role |
|---|---|---|---|---|
| Acme Corp | Engineering | `alice@acme.test` | `password` | admin |
| Acme Corp | Engineering | `bob@acme.test` | `password` | editor |
| Acme Corp | Sales | `alice@acme.test` | (same) | viewer |
| Acme Corp | Sales | `carol@acme.test` | `password` | admin |
| Acme Corp | Support | `bob@acme.test` | (same) | admin |
| Beta Inc | Engineering | `dan@beta.test` | `password` | admin |
| Beta Inc | Marketing | `dan@beta.test` | (same) | editor |
| Beta Inc | Marketing | `eve@beta.test` | `password` | admin |
| Beta Inc | Operations | `eve@beta.test` | (same) | viewer |

---

## 3. Open the app

Visit **http://localhost:5173** and log in with any test user (e.g.,
`alice@acme.test` / `password`).

---

## 4. What to test

### Multi-tenant role differences

Log in as Alice. She is an admin in Acme Engineering (can create maps, manage
members) but only a viewer in Acme Sales (read-only). Switch tenants by changing
the tenant ID in the URL: `/tenants/{tenantId}/maps`.

To find tenant IDs:

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@acme.test","password":"password"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s http://localhost:8080/api/v1/tenants \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Cross-org isolation

1. Log in as `alice@acme.test` in one browser window.
2. Log in as `dan@beta.test` in an incognito window.
3. Copy a tenant URL from Alice's session and paste it into Dan's window.
   Dan should get a 403 — he is not a member of any Acme tenant.

### Branding

The seed applies sample branding to Acme Engineering (red) and Beta Engineering
(green). Log in as Alice vs. Dan and confirm different colors and page titles.

Update branding:

```bash
curl -X PUT http://localhost:8080/api/v1/tenants/101/branding \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"display_name":"Acme Maps","primary_color":"#7c3aed","accent_color":"#6d28d9"}'
```

Refresh the browser to see the change.

### Audit log

After performing some actions, inspect the audit trail:

```bash
docker compose exec mysql mysql -uroot -prootpassword annotated_maps \
  -e "SELECT id, event_type, user_id, target_user_id, ip_address, \
      LEFT(detail, 60) AS detail, created_at \
      FROM audit_log ORDER BY id DESC LIMIT 15;"
```

### Rate limiting

Hit the login endpoint rapidly to trigger the rate limiter (dev default: 100
requests per 60 seconds):

```bash
for i in $(seq 1 12); do
  echo -n "Request $i: "
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8080/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"alice@acme.test","password":"wrong"}'
  echo
done
```

Requests 11 and 12 should return `429`.

### User deactivation

Deactivate a user and confirm immediate lockout:

```bash
# Deactivate Bob
docker compose exec mysql mysql -uroot -prootpassword annotated_maps \
  -e "UPDATE users SET status = 'deactivated' WHERE email = 'bob@acme.test';"

# Bob's next API call (with a still-valid JWT) should return 401
curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"bob@acme.test","password":"password"}'
# Even if Bob had a cached JWT, any authenticated endpoint would reject it.

# Re-activate
docker compose exec mysql mysql -uroot -prootpassword annotated_maps \
  -e "UPDATE users SET status = 'active' WHERE email = 'bob@acme.test';"
```

---

## 5. Running frontend checks locally

Before opening a PR, run the same checks CI runs so you don't eat a slow
round-trip. These run in the local npm install, not in Docker:

```bash
cd frontend

# TypeScript type check (no output on success)
npx tsc --noEmit

# ESLint (fails on any warning — max-warnings 0)
npm run lint

# npm audit (PR CI fails only on critical; lower severities are noted in #31)
npm audit --audit-level=critical
```

The ESLint config lives at [`frontend/.eslintrc.cjs`](../frontend/.eslintrc.cjs).
If you need to disable a rule on a specific line, use
`// eslint-disable-next-line <rule-name>` with a comment explaining why.

## 6. Day-to-day development

```bash
# Rebuild after code changes
docker compose up --build

# Stop the stack
docker compose down

# Wipe everything and start fresh (deletes all data)
docker compose down -v
docker compose up --build
# Then re-run: python3 database/seed-local-dev.py

# View backend logs only
docker compose logs -f backend

# Open a MySQL shell
docker compose exec mysql mysql -uroot -prootpassword annotated_maps
```

---

## 7. Resource usage

| Resource | Approximate usage |
|---|---|
| RAM | ~500 MB (MySQL ~200, backend ~50, Vite/Node ~250) |
| Disk | ~1.5 GB (Docker images + MySQL data volume) |
| Ports | 3306, 8080, 5173 on localhost |

If a port is in use, either stop the conflicting process or edit the port
mapping in `docker-compose.yml`.

---

## Troubleshooting

**Backend fails to connect to MySQL**
MySQL takes 10-20 seconds to initialize on first boot. The Docker healthcheck
handles this. If it persists: `docker compose down -v && docker compose up --build`.

**Seed script says "connection refused"**
The backend must be running before you run the seed script. Wait for the
`starting on port 8080` log line.

**"No active tenant" in the browser**
Clear localStorage (`localStorage.clear()` in the browser console) and log in
again. This happens if a previous session's tenant ID no longer exists after a
database wipe.

**Seed script shows "HTTP 429"**
You hit the rate limiter by running the seed script too many times in a row.
Wait 60 seconds or restart the backend (`docker compose restart backend`).

**Backend logs `FATAL: JWT secret is a placeholder`**
`docker-compose.yml` sets `ALLOW_PLACEHOLDER_SECRETS=1` in the backend
service's environment specifically to allow local dev with the
`CHANGE_ME...` placeholder in `config.docker.json`. If you removed that
env var, either add it back or set a real `JWT_SECRET` (min 32 chars).
**Do not set `ALLOW_PLACEHOLDER_SECRETS` in any production
deployment** — it's a safety gate specifically to prevent silent
placeholder deployments.

**SSO flow returns "SSO is not available" in callback**
The backend reads SSO client secrets from the environment, not the
database. Set `SSO_CLIENT_SECRET_<ORG_ID>=...` in a
`docker-compose.override.yml` (gitignored) for your test IdP. See
`docs/DEVELOPER-GUIDE.md` → "SSO client_secret storage".

**Login/registration feels fast — is Argon2id OK?**
By default the backend uses `ARGON2_OPSLIMIT_MIN` / `ARGON2_MEMLIMIT_MIN`
(1 iteration, 8 MiB), which is dev-safe but weak for production.
See `docs/DEVELOPER-GUIDE.md` → "Argon2id cost parameters" for the
production settings.
