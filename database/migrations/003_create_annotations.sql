-- Migration 003: Annotations & Media

-- ─── Annotation types ─────────────────────────────────────────────────────────
-- 'marker'   → GeoJSON Point
-- 'polyline' → GeoJSON LineString
-- 'polygon'  → GeoJSON Polygon

CREATE TABLE IF NOT EXISTS annotations (
    id          BIGINT UNSIGNED                           NOT NULL AUTO_INCREMENT,
    map_id      BIGINT UNSIGNED                           NOT NULL,
    created_by  BIGINT UNSIGNED                           NOT NULL,
    type        ENUM('marker','polyline','polygon')       NOT NULL,
    title       VARCHAR(255)                              NOT NULL,
    description TEXT,
    -- GeoJSON geometry stored as JSON text (e.g. {"type":"Point","coordinates":[...]})
    geo_json    JSON                                      NOT NULL,
    created_at  TIMESTAMP                                 NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP                                 NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                                   ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_ann_map       (map_id),
    KEY idx_ann_creator   (created_by),
    KEY idx_ann_updated   (updated_at),

    CONSTRAINT fk_ann_map
        FOREIGN KEY (map_id)     REFERENCES maps  (id) ON DELETE CASCADE,
    CONSTRAINT fk_ann_creator
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─── Annotation media attachments ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS annotation_media (
    id            BIGINT UNSIGNED            NOT NULL AUTO_INCREMENT,
    annotation_id BIGINT UNSIGNED            NOT NULL,
    media_type    ENUM('image','link')       NOT NULL,
    url           VARCHAR(2048)              NOT NULL,
    caption       VARCHAR(512)                        DEFAULT NULL,
    created_at    TIMESTAMP                  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_media_annotation (annotation_id),

    CONSTRAINT fk_media_annotation
        FOREIGN KEY (annotation_id) REFERENCES annotations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
