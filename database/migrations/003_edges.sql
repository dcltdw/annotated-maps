-- Migration 003: Node edges (#148)
-- Adds a graph layer alongside the existing tree (parent_id) for
-- relational use cases — trade routes, ferry connections, quest
-- dependencies, gates between regions. The tree structure stays for
-- containment ("Region → City"); edges layer in for "A connects to B."
--
-- Edges are visible to a user iff BOTH endpoints are visible to them
-- under the existing per-node visibility rules (see #197). No per-edge
-- visibility tags — derived purely from endpoint visibility.

CREATE TABLE IF NOT EXISTS node_edges (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    map_id          BIGINT UNSIGNED  NOT NULL,
    source_node_id  BIGINT UNSIGNED  NOT NULL,
    dest_node_id    BIGINT UNSIGNED  NOT NULL,
    directed        BOOLEAN          NOT NULL DEFAULT FALSE,
    color           VARCHAR(9)                DEFAULT NULL,
    label           VARCHAR(255)              DEFAULT NULL,
    description     TEXT                      DEFAULT NULL,
    created_by      BIGINT UNSIGNED  NOT NULL,
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                              ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_edge_map_src  (map_id, source_node_id),
    KEY idx_edge_map_dst  (map_id, dest_node_id),
    KEY idx_edge_creator  (created_by),

    -- Self-loop prevention. Cross-map edges are out of scope for v1;
    -- the controller enforces "both nodes belong to map_id" at insert
    -- time. Duplicate edges (same source/dest/directed) are allowed
    -- on purpose — distinct trade routes, distinct ferry runs, etc.
    CONSTRAINT chk_edge_no_self_loop CHECK (source_node_id <> dest_node_id),

    CONSTRAINT fk_edge_map
        FOREIGN KEY (map_id)         REFERENCES maps  (id) ON DELETE CASCADE,
    CONSTRAINT fk_edge_src
        FOREIGN KEY (source_node_id) REFERENCES nodes (id) ON DELETE CASCADE,
    CONSTRAINT fk_edge_dst
        FOREIGN KEY (dest_node_id)   REFERENCES nodes (id) ON DELETE CASCADE,
    CONSTRAINT fk_edge_creator
        FOREIGN KEY (created_by)     REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
