-- test_01_schema_exists.sql
-- Verify all expected tables exist after running migrations 001-009.

SOURCE helpers.sql;

SET @db = DATABASE();

-- Check each table exists
SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'users';
CALL assert_equals('table users exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'maps';
CALL assert_equals('table maps exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'map_permissions';
CALL assert_equals('table map_permissions exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'annotations';
CALL assert_equals('table annotations exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'annotation_media';
CALL assert_equals('table annotation_media exists', '1', CAST(@cnt AS CHAR));

SELECT COUNT(*) INTO @cnt FROM information_schema.tables
    WHERE table_schema = @db AND table_name = 'organizations';
CALL assert_equals('table organizations exists', '1', CAST(@cnt AS CHAR));

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
    WHERE table_schema = @db AND table_name = 'audit_log';
CALL assert_equals('table audit_log exists', '1', CAST(@cnt AS CHAR));
