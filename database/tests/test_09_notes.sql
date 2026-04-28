-- test_09_notes.sql
-- Verify notes table structure and constraints under the nodes-rebuild
-- schema. Notes attach to a node (no own coordinates), inherit visibility
-- from the attached node by default, and CASCADE when their node or
-- creator is deleted.

SOURCE helpers.sql;

-- ─── Setup ───────────────────────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (90, 'NoteOrg', 'noteorg');
INSERT INTO tenants (id, org_id, name, slug) VALUES (90, 90, 'NoteTenant', 'note');
INSERT INTO users (id, username, email, password_hash, org_id, status)
    VALUES (90, 'note_user', 'note@test.com', NULL, 90, 'active');
INSERT INTO maps (id, owner_id, tenant_id, title, coordinate_system)
    VALUES (90, 90, 90, 'NoteMap', '{"type":"wgs84","center":{"lat":0,"lng":0},"zoom":3}');
INSERT INTO nodes (id, map_id, created_by, name) VALUES (90, 90, 90, 'NoteAnchor');

-- ─── Insert a note ───────────────────────────────────────────────────────────

INSERT INTO notes (id, node_id, created_by, title, text)
    VALUES (90, 90, 90, 'Test Note', 'This is a test note');

SELECT COUNT(*) INTO @cnt FROM notes WHERE id = 90;
CALL assert_equals('note inserted', '1', CAST(@cnt AS CHAR));

-- ─── Title is nullable ──────────────────────────────────────────────────────

INSERT INTO notes (id, node_id, created_by, text)
    VALUES (91, 90, 90, 'No title note');

SELECT title INTO @t FROM notes WHERE id = 91;
CALL assert_equals('notes.title allows NULL', NULL, @t);

-- ─── node_id is required ────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS test_note_no_node;
DELIMITER $$
CREATE PROCEDURE test_note_no_node()
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
    INSERT INTO notes (created_by, text) VALUES (90, 'orphan');
END$$
DELIMITER ;
SELECT COUNT(*) INTO @before FROM notes;
CALL test_note_no_node();
SELECT COUNT(*) INTO @after FROM notes;
CALL assert_true('notes rejects missing node_id', @before = @after);
DROP PROCEDURE IF EXISTS test_note_no_node;

-- ─── CASCADE: deleting node cascades notes ──────────────────────────────────

INSERT INTO nodes (id, map_id, created_by, name) VALUES (91, 90, 90, 'CascadeAnchor');
INSERT INTO notes (id, node_id, created_by, text) VALUES (92, 91, 90, 'cascade test');

SELECT COUNT(*) INTO @before FROM notes WHERE node_id = 91;
CALL assert_equals('cascade setup: note exists', '1', CAST(@before AS CHAR));
DELETE FROM nodes WHERE id = 91;
SELECT COUNT(*) INTO @after FROM notes WHERE node_id = 91;
CALL assert_equals('deleting node cascades notes', '0', CAST(@after AS CHAR));

-- ─── CASCADE: deleting map cascades through nodes to notes ──────────────────

INSERT INTO maps (id, owner_id, tenant_id, title, coordinate_system)
    VALUES (91, 90, 90, 'TransitiveMap', '{"type":"wgs84","center":{"lat":0,"lng":0},"zoom":3}');
INSERT INTO nodes (id, map_id, created_by, name) VALUES (92, 91, 90, 'TransitiveAnchor');
INSERT INTO notes (id, node_id, created_by, text) VALUES (93, 92, 90, 'transitive');

DELETE FROM maps WHERE id = 91;
SELECT COUNT(*) INTO @cnt FROM notes WHERE id = 93;
CALL assert_equals('deleting map cascades through nodes to notes', '0', CAST(@cnt AS CHAR));

-- ─── RESTRICT: deleting user with notes is blocked ───────────────────────────
-- User 92 creates a note on a node owned by user 90.
-- Deleting user 92 should be blocked by RESTRICT on notes.created_by,
-- because the CASCADE path (maps.owner_id → nodes.map_id) doesn't clear
-- user 92's notes (user 92 doesn't own the map).

INSERT INTO users (id, username, email, password_hash, org_id, status)
    VALUES (92, 'note_user2', 'note2@test.com', NULL, 90, 'active');
INSERT INTO notes (id, node_id, created_by, text) VALUES (94, 90, 92, 'restrict test');

DROP PROCEDURE IF EXISTS test_user_del_with_notes;
DELIMITER $$
CREATE PROCEDURE test_user_del_with_notes()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1451 BEGIN END;
    DELETE FROM users WHERE id = 92;
END$$
DELIMITER ;

SELECT COUNT(*) INTO @before FROM users WHERE id = 92;
CALL test_user_del_with_notes();
SELECT COUNT(*) INTO @after FROM users WHERE id = 92;
CALL assert_equals('deleting user with notes is RESTRICTed (before)', '1', CAST(@before AS CHAR));
CALL assert_equals('deleting user with notes is RESTRICTed (after)',  '1', CAST(@after AS CHAR));
DROP PROCEDURE IF EXISTS test_user_del_with_notes;

-- ─── Fulltext index exists ──────────────────────────────────────────────────

SELECT COUNT(*) INTO @cnt FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'notes' AND index_name = 'idx_notes_text';
CALL assert_true('notes has FULLTEXT(title, text) index', @cnt > 0);
