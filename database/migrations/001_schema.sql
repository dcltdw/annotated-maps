-- Migration 001: Core schema (nodes-rebuild edition)
--
-- This file represents the complete schema after the nodes-rebuild
-- effort (see #82 and the long-running `nodes-rebuild` branch). Since
-- the project has no deployed databases, the schema is rebuilt from
-- scratch in final form on each branch rather than carrying ALTER TABLE
-- history forward. See #44 for the original consolidation rationale.
--
-- High-level model:
--   * `nodes` form a tree (parent_id) on a map. Each node has optional
--     GeoJSON geometry (point/polyline/polygon), a name, description,
--     color, and a visibility-override flag. They replace the old
--     `annotations` table and add hierarchy.
--   * `notes` attach to a node (no own coordinates). Inherit position
--     and (in later phases) visibility from the attached node.
--   * `visibility_groups` are tenant-scoped, generic audiences. Nodes
--     and notes are tagged with N visibility groups (multi-tag).
--     Visibility cascades up the node tree via NULL-fallthrough.
--   * `plots` are tenant-scoped narrative groupings, many-to-many to
--     both nodes and notes via two parallel junction tables.
--   * Maps carry a `coordinate_system` JSON column so the geometry
--     numbers in nodes can mean different things (WGS84 lat/lng,
--     image pixels, blank canvas) — see Phase 2f for backdrop work.
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
-- `coordinate_system` is a JSON config that tells the frontend how to
-- render the map and what the geometry numbers in `nodes.geo_json` mean.
-- Validated at the API layer; expected shapes:
--   { "type": "wgs84", "center": {"lat", "lng"}, "zoom": N }
--   { "type": "pixel", "image_url", "width", "height", "viewport": {x, y, zoom} }
--   { "type": "blank", "extent": {x, y} }
--
-- `owner_xray` (default FALSE) is an opt-in toggle so map owners can
-- bypass node-visibility filtering when they need to see hidden content
-- (e.g., a GM testing what's set up before a session). Off by default
-- so the owner gets the same view as everyone else.

CREATE TABLE IF NOT EXISTS maps (
    id                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    owner_id          BIGINT UNSIGNED  NOT NULL,
    tenant_id         BIGINT UNSIGNED  NOT NULL,
    title             VARCHAR(255)     NOT NULL,
    description       TEXT,
    coordinate_system JSON             NOT NULL,
    owner_xray        BOOLEAN          NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
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

-- ─── Visibility Groups ────────────────────────────────────────────────────────
-- Tenant-scoped, generic audiences. No "GM" / "Player" baked in — each
-- tenant defines its own audience names. A node or note tagged with N
-- groups is visible to a user who is a member of *any* of those groups
-- (multi-tag, OR semantics).
--
-- `manages_visibility = TRUE` means members of this group can manage
-- (CRUD) any visibility group in the tenant, in addition to tenant
-- admins. Bootstrapped per-tenant — see Phase 2b.i for the bootstrap
-- behavior.
--
-- This table is declared here so node_visibility / note_visibility FKs
-- below resolve. Phase 2b.i fills in the controller and bootstrap.

CREATE TABLE IF NOT EXISTS visibility_groups (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT UNSIGNED NOT NULL,
    name                VARCHAR(255)    NOT NULL,
    description         TEXT                     DEFAULT NULL,
    manages_visibility  BOOLEAN         NOT NULL DEFAULT FALSE,
    created_by          BIGINT UNSIGNED NOT NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                 ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_vg_tenant_name (tenant_id, name),
    KEY idx_vg_tenant            (tenant_id),

    CONSTRAINT fk_vg_tenant
        FOREIGN KEY (tenant_id)  REFERENCES tenants (id) ON DELETE CASCADE,
    CONSTRAINT fk_vg_creator
        FOREIGN KEY (created_by) REFERENCES users   (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS visibility_group_members (
    visibility_group_id BIGINT UNSIGNED NOT NULL,
    user_id             BIGINT UNSIGNED NOT NULL,
    joined_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (visibility_group_id, user_id),
    KEY idx_vgm_user (user_id),

    CONSTRAINT fk_vgm_group
        FOREIGN KEY (visibility_group_id) REFERENCES visibility_groups (id) ON DELETE CASCADE,
    CONSTRAINT fk_vgm_user
        FOREIGN KEY (user_id)             REFERENCES users             (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Nodes ────────────────────────────────────────────────────────────────────
-- The new central abstraction. Replaces the old `annotations` table and
-- adds hierarchy. Each node lives on a map, has an optional GeoJSON
-- geometry of any type (NULL = tree-only, no map presence), and may
-- have a parent node for tree structure.
--
-- `parent_id` must reference a node on the same map (enforced at the
-- application layer; MySQL doesn't easily express cross-row CHECKs).
--
-- `visibility_override`:
--   FALSE  → effective visibility inherits from parent (recursive walk
--            up parent_id chain until a node with override = TRUE; if
--            none found, falls back to "admin-only" — i.e., the empty
--            visibility group set).
--   TRUE   → effective visibility is exactly this node's `node_visibility`
--            rows. An empty set = explicit "admin-only".
-- (Phase 2b.ii wires up the filtering; this column ships in 2a.i.)
--
-- Tree depth ceiling: enforced at the application layer (~20 levels).
-- The recursive visibility walk and Phase 2d's subtree CTE both bound
-- their recursion against this.

CREATE TABLE IF NOT EXISTS nodes (
    id                   BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    map_id               BIGINT UNSIGNED  NOT NULL,
    parent_id            BIGINT UNSIGNED           DEFAULT NULL,
    name                 VARCHAR(255)     NOT NULL,
    geo_json             JSON                      DEFAULT NULL,
    description          TEXT                      DEFAULT NULL,
    color                VARCHAR(9)                DEFAULT NULL,
    visibility_override  BOOLEAN          NOT NULL DEFAULT FALSE,
    created_by           BIGINT UNSIGNED  NOT NULL,
    created_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                   ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_nodes_map     (map_id),
    KEY idx_nodes_parent  (parent_id),
    KEY idx_nodes_creator (created_by),

    CONSTRAINT fk_nodes_map
        FOREIGN KEY (map_id)     REFERENCES maps  (id) ON DELETE CASCADE,
    CONSTRAINT fk_nodes_parent
        FOREIGN KEY (parent_id)  REFERENCES nodes (id) ON DELETE CASCADE,
    CONSTRAINT fk_nodes_creator
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Node Visibility (junction) ──────────────────────────────────────────────
-- A node tagged with N visibility groups. See `nodes.visibility_override`
-- for inheritance semantics. Filtering wired up in Phase 2b.ii.

CREATE TABLE IF NOT EXISTS node_visibility (
    node_id              BIGINT UNSIGNED NOT NULL,
    visibility_group_id  BIGINT UNSIGNED NOT NULL,

    PRIMARY KEY (node_id, visibility_group_id),
    KEY idx_nv_group (visibility_group_id),

    CONSTRAINT fk_nv_node
        FOREIGN KEY (node_id)             REFERENCES nodes             (id) ON DELETE CASCADE,
    CONSTRAINT fk_nv_group
        FOREIGN KEY (visibility_group_id) REFERENCES visibility_groups (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Notes ────────────────────────────────────────────────────────────────────
-- Lightweight text content attached to a node. No own coordinates —
-- inherits position from `node_id`. Inherits visibility from its node
-- by default; can override per-note (Phase 2b.iii wires up filtering).

CREATE TABLE IF NOT EXISTS notes (
    id                   BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    node_id              BIGINT UNSIGNED  NOT NULL,
    created_by           BIGINT UNSIGNED  NOT NULL,
    title                VARCHAR(255)              DEFAULT NULL,
    text                 TEXT             NOT NULL,
    pinned               BOOLEAN          NOT NULL DEFAULT FALSE,
    color                VARCHAR(9)                DEFAULT NULL,
    visibility_override  BOOLEAN          NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                   ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_notes_node    (node_id),
    KEY idx_notes_creator (created_by),
    FULLTEXT idx_notes_text (title, text),

    CONSTRAINT fk_notes_node
        FOREIGN KEY (node_id)    REFERENCES nodes (id) ON DELETE CASCADE,
    CONSTRAINT fk_notes_creator
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Note Visibility (junction) ──────────────────────────────────────────────
-- Same shape as node_visibility. Inheritance walks: note → its node →
-- node's parent chain. Filtering wired up in Phase 2b.iii.

CREATE TABLE IF NOT EXISTS note_visibility (
    note_id              BIGINT UNSIGNED NOT NULL,
    visibility_group_id  BIGINT UNSIGNED NOT NULL,

    PRIMARY KEY (note_id, visibility_group_id),
    KEY idx_notev_group (visibility_group_id),

    CONSTRAINT fk_notev_note
        FOREIGN KEY (note_id)             REFERENCES notes             (id) ON DELETE CASCADE,
    CONSTRAINT fk_notev_group
        FOREIGN KEY (visibility_group_id) REFERENCES visibility_groups (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Plots ────────────────────────────────────────────────────────────────────
-- Tenant-scoped narrative groupings. Many-to-many to both nodes and
-- notes via two parallel junction tables (clean FKs, no discriminator).
-- Phase 2c wires up the controller; this ticket just lays the schema.

CREATE TABLE IF NOT EXISTS plots (
    id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    tenant_id   BIGINT UNSIGNED  NOT NULL,
    name        VARCHAR(255)     NOT NULL,
    description TEXT                      DEFAULT NULL,
    created_by  BIGINT UNSIGNED  NOT NULL,
    created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_plots_tenant (tenant_id),

    CONSTRAINT fk_plots_tenant
        FOREIGN KEY (tenant_id)  REFERENCES tenants (id) ON DELETE CASCADE,
    CONSTRAINT fk_plots_creator
        FOREIGN KEY (created_by) REFERENCES users   (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plot_nodes (
    plot_id BIGINT UNSIGNED NOT NULL,
    node_id BIGINT UNSIGNED NOT NULL,

    PRIMARY KEY (plot_id, node_id),
    KEY idx_pn_node (node_id),

    CONSTRAINT fk_pn_plot
        FOREIGN KEY (plot_id) REFERENCES plots (id) ON DELETE CASCADE,
    CONSTRAINT fk_pn_node
        FOREIGN KEY (node_id) REFERENCES nodes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plot_notes (
    plot_id BIGINT UNSIGNED NOT NULL,
    note_id BIGINT UNSIGNED NOT NULL,

    PRIMARY KEY (plot_id, note_id),
    KEY idx_pnn_note (note_id),

    CONSTRAINT fk_pnn_plot
        FOREIGN KEY (plot_id) REFERENCES plots (id) ON DELETE CASCADE,
    CONSTRAINT fk_pnn_note
        FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Node Media ──────────────────────────────────────────────────────────────
-- Image / link attachments on a node. Phase 2a.iii wires up the controller.

CREATE TABLE IF NOT EXISTS node_media (
    id            BIGINT UNSIGNED      NOT NULL AUTO_INCREMENT,
    node_id       BIGINT UNSIGNED      NOT NULL,
    media_type    ENUM('image','link') NOT NULL,
    url           VARCHAR(2048)        NOT NULL,
    caption       VARCHAR(512)                  DEFAULT NULL,
    created_at    TIMESTAMP            NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_nodemedia_node (node_id),

    CONSTRAINT fk_nodemedia_node
        FOREIGN KEY (node_id) REFERENCES nodes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Note Media ──────────────────────────────────────────────────────────────
-- Image / link attachments on a note. Same shape as node_media. Phase 2a.iii.

CREATE TABLE IF NOT EXISTS note_media (
    id            BIGINT UNSIGNED      NOT NULL AUTO_INCREMENT,
    note_id       BIGINT UNSIGNED      NOT NULL,
    media_type    ENUM('image','link') NOT NULL,
    url           VARCHAR(2048)        NOT NULL,
    caption       VARCHAR(512)                  DEFAULT NULL,
    created_at    TIMESTAMP            NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_notemedia_note (note_id),

    CONSTRAINT fk_notemedia_note
        FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
