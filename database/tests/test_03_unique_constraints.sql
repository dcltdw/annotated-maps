-- test_03_unique_constraints.sql
-- Verify unique constraints reject duplicate inserts.

SOURCE helpers.sql;

-- ─── Setup: seed minimal data ────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (1, 'TestOrg', 'testorg');
INSERT INTO tenants (id, org_id, name, slug) VALUES (1, 1, 'TestTenant', 'test');
INSERT INTO users (id, username, email, password_hash, org_id, is_active)
    VALUES (1, 'testuser', 'test@example.com', NULL, 1, TRUE);

-- ─── users: duplicate username ────────────────────────────────────────────────

SET @dup_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 SET @dup_caught = 1;
    INSERT INTO users (username, email, password_hash, org_id, is_active)
        VALUES ('testuser', 'other@example.com', NULL, 1, TRUE);
END;
CALL assert_true('users rejects duplicate username', @dup_caught = 1);

-- ─── users: duplicate email ───────────────────────────────────────────────────

SET @dup_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 SET @dup_caught = 1;
    INSERT INTO users (username, email, password_hash, org_id, is_active)
        VALUES ('otheruser', 'test@example.com', NULL, 1, TRUE);
END;
CALL assert_true('users rejects duplicate email', @dup_caught = 1);

-- ─── users: duplicate (org_id, external_id) ──────────────────────────────────

UPDATE users SET external_id = 'sso-sub-1' WHERE id = 1;

SET @dup_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 SET @dup_caught = 1;
    INSERT INTO users (username, email, password_hash, org_id, external_id, is_active)
        VALUES ('ssouser2', 'sso2@example.com', NULL, 1, 'sso-sub-1', TRUE);
END;
CALL assert_true('users rejects duplicate (org_id, external_id)', @dup_caught = 1);

-- ─── organizations: duplicate slug ────────────────────────────────────────────

SET @dup_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 SET @dup_caught = 1;
    INSERT INTO organizations (name, slug) VALUES ('Other', 'testorg');
END;
CALL assert_true('organizations rejects duplicate slug', @dup_caught = 1);

-- ─── tenants: duplicate (org_id, slug) ────────────────────────────────────────

SET @dup_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 SET @dup_caught = 1;
    INSERT INTO tenants (org_id, name, slug) VALUES (1, 'Dupe', 'test');
END;
CALL assert_true('tenants rejects duplicate (org_id, slug)', @dup_caught = 1);

-- ─── tenant_members: duplicate (tenant_id, user_id) ──────────────────────────

INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (1, 1, 'admin');

SET @dup_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 SET @dup_caught = 1;
    INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (1, 1, 'viewer');
END;
CALL assert_true('tenant_members rejects duplicate (tenant_id, user_id)', @dup_caught = 1);

-- ─── map_permissions: duplicate (map_id, user_id) ─────────────────────────────

INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (1, 1, 1, 'Test Map');
INSERT INTO map_permissions (map_id, user_id, can_view) VALUES (1, NULL, TRUE);

SET @dup_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 SET @dup_caught = 1;
    INSERT INTO map_permissions (map_id, user_id, can_view) VALUES (1, NULL, TRUE);
END;
CALL assert_true('map_permissions rejects duplicate (map_id, NULL user_id)', @dup_caught = 1);

-- ─── sso_providers: duplicate org_id ──────────────────────────────────────────

INSERT INTO sso_providers (org_id, config) VALUES (1, '{"issuer":"https://idp.test"}');

SET @dup_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 SET @dup_caught = 1;
    INSERT INTO sso_providers (org_id, config) VALUES (1, '{"issuer":"https://other.test"}');
END;
CALL assert_true('sso_providers rejects duplicate org_id', @dup_caught = 1);
