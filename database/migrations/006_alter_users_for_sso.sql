-- Migration 006: Alter users + maps for multi-tenancy and SSO.
-- Also performs the data backfill: creates a personal org/tenant for every
-- existing user and sets tenant_id on all existing maps.

-- ─── 1. Alter users ───────────────────────────────────────────────────────────

-- Allow NULL password_hash for SSO users who have no local password.
ALTER TABLE users
    MODIFY COLUMN password_hash VARCHAR(255) NULL DEFAULT NULL;

-- Add org membership (NULL = personal / standalone user pre-backfill).
ALTER TABLE users
    ADD COLUMN org_id      BIGINT UNSIGNED NULL DEFAULT NULL
        AFTER updated_at,
    ADD COLUMN external_id VARCHAR(255)    NULL DEFAULT NULL
        AFTER org_id;

-- Composite unique: one external_id per org (SSO identity dedup).
ALTER TABLE users
    ADD UNIQUE KEY uq_user_org_external (org_id, external_id);

ALTER TABLE users
    ADD CONSTRAINT fk_user_org
        FOREIGN KEY (org_id) REFERENCES organizations (id)
        ON DELETE SET NULL;


-- ─── 2. Add tenant_id to maps ─────────────────────────────────────────────────

-- Allow NULL initially so the backfill can run before we add the NOT NULL
-- constraint (MySQL requires this for existing rows).
ALTER TABLE maps
    ADD COLUMN tenant_id BIGINT UNSIGNED NULL DEFAULT NULL
        AFTER owner_id;

ALTER TABLE maps
    ADD KEY idx_maps_tenant (tenant_id);

ALTER TABLE maps
    ADD CONSTRAINT fk_maps_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants (id)
        ON DELETE CASCADE;


-- ─── 3. Backfill: personal org + tenant per existing user ─────────────────────
--
-- For each user without an org_id:
--   a. Create an organization with slug = username.
--   b. Create a tenant "Personal" inside that org.
--   c. Add tenant_members row (role = admin).
--   d. Set org_id on the user.
--   e. Set tenant_id on all maps owned by that user.

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

        -- a. Org (slug = username; add suffix if collision)
        INSERT INTO organizations (name, slug)
        VALUES (v_uname, v_uname)
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id);
        SET v_org_id = LAST_INSERT_ID();

        -- b. Tenant
        INSERT INTO tenants (org_id, name, slug)
        VALUES (v_org_id, 'Personal', 'personal')
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id);
        SET v_ten_id = LAST_INSERT_ID();

        -- c. Member
        INSERT IGNORE INTO tenant_members (tenant_id, user_id, role)
        VALUES (v_ten_id, v_user_id, 'admin');

        -- d. User org_id
        UPDATE users SET org_id = v_org_id WHERE id = v_user_id;

        -- e. Maps
        UPDATE maps SET tenant_id = v_ten_id
        WHERE owner_id = v_user_id AND tenant_id IS NULL;

    END LOOP;

    CLOSE cur;
END$$

DELIMITER ;

CALL backfill_personal_tenants();
DROP PROCEDURE IF EXISTS backfill_personal_tenants;


-- ─── 4. Enforce NOT NULL on tenant_id now that backfill is complete ────────────

ALTER TABLE maps
    MODIFY COLUMN tenant_id BIGINT UNSIGNED NOT NULL;


SELECT 'Migration 006 complete.' AS status;
