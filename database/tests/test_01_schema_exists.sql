-- test_01_schema_exists.sql
-- Verify all expected tables exist after running migrations.

SOURCE helpers.sql;

SET @db = DATABASE();

-- Identity / org
SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'organizations';
CALL assert_equals('table organizations exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'users';
CALL assert_equals('table users exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'tenants';
CALL assert_equals('table tenants exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'tenant_members';
CALL assert_equals('table tenant_members exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'sso_providers';
CALL assert_equals('table sso_providers exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'org_members';
CALL assert_equals('table org_members exists', '1', CAST(@cnt AS CHAR));

-- Maps
SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'maps';
CALL assert_equals('table maps exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'map_permissions';
CALL assert_equals('table map_permissions exists', '1', CAST(@cnt AS CHAR));

-- Nodes (replaces annotations)
SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'nodes';
CALL assert_equals('table nodes exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'node_media';
CALL assert_equals('table node_media exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'node_visibility';
CALL assert_equals('table node_visibility exists', '1', CAST(@cnt AS CHAR));

-- Notes (now node-attached)
SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'notes';
CALL assert_equals('table notes exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'note_media';
CALL assert_equals('table note_media exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'note_visibility';
CALL assert_equals('table note_visibility exists', '1', CAST(@cnt AS CHAR));

-- Visibility groups
SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'visibility_groups';
CALL assert_equals('table visibility_groups exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'visibility_group_members';
CALL assert_equals('table visibility_group_members exists', '1', CAST(@cnt AS CHAR));

-- Plots
SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'plots';
CALL assert_equals('table plots exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'plot_nodes';
CALL assert_equals('table plot_nodes exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'plot_notes';
CALL assert_equals('table plot_notes exists', '1', CAST(@cnt AS CHAR));

-- Audit log (separate migration file)
SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'audit_log';
CALL assert_equals('table audit_log exists', '1', CAST(@cnt AS CHAR));

-- Tables removed in nodes-rebuild — should NOT exist
SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'annotations';
CALL assert_equals('annotations table dropped', '0', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'annotation_media';
CALL assert_equals('annotation_media table dropped', '0', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'note_groups';
CALL assert_equals('note_groups table dropped', '0', CAST(@cnt AS CHAR));
