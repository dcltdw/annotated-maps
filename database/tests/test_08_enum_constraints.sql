-- test_08_enum_constraints.sql
-- Verify ENUM columns reject invalid values.

SOURCE helpers.sql;

-- ─── Setup ───────────────────────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (60, 'EnumOrg', 'enum');
INSERT INTO tenants (id, org_id, name, slug) VALUES (60, 60, 'EnumTenant', 'enum');
INSERT INTO users (id, username, email, password_hash, org_id, status)
    VALUES (60, 'enum_user', 'enum@test.com', NULL, 60, 'active');
INSERT INTO maps (id, owner_id, tenant_id, title, coordinate_system)
    VALUES (60, 60, 60, 'EnumMap', '{"type":"wgs84","center":{"lat":0,"lng":0},"zoom":3}');
INSERT INTO nodes (id, map_id, created_by, name) VALUES (60, 60, 60, 'EnumNode');
INSERT INTO notes (id, node_id, created_by, text) VALUES (60, 60, 60, 'enum note');

-- ─── tenant_members.role accepts valid values ────────────────────────────────

INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (60, 60, 'admin');
UPDATE tenant_members SET role = 'editor' WHERE tenant_id = 60 AND user_id = 60;
UPDATE tenant_members SET role = 'viewer' WHERE tenant_id = 60 AND user_id = 60;

SELECT role INTO @r FROM tenant_members WHERE tenant_id = 60 AND user_id = 60;
CALL assert_equals('tenant_members accepts viewer role', 'viewer', @r);

-- ─── Helper procedures for invalid enum tests ────────────────────────────────

DROP PROCEDURE IF EXISTS test_bad_tm_role;
DROP PROCEDURE IF EXISTS test_bad_node_media_type;
DROP PROCEDURE IF EXISTS test_bad_note_media_type;
DROP PROCEDURE IF EXISTS test_bad_sso_provider;

DELIMITER $$

CREATE PROCEDURE test_bad_tm_role()
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLWARNING BEGIN END;
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
    UPDATE tenant_members SET role = 'superadmin' WHERE tenant_id = 60 AND user_id = 60;
END$$

CREATE PROCEDURE test_bad_node_media_type()
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLWARNING BEGIN END;
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
    INSERT INTO node_media (node_id, media_type, url)
        VALUES (60, 'video', 'https://example.com/v.mp4');
END$$

CREATE PROCEDURE test_bad_note_media_type()
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLWARNING BEGIN END;
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
    INSERT INTO note_media (note_id, media_type, url)
        VALUES (60, 'video', 'https://example.com/v.mp4');
END$$

CREATE PROCEDURE test_bad_sso_provider()
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLWARNING BEGIN END;
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
    INSERT INTO sso_providers (org_id, config, provider) VALUES (60, '{}', 'saml');
END$$

DELIMITER ;

-- ─── node_media.media_type accepts both valid values ────────────────────────

INSERT INTO node_media (node_id, media_type, url) VALUES (60, 'image', 'https://x/img.png');
INSERT INTO node_media (node_id, media_type, url) VALUES (60, 'link',  'https://x/page');
SELECT COUNT(*) INTO @cnt FROM node_media WHERE node_id = 60;
CALL assert_equals('node_media accepts image and link', '2', CAST(@cnt AS CHAR));

-- ─── note_media.media_type accepts both valid values ────────────────────────

INSERT INTO note_media (note_id, media_type, url) VALUES (60, 'image', 'https://x/n.png');
INSERT INTO note_media (note_id, media_type, url) VALUES (60, 'link',  'https://x/n');
SELECT COUNT(*) INTO @cnt FROM note_media WHERE note_id = 60;
CALL assert_equals('note_media accepts image and link', '2', CAST(@cnt AS CHAR));

-- ─── Run invalid enum tests ──────────────────────────────────────────────────

-- tenant_members.role: save current value, try invalid, check unchanged
SELECT role INTO @role_before FROM tenant_members WHERE tenant_id = 60 AND user_id = 60;
CALL test_bad_tm_role();
SELECT role INTO @role_after FROM tenant_members WHERE tenant_id = 60 AND user_id = 60;
CALL assert_equals('tenant_members.role rejects invalid enum', @role_before, @role_after);

-- node_media.media_type
SELECT COUNT(*) INTO @before FROM node_media;
CALL test_bad_node_media_type();
SELECT COUNT(*) INTO @after FROM node_media WHERE media_type = 'video';
CALL assert_true('node_media.media_type rejects invalid enum', @after = 0);

-- note_media.media_type
SELECT COUNT(*) INTO @before FROM note_media;
CALL test_bad_note_media_type();
SELECT COUNT(*) INTO @after FROM note_media WHERE media_type = 'video';
CALL assert_true('note_media.media_type rejects invalid enum', @after = 0);

-- sso_providers.provider
SELECT COUNT(*) INTO @before FROM sso_providers;
CALL test_bad_sso_provider();
SELECT COUNT(*) INTO @after FROM sso_providers WHERE org_id = 60;
CALL assert_true('sso_providers.provider rejects invalid enum', @after = 0);

-- Cleanup
DROP PROCEDURE IF EXISTS test_bad_tm_role;
DROP PROCEDURE IF EXISTS test_bad_node_media_type;
DROP PROCEDURE IF EXISTS test_bad_note_media_type;
DROP PROCEDURE IF EXISTS test_bad_sso_provider;
