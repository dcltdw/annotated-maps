-- test_04_cascade_behavior.sql
-- Verify ON DELETE CASCADE and ON DELETE SET NULL behave correctly.

SOURCE helpers.sql;

-- ─── Setup ───────────────────────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (10, 'CascadeOrg', 'cascade');
INSERT INTO tenants (id, org_id, name, slug) VALUES (10, 10, 'CascadeTenant', 'cascade');
INSERT INTO users (id, username, email, password_hash, org_id, status)
    VALUES (10, 'cascade_user', 'cascade@test.com', NULL, 10, 'active');
INSERT INTO users (id, username, email, password_hash, org_id, status)
    VALUES (11, 'cascade_user2', 'cascade2@test.com', NULL, 10, 'active');
INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (10, 10, 'admin');
INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (10, 11, 'viewer');
INSERT INTO sso_providers (org_id, config) VALUES (10, '{"issuer":"test"}');
INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (10, 10, 10, 'CascadeMap');
INSERT INTO map_permissions (map_id, user_id, level) VALUES (10, 11, 'view');
INSERT INTO annotations (id, map_id, created_by, type, title, geo_json)
    VALUES (10, 10, 10, 'marker', 'TestAnn', '{"type":"Point","coordinates":[0,0]}');
INSERT INTO annotation_media (id, annotation_id, media_type, url)
    VALUES (10, 10, 'image', 'https://example.com/img.png');

-- Audit log entries referencing these entities
INSERT INTO audit_log (event_type, user_id, target_user_id, tenant_id, ip_address)
    VALUES ('test_event', 10, 11, 10, '127.0.0.1');

-- ─── Test: deleting an org cascades to tenants, tenant_members, sso_providers ─

DELETE FROM organizations WHERE id = 10;

SELECT COUNT(*) INTO @cnt FROM tenants WHERE id = 10;
CALL assert_equals('deleting org cascades tenants', '0', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM tenant_members WHERE tenant_id = 10;
CALL assert_equals('deleting org cascades tenant_members', '0', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM sso_providers WHERE org_id = 10;
CALL assert_equals('deleting org cascades sso_providers', '0', CAST(@cnt AS CHAR));

-- Maps should also be gone (tenant cascade)
SELECT COUNT(*) INTO @cnt FROM maps WHERE id = 10;
CALL assert_equals('deleting org cascades maps via tenant', '0', CAST(@cnt AS CHAR));

-- Annotations should be gone (map cascade)
SELECT COUNT(*) INTO @cnt FROM annotations WHERE id = 10;
CALL assert_equals('deleting org cascades annotations via map', '0', CAST(@cnt AS CHAR));

-- Annotation media should be gone (annotation cascade)
SELECT COUNT(*) INTO @cnt FROM annotation_media WHERE id = 10;
CALL assert_equals('deleting org cascades annotation_media via annotation', '0', CAST(@cnt AS CHAR));

-- Map permissions should be gone (map cascade)
SELECT COUNT(*) INTO @cnt FROM map_permissions WHERE map_id = 10;
CALL assert_equals('deleting org cascades map_permissions via map', '0', CAST(@cnt AS CHAR));

-- ─── Test: audit_log uses SET NULL, not CASCADE ──────────────────────────────

-- The audit_log entry should still exist but with NULLed FKs
SELECT COUNT(*) INTO @cnt FROM audit_log WHERE event_type = 'test_event';
CALL assert_equals('audit_log row survives entity deletion', '1', CAST(@cnt AS CHAR));

SELECT tenant_id INTO @tid FROM audit_log WHERE event_type = 'test_event' LIMIT 1;
CALL assert_equals('audit_log.tenant_id set to NULL after tenant deletion',
                    NULL, CAST(@tid AS CHAR));

-- ─── Test: deleting a user sets audit_log.user_id to NULL ────────────────────

-- Re-create minimal data for user deletion test
INSERT INTO organizations (id, name, slug) VALUES (20, 'UserDelOrg', 'userdel');
INSERT INTO tenants (id, org_id, name, slug) VALUES (20, 20, 'UDTenant', 'ud');
INSERT INTO users (id, username, email, password_hash, org_id, status)
    VALUES (20, 'delme', 'delme@test.com', NULL, 20, 'active');
INSERT INTO audit_log (event_type, user_id, ip_address)
    VALUES ('user_del_test', 20, '127.0.0.1');

DELETE FROM users WHERE id = 20;

SELECT COUNT(*) INTO @cnt FROM audit_log WHERE event_type = 'user_del_test';
CALL assert_equals('audit_log row survives user deletion', '1', CAST(@cnt AS CHAR));

SELECT user_id INTO @uid FROM audit_log WHERE event_type = 'user_del_test' LIMIT 1;
CALL assert_equals('audit_log.user_id set to NULL after user deletion',
                    NULL, CAST(@uid AS CHAR));

-- ─── Test: deleting a user cascades to tenant_members ────────────────────────

INSERT INTO users (id, username, email, password_hash, org_id, status)
    VALUES (21, 'member_del', 'memberdel@test.com', NULL, 20, 'active');
INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (20, 21, 'editor');

SELECT COUNT(*) INTO @before FROM tenant_members WHERE user_id = 21;
DELETE FROM users WHERE id = 21;
SELECT COUNT(*) INTO @after FROM tenant_members WHERE user_id = 21;

CALL assert_equals('deleting user cascades tenant_members (before)', '1', CAST(@before AS CHAR));
CALL assert_equals('deleting user cascades tenant_members (after)', '0', CAST(@after AS CHAR));

-- ─── Test: deleting a map cascades to map_permissions ────────────────────────

INSERT INTO users (id, username, email, password_hash, org_id, status)
    VALUES (22, 'mapperm_user', 'mapperm@test.com', NULL, 20, 'active');
INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (20, 22, 20, 'PermMap');
INSERT INTO map_permissions (map_id, user_id, level) VALUES (20, NULL, 'view');
INSERT INTO map_permissions (map_id, user_id, level) VALUES (20, 22, 'view');

SELECT COUNT(*) INTO @before FROM map_permissions WHERE map_id = 20;
DELETE FROM maps WHERE id = 20;
SELECT COUNT(*) INTO @after FROM map_permissions WHERE map_id = 20;

CALL assert_equals('deleting map cascades map_permissions (before)', '2', CAST(@before AS CHAR));
CALL assert_equals('deleting map cascades map_permissions (after)', '0', CAST(@after AS CHAR));

-- ─── Test: deleting an annotation cascades to annotation_media ───────────────

INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (21, 22, 20, 'MediaMap');
INSERT INTO annotations (id, map_id, created_by, type, title, geo_json)
    VALUES (20, 21, 22, 'marker', 'MediaAnn', '{"type":"Point","coordinates":[1,1]}');
INSERT INTO annotation_media (annotation_id, media_type, url)
    VALUES (20, 'link', 'https://example.com');
INSERT INTO annotation_media (annotation_id, media_type, url)
    VALUES (20, 'image', 'https://example.com/img2.png');

SELECT COUNT(*) INTO @before FROM annotation_media WHERE annotation_id = 20;
DELETE FROM annotations WHERE id = 20;
SELECT COUNT(*) INTO @after FROM annotation_media WHERE annotation_id = 20;

CALL assert_equals('deleting annotation cascades media (before)', '2', CAST(@before AS CHAR));
CALL assert_equals('deleting annotation cascades media (after)', '0', CAST(@after AS CHAR));
