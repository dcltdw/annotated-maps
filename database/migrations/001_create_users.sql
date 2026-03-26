-- Migration 001: Users
-- Run in order. Each migration is idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS users (
    id            BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    username      VARCHAR(64)         NOT NULL,
    email         VARCHAR(255)        NOT NULL,
    password_hash VARCHAR(64)         NOT NULL,  -- SHA-256 hex (64 chars)
    created_at    TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP
                                               ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_email    (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
