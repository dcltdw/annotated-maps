-- test_05_foreign_keys.sql
-- Verify foreign key constraints reject invalid references.

SOURCE helpers.sql;

-- ─── Setup ───────────────────────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (30, 'FKOrg', 'fkorg');
INSERT INTO tenants (id, org_id, name, slug) VALUES (30, 30, 'FKTenant', 'fk');
INSERT INTO users (id, username, email, password_hash, org_id, is_active)
    VALUES (30, 'fkuser', 'fk@test.com', NULL, 30, TRUE);

-- ─── maps: owner_id must reference a valid user ──────────────────────────────

SET @fk_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 SET @fk_caught = 1;
    INSERT INTO maps (owner_id, tenant_id, title) VALUES (99999, 30, 'BadOwner');
END;
CALL assert_true('maps rejects invalid owner_id', @fk_caught = 1);

-- ─── maps: tenant_id must reference a valid tenant ───────────────────────────

SET @fk_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 SET @fk_caught = 1;
    INSERT INTO maps (owner_id, tenant_id, title) VALUES (30, 99999, 'BadTenant');
END;
CALL assert_true('maps rejects invalid tenant_id', @fk_caught = 1);

-- ─── tenant_members: tenant_id must reference a valid tenant ─────────────────

SET @fk_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 SET @fk_caught = 1;
    INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (99999, 30, 'admin');
END;
CALL assert_true('tenant_members rejects invalid tenant_id', @fk_caught = 1);

-- ─── tenant_members: user_id must reference a valid user ─────────────────────

SET @fk_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 SET @fk_caught = 1;
    INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (30, 99999, 'admin');
END;
CALL assert_true('tenant_members rejects invalid user_id', @fk_caught = 1);

-- ─── tenants: org_id must reference a valid organization ─────────────────────

SET @fk_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 SET @fk_caught = 1;
    INSERT INTO tenants (org_id, name, slug) VALUES (99999, 'BadOrg', 'badorg');
END;
CALL assert_true('tenants rejects invalid org_id', @fk_caught = 1);

-- ─── annotations: map_id must reference a valid map ──────────────────────────

SET @fk_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 SET @fk_caught = 1;
    INSERT INTO annotations (map_id, created_by, type, title, geo_json)
        VALUES (99999, 30, 'marker', 'Bad', '{"type":"Point","coordinates":[0,0]}');
END;
CALL assert_true('annotations rejects invalid map_id', @fk_caught = 1);

-- ─── annotations: created_by must reference a valid user ─────────────────────

INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (30, 30, 30, 'FKMap');

SET @fk_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 SET @fk_caught = 1;
    INSERT INTO annotations (map_id, created_by, type, title, geo_json)
        VALUES (30, 99999, 'marker', 'Bad', '{"type":"Point","coordinates":[0,0]}');
END;
CALL assert_true('annotations rejects invalid created_by', @fk_caught = 1);

-- ─── annotation_media: annotation_id must reference a valid annotation ───────

SET @fk_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 SET @fk_caught = 1;
    INSERT INTO annotation_media (annotation_id, media_type, url)
        VALUES (99999, 'image', 'https://example.com/bad.png');
END;
CALL assert_true('annotation_media rejects invalid annotation_id', @fk_caught = 1);

-- ─── sso_providers: org_id must reference a valid organization ────────────────

SET @fk_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 SET @fk_caught = 1;
    INSERT INTO sso_providers (org_id, config) VALUES (99999, '{}');
END;
CALL assert_true('sso_providers rejects invalid org_id', @fk_caught = 1);

-- ─── audit_log: user_id FK allows NULL but rejects invalid refs ──────────────

-- NULL should be accepted
INSERT INTO audit_log (event_type, user_id, ip_address) VALUES ('fk_test', NULL, '127.0.0.1');
SELECT COUNT(*) INTO @cnt FROM audit_log WHERE event_type = 'fk_test' AND user_id IS NULL;
CALL assert_equals('audit_log accepts NULL user_id', '1', CAST(@cnt AS CHAR));

-- Invalid non-NULL reference should be rejected
SET @fk_caught = 0;
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 SET @fk_caught = 1;
    INSERT INTO audit_log (event_type, user_id, ip_address)
        VALUES ('fk_test_bad', 99999, '127.0.0.1');
END;
CALL assert_true('audit_log rejects invalid user_id FK', @fk_caught = 1);
