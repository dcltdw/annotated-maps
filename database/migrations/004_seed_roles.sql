-- Migration 004: Optional seed data for development
-- Safe to skip in production.

-- Example: make all maps created by user 1 publicly viewable
-- INSERT INTO map_permissions (map_id, user_id, can_view, can_edit)
-- SELECT id, NULL, TRUE, FALSE FROM maps WHERE owner_id = 1
-- ON DUPLICATE KEY UPDATE can_view = TRUE;

-- This file intentionally left mostly empty.
-- Add development seed data here as the project grows.

SELECT 'Seed migration 004 complete.' AS status;
