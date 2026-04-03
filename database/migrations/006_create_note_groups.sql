-- Migration 006: Note Groups
-- Named categories for organizing notes, displayed as tabs in the UI.

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

-- Add FK constraint on existing notes.group_id column
ALTER TABLE notes
    ADD KEY idx_notes_group (group_id),
    ADD CONSTRAINT fk_notes_group
        FOREIGN KEY (group_id) REFERENCES note_groups (id) ON DELETE SET NULL;
