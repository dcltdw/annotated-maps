-- Migration 005: User roles, org members, and boolean-to-enum conversions.
--
-- 1. users.is_active BOOLEAN → users.status ENUM
-- 2. users.platform_role ENUM (superuser, support, none)
-- 3. map_permissions.can_view/can_edit → map_permissions.level ENUM
-- 4. org_members table (organization-level roles)

-- ─── 1. Convert users.is_active to users.status ──────────────────────────────

ALTER TABLE users
    ADD COLUMN status ENUM('active','suspended','deactivated','pending','locked')
        NOT NULL DEFAULT 'active'
        AFTER is_active;

-- Backfill: active if is_active=TRUE, deactivated if FALSE
UPDATE users SET status = IF(is_active, 'active', 'deactivated');

-- Drop old column and index
ALTER TABLE users
    DROP INDEX idx_users_active,
    DROP COLUMN is_active;

ALTER TABLE users
    ADD KEY idx_users_status (status);

-- ─── 2. Add platform_role to users ───────────────────────────────────────────

ALTER TABLE users
    ADD COLUMN platform_role ENUM('superuser','support','none')
        NOT NULL DEFAULT 'none'
        AFTER status;

-- ─── 3. Convert map_permissions booleans to level enum ───────────────────────

ALTER TABLE map_permissions
    ADD COLUMN level ENUM('none','view','comment','edit','moderate','admin')
        NOT NULL DEFAULT 'none'
        AFTER user_id;

-- Backfill from boolean columns
UPDATE map_permissions SET level = CASE
    WHEN can_edit = TRUE THEN 'edit'
    WHEN can_view = TRUE THEN 'view'
    ELSE 'none'
END;

-- Drop old boolean columns
ALTER TABLE map_permissions
    DROP COLUMN can_view,
    DROP COLUMN can_edit;

-- ─── 4. Organization members ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_members (
    id         BIGINT UNSIGNED                       NOT NULL AUTO_INCREMENT,
    org_id     BIGINT UNSIGNED                       NOT NULL,
    user_id    BIGINT UNSIGNED                       NOT NULL,
    role       ENUM('owner','admin','member')         NOT NULL DEFAULT 'member',
    created_at TIMESTAMP                             NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_om_org_user (org_id, user_id),
    KEY idx_om_user (user_id),

    CONSTRAINT fk_om_org
        FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE,
    CONSTRAINT fk_om_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill: for each user with an org_id, create an org_members row.
-- Users who created their personal org get 'owner'. Others get 'member'.
-- Since we can't distinguish creators from members in the current schema,
-- default everyone to 'owner' for personal orgs (1 user = 1 org).
INSERT IGNORE INTO org_members (org_id, user_id, role)
    SELECT org_id, id, 'owner' FROM users WHERE org_id IS NOT NULL;

SELECT 'Migration 005 complete.' AS status;
