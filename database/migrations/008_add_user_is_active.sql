-- Migration 008: Add is_active flag to users for token-validity rechecking.
-- When FALSE, JwtFilter rejects the bearer token even if it is cryptographically valid.

ALTER TABLE users
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE
        AFTER external_id;

ALTER TABLE users
    ADD KEY idx_users_active (is_active);
