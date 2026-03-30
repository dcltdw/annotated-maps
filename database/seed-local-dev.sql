-- seed-local-dev.sql
-- Creates test data for local development: 2 orgs, 6 tenants, 5 users.
-- Idempotent — safe to run multiple times.
--
-- Usage:
--   docker compose exec mysql mysql -uroot -prootpassword annotated_maps < database/seed-local-dev.sql

-- ─── Organizations ────────────────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES
    (100, 'Acme Corp',  'acme'),
    (200, 'Beta Inc',   'beta')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- ─── Tenants ──────────────────────────────────────────────────────────────────

INSERT INTO tenants (id, org_id, name, slug) VALUES
    -- Acme Corp
    (101, 100, 'Engineering', 'engineering'),
    (102, 100, 'Sales',       'sales'),
    (103, 100, 'Support',     'support'),
    -- Beta Inc
    (201, 200, 'Engineering', 'engineering'),
    (202, 200, 'Marketing',   'marketing'),
    (203, 200, 'Operations',  'operations')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- ─── Users ────────────────────────────────────────────────────────────────────
-- Passwords are set to NULL here. After running this seed, use the helper
-- script below to set passwords via the running backend (which generates
-- real Argon2id hashes).
--
-- Alternatively, register users via the API and then run just the org/tenant
-- portion of this seed.

SET @pw_hash = NULL;

INSERT INTO users (id, username, email, password_hash, org_id, is_active) VALUES
    -- Acme Corp users
    (1001, 'alice', 'alice@acme.test', @pw_hash, 100, TRUE),
    (1002, 'bob',   'bob@acme.test',   @pw_hash, 100, TRUE),
    (1003, 'carol', 'carol@acme.test', @pw_hash, 100, TRUE),
    -- Beta Inc users
    (2001, 'dan',   'dan@beta.test',   @pw_hash, 200, TRUE),
    (2002, 'eve',   'eve@beta.test',   @pw_hash, 200, TRUE)
ON DUPLICATE KEY UPDATE
    password_hash=VALUES(password_hash),
    org_id=VALUES(org_id),
    is_active=VALUES(is_active);

-- ─── Tenant memberships ──────────────────────────────────────────────────────

INSERT INTO tenant_members (tenant_id, user_id, role) VALUES
    -- Acme Engineering
    (101, 1001, 'admin'),   -- alice: admin
    (101, 1002, 'editor'),  -- bob: editor

    -- Acme Sales
    (102, 1001, 'viewer'),  -- alice: viewer (different role, same org)
    (102, 1003, 'admin'),   -- carol: admin

    -- Acme Support
    (103, 1002, 'admin'),   -- bob: admin (spans two tenants)

    -- Beta Engineering
    (201, 2001, 'admin'),   -- dan: admin

    -- Beta Marketing
    (202, 2001, 'editor'),  -- dan: editor (different role, same org)
    (202, 2002, 'admin'),   -- eve: admin

    -- Beta Operations
    (203, 2002, 'viewer')   -- eve: viewer
ON DUPLICATE KEY UPDATE role=VALUES(role);

-- ─── Sample branding ─────────────────────────────────────────────────────────

UPDATE tenants SET branding = JSON_OBJECT(
    'display_name', 'Acme Engineering Maps',
    'primary_color', '#dc2626',
    'accent_color', '#991b1b'
) WHERE id = 101;

UPDATE tenants SET branding = JSON_OBJECT(
    'display_name', 'Beta Inc',
    'primary_color', '#059669',
    'accent_color', '#047857'
) WHERE id = 201;

SELECT 'Seed complete. Test users: alice/bob/carol @acme.test, dan/eve @beta.test (password: password)' AS status;
