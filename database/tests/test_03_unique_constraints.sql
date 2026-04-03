-- test_03_unique_constraints.sql
-- Verify unique constraints reject duplicate inserts.

SOURCE helpers.sql;

-- ─── Setup: seed minimal data ────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (1, 'TestOrg', 'testorg');
INSERT INTO tenants (id, org_id, name, slug) VALUES (1, 1, 'TestTenant', 'test');
INSERT INTO users (id, username, email, password_hash, org_id, status)
    VALUES (1, 'testuser', 'test@example.com', NULL, 1, 'active');

-- ─── Helper procedure for testing duplicate inserts ──────────────────────────

DROP PROCEDURE IF EXISTS test_dup_username;
DROP PROCEDURE IF EXISTS test_dup_email;
DROP PROCEDURE IF EXISTS test_dup_external_id;
DROP PROCEDURE IF EXISTS test_dup_org_slug;
DROP PROCEDURE IF EXISTS test_dup_tenant_slug;
DROP PROCEDURE IF EXISTS test_dup_tenant_member;
DROP PROCEDURE IF EXISTS test_dup_map_permission;
DROP PROCEDURE IF EXISTS test_dup_sso_org;

DELIMITER $$

CREATE PROCEDURE test_dup_username()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 BEGIN END;
    INSERT INTO users (username, email, password_hash, org_id, status)
        VALUES ('testuser', 'other@example.com', NULL, 1, 'active');
END$$

CREATE PROCEDURE test_dup_email()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 BEGIN END;
    INSERT INTO users (username, email, password_hash, org_id, status)
        VALUES ('otheruser', 'test@example.com', NULL, 1, 'active');
END$$

CREATE PROCEDURE test_dup_external_id()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 BEGIN END;
    INSERT INTO users (username, email, password_hash, org_id, external_id, status)
        VALUES ('ssouser2', 'sso2@example.com', NULL, 1, 'sso-sub-1', 'active');
END$$

CREATE PROCEDURE test_dup_org_slug()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 BEGIN END;
    INSERT INTO organizations (name, slug) VALUES ('Other', 'testorg');
END$$

CREATE PROCEDURE test_dup_tenant_slug()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 BEGIN END;
    INSERT INTO tenants (org_id, name, slug) VALUES (1, 'Dupe', 'test');
END$$

CREATE PROCEDURE test_dup_tenant_member()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 BEGIN END;
    INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (1, 1, 'viewer');
END$$

CREATE PROCEDURE test_dup_map_permission()
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '23000' BEGIN END;
    INSERT INTO map_permissions (map_id, user_id, level) VALUES (1, NULL, 'view');
END$$

CREATE PROCEDURE test_dup_sso_org()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 BEGIN END;
    INSERT INTO sso_providers (org_id, config) VALUES (1, '{"issuer":"https://other.test"}');
END$$

DELIMITER ;

-- ─── Run tests ───────────────────────────────────────────────────────────────

-- users: duplicate username
SELECT COUNT(*) INTO @before FROM users;
CALL test_dup_username();
SELECT COUNT(*) INTO @after FROM users;
CALL assert_true('users rejects duplicate username', @before = @after);

-- users: duplicate email
SELECT COUNT(*) INTO @before FROM users;
CALL test_dup_email();
SELECT COUNT(*) INTO @after FROM users;
CALL assert_true('users rejects duplicate email', @before = @after);

-- users: duplicate (org_id, external_id)
UPDATE users SET external_id = 'sso-sub-1' WHERE id = 1;
SELECT COUNT(*) INTO @before FROM users;
CALL test_dup_external_id();
SELECT COUNT(*) INTO @after FROM users;
CALL assert_true('users rejects duplicate (org_id, external_id)', @before = @after);

-- organizations: duplicate slug
SELECT COUNT(*) INTO @before FROM organizations;
CALL test_dup_org_slug();
SELECT COUNT(*) INTO @after FROM organizations;
CALL assert_true('organizations rejects duplicate slug', @before = @after);

-- tenants: duplicate (org_id, slug)
SELECT COUNT(*) INTO @before FROM tenants;
CALL test_dup_tenant_slug();
SELECT COUNT(*) INTO @after FROM tenants;
CALL assert_true('tenants rejects duplicate (org_id, slug)', @before = @after);

-- tenant_members: duplicate (tenant_id, user_id)
INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (1, 1, 'admin');
SELECT COUNT(*) INTO @before FROM tenant_members;
CALL test_dup_tenant_member();
SELECT COUNT(*) INTO @after FROM tenant_members;
CALL assert_true('tenant_members rejects duplicate (tenant_id, user_id)', @before = @after);

-- map_permissions: duplicate (map_id, non-NULL user_id) is rejected
INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (1, 1, 1, 'Test Map');
INSERT INTO map_permissions (map_id, user_id, level) VALUES (1, 1, 'view');

DROP PROCEDURE IF EXISTS test_dup_map_perm_user;
DELIMITER $$
CREATE PROCEDURE test_dup_map_perm_user()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 BEGIN END;
    INSERT INTO map_permissions (map_id, user_id, level) VALUES (1, 1, 'view');
END$$
DELIMITER ;

SELECT COUNT(*) INTO @before FROM map_permissions WHERE map_id = 1 AND user_id = 1;
CALL test_dup_map_perm_user();
SELECT COUNT(*) INTO @after FROM map_permissions WHERE map_id = 1 AND user_id = 1;
CALL assert_true('map_permissions rejects duplicate (map_id, user_id)', @before = @after);
DROP PROCEDURE IF EXISTS test_dup_map_perm_user;

-- map_permissions: duplicate (map_id, NULL user_id) is rejected
-- Migration 010 adds a generated column (COALESCE(user_id, 0)) with a unique
-- key, so the database now enforces one public permission row per map.
INSERT INTO map_permissions (map_id, user_id, level) VALUES (1, NULL, 'view');
SELECT COUNT(*) INTO @before FROM map_permissions WHERE map_id = 1 AND user_id IS NULL;
CALL test_dup_map_permission();
SELECT COUNT(*) INTO @after FROM map_permissions WHERE map_id = 1 AND user_id IS NULL;
CALL assert_true('map_permissions rejects duplicate (map_id, NULL user_id)', @before = @after);


-- sso_providers: duplicate org_id
INSERT INTO sso_providers (org_id, config) VALUES (1, '{"issuer":"https://idp.test"}');
SELECT COUNT(*) INTO @before FROM sso_providers;
CALL test_dup_sso_org();
SELECT COUNT(*) INTO @after FROM sso_providers;
CALL assert_true('sso_providers rejects duplicate org_id', @before = @after);

-- Cleanup procedures
DROP PROCEDURE IF EXISTS test_dup_username;
DROP PROCEDURE IF EXISTS test_dup_email;
DROP PROCEDURE IF EXISTS test_dup_external_id;
DROP PROCEDURE IF EXISTS test_dup_org_slug;
DROP PROCEDURE IF EXISTS test_dup_tenant_slug;
DROP PROCEDURE IF EXISTS test_dup_tenant_member;
DROP PROCEDURE IF EXISTS test_dup_map_perm_user;
DROP PROCEDURE IF EXISTS test_dup_map_permission;
DROP PROCEDURE IF EXISTS test_dup_sso_org;
