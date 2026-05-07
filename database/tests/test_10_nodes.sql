-- test_10_nodes.sql
-- Verify the `nodes` table — the central new abstraction in the
-- nodes-rebuild schema. Replaces what `annotations` covered, plus
-- adds tree (parent_id) semantics.

SOURCE helpers.sql;

-- ─── Setup ───────────────────────────────────────────────────────────────────

INSERT INTO organizations (id, name, slug) VALUES (100, 'NodeOrg', 'nodeorg');
INSERT INTO tenants (id, org_id, name, slug) VALUES (100, 100, 'NodeTenant', 'node');
INSERT INTO users (id, username, email, password_hash, org_id, status)
    VALUES (100, 'node_user', 'node@test.com', NULL, 100, 'active');
INSERT INTO maps (id, owner_id, tenant_id, title, coordinate_system)
    VALUES (100, 100, 100, 'NodeMap', '{"type":"wgs84","center":{"lat":0,"lng":0},"zoom":3}');

-- ─── Insert a node with no geometry (tree-only) ─────────────────────────────

INSERT INTO nodes (id, map_id, created_by, name) VALUES (100, 100, 100, 'TreeOnly');
SELECT geo_json INTO @gj FROM nodes WHERE id = 100;
CALL assert_equals('nodes.geo_json allows NULL', NULL, CAST(@gj AS CHAR));

-- ─── Insert nodes with each GeoJSON geometry type ───────────────────────────

INSERT INTO nodes (id, map_id, created_by, name, geo_json)
    VALUES (101, 100, 100, 'Point', '{"type":"Point","coordinates":[0,0]}');
INSERT INTO nodes (id, map_id, created_by, name, geo_json)
    VALUES (102, 100, 100, 'Line',  '{"type":"LineString","coordinates":[[0,0],[1,1]]}');
INSERT INTO nodes (id, map_id, created_by, name, geo_json)
    VALUES (103, 100, 100, 'Poly',  '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}');

SELECT COUNT(*) INTO @cnt FROM nodes WHERE map_id = 100;
CALL assert_equals('nodes accepts all geometry types + tree-only', '4', CAST(@cnt AS CHAR));

-- ─── Tree structure: parent_id self-FK ──────────────────────────────────────

INSERT INTO nodes (id, map_id, parent_id, created_by, name)
    VALUES (110, 100, 100, 100, 'ChildOfTreeOnly');
SELECT parent_id INTO @pid FROM nodes WHERE id = 110;
CALL assert_equals('nodes.parent_id stored', '100', CAST(@pid AS CHAR));

-- Self-referencing parent should be allowed by the schema
-- (cycle prevention is at the application layer, not the DB).

-- ─── CASCADE: deleting parent cascades children (subtree delete) ────────────

INSERT INTO nodes (id, map_id, created_by, name) VALUES (120, 100, 100, 'SubtreeRoot');
INSERT INTO nodes (id, map_id, parent_id, created_by, name) VALUES (121, 100, 120, 100, 'L1A');
INSERT INTO nodes (id, map_id, parent_id, created_by, name) VALUES (122, 100, 120, 100, 'L1B');
INSERT INTO nodes (id, map_id, parent_id, created_by, name) VALUES (123, 100, 121, 100, 'L2');

SELECT COUNT(*) INTO @before FROM nodes WHERE id IN (120, 121, 122, 123);
DELETE FROM nodes WHERE id = 120;
SELECT COUNT(*) INTO @after  FROM nodes WHERE id IN (120, 121, 122, 123);
CALL assert_equals('subtree cascade deletes 4 nodes (before)', '4', CAST(@before AS CHAR));
CALL assert_equals('subtree cascade deletes 4 nodes (after)',  '0', CAST(@after AS CHAR));

-- ─── visibility_override defaults to FALSE ──────────────────────────────────

SELECT visibility_override INTO @vo FROM nodes WHERE id = 100;
CALL assert_equals('nodes.visibility_override defaults to FALSE', '0', CAST(@vo AS CHAR));

-- ─── Indexes exist for the access patterns the controllers will use ─────────

SELECT COUNT(*) INTO @cnt FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'nodes' AND index_name = 'idx_nodes_map';
CALL assert_true('nodes has idx_nodes_map', @cnt > 0);

SELECT COUNT(*) INTO @cnt FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'nodes' AND index_name = 'idx_nodes_parent';
CALL assert_true('nodes has idx_nodes_parent', @cnt > 0);
