-- test_05_foreign_keys.sql
-- Verify foreign key constraints reject invalid references.

SOURCE helpers.sql;

-- ─── Setup ───────────────────────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (30, 'FKOrg', 'fkorg');
INSERT INTO tenants (id, org_id, name, slug) VALUES (30, 30, 'FKTenant', 'fk');
INSERT INTO users (id, username, email, password_hash, org_id, is_active)
    VALUES (30, 'fkuser', 'fk@test.com', NULL, 30, TRUE);

-- ─── Helper procedures ──────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS test_fk_map_bad_owner;
DROP PROCEDURE IF EXISTS test_fk_map_bad_tenant;
DROP PROCEDURE IF EXISTS test_fk_tm_bad_tenant;
DROP PROCEDURE IF EXISTS test_fk_tm_bad_user;
DROP PROCEDURE IF EXISTS test_fk_tenant_bad_org;
DROP PROCEDURE IF EXISTS test_fk_ann_bad_map;
DROP PROCEDURE IF EXISTS test_fk_ann_bad_creator;
DROP PROCEDURE IF EXISTS test_fk_media_bad_ann;
DROP PROCEDURE IF EXISTS test_fk_sso_bad_org;
DROP PROCEDURE IF EXISTS test_fk_audit_bad_user;

DELIMITER $$

CREATE PROCEDURE test_fk_map_bad_owner()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 BEGIN END;
    INSERT INTO maps (owner_id, tenant_id, title) VALUES (99999, 30, 'BadOwner');
END$$

CREATE PROCEDURE test_fk_map_bad_tenant()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 BEGIN END;
    INSERT INTO maps (owner_id, tenant_id, title) VALUES (30, 99999, 'BadTenant');
END$$

CREATE PROCEDURE test_fk_tm_bad_tenant()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 BEGIN END;
    INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (99999, 30, 'admin');
END$$

CREATE PROCEDURE test_fk_tm_bad_user()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 BEGIN END;
    INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (30, 99999, 'admin');
END$$

CREATE PROCEDURE test_fk_tenant_bad_org()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 BEGIN END;
    INSERT INTO tenants (org_id, name, slug) VALUES (99999, 'BadOrg', 'badorg');
END$$

CREATE PROCEDURE test_fk_ann_bad_map()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 BEGIN END;
    INSERT INTO annotations (map_id, created_by, type, title, geo_json)
        VALUES (99999, 30, 'marker', 'Bad', '{"type":"Point","coordinates":[0,0]}');
END$$

CREATE PROCEDURE test_fk_ann_bad_creator()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 BEGIN END;
    INSERT INTO annotations (map_id, created_by, type, title, geo_json)
        VALUES (30, 99999, 'marker', 'Bad', '{"type":"Point","coordinates":[0,0]}');
END$$

CREATE PROCEDURE test_fk_media_bad_ann()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 BEGIN END;
    INSERT INTO annotation_media (annotation_id, media_type, url)
        VALUES (99999, 'image', 'https://example.com/bad.png');
END$$

CREATE PROCEDURE test_fk_sso_bad_org()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 BEGIN END;
    INSERT INTO sso_providers (org_id, config) VALUES (99999, '{}');
END$$

CREATE PROCEDURE test_fk_audit_bad_user()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 BEGIN END;
    INSERT INTO audit_log (event_type, user_id, ip_address)
        VALUES ('fk_test_bad', 99999, '127.0.0.1');
END$$

DELIMITER ;

-- ─── Run tests ───────────────────────────────────────────────────────────────

SELECT COUNT(*) INTO @before FROM maps;
CALL test_fk_map_bad_owner();
SELECT COUNT(*) INTO @after FROM maps;
CALL assert_true('maps rejects invalid owner_id', @before = @after);

SELECT COUNT(*) INTO @before FROM maps;
CALL test_fk_map_bad_tenant();
SELECT COUNT(*) INTO @after FROM maps;
CALL assert_true('maps rejects invalid tenant_id', @before = @after);

SELECT COUNT(*) INTO @before FROM tenant_members;
CALL test_fk_tm_bad_tenant();
SELECT COUNT(*) INTO @after FROM tenant_members;
CALL assert_true('tenant_members rejects invalid tenant_id', @before = @after);

SELECT COUNT(*) INTO @before FROM tenant_members;
CALL test_fk_tm_bad_user();
SELECT COUNT(*) INTO @after FROM tenant_members;
CALL assert_true('tenant_members rejects invalid user_id', @before = @after);

SELECT COUNT(*) INTO @before FROM tenants;
CALL test_fk_tenant_bad_org();
SELECT COUNT(*) INTO @after FROM tenants;
CALL assert_true('tenants rejects invalid org_id', @before = @after);

SELECT COUNT(*) INTO @before FROM annotations;
CALL test_fk_ann_bad_map();
SELECT COUNT(*) INTO @after FROM annotations;
CALL assert_true('annotations rejects invalid map_id', @before = @after);

INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (30, 30, 30, 'FKMap');
SELECT COUNT(*) INTO @before FROM annotations;
CALL test_fk_ann_bad_creator();
SELECT COUNT(*) INTO @after FROM annotations;
CALL assert_true('annotations rejects invalid created_by', @before = @after);

SELECT COUNT(*) INTO @before FROM annotation_media;
CALL test_fk_media_bad_ann();
SELECT COUNT(*) INTO @after FROM annotation_media;
CALL assert_true('annotation_media rejects invalid annotation_id', @before = @after);

SELECT COUNT(*) INTO @before FROM sso_providers;
CALL test_fk_sso_bad_org();
SELECT COUNT(*) INTO @after FROM sso_providers;
CALL assert_true('sso_providers rejects invalid org_id', @before = @after);

-- audit_log: NULL user_id should be accepted
INSERT INTO audit_log (event_type, user_id, ip_address) VALUES ('fk_test', NULL, '127.0.0.1');
SELECT COUNT(*) INTO @cnt FROM audit_log WHERE event_type = 'fk_test' AND user_id IS NULL;
CALL assert_equals('audit_log accepts NULL user_id', '1', CAST(@cnt AS CHAR));

-- audit_log: invalid non-NULL user_id should be rejected
SELECT COUNT(*) INTO @before FROM audit_log;
CALL test_fk_audit_bad_user();
SELECT COUNT(*) INTO @after FROM audit_log WHERE event_type = 'fk_test_bad';
CALL assert_true('audit_log rejects invalid user_id FK', @after = 0);

-- Cleanup
DROP PROCEDURE IF EXISTS test_fk_map_bad_owner;
DROP PROCEDURE IF EXISTS test_fk_map_bad_tenant;
DROP PROCEDURE IF EXISTS test_fk_tm_bad_tenant;
DROP PROCEDURE IF EXISTS test_fk_tm_bad_user;
DROP PROCEDURE IF EXISTS test_fk_tenant_bad_org;
DROP PROCEDURE IF EXISTS test_fk_ann_bad_map;
DROP PROCEDURE IF EXISTS test_fk_ann_bad_creator;
DROP PROCEDURE IF EXISTS test_fk_media_bad_ann;
DROP PROCEDURE IF EXISTS test_fk_sso_bad_org;
DROP PROCEDURE IF EXISTS test_fk_audit_bad_user;
