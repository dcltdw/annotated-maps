# Notes Tests (Phase 1)

Tests for the notes feature: database schema validation and backend API integration tests.

## Prerequisites

- Docker Compose stack running (`docker compose up`)
- Backend rebuilt with NoteController (`docker compose build --no-cache backend`)
- Database is initialized from the consolidated schema in `database/migrations/001_schema.sql` (`docker compose down -v && docker compose up` to re-initialize)

## Running all notes tests

```bash
python3 backend/tests/run-notes-tests.py
```

This runs both layers in sequence:

1. **Database tests** — creates a temporary database, applies all migrations, runs `test_09_notes.sql`, then drops the database. Verifies:
   - `notes` table exists with correct columns
   - Default values (`pinned = FALSE`, `group_id = NULL`, `title` nullable)
   - Foreign key enforcement (invalid `map_id` and `created_by` rejected)
   - Cascade behavior (deleting a map cascades to its notes)
   - Restrict behavior (deleting a user with notes is blocked)
   - Fulltext search index works

2. **Backend integration tests** — restarts the backend (clears rate limiter), then runs `test_11_notes.py`. Verifies:
   - Note CRUD (create with/without title, with custom color, list, get, update, delete)
   - Note move (update lat/lng)
   - Note color update
   - `createdByUsername` in create response
   - Input validation (missing `text`, missing `lat`/`lng`)
   - Cross-org isolation (user from another org cannot list, create, read, update, or delete notes)
   - Permission model (note creator can edit/delete their own notes)

## Running tests individually

```bash
# Database tests only
python3 database/tests/run-db-tests.py   # runs all DB tests including test_09

# Backend integration tests only
python3 backend/tests/run-tests.py --only 11

# Or run the notes test file directly
python3 backend/tests/test_11_notes.py
```

## Test files

| File | Layer | What it tests |
|---|---|---|
| `database/tests/test_09_notes.sql` | Database | Schema, constraints, cascades, fulltext search |
| `backend/tests/test_11_notes.py` | Backend | CRUD API, validation, cross-org isolation |
| `backend/tests/run-notes-tests.py` | Runner | Runs both of the above in sequence |

## First-time setup

If you haven't run the notes migration yet:

```bash
# Rebuild everything from scratch
docker compose down -v
docker compose build --no-cache backend
docker compose up -d
sleep 15

# Run the notes tests
python3 backend/tests/run-notes-tests.py
```

## Troubleshooting

**"Backend is not reachable"**
Run `docker compose up` and wait for `starting on port 8080` in the logs.

**Database test fails on schema setup**
The `notes` table has FK dependencies on `maps`, `users`, and `note_groups`. All are declared in the consolidated `001_schema.sql`; if tests fail on setup, check that MySQL is fully initialized (`docker compose exec mysql mysqladmin ping ...`).

**Backend test returns 404 on notes endpoints**
The backend binary doesn't include `NoteController`. Rebuild: `docker compose build --no-cache backend && docker compose up -d`.

**"Note limit reached for this map" (400)**
The backend enforces a 10,000 note per map limit. This shouldn't trigger in tests (they create ~3 notes).
