-- test_10_note_groups.sql
-- Verify note_groups table structure, constraints, and cascading.

SOURCE helpers.sql;

-- ─── Setup ───────────────────────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (100, 'NGOrg', 'ngorg');
INSERT INTO tenants (id, org_id, name, slug) VALUES (100, 100, 'NGTenant', 'ng');
INSERT INTO users (id, username, email, password_hash, org_id, status)
    VALUES (100, 'ng_user', 'ng@test.com', NULL, 100, 'active');
INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (100, 100, 100, 'NGMap');

-- ─── Table exists ────────────────────────────────────────────────────────────

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'note_groups';
CALL assert_equals('note_groups table exists', '1', CAST(@cnt AS CHAR));

-- ─── Insert a group ──────────────────────────────────────────────────────────

INSERT INTO note_groups (id, map_id, name, color, sort_order, created_by)
    VALUES (100, 100, 'Safety Hazards', '#dc2626', 1, 100);

SELECT COUNT(*) INTO @cnt FROM note_groups WHERE id = 100;
CALL assert_equals('note group inserted', '1', CAST(@cnt AS CHAR));

-- ─── Defaults ────────────────────────────────────────────────────────────────

INSERT INTO note_groups (id, map_id, name, created_by) VALUES (101, 100, 'No Color', 100);

SELECT color INTO @c FROM note_groups WHERE id = 101;
CALL assert_equals('note_groups.color defaults to NULL', NULL, @c);

SELECT description INTO @d FROM note_groups WHERE id = 101;
CALL assert_equals('note_groups.description defaults to NULL', NULL, @d);

SELECT sort_order INTO @so FROM note_groups WHERE id = 101;
CALL assert_equals('note_groups.sort_order defaults to 0', '0', CAST(@so AS CHAR));

-- ─── Unique constraint (map_id, name) ────────────────────────────────────────

DROP PROCEDURE IF EXISTS test_dup_group_name;
DELIMITER $$
CREATE PROCEDURE test_dup_group_name()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 BEGIN END;
    INSERT INTO note_groups (map_id, name, created_by) VALUES (100, 'Safety Hazards', 100);
END$$
DELIMITER ;

SELECT COUNT(*) INTO @before FROM note_groups WHERE map_id = 100;
CALL test_dup_group_name();
SELECT COUNT(*) INTO @after FROM note_groups WHERE map_id = 100;
CALL assert_true('note_groups rejects duplicate (map_id, name)', @before = @after);
DROP PROCEDURE IF EXISTS test_dup_group_name;

-- ─── Same name on different map is allowed ───────────────────────────────────

INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (101, 100, 100, 'OtherMap');
INSERT INTO note_groups (id, map_id, name, created_by) VALUES (102, 101, 'Safety Hazards', 100);

SELECT COUNT(*) INTO @cnt FROM note_groups WHERE name = 'Safety Hazards';
CALL assert_equals('same group name on different map allowed', '2', CAST(@cnt AS CHAR));

-- ─── FK: notes.group_id references note_groups ───────────────────────────────

INSERT INTO notes (id, map_id, created_by, lat, lng, text, group_id)
    VALUES (100, 100, 100, 40.0, -74.0, 'Grouped note', 100);

SELECT group_id INTO @gid FROM notes WHERE id = 100;
CALL assert_equals('note.group_id set correctly', '100', CAST(@gid AS CHAR));

-- ─── FK: invalid group_id rejected ───────────────────────────────────────────

DROP PROCEDURE IF EXISTS test_bad_group;
DELIMITER $$
CREATE PROCEDURE test_bad_group()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 BEGIN END;
    INSERT INTO notes (map_id, created_by, lat, lng, text, group_id)
        VALUES (100, 100, 40.0, -74.0, 'Bad group', 99999);
END$$
DELIMITER ;

SELECT COUNT(*) INTO @before FROM notes;
CALL test_bad_group();
SELECT COUNT(*) INTO @after FROM notes;
CALL assert_true('notes rejects invalid group_id FK', @before = @after);
DROP PROCEDURE IF EXISTS test_bad_group;

-- ─── CASCADE: deleting map cascades note_groups ──────────────────────────────

INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (102, 100, 100, 'CascadeGroupMap');
INSERT INTO note_groups (id, map_id, name, created_by) VALUES (103, 102, 'Temp Group', 100);

SELECT COUNT(*) INTO @before FROM note_groups WHERE id = 103;
DELETE FROM maps WHERE id = 102;
SELECT COUNT(*) INTO @after FROM note_groups WHERE id = 103;

CALL assert_equals('cascade: group exists before map delete', '1', CAST(@before AS CHAR));
CALL assert_equals('cascade: group gone after map delete', '0', CAST(@after AS CHAR));

-- ─── SET NULL: deleting group sets notes.group_id to NULL ────────────────────

SELECT group_id INTO @gid_before FROM notes WHERE id = 100;
CALL assert_equals('before group delete: note has group_id', '100', CAST(@gid_before AS CHAR));

DELETE FROM note_groups WHERE id = 100;

SELECT group_id INTO @gid_after FROM notes WHERE id = 100;
CALL assert_equals('after group delete: note.group_id is NULL', NULL, CAST(@gid_after AS CHAR));
