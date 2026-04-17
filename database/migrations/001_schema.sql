-- Migration 001: Core schema (consolidated)
--
-- This file represents the complete schema after consolidation of the
-- incremental migrations 001-007 that existed during pre-release
-- development. Since the project has no deployed databases, we rebuilt
-- the schema from scratch in final form instead of carrying ALTER TABLE
-- history forward. See #44 for the consolidation rationale.
--
-- Audit log lives in 002_audit_log.sql (separate lifecycle).
-- Dev seed data is in database/seed-local-dev.{sql,py}, not in migrations.

-- ─── Organizations ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name       VARCHAR(255)    NOT NULL,
    slug       VARCHAR(64)     NOT NULL,
    created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_org_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Users ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username      VARCHAR(64)     NOT NULL,
    email         VARCHAR(255)    NOT NULL,
    password_hash VARCHAR(255)             DEFAULT NULL,  -- NULL for SSO-only users
    status        ENUM('active','suspended','deactivated','pending','locked')
                                  NOT NULL DEFAULT 'active',
    platform_role ENUM('superuser','support','none')
                                  NOT NULL DEFAULT 'none',
    org_id        BIGINT UNSIGNED          DEFAULT NULL,
    external_id   VARCHAR(255)             DEFAULT NULL,  -- OIDC subject claim
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                           ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username     (username),
    UNIQUE KEY uq_users_email        (email),
    UNIQUE KEY uq_user_org_external  (org_id, external_id),
    KEY idx_users_status             (status),

    CONSTRAINT fk_user_org
        FOREIGN KEY (org_id) REFERENCES organizations (id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Tenants ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    org_id     BIGINT UNSIGNED NOT NULL,
    name       VARCHAR(255)    NOT NULL,
    slug       VARCHAR(64)     NOT NULL,
    branding   JSON                     DEFAULT NULL,
    created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_org_slug (org_id, slug),
    KEY idx_tenant_org            (org_id),

    CONSTRAINT fk_tenant_org
        FOREIGN KEY (org_id) REFERENCES organizations (id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Tenant Members ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_members (
    id         BIGINT UNSIGNED                NOT NULL AUTO_INCREMENT,
    tenant_id  BIGINT UNSIGNED                NOT NULL,
    user_id    BIGINT UNSIGNED                NOT NULL,
    role       ENUM('admin','editor','viewer') NOT NULL DEFAULT 'viewer',
    created_at TIMESTAMP                      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_tm_tenant_user (tenant_id, user_id),
    KEY idx_tm_user              (user_id),

    CONSTRAINT fk_tm_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
    CONSTRAINT fk_tm_user
        FOREIGN KEY (user_id)   REFERENCES users   (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── SSO Providers ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sso_providers (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    org_id     BIGINT UNSIGNED NOT NULL,
    provider   ENUM('oidc')    NOT NULL DEFAULT 'oidc',
    config     JSON            NOT NULL,
    created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_sso_org (org_id),

    CONSTRAINT fk_sso_org
        FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Organization Members ─────────────────────────────────────────────────────

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
        FOREIGN KEY (org_id)  REFERENCES organizations (id) ON DELETE CASCADE,
    CONSTRAINT fk_om_user
        FOREIGN KEY (user_id) REFERENCES users         (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Maps ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS maps (
    id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    owner_id    BIGINT UNSIGNED  NOT NULL,
    tenant_id   BIGINT UNSIGNED  NOT NULL,
    title       VARCHAR(255)     NOT NULL,
    description TEXT,
    center_lat  DECIMAL(10, 7)   NOT NULL DEFAULT 0.0,
    center_lng  DECIMAL(10, 7)   NOT NULL DEFAULT 0.0,
    zoom        TINYINT UNSIGNED NOT NULL DEFAULT 3,
    created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_maps_owner   (owner_id),
    KEY idx_maps_tenant  (tenant_id),
    KEY idx_maps_updated (updated_at),

    CONSTRAINT fk_maps_owner
        FOREIGN KEY (owner_id)  REFERENCES users   (id) ON DELETE CASCADE,
    CONSTRAINT fk_maps_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Map Permissions ──────────────────────────────────────────────────────────
--
--   user_id IS NULL  →  public (unauthenticated) access
--   user_id = N      →  per-user access
--
-- The map owner always has full access; no row needed.
-- The `level` enum expresses access level; higher levels imply lower.
--
-- UNIQUE KEY (map_id, user_id) enforces one row per (map, named user).
-- For NULL user_id (public), the triggers below enforce at most one row
-- per map because MySQL's UNIQUE treats each NULL as distinct.

CREATE TABLE IF NOT EXISTS map_permissions (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    map_id     BIGINT UNSIGNED NOT NULL,
    user_id    BIGINT UNSIGNED          DEFAULT NULL,
    level      ENUM('none','view','comment','edit','moderate','admin')
                               NOT NULL DEFAULT 'none',
    created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_map_user (map_id, user_id),
    KEY idx_mp_user        (user_id),

    CONSTRAINT fk_mp_map
        FOREIGN KEY (map_id)  REFERENCES maps  (id) ON DELETE CASCADE,
    CONSTRAINT fk_mp_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

CREATE TRIGGER trg_map_perm_no_dup_public_insert
BEFORE INSERT ON map_permissions
FOR EACH ROW
BEGIN
    IF NEW.user_id IS NULL THEN
        IF (SELECT COUNT(*) FROM map_permissions
            WHERE map_id = NEW.map_id AND user_id IS NULL) > 0 THEN
            SIGNAL SQLSTATE '23000'
                SET MESSAGE_TEXT = 'Duplicate public permission for this map';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_map_perm_no_dup_public_update
BEFORE UPDATE ON map_permissions
FOR EACH ROW
BEGIN
    IF NEW.user_id IS NULL AND (OLD.user_id IS NOT NULL OR OLD.map_id != NEW.map_id) THEN
        IF (SELECT COUNT(*) FROM map_permissions
            WHERE map_id = NEW.map_id AND user_id IS NULL AND id != OLD.id) > 0 THEN
            SIGNAL SQLSTATE '23000'
                SET MESSAGE_TEXT = 'Duplicate public permission for this map';
        END IF;
    END IF;
END$$

DELIMITER ;

-- ─── Annotations ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS annotations (
    id          BIGINT UNSIGNED                     NOT NULL AUTO_INCREMENT,
    map_id      BIGINT UNSIGNED                     NOT NULL,
    created_by  BIGINT UNSIGNED                     NOT NULL,
    type        ENUM('marker','polyline','polygon')  NOT NULL,
    title       VARCHAR(255)                        NOT NULL,
    description TEXT,
    geo_json    JSON                                NOT NULL,
    created_at  TIMESTAMP                           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP                           NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                             ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_ann_map     (map_id),
    KEY idx_ann_creator (created_by),
    KEY idx_ann_updated (updated_at),

    CONSTRAINT fk_ann_map
        FOREIGN KEY (map_id)     REFERENCES maps  (id) ON DELETE CASCADE,
    CONSTRAINT fk_ann_creator
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Annotation Media ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS annotation_media (
    id            BIGINT UNSIGNED      NOT NULL AUTO_INCREMENT,
    annotation_id BIGINT UNSIGNED      NOT NULL,
    media_type    ENUM('image','link') NOT NULL,
    url           VARCHAR(2048)        NOT NULL,
    caption       VARCHAR(512)                  DEFAULT NULL,
    created_at    TIMESTAMP            NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_media_annotation (annotation_id),

    CONSTRAINT fk_media_annotation
        FOREIGN KEY (annotation_id) REFERENCES annotations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Note Groups ──────────────────────────────────────────────────────────────
-- Named categories for organizing notes, displayed as tabs in the UI.
-- Must be declared before `notes` so the FK below can reference it.

CREATE TABLE IF NOT EXISTS note_groups (
    id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    map_id      BIGINT UNSIGNED  NOT NULL,
    name        VARCHAR(255)     NOT NULL,
    description TEXT                      DEFAULT NULL,
    color       VARCHAR(9)                DEFAULT NULL,
    sort_order  INT              NOT NULL DEFAULT 0,
    created_by  BIGINT UNSIGNED  NOT NULL,
    created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_notegroup_map_name (map_id, name),
    KEY idx_notegroup_map (map_id),

    CONSTRAINT fk_notegroup_map
        FOREIGN KEY (map_id)     REFERENCES maps  (id) ON DELETE CASCADE,
    CONSTRAINT fk_notegroup_creator
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Notes ────────────────────────────────────────────────────────────────────
-- Lightweight location-pinned text notes, separate from GeoJSON annotations.
-- `color` overrides the group color and the default cyan when set.

CREATE TABLE IF NOT EXISTS notes (
    id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    map_id      BIGINT UNSIGNED  NOT NULL,
    group_id    BIGINT UNSIGNED           DEFAULT NULL,
    created_by  BIGINT UNSIGNED  NOT NULL,
    lat         DECIMAL(10, 7)   NOT NULL,
    lng         DECIMAL(10, 7)   NOT NULL,
    title       VARCHAR(255)              DEFAULT NULL,
    text        TEXT             NOT NULL,
    pinned      BOOLEAN          NOT NULL DEFAULT FALSE,
    color       VARCHAR(9)                DEFAULT NULL,
    created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_notes_map     (map_id),
    KEY idx_notes_group   (group_id),
    KEY idx_notes_creator (created_by),
    FULLTEXT idx_notes_text (title, text),

    CONSTRAINT fk_notes_map
        FOREIGN KEY (map_id)     REFERENCES maps         (id) ON DELETE CASCADE,
    CONSTRAINT fk_notes_group
        FOREIGN KEY (group_id)   REFERENCES note_groups  (id) ON DELETE SET NULL,
    CONSTRAINT fk_notes_creator
        FOREIGN KEY (created_by) REFERENCES users        (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
