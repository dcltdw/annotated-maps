-- Migration 005: Multi-tenancy — Organizations, Tenants, Members, SSO Providers
-- Safe to run multiple times (IF NOT EXISTS guards).

-- ─── Organizations ────────────────────────────────────────────────────────────
-- Top-level identity unit. One company = one org.

CREATE TABLE IF NOT EXISTS organizations (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name       VARCHAR(255)    NOT NULL,
    slug       VARCHAR(64)     NOT NULL,
    created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_org_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─── Tenants ─────────────────────────────────────────────────────────────────
-- Department / team within an org. The unit of data isolation.

CREATE TABLE IF NOT EXISTS tenants (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    org_id     BIGINT UNSIGNED NOT NULL,
    name       VARCHAR(255)    NOT NULL,
    slug       VARCHAR(64)     NOT NULL,
    created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_org_slug (org_id, slug),
    KEY idx_tenant_org (org_id),

    CONSTRAINT fk_tenant_org
        FOREIGN KEY (org_id) REFERENCES organizations (id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─── Tenant Members ───────────────────────────────────────────────────────────
-- A user may appear in multiple tenants (within the same org) with independent roles.
--
-- Roles:
--   admin  — full access + member management
--   editor — create/edit own maps and annotations
--   viewer — read-only

CREATE TABLE IF NOT EXISTS tenant_members (
    id         BIGINT UNSIGNED                       NOT NULL AUTO_INCREMENT,
    tenant_id  BIGINT UNSIGNED                       NOT NULL,
    user_id    BIGINT UNSIGNED                       NOT NULL,
    role       ENUM('admin','editor','viewer')        NOT NULL DEFAULT 'viewer',
    created_at TIMESTAMP                             NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_tm_tenant_user (tenant_id, user_id),
    KEY idx_tm_user (user_id),

    CONSTRAINT fk_tm_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
    CONSTRAINT fk_tm_user
        FOREIGN KEY (user_id)   REFERENCES users   (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─── SSO Providers ────────────────────────────────────────────────────────────
-- One OIDC config per organization (one IdP per org for v2.0).
--
-- config JSON keys:
--   issuer                  — OIDC issuer URL (for verification)
--   client_id               — OAuth2 client ID
--   client_secret           — OAuth2 client secret
--   redirect_uri            — Must match IdP's allowed redirect URIs
--   authorization_endpoint  — IdP authorization URL
--   token_endpoint          — IdP token exchange URL
--   userinfo_endpoint       — IdP userinfo URL

CREATE TABLE IF NOT EXISTS sso_providers (
    id         BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    org_id     BIGINT UNSIGNED     NOT NULL,
    provider   ENUM('oidc')        NOT NULL DEFAULT 'oidc',
    config     JSON                NOT NULL,
    created_at TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_sso_org (org_id),

    CONSTRAINT fk_sso_org
        FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
