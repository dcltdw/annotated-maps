-- Migration 007: Audit Log
-- Records security-relevant events for compliance and incident investigation.

CREATE TABLE IF NOT EXISTS audit_log (
    id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    event_type     VARCHAR(64)      NOT NULL,
    user_id        BIGINT UNSIGNED           DEFAULT NULL,
    target_user_id BIGINT UNSIGNED           DEFAULT NULL,
    tenant_id      BIGINT UNSIGNED           DEFAULT NULL,
    ip_address     VARCHAR(45)      NOT NULL,
    detail         JSON                      DEFAULT NULL,
    created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_audit_user    (user_id),
    KEY idx_audit_event   (event_type),
    KEY idx_audit_created (created_at),

    CONSTRAINT fk_audit_user
        FOREIGN KEY (user_id)        REFERENCES users   (id) ON DELETE SET NULL,
    CONSTRAINT fk_audit_target
        FOREIGN KEY (target_user_id) REFERENCES users   (id) ON DELETE SET NULL,
    CONSTRAINT fk_audit_tenant
        FOREIGN KEY (tenant_id)      REFERENCES tenants (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
