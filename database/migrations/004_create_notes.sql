-- Migration 004: Notes
-- Lightweight location-pinned text notes, separate from GeoJSON annotations.
-- group_id is NULL for phase 1 (ungrouped). note_groups table comes in phase 2.

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
    created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_notes_map     (map_id),
    KEY idx_notes_creator (created_by),
    FULLTEXT idx_notes_text (title, text),

    CONSTRAINT fk_notes_map
        FOREIGN KEY (map_id)     REFERENCES maps  (id) ON DELETE CASCADE,
    CONSTRAINT fk_notes_creator
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
