-- test_08_enum_constraints.sql
-- Verify ENUM columns reject invalid values.

SOURCE helpers.sql;

-- ─── Setup ───────────────────────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (60, 'EnumOrg', 'enum');
INSERT INTO tenants (id, org_id, name, slug) VALUES (60, 60, 'EnumTenant', 'enum');
INSERT INTO users (id, username, email, password_hash, org_id, is_active)
    VALUES (60, 'enum_user', 'enum@test.com', NULL, 60, TRUE);
INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (60, 60, 60, 'EnumMap');

-- ─── tenant_members.role accepts valid values ────────────────────────────────

INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (60, 60, 'admin');
UPDATE tenant_members SET role = 'editor' WHERE tenant_id = 60 AND user_id = 60;
UPDATE tenant_members SET role = 'viewer' WHERE tenant_id = 60 AND user_id = 60;

SELECT role INTO @r FROM tenant_members WHERE tenant_id = 60 AND user_id = 60;
CALL assert_equals('tenant_members accepts viewer role', 'viewer', @r);

-- ─── tenant_members.role rejects invalid values ──────────────────────────────

-- MySQL strict mode truncates/errors on invalid ENUM. Use a handler.
SET @enum_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLWARNING SET @enum_caught = 1;
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET @enum_caught = 1;
    UPDATE tenant_members SET role = 'superadmin' WHERE tenant_id = 60 AND user_id = 60;
END;
CALL assert_true('tenant_members.role rejects invalid enum', @enum_caught = 1);

-- ─── annotations.type accepts valid values ───────────────────────────────────

INSERT INTO annotations (id, map_id, created_by, type, title, geo_json)
    VALUES (60, 60, 60, 'marker', 'M', '{"type":"Point","coordinates":[0,0]}');
INSERT INTO annotations (id, map_id, created_by, type, title, geo_json)
    VALUES (61, 60, 60, 'polyline', 'P', '{"type":"LineString","coordinates":[[0,0],[1,1]]}');
INSERT INTO annotations (id, map_id, created_by, type, title, geo_json)
    VALUES (62, 60, 60, 'polygon', 'G', '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}');

SELECT COUNT(*) INTO @cnt FROM annotations WHERE map_id = 60;
CALL assert_equals('annotations accepts all valid types', '3', CAST(@cnt AS CHAR));

-- ─── annotations.type rejects invalid values ─────────────────────────────────

SET @enum_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLWARNING SET @enum_caught = 1;
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET @enum_caught = 1;
    INSERT INTO annotations (map_id, created_by, type, title, geo_json)
        VALUES (60, 60, 'circle', 'Bad', '{"type":"Point","coordinates":[0,0]}');
END;
CALL assert_true('annotations.type rejects invalid enum', @enum_caught = 1);

-- ─── annotation_media.media_type rejects invalid values ──────────────────────

SET @enum_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLWARNING SET @enum_caught = 1;
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET @enum_caught = 1;
    INSERT INTO annotation_media (annotation_id, media_type, url)
        VALUES (60, 'video', 'https://example.com/v.mp4');
END;
CALL assert_true('annotation_media.media_type rejects invalid enum', @enum_caught = 1);

-- ─── sso_providers.provider rejects invalid values ───────────────────────────

SET @enum_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLWARNING SET @enum_caught = 1;
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET @enum_caught = 1;
    INSERT INTO sso_providers (org_id, config, provider) VALUES (60, '{}', 'saml');
END;
CALL assert_true('sso_providers.provider rejects invalid enum', @enum_caught = 1);
