-- test_06_defaults.sql
-- Verify column defaults behave as expected.

SOURCE helpers.sql;

-- ─── Setup ───────────────────────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (40, 'DefaultsOrg', 'defaults');
INSERT INTO tenants (id, org_id, name, slug) VALUES (40, 40, 'DefaultsTenant', 'defaults');

-- ─── users.is_active defaults to TRUE ────────────────────────────────────────

INSERT INTO users (id, username, email, password_hash, org_id)
    VALUES (40, 'defaults_user', 'defaults@test.com', NULL, 40);

SELECT is_active INTO @active FROM users WHERE id = 40;
CALL assert_equals('users.is_active defaults to TRUE', '1', CAST(@active AS CHAR));

-- ─── tenant_members.role defaults to viewer ──────────────────────────────────

INSERT INTO tenant_members (tenant_id, user_id) VALUES (40, 40);

SELECT role INTO @role FROM tenant_members WHERE tenant_id = 40 AND user_id = 40;
CALL assert_equals('tenant_members.role defaults to viewer', 'viewer', @role);

-- ─── map_permissions defaults ─────────────────────────────────────────────────

INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (40, 40, 40, 'DefaultsMap');
INSERT INTO map_permissions (map_id, user_id) VALUES (40, NULL);

SELECT can_view INTO @cv FROM map_permissions WHERE map_id = 40 AND user_id IS NULL;
SELECT can_edit INTO @ce FROM map_permissions WHERE map_id = 40 AND user_id IS NULL;
CALL assert_equals('map_permissions.can_view defaults to FALSE', '0', CAST(@cv AS CHAR));
CALL assert_equals('map_permissions.can_edit defaults to FALSE', '0', CAST(@ce AS CHAR));

-- ─── tenants.branding defaults to NULL ────────────────────────────────────────

SELECT branding INTO @b FROM tenants WHERE id = 40;
CALL assert_equals('tenants.branding defaults to NULL', NULL, CAST(@b AS CHAR));

-- ─── users.password_hash allows NULL (SSO users) ─────────────────────────────

INSERT INTO users (id, username, email, password_hash, org_id)
    VALUES (41, 'sso_only', 'sso@test.com', NULL, 40);

SELECT password_hash INTO @ph FROM users WHERE id = 41;
CALL assert_equals('users.password_hash allows NULL', NULL, @ph);

-- ─── maps.tenant_id is NOT NULL ──────────────────────────────────────────────

SET @null_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1048 SET @null_caught = 1;
    INSERT INTO maps (owner_id, tenant_id, title) VALUES (40, NULL, 'NullTenant');
END;
CALL assert_true('maps.tenant_id rejects NULL', @null_caught = 1);

-- ─── sso_providers.provider defaults to oidc ─────────────────────────────────

INSERT INTO sso_providers (org_id, config) VALUES (40, '{"issuer":"test"}');

SELECT provider INTO @prov FROM sso_providers WHERE org_id = 40;
CALL assert_equals('sso_providers.provider defaults to oidc', 'oidc', @prov);
