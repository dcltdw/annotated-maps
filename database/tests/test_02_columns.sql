-- test_02_columns.sql
-- Verify key columns exist with expected types after all migrations.

SOURCE helpers.sql;

SET @db = DATABASE();

-- Helper: check a column exists
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

-- users: columns from migrations 001, 006, 008
CALL check_column('users', 'id',            'NO');
CALL check_column('users', 'username',      'NO');
CALL check_column('users', 'email',         'NO');
CALL check_column('users', 'password_hash', 'YES');  -- nullable after migration 006
CALL check_column('users', 'org_id',        'YES');  -- nullable FK, migration 006
CALL check_column('users', 'external_id',   'YES');  -- nullable, migration 006
CALL check_column('users', 'is_active',     'NO');   -- NOT NULL DEFAULT TRUE, migration 008

-- maps: tenant_id from migration 006
CALL check_column('maps', 'tenant_id',      'NO');   -- NOT NULL after backfill

-- tenants: branding from migration 009
CALL check_column('tenants', 'branding',    'YES');  -- nullable JSON

-- audit_log: key columns from migration 007
CALL check_column('audit_log', 'event_type',     'NO');
CALL check_column('audit_log', 'user_id',        'YES');  -- nullable FK
CALL check_column('audit_log', 'target_user_id', 'YES');  -- nullable FK
CALL check_column('audit_log', 'tenant_id',      'YES');  -- nullable FK
CALL check_column('audit_log', 'ip_address',     'NO');
CALL check_column('audit_log', 'detail',         'YES');  -- nullable JSON

DROP PROCEDURE IF EXISTS check_column;
