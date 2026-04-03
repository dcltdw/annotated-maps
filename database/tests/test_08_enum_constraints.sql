-- test_08_enum_constraints.sql
-- Verify ENUM columns reject invalid values.

SOURCE helpers.sql;

-- ─── Setup ───────────────────────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (60, 'EnumOrg', 'enum');
INSERT INTO tenants (id, org_id, name, slug) VALUES (60, 60, 'EnumTenant', 'enum');
INSERT INTO users (id, username, email, password_hash, org_id, status)
    VALUES (60, 'enum_user', 'enum@test.com', NULL, 60, 'active');
INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (60, 60, 60, 'EnumMap');

-- ─── tenant_members.role accepts valid values ────────────────────────────────

INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (60, 60, 'admin');
UPDATE tenant_members SET role = 'editor' WHERE tenant_id = 60 AND user_id = 60;
UPDATE tenant_members SET role = 'viewer' WHERE tenant_id = 60 AND user_id = 60;

SELECT role INTO @r FROM tenant_members WHERE tenant_id = 60 AND user_id = 60;
CALL assert_equals('tenant_members accepts viewer role', 'viewer', @r);

-- ─── Helper procedures for invalid enum tests ────────────────────────────────

DROP PROCEDURE IF EXISTS test_bad_tm_role;
DROP PROCEDURE IF EXISTS test_bad_ann_type;
DROP PROCEDURE IF EXISTS test_bad_media_type;
DROP PROCEDURE IF EXISTS test_bad_sso_provider;

DELIMITER $$

CREATE PROCEDURE test_bad_tm_role()
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLWARNING BEGIN END;
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
    UPDATE tenant_members SET role = 'superadmin' WHERE tenant_id = 60 AND user_id = 60;
END$$

CREATE PROCEDURE test_bad_ann_type()
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLWARNING BEGIN END;
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
    INSERT INTO annotations (map_id, created_by, type, title, geo_json)
        VALUES (60, 60, 'circle', 'Bad', '{"type":"Point","coordinates":[0,0]}');
END$$

CREATE PROCEDURE test_bad_media_type()
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLWARNING BEGIN END;
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
    INSERT INTO annotation_media (annotation_id, media_type, url)
        VALUES (60, 'video', 'https://example.com/v.mp4');
END$$

CREATE PROCEDURE test_bad_sso_provider()
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLWARNING BEGIN END;
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
    INSERT INTO sso_providers (org_id, config, provider) VALUES (60, '{}', 'saml');
END$$

DELIMITER ;

-- ─── annotations.type accepts valid values ───────────────────────────────────

INSERT INTO annotations (id, map_id, created_by, type, title, geo_json)
    VALUES (60, 60, 60, 'marker', 'M', '{"type":"Point","coordinates":[0,0]}');
INSERT INTO annotations (id, map_id, created_by, type, title, geo_json)
    VALUES (61, 60, 60, 'polyline', 'P', '{"type":"LineString","coordinates":[[0,0],[1,1]]}');
INSERT INTO annotations (id, map_id, created_by, type, title, geo_json)
    VALUES (62, 60, 60, 'polygon', 'G', '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}');

SELECT COUNT(*) INTO @cnt FROM annotations WHERE map_id = 60;
CALL assert_equals('annotations accepts all valid types', '3', CAST(@cnt AS CHAR));

-- ─── Run invalid enum tests ──────────────────────────────────────────────────

-- tenant_members.role: save current value, try invalid, check unchanged
SELECT role INTO @role_before FROM tenant_members WHERE tenant_id = 60 AND user_id = 60;
CALL test_bad_tm_role();
SELECT role INTO @role_after FROM tenant_members WHERE tenant_id = 60 AND user_id = 60;
CALL assert_equals('tenant_members.role rejects invalid enum', @role_before, @role_after);

-- annotations.type
SELECT COUNT(*) INTO @before FROM annotations WHERE type = 'circle';
CALL test_bad_ann_type();
SELECT COUNT(*) INTO @after FROM annotations WHERE type = 'circle';
CALL assert_true('annotations.type rejects invalid enum', @after = 0);

-- annotation_media.media_type
SELECT COUNT(*) INTO @before FROM annotation_media;
CALL test_bad_media_type();
SELECT COUNT(*) INTO @after FROM annotation_media WHERE media_type = 'video';
CALL assert_true('annotation_media.media_type rejects invalid enum', @after = 0);

-- sso_providers.provider
SELECT COUNT(*) INTO @before FROM sso_providers;
CALL test_bad_sso_provider();
SELECT COUNT(*) INTO @after FROM sso_providers WHERE org_id = 60;
CALL assert_true('sso_providers.provider rejects invalid enum', @after = 0);

-- Cleanup
DROP PROCEDURE IF EXISTS test_bad_tm_role;
DROP PROCEDURE IF EXISTS test_bad_ann_type;
DROP PROCEDURE IF EXISTS test_bad_media_type;
DROP PROCEDURE IF EXISTS test_bad_sso_provider;
