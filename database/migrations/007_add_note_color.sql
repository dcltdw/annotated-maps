-- Migration 007: Add per-note color column.
-- Optional hex color for individual note markers on the map.
-- When set, overrides the group color and the default cyan.

ALTER TABLE notes
    ADD COLUMN color VARCHAR(9) DEFAULT NULL
        AFTER pinned;
