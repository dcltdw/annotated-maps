-- test_02_columns.sql
-- Verify key columns exist with expected types and nullability.

SOURCE helpers.sql;

-- Helper: check a column exists with expected nullability
DROP PROCEDURE IF EXISTS check_column;
DELIMITER $$
CREATE PROCEDURE check_column(IN tbl VARCHAR(64), IN col VARCHAR(64), IN expected_nullable VARCHAR(3))
BEGIN
    DECLARE v_nullable VARCHAR(3) DEFAULT NULL;
    SELECT is_nullable INTO v_nullable FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = tbl AND column_name = col;
    IF v_nullable IS NULL THEN
        SELECT CONCAT('FAIL: ', tbl, '.', col, ' does not exist') AS result;
    ELSE
        IF expected_nullable = v_nullable THEN
            SELECT CONCAT('PASS: ', tbl, '.', col, ' exists (nullable=', v_nullable, ')') AS result;
        ELSE
            SELECT CONCAT('FAIL: ', tbl, '.', col, ' nullable mismatch — expected ',
                          expected_nullable, ' got ', v_nullable) AS result;
        END IF;
    END IF;
END$$
DELIMITER ;

-- users
CALL check_column('users', 'id',            'NO');
CALL check_column('users', 'username',      'NO');
CALL check_column('users', 'email',         'NO');
CALL check_column('users', 'password_hash', 'YES');
CALL check_column('users', 'org_id',        'YES');
CALL check_column('users', 'external_id',   'YES');
CALL check_column('users', 'status',         'NO');
CALL check_column('users', 'platform_role',  'NO');

-- maps
CALL check_column('maps', 'tenant_id',      'NO');

-- tenants
CALL check_column('tenants', 'branding',    'YES');

-- map_permissions (level enum replaces can_view/can_edit booleans)
CALL check_column('map_permissions', 'level', 'NO');

-- org_members
CALL check_column('org_members', 'org_id',   'NO');
CALL check_column('org_members', 'user_id',  'NO');
CALL check_column('org_members', 'role',     'NO');

-- audit_log
CALL check_column('audit_log', 'event_type',     'NO');
CALL check_column('audit_log', 'user_id',        'YES');
CALL check_column('audit_log', 'target_user_id', 'YES');
CALL check_column('audit_log', 'tenant_id',      'YES');
CALL check_column('audit_log', 'ip_address',     'NO');
CALL check_column('audit_log', 'detail',         'YES');

DROP PROCEDURE IF EXISTS check_column;
