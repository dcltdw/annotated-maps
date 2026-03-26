-- Migration 002: Maps

CREATE TABLE IF NOT EXISTS maps (
    id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    owner_id    BIGINT UNSIGNED  NOT NULL,
    title       VARCHAR(255)     NOT NULL,
    description TEXT,
    center_lat  DECIMAL(10, 7)   NOT NULL DEFAULT 0.0,
    center_lng  DECIMAL(10, 7)   NOT NULL DEFAULT 0.0,
    zoom        TINYINT UNSIGNED NOT NULL DEFAULT 3,
    created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_maps_owner (owner_id),
    KEY idx_maps_updated (updated_at),

    CONSTRAINT fk_maps_owner
        FOREIGN KEY (owner_id) REFERENCES users (id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─── Per-map permissions ───────────────────────────────────────────────────────
--
-- Permission rows describe who can view or edit a map.
--
--   user_id IS NULL  →  applies to the public (unauthenticated users)
--   user_id = N      →  applies to the specific logged-in user
--
-- The map owner always has full access; no row is needed for them.
-- Permissions are additive: edit implies view.

CREATE TABLE IF NOT EXISTS map_permissions (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    map_id     BIGINT UNSIGNED NOT NULL,
    user_id    BIGINT UNSIGNED          DEFAULT NULL,  -- NULL = public
    can_view   BOOLEAN         NOT NULL DEFAULT FALSE,
    can_edit   BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    -- Enforce one row per (map, user) pair; NULL user_id = public row
    UNIQUE KEY uq_map_user (map_id, user_id),
    KEY idx_mp_user (user_id),

    CONSTRAINT fk_mp_map
        FOREIGN KEY (map_id)  REFERENCES maps  (id) ON DELETE CASCADE,
    CONSTRAINT fk_mp_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
