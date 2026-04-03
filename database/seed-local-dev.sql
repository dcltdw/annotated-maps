-- seed-local-dev.sql
-- Creates test data for local development: 2 orgs, 6 tenants, 5 users.
-- Idempotent — safe to run multiple times.
--
-- Prerequisites: users must be registered via the API first (seed-local-dev.py
-- handles this) so passwords get real Argon2id hashes.
--
-- Usage:
--   python3 database/seed-local-dev.py

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

-- ─── Assign users to orgs ─────────────────────────────────────────────────────
-- Users were registered via the API and have auto-increment IDs.
-- Look them up by email and assign to the correct org.

UPDATE users SET org_id = 100 WHERE email = 'alice@acme.test';
UPDATE users SET org_id = 100 WHERE email = 'bob@acme.test';
UPDATE users SET org_id = 100 WHERE email = 'carol@acme.test';
UPDATE users SET org_id = 200 WHERE email = 'dan@beta.test';
UPDATE users SET org_id = 200 WHERE email = 'eve@beta.test';

-- ─── Tenant memberships ──────────────────────────────────────────────────────
-- Use subqueries to look up user IDs by email.

-- Acme Engineering
INSERT INTO tenant_members (tenant_id, user_id, role)
    SELECT 101, id, 'admin' FROM users WHERE email = 'alice@acme.test'
    ON DUPLICATE KEY UPDATE role=VALUES(role);
INSERT INTO tenant_members (tenant_id, user_id, role)
    SELECT 101, id, 'editor' FROM users WHERE email = 'bob@acme.test'
    ON DUPLICATE KEY UPDATE role=VALUES(role);

-- Acme Sales
INSERT INTO tenant_members (tenant_id, user_id, role)
    SELECT 102, id, 'viewer' FROM users WHERE email = 'alice@acme.test'
    ON DUPLICATE KEY UPDATE role=VALUES(role);
INSERT INTO tenant_members (tenant_id, user_id, role)
    SELECT 102, id, 'admin' FROM users WHERE email = 'carol@acme.test'
    ON DUPLICATE KEY UPDATE role=VALUES(role);

-- Acme Support
INSERT INTO tenant_members (tenant_id, user_id, role)
    SELECT 103, id, 'admin' FROM users WHERE email = 'bob@acme.test'
    ON DUPLICATE KEY UPDATE role=VALUES(role);

-- Beta Engineering
INSERT INTO tenant_members (tenant_id, user_id, role)
    SELECT 201, id, 'admin' FROM users WHERE email = 'dan@beta.test'
    ON DUPLICATE KEY UPDATE role=VALUES(role);

-- Beta Marketing
INSERT INTO tenant_members (tenant_id, user_id, role)
    SELECT 202, id, 'editor' FROM users WHERE email = 'dan@beta.test'
    ON DUPLICATE KEY UPDATE role=VALUES(role);
INSERT INTO tenant_members (tenant_id, user_id, role)
    SELECT 202, id, 'admin' FROM users WHERE email = 'eve@beta.test'
    ON DUPLICATE KEY UPDATE role=VALUES(role);

-- Beta Operations
INSERT INTO tenant_members (tenant_id, user_id, role)
    SELECT 203, id, 'viewer' FROM users WHERE email = 'eve@beta.test'
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
