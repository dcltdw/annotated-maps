-- Migration 010: Fix NULL uniqueness gap in map_permissions.
--
-- MySQL's UNIQUE KEY treats each NULL as distinct, so the constraint
-- uq_map_user (map_id, user_id) allowed multiple public permission rows
-- (user_id=NULL) per map.
--
-- Fix: use BEFORE INSERT / BEFORE UPDATE triggers to check for existing
-- public rows and reject duplicates with a signal.

-- Step 1: Clean up any duplicate public rows that may already exist.
DELETE FROM map_permissions
    WHERE user_id IS NULL
    AND id NOT IN (
        SELECT keep_id FROM (
            SELECT MIN(id) AS keep_id
            FROM map_permissions
            WHERE user_id IS NULL
            GROUP BY map_id
        ) AS tmp
    );

-- Step 2: Add triggers to enforce one NULL user_id per map_id
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

SELECT 'Migration 010 complete.' AS status;
