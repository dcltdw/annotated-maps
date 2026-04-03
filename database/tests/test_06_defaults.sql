-- test_06_defaults.sql
-- Verify column defaults behave as expected.

SOURCE helpers.sql;

-- ─── Setup ───────────────────────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (40, 'DefaultsOrg', 'defaults');
INSERT INTO tenants (id, org_id, name, slug) VALUES (40, 40, 'DefaultsTenant', 'defaults');

-- ─── users.status defaults to active ──────────────────────────────────────────

INSERT INTO users (id, username, email, password_hash, org_id)
    VALUES (40, 'defaults_user', 'defaults@test.com', NULL, 40);

SELECT status INTO @status FROM users WHERE id = 40;
CALL assert_equals('users.status defaults to active', 'active', @status);

-- ─── users.platform_role defaults to none ─────────────────────────────────────

SELECT platform_role INTO @pr FROM users WHERE id = 40;
CALL assert_equals('users.platform_role defaults to none', 'none', @pr);

-- ─── tenant_members.role defaults to viewer ──────────────────────────────────

INSERT INTO tenant_members (tenant_id, user_id) VALUES (40, 40);

SELECT role INTO @role FROM tenant_members WHERE tenant_id = 40 AND user_id = 40;
CALL assert_equals('tenant_members.role defaults to viewer', 'viewer', @role);

-- ─── map_permissions defaults ─────────────────────────────────────────────────

INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (40, 40, 40, 'DefaultsMap');
INSERT INTO map_permissions (map_id, user_id) VALUES (40, NULL);

SELECT level INTO @lv FROM map_permissions WHERE map_id = 40 AND user_id IS NULL;
CALL assert_equals('map_permissions.level defaults to none', 'none', @lv);

-- ─── tenants.branding defaults to NULL ────────────────────────────────────────

SELECT branding INTO @b FROM tenants WHERE id = 40;
CALL assert_equals('tenants.branding defaults to NULL', NULL, CAST(@b AS CHAR));

-- ─── users.password_hash allows NULL (SSO users) ─────────────────────────────

INSERT INTO users (id, username, email, password_hash, org_id)
    VALUES (41, 'sso_only', 'sso@test.com', NULL, 40);

SELECT password_hash INTO @ph FROM users WHERE id = 41;
CALL assert_equals('users.password_hash allows NULL', NULL, @ph);

-- ─── maps.tenant_id rejects NULL ─────────────────────────────────────────────

DROP PROCEDURE IF EXISTS test_null_tenant;
DELIMITER $$
CREATE PROCEDURE test_null_tenant()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1048 BEGIN END;
    DECLARE CONTINUE HANDLER FOR 1364 BEGIN END;
    INSERT INTO maps (owner_id, tenant_id, title) VALUES (40, NULL, 'NullTenant');
END$$
DELIMITER ;

SELECT COUNT(*) INTO @before FROM maps;
CALL test_null_tenant();
SELECT COUNT(*) INTO @after FROM maps;
CALL assert_true('maps.tenant_id rejects NULL', @before = @after);
DROP PROCEDURE IF EXISTS test_null_tenant;

-- ─── sso_providers.provider defaults to oidc ─────────────────────────────────

INSERT INTO sso_providers (org_id, config) VALUES (40, '{"issuer":"test"}');

SELECT provider INTO @prov FROM sso_providers WHERE org_id = 40;
CALL assert_equals('sso_providers.provider defaults to oidc', 'oidc', @prov);
