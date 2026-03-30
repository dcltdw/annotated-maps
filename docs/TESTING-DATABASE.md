# Database Unit Tests

SQL-based tests that verify schema integrity, constraints, cascading behavior,
defaults, and migration idempotency. Tests run against a disposable MySQL
database that is created and dropped automatically.

## Running the tests

With the Docker Compose stack running:

```bash
./database/tests/run-db-tests.sh
```

The script will:
1. Create a temporary database (`annotated_maps_test_<pid>`).
2. Apply all migrations (001-009).
3. Run each `test_*.sql` file and report PASS/FAIL per assertion.
4. Drop the temporary database.

Exit code 0 means all tests passed.

## Test files

| File | What it tests |
|---|---|
| `test_01_schema_exists.sql` | All 10 tables exist after migrations |
| `test_02_columns.sql` | Key columns have correct types and nullability |
| `test_03_unique_constraints.sql` | Duplicate inserts rejected by unique keys |
| `test_04_cascade_behavior.sql` | ON DELETE CASCADE and ON DELETE SET NULL |
| `test_05_foreign_keys.sql` | Invalid FK references rejected |
| `test_06_defaults.sql` | Column defaults (`is_active`, `role`, `branding`, etc.) |
| `test_07_backfill_idempotent.sql` | Migration 006 backfill can run twice safely |
| `test_08_enum_constraints.sql` | ENUM columns reject invalid values |

## Writing new tests

1. Create a new file in `database/tests/` named `test_NN_description.sql`.
2. Start with `SOURCE helpers.sql;` to get the assertion procedures.
3. Use `CALL assert_equals(name, expected, actual)` or `CALL assert_true(name, condition)`.
4. Output lines starting with `PASS:` or `FAIL:` are counted by the runner.
5. Each test file runs in the same database (shared state), so use unique IDs
   (e.g., `id = 70+` for test 09) to avoid collisions.

## Assertions available

| Procedure | Parameters | Description |
|---|---|---|
| `assert_equals` | `(name, expected, actual)` | Passes if `expected = actual` (or both NULL) |
| `assert_true` | `(name, condition)` | Passes if `condition` is true (1) |
| `assert_row_count` | `(name, expected, actual)` | Passes if counts match |
