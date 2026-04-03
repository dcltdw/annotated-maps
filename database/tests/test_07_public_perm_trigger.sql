-- test_07_public_perm_trigger.sql
-- Verify the trigger prevents duplicate public permission rows per map.

SOURCE helpers.sql;

-- ─── Setup ───────────────────────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (70, 'TrigOrg', 'trig');
INSERT INTO tenants (id, org_id, name, slug) VALUES (70, 70, 'TrigTenant', 'trig');
INSERT INTO users (id, username, email, password_hash, org_id, status)
    VALUES (70, 'trig_user', 'trig@test.com', NULL, 70, 'active');
INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (70, 70, 70, 'TrigMap');
INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (71, 70, 70, 'TrigMap2');

-- ─── Test: first public row is accepted ──────────────────────────────────────

INSERT INTO map_permissions (map_id, user_id, level) VALUES (70, NULL, 'view');
SELECT COUNT(*) INTO @cnt FROM map_permissions WHERE map_id = 70 AND user_id IS NULL;
CALL assert_equals('first public permission row accepted', '1', CAST(@cnt AS CHAR));

-- ─── Test: second public row for same map is rejected ────────────────────────

DROP PROCEDURE IF EXISTS test_dup_public;
DELIMITER $$
CREATE PROCEDURE test_dup_public()
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE '23000' BEGIN END;
    INSERT INTO map_permissions (map_id, user_id, level) VALUES (70, NULL, 'view');
END$$
DELIMITER ;

SELECT COUNT(*) INTO @before FROM map_permissions WHERE map_id = 70 AND user_id IS NULL;
CALL test_dup_public();
SELECT COUNT(*) INTO @after FROM map_permissions WHERE map_id = 70 AND user_id IS NULL;
CALL assert_true('second public permission row rejected', @before = @after);

-- ─── Test: public row on a different map is accepted ─────────────────────────

INSERT INTO map_permissions (map_id, user_id, level) VALUES (71, NULL, 'view');
SELECT COUNT(*) INTO @cnt FROM map_permissions WHERE map_id = 71 AND user_id IS NULL;
CALL assert_equals('public permission on different map accepted', '1', CAST(@cnt AS CHAR));

-- ─── Test: named user rows are unaffected by trigger ─────────────────────────

INSERT INTO map_permissions (map_id, user_id, level) VALUES (70, 70, 'view');
SELECT COUNT(*) INTO @cnt FROM map_permissions WHERE map_id = 70 AND user_id = 70;
CALL assert_equals('named user permission still works', '1', CAST(@cnt AS CHAR));

-- Cleanup
DROP PROCEDURE IF EXISTS test_dup_public;
