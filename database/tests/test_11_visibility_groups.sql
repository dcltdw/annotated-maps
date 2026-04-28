-- test_11_visibility_groups.sql
-- Smoke tests for the visibility-related tables stubbed in 2a.i.
-- Phase 2b.i wires up the controller; 2b.ii/iii wire up filtering.
-- This file exercises the schema (insert/cascade/uniqueness) so the
-- foundation is sound before any feature work depends on it.

SOURCE helpers.sql;

-- ─── Setup ───────────────────────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (110, 'VisOrg', 'visorg');
INSERT INTO tenants (id, org_id, name, slug) VALUES (110, 110, 'VisTenant', 'vis');
INSERT INTO users (id, username, email, password_hash, org_id, status)
    VALUES (110, 'vis_user',  'vis@test.com',  NULL, 110, 'active');
INSERT INTO users (id, username, email, password_hash, org_id, status)
    VALUES (111, 'vis_user2', 'vis2@test.com', NULL, 110, 'active');
INSERT INTO maps (id, owner_id, tenant_id, title, coordinate_system)
    VALUES (110, 110, 110, 'VisMap', '{"type":"wgs84","center":{"lat":0,"lng":0},"zoom":3}');
INSERT INTO nodes (id, map_id, created_by, name) VALUES (110, 110, 110, 'VisNode');
INSERT INTO notes (id, node_id, created_by, text) VALUES (110, 110, 110, 'vis note');

-- ─── Insert visibility groups ───────────────────────────────────────────────

INSERT INTO visibility_groups (id, tenant_id, name, created_by)
    VALUES (110, 110, 'Players', 110);
INSERT INTO visibility_groups (id, tenant_id, name, manages_visibility, created_by)
    VALUES (111, 110, 'GMs', TRUE, 110);

SELECT COUNT(*) INTO @cnt FROM visibility_groups WHERE tenant_id = 110;
CALL assert_equals('visibility_groups inserted', '2', CAST(@cnt AS CHAR));

-- ─── Members ────────────────────────────────────────────────────────────────

INSERT INTO visibility_group_members (visibility_group_id, user_id) VALUES (110, 111);
INSERT INTO visibility_group_members (visibility_group_id, user_id) VALUES (111, 110);

SELECT COUNT(*) INTO @cnt FROM visibility_group_members WHERE visibility_group_id = 110;
CALL assert_equals('Players group has 1 member', '1', CAST(@cnt AS CHAR));

-- ─── Tag a node and a note ──────────────────────────────────────────────────

INSERT INTO node_visibility (node_id, visibility_group_id) VALUES (110, 110);
INSERT INTO note_visibility (note_id, visibility_group_id) VALUES (110, 110);

SELECT COUNT(*) INTO @cnt FROM node_visibility WHERE node_id = 110;
CALL assert_equals('node tagged with visibility group', '1', CAST(@cnt AS CHAR));
SELECT COUNT(*) INTO @cnt FROM note_visibility WHERE note_id = 110;
CALL assert_equals('note tagged with visibility group', '1', CAST(@cnt AS CHAR));

-- ─── CASCADE: deleting a visibility group clears its tags + members ─────────

DELETE FROM visibility_groups WHERE id = 110;

SELECT COUNT(*) INTO @cnt FROM visibility_group_members WHERE visibility_group_id = 110;
CALL assert_equals('deleting group cascades members', '0', CAST(@cnt AS CHAR));
SELECT COUNT(*) INTO @cnt FROM node_visibility WHERE visibility_group_id = 110;
CALL assert_equals('deleting group cascades node tags', '0', CAST(@cnt AS CHAR));
SELECT COUNT(*) INTO @cnt FROM note_visibility WHERE visibility_group_id = 110;
CALL assert_equals('deleting group cascades note tags', '0', CAST(@cnt AS CHAR));

-- ─── Plots smoke test ───────────────────────────────────────────────────────

INSERT INTO plots (id, tenant_id, name, created_by)
    VALUES (110, 110, 'The Quest', 110);
INSERT INTO plot_nodes (plot_id, node_id) VALUES (110, 110);
INSERT INTO plot_notes (plot_id, note_id) VALUES (110, 110);

SELECT COUNT(*) INTO @cnt FROM plot_nodes WHERE plot_id = 110;
CALL assert_equals('plot has node member', '1', CAST(@cnt AS CHAR));
SELECT COUNT(*) INTO @cnt FROM plot_notes WHERE plot_id = 110;
CALL assert_equals('plot has note member', '1', CAST(@cnt AS CHAR));

-- ─── CASCADE: deleting a plot cascades both junction tables ─────────────────

DELETE FROM plots WHERE id = 110;
SELECT COUNT(*) INTO @cnt FROM plot_nodes WHERE plot_id = 110;
CALL assert_equals('deleting plot cascades plot_nodes', '0', CAST(@cnt AS CHAR));
SELECT COUNT(*) INTO @cnt FROM plot_notes WHERE plot_id = 110;
CALL assert_equals('deleting plot cascades plot_notes', '0', CAST(@cnt AS CHAR));
