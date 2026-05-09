#include "EdgeController.h"
#include "AuditLog.h"
#include "ErrorResponse.h"
#include <drogon/drogon.h>

// Phase 1 of the edges epic (#148). Schema + unfiltered CRUD; the
// visibility filter (edge visible iff BOTH endpoints visible) lands in
// #197 as a follow-up. Edges connect two nodes within a single map and
// are scoped to that map's permissions for read + write.
//
// Read authorization: caller must have view-level access to the map.
// Write authorization: caller must have edit-level access to the map
// (or be the owner) AND tenant role admin or editor.
//
// Endpoints are immutable on update — to "re-target" an edge, delete it
// and create a new one. Keeps audit semantics simple (an updated edge
// stays "the same edge" from the caller's perspective).

namespace {

int callerUserId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("userId"); }
    catch (...) { return 0; }
}

bool isTenantEditorOrAdmin(const drogon::HttpRequestPtr& req) {
    try {
        const auto role = req->getAttributes()->get<std::string>("tenantRole");
        return role == "admin" || role == "editor";
    } catch (...) { return false; }
}

Json::Value rowToEdge(const drogon::orm::Row& row) {
    Json::Value e;
    e["id"]            = row["id"].as<int>();
    e["mapId"]         = row["map_id"].as<int>();
    e["sourceNodeId"]  = row["source_node_id"].as<int>();
    e["destNodeId"]    = row["dest_node_id"].as<int>();
    e["directed"]      = row["directed"].as<bool>();
    e["color"]         = row["color"].isNull()
                            ? Json::Value()
                            : Json::Value(row["color"].as<std::string>());
    e["label"]         = row["label"].isNull()
                            ? Json::Value()
                            : Json::Value(row["label"].as<std::string>());
    e["description"]   = row["description"].isNull()
                            ? "" : row["description"].as<std::string>();
    e["createdBy"]     = row["created_by"].as<int>();
    e["createdAt"]     = row["created_at"].as<std::string>();
    e["updatedAt"]     = row["updated_at"].as<std::string>();
    return e;
}

const std::string EDGE_COLUMNS =
    "id, map_id, source_node_id, dest_node_id, directed, color, label, "
    "description, created_by, created_at, updated_at";

}  // namespace

// ─── GET /api/v1/tenants/{tid}/maps/{mid}/edges ──────────────────────────────

void EdgeController::listEdges(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId) {

    int userId = callerUserId(req);

    // First verify the caller has view access on the map; on success,
    // fetch the edges. Splitting the read makes 403/empty-array
    // distinguishable (map missing or hidden → 403; map visible but no
    // edges → 200 []).
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT m.id FROM maps m "
        "LEFT JOIN map_permissions mp     ON mp.map_id = m.id     AND mp.user_id = ? "
        "LEFT JOIN map_permissions mp_pub ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL "
        "                                AND mp_pub.level IN ('view','comment','edit','moderate','admin') "
        "WHERE m.id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? "
        "       OR mp.level IN ('view','comment','edit','moderate','admin') "
        "       OR mp_pub.level IN ('view','comment','edit','moderate','admin'))",
        [callback, mapId](const drogon::orm::Result& rAccess) {
            if (rAccess.empty()) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Map not found or insufficient permissions"));
                return;
            }
            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "SELECT " + EDGE_COLUMNS +
                " FROM node_edges WHERE map_id = ? "
                " ORDER BY created_at ASC, id ASC",
                [callback](const drogon::orm::Result& r) {
                    Json::Value arr(Json::arrayValue);
                    for (const auto& row : r) arr.append(rowToEdge(row));
                    callback(drogon::HttpResponse::newHttpJsonResponse(arr));
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to fetch edges"));
                },
                mapId);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Database error"));
        },
        userId, mapId, tenantId, userId);
}

// ─── POST /api/v1/tenants/{tid}/maps/{mid}/edges ─────────────────────────────

void EdgeController::createEdge(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId) {

    if (!isTenantEditorOrAdmin(req)) {
        callback(errorResponse(drogon::k403Forbidden,
            "forbidden", "Edge management requires editor or admin role"));
        return;
    }

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body || !(*body).isMember("sourceNodeId") || !(*body).isMember("destNodeId")) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "sourceNodeId and destNodeId are required"));
        return;
    }
    if (!(*body)["sourceNodeId"].isInt() || !(*body)["destNodeId"].isInt()) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "sourceNodeId and destNodeId must be integers"));
        return;
    }

    int sourceNodeId = (*body)["sourceNodeId"].asInt();
    int destNodeId   = (*body)["destNodeId"].asInt();
    if (sourceNodeId == destNodeId) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "sourceNodeId and destNodeId must differ"));
        return;
    }

    bool directed = (*body).get("directed", false).asBool();
    std::string color       = (*body).get("color", "").asString();
    std::string label       = (*body).get("label", "").asString();
    std::string description = (*body).get("description", "").asString();

    if (!checkMaxLen("label", label, MAX_NAME_LEN, callback)) return;
    if (!checkMaxLen("description", description, MAX_DESCRIPTION_LEN, callback)) return;
    // Color is short; 9-char column accepts #RRGGBBAA. Reject longer
    // values up-front for a clearer error than the DB truncation warning.
    if (color.size() > 9) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "color must be a hex color (e.g. #ff0000)"));
        return;
    }

    // Verify caller has edit access on the map AND both endpoints exist
    // on this map. Single SELECT does both checks: count of nodes whose
    // id ∈ {source, dest} AND map_id = ? must be 2.
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT m.id, "
        "       (SELECT COUNT(*) FROM nodes n "
        "          WHERE n.map_id = m.id AND n.id IN (?, ?)) AS endpoint_count "
        "FROM maps m "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "WHERE m.id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin'))",
        [callback, req, mapId, tenantId, userId,
         sourceNodeId, destNodeId, directed, color, label, description]
        (const drogon::orm::Result& rAcc) {
            if (rAcc.empty()) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Map not found or insufficient permissions"));
                return;
            }
            int endpointCount = rAcc[0]["endpoint_count"].as<int>();
            if (endpointCount != 2) {
                // Either one or both endpoints missing, or one is on a
                // different map. Same error either way — don't leak
                // which one — to avoid information disclosure.
                callback(errorResponse(drogon::k400BadRequest,
                    "bad_request",
                    "sourceNodeId and destNodeId must both exist on this map"));
                return;
            }

            // INSERT, then re-SELECT the canonical row (#152 pattern).
            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "INSERT INTO node_edges "
                "  (map_id, source_node_id, dest_node_id, directed, "
                "   color, label, description, created_by) "
                "VALUES (?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?)",
                [callback, req, mapId, tenantId, userId, sourceNodeId, destNodeId]
                (const drogon::orm::Result& rIns) {
                    int newId = static_cast<int>(rIns.insertId());
                    Json::Value detail;
                    detail["mapId"]        = mapId;
                    detail["edgeId"]       = newId;
                    detail["sourceNodeId"] = sourceNodeId;
                    detail["destNodeId"]   = destNodeId;
                    AuditLog::record("edge_create", req,
                        userId, 0, tenantId, detail);

                    auto db3 = drogon::app().getDbClient();
                    db3->execSqlAsync(
                        "SELECT " + EDGE_COLUMNS + " FROM node_edges "
                        "WHERE id = ? AND map_id = ?",
                        [callback](const drogon::orm::Result& rGet) {
                            if (rGet.empty()) {
                                callback(errorResponse(drogon::k500InternalServerError,
                                    "internal_error", "Edge vanished after insert"));
                                return;
                            }
                            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                                rowToEdge(rGet[0]));
                            resp->setStatusCode(drogon::k201Created);
                            callback(resp);
                        },
                        [callback](const drogon::orm::DrogonDbException&) {
                            callback(errorResponse(drogon::k500InternalServerError,
                                "db_error", "Failed to fetch created edge"));
                        },
                        newId, mapId);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to create edge"));
                },
                mapId, sourceNodeId, destNodeId, directed,
                color, label, description, userId);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Database error"));
        },
        sourceNodeId, destNodeId, userId, mapId, tenantId, userId);
}

// ─── GET /api/v1/tenants/{tid}/maps/{mid}/edges/{id} ─────────────────────────

void EdgeController::getEdge(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    int userId = callerUserId(req);

    // Verify view access on the map first; on success, fetch the edge.
    // Returns 404 (not 403) if the edge doesn't exist on this map — the
    // caller proved they could see the map, so distinguishing missing
    // from hidden is fine here.
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT m.id FROM maps m "
        "LEFT JOIN map_permissions mp     ON mp.map_id = m.id     AND mp.user_id = ? "
        "LEFT JOIN map_permissions mp_pub ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL "
        "                                AND mp_pub.level IN ('view','comment','edit','moderate','admin') "
        "WHERE m.id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? "
        "       OR mp.level IN ('view','comment','edit','moderate','admin') "
        "       OR mp_pub.level IN ('view','comment','edit','moderate','admin'))",
        [callback, mapId, id](const drogon::orm::Result& rAcc) {
            if (rAcc.empty()) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Map not found or insufficient permissions"));
                return;
            }
            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "SELECT " + EDGE_COLUMNS +
                " FROM node_edges WHERE id = ? AND map_id = ?",
                [callback](const drogon::orm::Result& r) {
                    if (r.empty()) {
                        callback(errorResponse(drogon::k404NotFound,
                            "not_found", "Edge not found"));
                        return;
                    }
                    callback(drogon::HttpResponse::newHttpJsonResponse(rowToEdge(r[0])));
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to fetch edge"));
                },
                id, mapId);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Database error"));
        },
        userId, mapId, tenantId, userId);
}

// ─── PUT /api/v1/tenants/{tid}/maps/{mid}/edges/{id} ─────────────────────────
//
// Endpoints (sourceNodeId, destNodeId) are immutable. Body accepts
// directed, color, label, description (any subset). Body fields that
// are omitted leave the column unchanged.

void EdgeController::updateEdge(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    if (!isTenantEditorOrAdmin(req)) {
        callback(errorResponse(drogon::k403Forbidden,
            "forbidden", "Edge management requires editor or admin role"));
        return;
    }

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "Request body required"));
        return;
    }

    bool hasDirected    = body->isMember("directed");
    bool hasColor       = body->isMember("color");
    bool hasLabel       = body->isMember("label");
    bool hasDescription = body->isMember("description");

    if (!hasDirected && !hasColor && !hasLabel && !hasDescription) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "At least one of directed/color/label/description required"));
        return;
    }

    bool directed       = hasDirected ? (*body)["directed"].asBool() : false;
    std::string color       = hasColor       ? (*body)["color"].asString()       : "";
    std::string label       = hasLabel       ? (*body)["label"].asString()       : "";
    std::string description = hasDescription ? (*body)["description"].asString() : "";

    if (hasLabel       && !checkMaxLen("label", label, MAX_NAME_LEN, callback)) return;
    if (hasDescription && !checkMaxLen("description", description, MAX_DESCRIPTION_LEN, callback)) return;
    if (hasColor && color.size() > 9) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "color must be a hex color (e.g. #ff0000)"));
        return;
    }

    // Verify caller has edit access on the map; on success, run the
    // partial UPDATE (each column gated by its has-flag). Same pattern
    // as PlotController::updatePlot — empty string maps to NULL via
    // NULLIF for nullable columns.
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT m.id FROM maps m "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "WHERE m.id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin'))",
        [callback, req, mapId, tenantId, userId, id,
         hasDirected, directed, hasColor, color, hasLabel, label,
         hasDescription, description]
        (const drogon::orm::Result& rAcc) {
            if (rAcc.empty()) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Map not found or insufficient permissions"));
                return;
            }

            // Build UPDATE with only the supplied columns. Pass-through
            // unchanged columns by reusing the existing value via the
            // table itself (e.g. `color = IF(?, NULLIF(?, ''), color)`).
            std::string sql = "UPDATE node_edges SET ";
            std::vector<std::string> sets;
            if (hasDirected)    sets.push_back("directed = ?");
            if (hasColor)       sets.push_back("color = NULLIF(?, '')");
            if (hasLabel)       sets.push_back("label = NULLIF(?, '')");
            if (hasDescription) sets.push_back("description = NULLIF(?, '')");
            for (size_t i = 0; i < sets.size(); ++i) {
                sql += (i ? ", " : "") + sets[i];
            }
            sql += " WHERE id = ? AND map_id = ?";

            auto onUpdated = [callback, req, mapId, tenantId, userId, id]
                (const drogon::orm::Result& rU) {
                if (rU.affectedRows() == 0) {
                    // Either edge doesn't exist on this map, or values
                    // matched exactly (no-op). Disambiguate.
                    auto dbEx = drogon::app().getDbClient();
                    dbEx->execSqlAsync(
                        "SELECT 1 FROM node_edges WHERE id = ? AND map_id = ?",
                        [callback, req, mapId, tenantId, userId, id]
                        (const drogon::orm::Result& rEx) {
                            if (rEx.empty()) {
                                callback(errorResponse(drogon::k404NotFound,
                                    "not_found", "Edge not found"));
                                return;
                            }
                            // No-op success: re-fetch and return.
                            Json::Value detail;
                            detail["edgeId"] = id; detail["noop"] = true;
                            AuditLog::record("edge_update", req,
                                userId, 0, tenantId, detail);
                            auto dbR = drogon::app().getDbClient();
                            dbR->execSqlAsync(
                                "SELECT " + EDGE_COLUMNS +
                                " FROM node_edges WHERE id = ? AND map_id = ?",
                                [callback](const drogon::orm::Result& rGet) {
                                    if (rGet.empty()) {
                                        callback(errorResponse(drogon::k404NotFound,
                                            "not_found", "Edge not found"));
                                        return;
                                    }
                                    callback(drogon::HttpResponse::newHttpJsonResponse(rowToEdge(rGet[0])));
                                },
                                [callback](const drogon::orm::DrogonDbException&) {
                                    callback(errorResponse(drogon::k500InternalServerError,
                                        "db_error", "Failed to re-fetch edge"));
                                },
                                id, mapId);
                        },
                        [callback](const drogon::orm::DrogonDbException&) {
                            callback(errorResponse(drogon::k500InternalServerError,
                                "db_error", "Database error"));
                        },
                        id, mapId);
                    return;
                }
                Json::Value detail;
                detail["edgeId"] = id;
                AuditLog::record("edge_update", req,
                    userId, 0, tenantId, detail);
                auto dbR = drogon::app().getDbClient();
                dbR->execSqlAsync(
                    "SELECT " + EDGE_COLUMNS +
                    " FROM node_edges WHERE id = ? AND map_id = ?",
                    [callback](const drogon::orm::Result& rGet) {
                        if (rGet.empty()) {
                            callback(errorResponse(drogon::k404NotFound,
                                "not_found", "Edge not found"));
                            return;
                        }
                        callback(drogon::HttpResponse::newHttpJsonResponse(rowToEdge(rGet[0])));
                    },
                    [callback](const drogon::orm::DrogonDbException&) {
                        callback(errorResponse(drogon::k500InternalServerError,
                            "db_error", "Failed to re-fetch edge"));
                    },
                    id, mapId);
            };
            auto onErr = [callback](const drogon::orm::DrogonDbException&) {
                callback(errorResponse(drogon::k500InternalServerError,
                    "db_error", "Failed to update edge"));
            };

            auto db2 = drogon::app().getDbClient();
            // Bind the column values in the order of `sets`, then id, mapId.
            // Each present flag adds one bind parameter.
            // We iterate the 16 combinations explicitly to keep type-correctness:
            // bool / std::string mixed parameter packs are unsupported in a
            // single dynamic call, so dispatch on the bitmask of present flags.
            int mask = (hasDirected    ? 1 : 0) |
                       (hasColor       ? 2 : 0) |
                       (hasLabel       ? 4 : 0) |
                       (hasDescription ? 8 : 0);
            switch (mask) {
                case 1: db2->execSqlAsync(sql, onUpdated, onErr,
                    directed, id, mapId); break;
                case 2: db2->execSqlAsync(sql, onUpdated, onErr,
                    color, id, mapId); break;
                case 3: db2->execSqlAsync(sql, onUpdated, onErr,
                    directed, color, id, mapId); break;
                case 4: db2->execSqlAsync(sql, onUpdated, onErr,
                    label, id, mapId); break;
                case 5: db2->execSqlAsync(sql, onUpdated, onErr,
                    directed, label, id, mapId); break;
                case 6: db2->execSqlAsync(sql, onUpdated, onErr,
                    color, label, id, mapId); break;
                case 7: db2->execSqlAsync(sql, onUpdated, onErr,
                    directed, color, label, id, mapId); break;
                case 8: db2->execSqlAsync(sql, onUpdated, onErr,
                    description, id, mapId); break;
                case 9: db2->execSqlAsync(sql, onUpdated, onErr,
                    directed, description, id, mapId); break;
                case 10: db2->execSqlAsync(sql, onUpdated, onErr,
                    color, description, id, mapId); break;
                case 11: db2->execSqlAsync(sql, onUpdated, onErr,
                    directed, color, description, id, mapId); break;
                case 12: db2->execSqlAsync(sql, onUpdated, onErr,
                    label, description, id, mapId); break;
                case 13: db2->execSqlAsync(sql, onUpdated, onErr,
                    directed, label, description, id, mapId); break;
                case 14: db2->execSqlAsync(sql, onUpdated, onErr,
                    color, label, description, id, mapId); break;
                case 15: db2->execSqlAsync(sql, onUpdated, onErr,
                    directed, color, label, description, id, mapId); break;
                default: break;  // mask = 0 already rejected above
            }
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Database error"));
        },
        userId, mapId, tenantId, userId);
}

// ─── DELETE /api/v1/tenants/{tid}/maps/{mid}/edges/{id} ──────────────────────

void EdgeController::deleteEdge(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    if (!isTenantEditorOrAdmin(req)) {
        callback(errorResponse(drogon::k403Forbidden,
            "forbidden", "Edge management requires editor or admin role"));
        return;
    }

    int userId = callerUserId(req);

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT m.id FROM maps m "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "WHERE m.id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin'))",
        [callback, req, mapId, tenantId, userId, id]
        (const drogon::orm::Result& rAcc) {
            if (rAcc.empty()) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Map not found or insufficient permissions"));
                return;
            }
            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "DELETE FROM node_edges WHERE id = ? AND map_id = ?",
                [callback, req, mapId, tenantId, userId, id]
                (const drogon::orm::Result& rD) {
                    if (rD.affectedRows() == 0) {
                        callback(errorResponse(drogon::k404NotFound,
                            "not_found", "Edge not found"));
                        return;
                    }
                    Json::Value detail;
                    detail["edgeId"] = id; detail["mapId"] = mapId;
                    AuditLog::record("edge_delete", req,
                        userId, 0, tenantId, detail);
                    auto resp = drogon::HttpResponse::newHttpResponse();
                    resp->setStatusCode(drogon::k204NoContent);
                    callback(resp);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to delete edge"));
                },
                id, mapId);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Database error"));
        },
        userId, mapId, tenantId, userId);
}

// ─── GET /api/v1/tenants/{tid}/maps/{mid}/nodes/{nid}/edges ──────────────────
// All edges where source = nodeId OR dest = nodeId, on this map.

void EdgeController::listEdgesForNode(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int nodeId) {

    int userId = callerUserId(req);

    // Same map-view check as listEdges. Visibility filter on the *other*
    // endpoint comes in #197.
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT m.id FROM maps m "
        "LEFT JOIN map_permissions mp     ON mp.map_id = m.id     AND mp.user_id = ? "
        "LEFT JOIN map_permissions mp_pub ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL "
        "                                AND mp_pub.level IN ('view','comment','edit','moderate','admin') "
        "WHERE m.id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? "
        "       OR mp.level IN ('view','comment','edit','moderate','admin') "
        "       OR mp_pub.level IN ('view','comment','edit','moderate','admin'))",
        [callback, mapId, nodeId](const drogon::orm::Result& rAcc) {
            if (rAcc.empty()) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Map not found or insufficient permissions"));
                return;
            }
            // Verify the node is on this map (cheap; avoids returning
            // an empty array when the caller passed a bogus nodeId).
            auto dbN = drogon::app().getDbClient();
            dbN->execSqlAsync(
                "SELECT 1 FROM nodes WHERE id = ? AND map_id = ?",
                [callback, mapId, nodeId](const drogon::orm::Result& rN) {
                    if (rN.empty()) {
                        callback(errorResponse(drogon::k404NotFound,
                            "not_found", "Node not found on this map"));
                        return;
                    }
                    auto db2 = drogon::app().getDbClient();
                    db2->execSqlAsync(
                        "SELECT " + EDGE_COLUMNS +
                        " FROM node_edges "
                        "WHERE map_id = ? AND (source_node_id = ? OR dest_node_id = ?) "
                        "ORDER BY created_at ASC, id ASC",
                        [callback](const drogon::orm::Result& r) {
                            Json::Value arr(Json::arrayValue);
                            for (const auto& row : r) arr.append(rowToEdge(row));
                            callback(drogon::HttpResponse::newHttpJsonResponse(arr));
                        },
                        [callback](const drogon::orm::DrogonDbException&) {
                            callback(errorResponse(drogon::k500InternalServerError,
                                "db_error", "Failed to fetch edges"));
                        },
                        mapId, nodeId, nodeId);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Database error"));
                },
                nodeId, mapId);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Database error"));
        },
        userId, mapId, tenantId, userId);
}
