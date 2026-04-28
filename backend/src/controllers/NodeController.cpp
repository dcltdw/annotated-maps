#include "NodeController.h"
#include "AuditLog.h"
#include "ErrorResponse.h"
#include "VisibilityAuth.h"
#include <drogon/drogon.h>
#include <set>
#include <sstream>

static int callerUserId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("userId"); }
    catch (...) { return 0; }
}

namespace {

// ─── JSON helpers ────────────────────────────────────────────────────────────
// Same shape as the helpers in MapController.cpp. If a third controller
// needs them in a future phase, lift them into a shared header.

std::string compactJson(const Json::Value& v) {
    Json::StreamWriterBuilder b;
    b["indentation"] = "";
    return Json::writeString(b, v);
}

Json::Value parseJsonColumn(const std::string& s) {
    Json::Value v;
    Json::CharReaderBuilder b;
    std::istringstream iss(s);
    std::string err;
    if (!Json::parseFromStream(b, iss, &v, &err)) {
        return Json::Value(Json::nullValue);
    }
    return v;
}

// ─── geo_json validation ─────────────────────────────────────────────────────
// Light validation — accepts NULL (tree-only nodes have no map presence) or
// a GeoJSON object with a recognized `type`. Coordinates aren't deeply
// schema-checked at this layer; the pluggable coordinate_system on maps
// means coordinate values can mean different things (lat/lng vs pixel)
// depending on the map.

std::string validateGeoJson(const Json::Value& g) {
    if (g.isNull()) return "";  // NULL is allowed (tree-only node)
    if (!g.isObject()) return "geoJson must be an object or null";
    if (!g.isMember("type") || !g["type"].isString())
        return "geoJson.type must be a string";
    const std::string t = g["type"].asString();
    if (t != "Point" && t != "LineString" && t != "Polygon")
        return "geoJson.type must be Point, LineString, or Polygon";
    if (!g.isMember("coordinates") || !g["coordinates"].isArray()
            || g["coordinates"].empty())
        return "geoJson.coordinates must be a non-empty array";
    return "";
}

// ─── Map-access permission check (shared shape across handlers) ──────────────
// Returns the SQL fragment that resolves to a non-empty result if the
// caller has at least view-level access to the map (owner, per-user
// permission, or public). All handlers JOIN against this same shape.

const std::string MAP_ACCESS_JOIN = R"(
    JOIN maps m ON m.id = ?
    LEFT JOIN map_permissions mp     ON mp.map_id = m.id     AND mp.user_id = ?
    LEFT JOIN map_permissions mp_pub ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL
                                    AND mp_pub.level IN ('view','comment','edit','moderate','admin')
)";

const std::string MAP_VIEW_PREDICATE =
    " AND m.tenant_id = ? "
    " AND (m.owner_id = ? "
    "      OR mp.level IN ('view','comment','edit','moderate','admin') "
    "      OR mp_pub.level IN ('view','comment','edit','moderate','admin'))";

const std::string MAP_EDIT_PREDICATE =
    " AND m.tenant_id = ? "
    " AND (m.owner_id = ? "
    "      OR mp.level IN ('edit','moderate','admin'))";

// Build a JSON response for a single node row.
Json::Value rowToNode(const drogon::orm::Row& row) {
    Json::Value n;
    n["id"]                  = row["id"].as<int>();
    n["mapId"]               = row["map_id"].as<int>();
    n["parentId"]            = row["parent_id"].isNull()
                                 ? Json::Value() : Json::Value(row["parent_id"].as<int>());
    n["name"]                = row["name"].as<std::string>();
    n["geoJson"]             = row["geo_json"].isNull()
                                 ? Json::Value() : parseJsonColumn(row["geo_json"].as<std::string>());
    n["description"]         = row["description"].isNull()
                                 ? "" : row["description"].as<std::string>();
    n["color"]               = row["color"].isNull()
                                 ? Json::Value() : Json::Value(row["color"].as<std::string>());
    n["visibilityOverride"]  = row["visibility_override"].as<bool>();
    n["createdBy"]           = row["created_by"].as<int>();
    n["createdByUsername"]   = row["creator_username"].as<std::string>();
    n["createdAt"]           = row["created_at"].as<std::string>();
    n["updatedAt"]           = row["updated_at"].as<std::string>();
    return n;
}

} // anonymous namespace

// ─── GET /api/v1/tenants/{tenantId}/maps/{mapId}/nodes ───────────────────────
//
// Optional `?parentId=N` filters to direct children. `?parentId=` (empty)
// filters to top-level nodes (parent_id IS NULL). Omitting the parameter
// returns all nodes for the map.

void NodeController::listNodes(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId) {

    int userId = callerUserId(req);

    // Parent-id filter: present-and-empty means "top-level only";
    // present-and-numeric means "children of N"; absent means "all".
    std::string parentParam = req->getParameter("parentId");
    bool hasParentFilter = req->getParameters().count("parentId") > 0;
    bool topLevelOnly    = hasParentFilter && parentParam.empty();
    int  parentFilter    = 0;
    if (hasParentFilter && !parentParam.empty()) {
        try { parentFilter = std::stoi(parentParam); }
        catch (...) {
            callback(errorResponse(drogon::k400BadRequest,
                "bad_request", "parentId must be an integer"));
            return;
        }
    }

    std::string sql = R"(
        SELECT n.id, n.map_id, n.parent_id, n.name, n.geo_json, n.description,
               n.color, n.visibility_override, n.created_by,
               u.username AS creator_username,
               n.created_at, n.updated_at
        FROM nodes n
        JOIN maps m  ON m.id = n.map_id
        JOIN users u ON u.id = n.created_by
        LEFT JOIN map_permissions mp     ON mp.map_id = m.id     AND mp.user_id = ?
        LEFT JOIN map_permissions mp_pub ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL
                                        AND mp_pub.level IN ('view','comment','edit','moderate','admin')
        WHERE n.map_id = ? AND m.tenant_id = ?
          AND (m.owner_id = ?
               OR mp.level IN ('view','comment','edit','moderate','admin')
               OR mp_pub.level IN ('view','comment','edit','moderate','admin'))
    )";
    if (topLevelOnly) {
        sql += " AND n.parent_id IS NULL";
    } else if (hasParentFilter) {
        sql += " AND n.parent_id = ?";
    }
    sql += " ORDER BY n.created_at ASC";

    auto resultCb = [callback](const drogon::orm::Result& r) {
        Json::Value arr(Json::arrayValue);
        for (const auto& row : r) arr.append(rowToNode(row));
        callback(drogon::HttpResponse::newHttpJsonResponse(arr));
    };
    auto errCb = [callback](const drogon::orm::DrogonDbException&) {
        callback(errorResponse(drogon::k500InternalServerError,
            "db_error", "Failed to fetch nodes"));
    };

    auto db = drogon::app().getDbClient();
    if (hasParentFilter && !topLevelOnly) {
        db->execSqlAsync(sql, resultCb, errCb,
            userId, mapId, tenantId, userId, parentFilter);
    } else {
        db->execSqlAsync(sql, resultCb, errCb,
            userId, mapId, tenantId, userId);
    }
}

// ─── POST /api/v1/tenants/{tenantId}/maps/{mapId}/nodes ──────────────────────

void NodeController::createNode(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId) {

    int userId = callerUserId(req);
    std::string callerUsername;
    try { callerUsername = req->getAttributes()->get<std::string>("username"); } catch (...) {}

    auto body = req->getJsonObject();
    if (!body || !(*body)["name"]) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "name is required"));
        return;
    }

    std::string name        = (*body)["name"].asString();
    std::string description = (*body).get("description", "").asString();
    std::string color       = (*body).get("color", "").asString();

    if (!checkMaxLen("name", name, MAX_NAME_LEN, callback)) return;
    if (!checkMaxLen("description", description, MAX_DESCRIPTION_LEN, callback)) return;

    // geo_json: optional; NULL = tree-only node with no map presence
    bool hasGeo = body->isMember("geoJson") && !(*body)["geoJson"].isNull();
    std::string geoJsonStr;
    if (hasGeo) {
        std::string err = validateGeoJson((*body)["geoJson"]);
        if (!err.empty()) {
            callback(errorResponse(drogon::k400BadRequest, "bad_request", err));
            return;
        }
        geoJsonStr = compactJson((*body)["geoJson"]);
    }

    // parent_id: optional; if set, must reference a node on the SAME map,
    // and the resulting depth must not exceed MAX_NODE_DEPTH.
    bool hasParent = body->isMember("parentId") && !(*body)["parentId"].isNull();
    int  parentId  = hasParent ? (*body)["parentId"].asInt() : 0;

    // We need three things in order:
    //   1. Verify the caller has edit access on the map.
    //   2. If parentId is given, verify it lives on this map and compute
    //      its depth (rejecting if depth+1 > MAX_NODE_DEPTH).
    //   3. INSERT.
    //
    // Step 2 uses a recursive CTE bounded by MAX_NODE_DEPTH so a malicious
    // pre-existing chain can't stall the query.

    auto db = drogon::app().getDbClient();

    // Step 1: edit access on the map.
    db->execSqlAsync(
        "SELECT m.id FROM maps m "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "WHERE m.id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin'))",
        [callback, req, mapId, tenantId, userId, callerUsername,
         name, description, color, hasGeo, geoJsonStr, hasParent, parentId]
        (const drogon::orm::Result& r1) {
            if (r1.empty()) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Map not found or insufficient permissions"));
                return;
            }

            auto db2 = drogon::app().getDbClient();

            // Build INSERT SQL with NULLs inlined for absent optional
            // columns (parent_id, geo_json). Avoids the parameter-binding
            // type gymnastics that plain CASE expressions induced.
            auto doInsert = [callback, req, mapId, userId, callerUsername,
                             name, description, color, hasGeo, geoJsonStr,
                             hasParent, parentId, tenantId]() {
                auto db3 = drogon::app().getDbClient();

                auto insertedCb = [callback, req, mapId, userId, callerUsername,
                                   name, description, color, hasGeo, geoJsonStr,
                                   hasParent, parentId, tenantId]
                    (const drogon::orm::Result& r3) {
                    int newId = static_cast<int>(r3.insertId());
                    Json::Value n;
                    n["id"]                  = newId;
                    n["mapId"]               = mapId;
                    n["parentId"]            = hasParent ? Json::Value(parentId) : Json::Value();
                    n["name"]                = name;
                    n["geoJson"]             = hasGeo ? parseJsonColumn(geoJsonStr) : Json::Value();
                    n["description"]         = description;
                    n["color"]               = color.empty() ? Json::Value() : Json::Value(color);
                    n["visibilityOverride"]  = false;
                    n["createdBy"]           = userId;
                    n["createdByUsername"]   = callerUsername;
                    Json::Value detail;
                    detail["mapId"]  = mapId;
                    detail["nodeId"] = newId;
                    AuditLog::record("node_create", req, userId, 0, tenantId, detail);
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(n);
                    resp->setStatusCode(drogon::k201Created);
                    callback(resp);
                };
                auto errCb = [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to create node"));
                };

                std::string sql =
                    "INSERT INTO nodes (map_id, parent_id, created_by, name, "
                    "                   geo_json, description, color) "
                    "VALUES (?, ";
                sql += hasParent ? "?, " : "NULL, ";
                sql += "?, ?, ";
                sql += hasGeo ? "CAST(? AS JSON), " : "NULL, ";
                sql += "NULLIF(?, ''), NULLIF(?, ''))";

                if (hasParent && hasGeo) {
                    db3->execSqlAsync(sql, insertedCb, errCb,
                        mapId, parentId, userId, name, geoJsonStr, description, color);
                } else if (hasParent) {
                    db3->execSqlAsync(sql, insertedCb, errCb,
                        mapId, parentId, userId, name, description, color);
                } else if (hasGeo) {
                    db3->execSqlAsync(sql, insertedCb, errCb,
                        mapId, userId, name, geoJsonStr, description, color);
                } else {
                    db3->execSqlAsync(sql, insertedCb, errCb,
                        mapId, userId, name, description, color);
                }
            };

            // Step 2: if parent given, verify same-map and depth.
            if (!hasParent) {
                doInsert();
                return;
            }

            // Recursive CTE walks up the parent chain, bounded by
            // MAX_NODE_DEPTH so a malicious pre-existing chain can't
            // stall here. Returns the depth of the parent (0-indexed
            // from root). New node's depth will be parent_depth + 1.
            std::string depthSql =
                "WITH RECURSIVE chain (id, parent_id, depth) AS ( "
                "  SELECT id, parent_id, 0 FROM nodes WHERE id = ? AND map_id = ? "
                "  UNION ALL "
                "  SELECT p.id, p.parent_id, c.depth + 1 "
                "  FROM nodes p JOIN chain c ON p.id = c.parent_id "
                "  WHERE c.depth < " + std::to_string(MAX_NODE_DEPTH) +
                ") SELECT MAX(depth) AS parent_depth, COUNT(*) AS chain_len FROM chain";

            db2->execSqlAsync(depthSql,
                [callback, doInsert](const drogon::orm::Result& r2) {
                    if (r2.empty() || r2[0]["chain_len"].as<int>() == 0) {
                        callback(errorResponse(drogon::k400BadRequest,
                            "bad_request", "parentId not found on this map"));
                        return;
                    }
                    int parentDepth = r2[0]["parent_depth"].as<int>();
                    if (parentDepth + 1 >= MAX_NODE_DEPTH) {
                        callback(errorResponse(drogon::k400BadRequest,
                            "bad_request", "Tree depth limit exceeded"));
                        return;
                    }
                    doInsert();
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to validate parent"));
                },
                parentId, mapId);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Database error"));
        },
        userId, mapId, tenantId, userId);
}

// ─── GET /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id} ──────────────────

void NodeController::getNode(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT n.id, n.map_id, n.parent_id, n.name, n.geo_json, n.description, "
        "       n.color, n.visibility_override, n.created_by, "
        "       u.username AS creator_username, "
        "       n.created_at, n.updated_at "
        "FROM nodes n "
        "JOIN maps m  ON m.id = n.map_id "
        "JOIN users u ON u.id = n.created_by "
        "LEFT JOIN map_permissions mp     ON mp.map_id = m.id     AND mp.user_id = ? "
        "LEFT JOIN map_permissions mp_pub ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL "
        "                                AND mp_pub.level IN ('view','comment','edit','moderate','admin') "
        "WHERE n.id = ? AND n.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('view','comment','edit','moderate','admin') OR mp_pub.level IN ('view','comment','edit','moderate','admin'))",
        [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "Node not found or no permission"));
                return;
            }
            callback(drogon::HttpResponse::newHttpJsonResponse(rowToNode(r[0])));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Database error"));
        },
        userId, id, mapId, tenantId, userId);
}

// ─── PUT /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id} ──────────────────

void NodeController::updateNode(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "Request body required"));
        return;
    }

    std::string name        = (*body).get("name", "").asString();
    std::string description = (*body).get("description", "").asString();
    std::string color       = (*body).get("color", "").asString();

    if (!checkMaxLen("name", name, MAX_NAME_LEN, callback)) return;
    if (!checkMaxLen("description", description, MAX_DESCRIPTION_LEN, callback)) return;

    bool hasGeo = body->isMember("geoJson");
    std::string geoJsonStr;
    bool geoIsNull = hasGeo && (*body)["geoJson"].isNull();
    if (hasGeo && !geoIsNull) {
        std::string err = validateGeoJson((*body)["geoJson"]);
        if (!err.empty()) {
            callback(errorResponse(drogon::k400BadRequest, "bad_request", err));
            return;
        }
        geoJsonStr = compactJson((*body)["geoJson"]);
    }

    // parent_id reassignment, max-depth check, and cycle prevention all
    // live in the move endpoint (Phase 2e). For now, PUT does not change
    // parent_id — only name/description/color/geoJson.

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "UPDATE nodes n "
        "JOIN maps m ON m.id = n.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "SET n.name        = IF(?='', n.name, ?), "
        "    n.description = IF(?='', n.description, ?), "
        "    n.color       = IF(?='', n.color, ?), "
        "    n.geo_json    = CASE WHEN ?=0 THEN n.geo_json "
        "                         WHEN ?=1 THEN NULL "
        "                         ELSE CAST(? AS JSON) END "
        "WHERE n.id = ? AND n.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin'))",
        [callback, req, userId, tenantId, mapId, id](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Node not found or insufficient permissions"));
                return;
            }
            Json::Value detail;
            detail["mapId"]  = mapId;
            detail["nodeId"] = id;
            AuditLog::record("node_update", req, userId, 0, tenantId, detail);
            Json::Value v;
            v["id"]      = id;
            v["updated"] = true;
            callback(drogon::HttpResponse::newHttpJsonResponse(v));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to update node"));
        },
        userId,
        name, name,
        description, description,
        color, color,
        // geoJson sentinel: 0 = unchanged, 1 = NULL, 2 = update to value
        hasGeo ? (geoIsNull ? 1 : 2) : 0,
        hasGeo ? (geoIsNull ? 1 : 2) : 0,
        geoJsonStr,
        id, mapId, tenantId, userId);
}

// ─── DELETE /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id} ───────────────
//
// Subtree CASCADE is DB-enforced (nodes.parent_id FK has ON DELETE CASCADE),
// so deleting a node also drops every descendant. Notes attached to those
// descendants CASCADE too via notes.node_id. Visibility / plot junctions
// CASCADE on each side as well. See database/migrations/001_schema.sql.

void NodeController::deleteNode(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
        "DELETE n FROM nodes n "
        "JOIN maps m ON m.id = n.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "WHERE n.id = ? AND n.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin'))",
        [callback, req, userId, tenantId, mapId, id](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Node not found or insufficient permissions"));
                return;
            }
            Json::Value detail;
            detail["mapId"]  = mapId;
            detail["nodeId"] = id;
            AuditLog::record("node_delete", req, userId, 0, tenantId, detail);
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k204NoContent);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to delete node"));
        },
        userId, id, mapId, tenantId, userId);
}

// ─── GET /api/v1/tenants/{tid}/maps/{mid}/nodes/{nid}/visibility ─────────────
//
// Returns raw stored state (no inheritance computation): the node's own
// visibility_override flag and its tagged visibility_group ids.
// Effective visibility (recursive walk up parent chain) is computed by
// the read filter that lands in #99.

void NodeController::getVisibility(
    const drogon::HttpRequestPtr& /*req*/,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    auto db = drogon::app().getDbClient();

    // Existence + tenant scoping check first. We use a single query that
    // returns the override flag and (zero or more) tagged group ids in
    // one shot. If the node isn't on this map+tenant, the result is
    // empty and we 404. (We don't gate on the caller's map permission
    // here — read filtering for the node itself happens via the regular
    // GET /nodes/:id route. This endpoint exposes only the visibility
    // metadata, which is the same metadata a manager needs to inspect
    // before editing.)
    db->execSqlAsync(
        "SELECT n.visibility_override, nv.visibility_group_id "
        "FROM nodes n "
        "JOIN maps m ON m.id = n.map_id "
        "LEFT JOIN node_visibility nv ON nv.node_id = n.id "
        "WHERE n.id = ? AND n.map_id = ? AND m.tenant_id = ?",
        [callback, id](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "Node not found"));
                return;
            }
            Json::Value out;
            out["nodeId"]   = id;
            out["override"] = r[0]["visibility_override"].as<bool>();
            Json::Value ids(Json::arrayValue);
            for (const auto& row : r) {
                if (!row["visibility_group_id"].isNull()) {
                    ids.append(row["visibility_group_id"].as<int>());
                }
            }
            out["groupIds"] = ids;
            callback(drogon::HttpResponse::newHttpJsonResponse(out));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to fetch node visibility"));
        },
        id, mapId, tenantId);
}

// ─── POST /api/v1/tenants/{tid}/maps/{mid}/nodes/{nid}/visibility ────────────
//
// Body: { override?: bool, groupIds?: number[] }
//   - override and groupIds are independently authoritative.
//   - groupIds OMITTED  → tag set untouched (toggle-override-only call).
//   - groupIds PRESENT (even []) → replace the entire tag set.
//   - All groupIds must belong to this tenant.
//   - Tags survive override flips (override=false just means "inherit",
//     not "drop tags") — see header comment.
//
// Auth: requireVisibilityGroupManager (admin OR manages_visibility group
// member). Combined with the existence-check below, a manager can set
// visibility on any node in their tenant.

void NodeController::setVisibility(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    int userId = callerUserId(req);

    auto body = req->getJsonObject();
    if (!body) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "JSON body required"));
        return;
    }

    bool hasOverride = body->isMember("override") && (*body)["override"].isBool();
    bool overrideVal = hasOverride ? (*body)["override"].asBool() : false;

    bool hasGroupIds = body->isMember("groupIds");
    std::set<int> groupIds;
    if (hasGroupIds) {
        const Json::Value& g = (*body)["groupIds"];
        if (!g.isArray()) {
            callback(errorResponse(drogon::k400BadRequest,
                "bad_request", "groupIds must be an array of integers"));
            return;
        }
        for (const auto& v : g) {
            if (!v.isInt()) {
                callback(errorResponse(drogon::k400BadRequest,
                    "bad_request", "groupIds must contain only integers"));
                return;
            }
            groupIds.insert(v.asInt());
        }
    }

    if (!hasOverride && !hasGroupIds) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "Body must include override or groupIds"));
        return;
    }

    // Helper: comma-join an int set (e.g. {1,3,7} → "1,3,7"). Safe to
    // splice into SQL because the values came from `Json::Value::asInt()`
    // — bounded, sign-checked integers, no string content.
    auto joinIds = [](const std::set<int>& s) {
        std::string out;
        bool first = true;
        for (int v : s) {
            if (!first) out += ",";
            out += std::to_string(v);
            first = false;
        }
        return out;
    };

    requireVisibilityGroupManager(req, tenantId, userId, callback,
        [callback, req, tenantId, mapId, id, userId,
         hasOverride, overrideVal, hasGroupIds, groupIds, joinIds]() {

        auto finish = [callback, req, tenantId, mapId, id, userId]() {
            Json::Value detail;
            detail["mapId"]  = mapId;
            detail["nodeId"] = id;
            AuditLog::record("node_visibility_set", req,
                userId, 0, tenantId, detail);
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k204NoContent);
            callback(resp);
        };

        // Step 4: replace tags. DELETE then (optionally) multi-row INSERT.
        auto applyTags = [callback, id, hasGroupIds, groupIds, joinIds, finish]() {
            if (!hasGroupIds) { finish(); return; }

            auto dbT = drogon::app().getDbClient();
            dbT->execSqlAsync(
                "DELETE FROM node_visibility WHERE node_id = ?",
                [callback, id, groupIds, joinIds, finish]
                (const drogon::orm::Result&) {
                    if (groupIds.empty()) { finish(); return; }

                    // Multi-row INSERT, ids inlined (see joinIds note above).
                    std::string vals;
                    bool first = true;
                    for (int g : groupIds) {
                        if (!first) vals += ",";
                        vals += "(" + std::to_string(id) + "," + std::to_string(g) + ")";
                        first = false;
                    }
                    auto dbI = drogon::app().getDbClient();
                    dbI->execSqlAsync(
                        "INSERT INTO node_visibility "
                        "  (node_id, visibility_group_id) VALUES " + vals,
                        [finish](const drogon::orm::Result&) { finish(); },
                        [callback](const drogon::orm::DrogonDbException&) {
                            callback(errorResponse(drogon::k500InternalServerError,
                                "db_error", "Failed to insert tags"));
                        });
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to clear existing tags"));
                },
                id);
        };

        // Step 3: optionally update override flag, then call applyTags.
        auto applyOverrideThenTags =
            [callback, id, hasOverride, overrideVal, applyTags]() {
            if (!hasOverride) { applyTags(); return; }
            auto dbO = drogon::app().getDbClient();
            dbO->execSqlAsync(
                "UPDATE nodes SET visibility_override = ? WHERE id = ?",
                [applyTags](const drogon::orm::Result&) { applyTags(); },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to set override"));
                },
                overrideVal, id);
        };

        // Step 2: verify the node exists on this map+tenant.
        auto dbN = drogon::app().getDbClient();
        dbN->execSqlAsync(
            "SELECT n.id FROM nodes n "
            "JOIN maps m ON m.id = n.map_id "
            "WHERE n.id = ? AND n.map_id = ? AND m.tenant_id = ?",
            [callback, tenantId, hasGroupIds, groupIds, joinIds,
             applyOverrideThenTags]
            (const drogon::orm::Result& r1) {
                if (r1.empty()) {
                    callback(errorResponse(drogon::k404NotFound,
                        "not_found", "Node not found"));
                    return;
                }
                if (!hasGroupIds || groupIds.empty()) {
                    applyOverrideThenTags();
                    return;
                }

                // Step 2.5: validate all groupIds belong to this tenant.
                std::string sql =
                    "SELECT COUNT(*) AS c FROM visibility_groups "
                    "WHERE tenant_id = ? AND id IN (" + joinIds(groupIds) + ")";
                auto dbV = drogon::app().getDbClient();
                dbV->execSqlAsync(sql,
                    [callback, groupIds, applyOverrideThenTags]
                    (const drogon::orm::Result& r2) {
                        int count = r2[0]["c"].as<int>();
                        if (count != static_cast<int>(groupIds.size())) {
                            callback(errorResponse(drogon::k400BadRequest,
                                "bad_request",
                                "One or more groupIds are invalid for this tenant"));
                            return;
                        }
                        applyOverrideThenTags();
                    },
                    [callback](const drogon::orm::DrogonDbException&) {
                        callback(errorResponse(drogon::k500InternalServerError,
                            "db_error", "Failed to validate group ids"));
                    },
                    tenantId);
            },
            [callback](const drogon::orm::DrogonDbException&) {
                callback(errorResponse(drogon::k500InternalServerError,
                    "db_error", "Failed to verify node"));
            },
            id, mapId, tenantId);
    });
}
