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
CALL check_column('maps', 'tenant_id',         'NO');
CALL check_column('maps', 'coordinate_system', 'NO');
CALL check_column('maps', 'owner_xray',        'NO');

-- nodes
CALL check_column('nodes', 'id',                  'NO');
CALL check_column('nodes', 'map_id',              'NO');
CALL check_column('nodes', 'parent_id',           'YES');
CALL check_column('nodes', 'name',                'NO');
CALL check_column('nodes', 'geo_json',            'YES');
CALL check_column('nodes', 'description',         'YES');
CALL check_column('nodes', 'color',               'YES');
CALL check_column('nodes', 'visibility_override', 'NO');
CALL check_column('nodes', 'created_by',          'NO');

-- notes (rebuilt — no lat/lng/group_id/map_id; attach via node_id)
CALL check_column('notes', 'id',                  'NO');
CALL check_column('notes', 'node_id',             'NO');
CALL check_column('notes', 'created_by',          'NO');
CALL check_column('notes', 'title',               'YES');
CALL check_column('notes', 'text',                'NO');
CALL check_column('notes', 'pinned',              'NO');
CALL check_column('notes', 'color',               'YES');
CALL check_column('notes', 'visibility_override', 'NO');

-- visibility_groups + members
CALL check_column('visibility_groups',         'tenant_id',          'NO');
CALL check_column('visibility_groups',         'name',               'NO');
CALL check_column('visibility_groups',         'manages_visibility', 'NO');
CALL check_column('visibility_group_members',  'visibility_group_id','NO');
CALL check_column('visibility_group_members',  'user_id',            'NO');

-- plots
CALL check_column('plots',      'tenant_id',  'NO');
CALL check_column('plots',      'name',       'NO');
CALL check_column('plot_nodes', 'plot_id',    'NO');
CALL check_column('plot_nodes', 'node_id',    'NO');
CALL check_column('plot_notes', 'plot_id',    'NO');
CALL check_column('plot_notes', 'note_id',    'NO');

-- node_media + note_media
CALL check_column('node_media', 'node_id',    'NO');
CALL check_column('node_media', 'media_type', 'NO');
CALL check_column('node_media', 'url',        'NO');
CALL check_column('note_media', 'note_id',    'NO');
CALL check_column('note_media', 'media_type', 'NO');
CALL check_column('note_media', 'url',        'NO');

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
