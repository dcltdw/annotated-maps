-- helpers.sql — Test assertion procedures.
-- Sourced at the top of each test file.

DROP PROCEDURE IF EXISTS assert_equals;
DROP PROCEDURE IF EXISTS assert_true;
DROP PROCEDURE IF EXISTS assert_row_count;

DELIMITER $$

-- Assert that two values are equal.
CREATE PROCEDURE assert_equals(IN test_name VARCHAR(255), IN expected VARCHAR(255), IN actual VARCHAR(255))
BEGIN
    IF expected = actual OR (expected IS NULL AND actual IS NULL) THEN
        SELECT CONCAT('PASS: ', test_name) AS result;
    ELSE
        SELECT CONCAT('FAIL: ', test_name, ' — expected [', IFNULL(expected, 'NULL'),
                       '] but got [', IFNULL(actual, 'NULL'), ']') AS result;
    END IF;
END$$

-- Assert that a condition is true (value = 1).
CREATE PROCEDURE assert_true(IN test_name VARCHAR(255), IN cond BOOLEAN)
BEGIN
    IF cond THEN
        SELECT CONCAT('PASS: ', test_name) AS result;
    ELSE
        SELECT CONCAT('FAIL: ', test_name) AS result;
    END IF;
END$$

-- Assert that a table/query returns exactly N rows.
-- Usage: CALL assert_row_count('test', 'SELECT ... FROM ...', expected_count);
--   Note: MySQL doesn't support dynamic SQL in stored functions easily,
--   so callers should SELECT INTO a variable and call assert_equals instead.
CREATE PROCEDURE assert_row_count(IN test_name VARCHAR(255), IN expected INT, IN actual INT)
BEGIN
    IF expected = actual THEN
        SELECT CONCAT('PASS: ', test_name) AS result;
    ELSE
        SELECT CONCAT('FAIL: ', test_name, ' — expected ', expected,
                       ' rows but got ', actual) AS result;
    END IF;
END$$

DELIMITER ;
