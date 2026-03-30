-- test_07_backfill_idempotent.sql
-- Verify that the migration 006 backfill procedure is idempotent:
-- running it a second time produces no duplicates or errors.
--
-- We simulate a pre-migration-006 user (no org_id), run the backfill
-- procedure twice, and verify the counts remain stable.

SOURCE helpers.sql;

-- ─── Setup: insert a user with no org (simulating pre-006 state) ─────────────

INSERT INTO organizations (id, name, slug) VALUES (50, 'BackfillOrg', 'backfill');
INSERT INTO tenants (id, org_id, name, slug) VALUES (50, 50, 'BackfillTenant', 'backfill');
INSERT INTO users (id, username, email, password_hash, org_id, is_active)
    VALUES (50, 'backfill_user', 'backfill@test.com', NULL, NULL, TRUE);
INSERT INTO maps (id, owner_id, tenant_id, title) VALUES (50, 50, 50, 'BackfillMap');

-- Set user's org to NULL to simulate pre-backfill state
UPDATE users SET org_id = NULL WHERE id = 50;
UPDATE maps SET tenant_id = 50 WHERE id = 50;

-- ─── Run the backfill procedure ──────────────────────────────────────────────

DROP PROCEDURE IF EXISTS backfill_personal_tenants;

DELIMITER $$
CREATE PROCEDURE backfill_personal_tenants()
BEGIN
    DECLARE done      INT DEFAULT FALSE;
    DECLARE v_user_id BIGINT UNSIGNED;
    DECLARE v_uname   VARCHAR(64);
    DECLARE v_org_id  BIGINT UNSIGNED;
    DECLARE v_ten_id  BIGINT UNSIGNED;
    DECLARE cur CURSOR FOR
        SELECT id, username FROM users WHERE org_id IS NULL;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
    OPEN cur;
    read_loop: LOOP
        FETCH cur INTO v_user_id, v_uname;
        IF done THEN LEAVE read_loop; END IF;
        INSERT INTO organizations (name, slug)
        VALUES (v_uname, v_uname)
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id);
        SET v_org_id = LAST_INSERT_ID();
        INSERT INTO tenants (org_id, name, slug)
        VALUES (v_org_id, 'Personal', 'personal')
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id);
        SET v_ten_id = LAST_INSERT_ID();
        INSERT IGNORE INTO tenant_members (tenant_id, user_id, role)
        VALUES (v_ten_id, v_user_id, 'admin');
        UPDATE users SET org_id = v_org_id WHERE id = v_user_id;
        UPDATE maps SET tenant_id = v_ten_id
        WHERE owner_id = v_user_id AND tenant_id IS NULL;
    END LOOP;
    CLOSE cur;
END$$
DELIMITER ;

-- First run
CALL backfill_personal_tenants();

-- Count after first run
SELECT COUNT(*) INTO @orgs1 FROM organizations WHERE slug = 'backfill_user';
SELECT COUNT(*) INTO @members1 FROM tenant_members WHERE user_id = 50;
SELECT org_id INTO @org_id1 FROM users WHERE id = 50;

CALL assert_equals('backfill run 1: org created', '1', CAST(@orgs1 AS CHAR));
CALL assert_equals('backfill run 1: membership created', '1', CAST(@members1 AS CHAR));
CALL assert_true('backfill run 1: user.org_id set', @org_id1 IS NOT NULL);

-- Second run (should be a no-op since user now has org_id)
CALL backfill_personal_tenants();

SELECT COUNT(*) INTO @orgs2 FROM organizations WHERE slug = 'backfill_user';
SELECT COUNT(*) INTO @members2 FROM tenant_members WHERE user_id = 50;

CALL assert_equals('backfill run 2: no duplicate orgs', '1', CAST(@orgs2 AS CHAR));
CALL assert_equals('backfill run 2: no duplicate members', '1', CAST(@members2 AS CHAR));

DROP PROCEDURE IF EXISTS backfill_personal_tenants;
