-- test_09_notes.sql
-- Verify notes table structure, constraints, and cascading behavior.

SOURCE helpers.sql;

-- ─── Setup ───────────────────────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (90, 'NoteOrg', 'noteorg');
INSERT INTO tenants (id, org_id, name, slug) VALUES (90, 90, 'NoteTenant', 'note');
INSERT INTO users (id, username, email, password_hash, org_id, is_active)
    VALUES (90, 'note_user', 'note@test.com', NULL, 90, TRUE);
INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (90, 90, 90, 'NoteMap');

-- ─── Table exists ────────────────────────────────────────────────────────────

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'notes';
CALL assert_equals('notes table exists', '1', CAST(@cnt AS CHAR));

-- ─── Insert a note ───────────────────────────────────────────────────────────

INSERT INTO notes (id, map_id, created_by, lat, lng, title, text)
    VALUES (90, 90, 90, 40.7128000, -74.0060000, 'Test Note', 'This is a test note');

SELECT COUNT(*) INTO @cnt FROM notes WHERE id = 90;
CALL assert_equals('note inserted', '1', CAST(@cnt AS CHAR));

-- ─── Defaults ────────────────────────────────────────────────────────────────

SELECT pinned INTO @pinned FROM notes WHERE id = 90;
CALL assert_equals('notes.pinned defaults to FALSE', '0', CAST(@pinned AS CHAR));

SELECT group_id INTO @gid FROM notes WHERE id = 90;
CALL assert_equals('notes.group_id defaults to NULL', NULL, CAST(@gid AS CHAR));

-- ─── Title is nullable ──────────────────────────────────────────────────────

INSERT INTO notes (id, map_id, created_by, lat, lng, text)
    VALUES (91, 90, 90, 40.7130000, -74.0062000, 'No title note');

SELECT title INTO @t FROM notes WHERE id = 91;
CALL assert_equals('notes.title allows NULL', NULL, @t);

-- ─── FK: invalid map_id rejected ─────────────────────────────────────────────

DROP PROCEDURE IF EXISTS test_note_bad_map;
DELIMITER $$
CREATE PROCEDURE test_note_bad_map()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 BEGIN END;
    INSERT INTO notes (map_id, created_by, lat, lng, text)
        VALUES (99999, 90, 0, 0, 'bad');
END$$
DELIMITER ;

SELECT COUNT(*) INTO @before FROM notes;
CALL test_note_bad_map();
SELECT COUNT(*) INTO @after FROM notes;
CALL assert_true('notes rejects invalid map_id', @before = @after);
DROP PROCEDURE IF EXISTS test_note_bad_map;

-- ─── FK: invalid created_by rejected ─────────────────────────────────────────

DROP PROCEDURE IF EXISTS test_note_bad_user;
DELIMITER $$
CREATE PROCEDURE test_note_bad_user()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1452 BEGIN END;
    INSERT INTO notes (map_id, created_by, lat, lng, text)
        VALUES (90, 99999, 0, 0, 'bad');
END$$
DELIMITER ;

SELECT COUNT(*) INTO @before FROM notes;
CALL test_note_bad_user();
SELECT COUNT(*) INTO @after FROM notes;
CALL assert_true('notes rejects invalid created_by', @before = @after);
DROP PROCEDURE IF EXISTS test_note_bad_user;

-- ─── CASCADE: deleting map cascades notes ────────────────────────────────────

INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (91, 90, 90, 'CascadeMap');
INSERT INTO notes (map_id, created_by, lat, lng, text)
    VALUES (91, 90, 0, 0, 'cascade test');

SELECT COUNT(*) INTO @before FROM notes WHERE map_id = 91;
CALL assert_equals('cascade setup: note exists', '1', CAST(@before AS CHAR));

DELETE FROM maps WHERE id = 91;

SELECT COUNT(*) INTO @after FROM notes WHERE map_id = 91;
CALL assert_equals('deleting map cascades notes', '0', CAST(@after AS CHAR));

-- ─── RESTRICT: deleting user with notes is blocked ───────────────────────────
-- User 92 creates a note on a map owned by user 90.
-- Deleting user 92 should be blocked by RESTRICT on notes.created_by,
-- because the CASCADE path (maps.owner_id) doesn't clear user 92's notes
-- (user 92 doesn't own the map).

INSERT INTO users (id, username, email, password_hash, org_id, is_active)
    VALUES (92, 'note_restricted', 'restrict@test.com', NULL, 90, TRUE);
INSERT INTO notes (map_id, created_by, lat, lng, text)
    VALUES (90, 92, 0, 0, 'restrict test');

DROP PROCEDURE IF EXISTS test_note_restrict_user;
DELIMITER $$
CREATE PROCEDURE test_note_restrict_user()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1451 BEGIN END;
    DELETE FROM users WHERE id = 92;
END$$
DELIMITER ;

CALL test_note_restrict_user();
SELECT COUNT(*) INTO @cnt FROM users WHERE id = 92;
CALL assert_equals('deleting user with notes is restricted', '1', CAST(@cnt AS CHAR));
DROP PROCEDURE IF EXISTS test_note_restrict_user;

-- ─── FULLTEXT search works ───────────────────────────────────────────────────

SELECT COUNT(*) INTO @cnt FROM notes
    WHERE MATCH(title, text) AGAINST('test note' IN NATURAL LANGUAGE MODE);
CALL assert_true('fulltext search finds notes', @cnt >= 1);
