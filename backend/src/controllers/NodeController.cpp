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

// ─── Effective-visibility CTE (#99) ──────────────────────────────────────────
// Recursive walk up the parent chain to find each node's "resolver" —
// the nearest ancestor (or self) with visibility_override = TRUE. The
// visibility groups tagged on the resolver are the node's effective set.
//
// `resolve` rows: (start_id, cur_id, parent_id, visibility_override, depth)
//   Anchor: every node on the map at depth 0 (cur_id = start_id).
//   Step:   if cur didn't have override, walk to its parent. Recursion
//           halts once we hit override = TRUE (no further row produced
//           from that branch) or hit the depth ceiling.
//
// `visible_starts`: for each start_id whose resolver tags include any
// visibility group the caller is a member of, that start_id is visible.
//
// Bound MAX_NODE_DEPTH so a malicious deep chain can't stall us.
//
// The CTE prefix binds 2 parameters: (mapId, userId).

const std::string VISIBILITY_RESOLVE_CTE =
    "WITH RECURSIVE resolve AS ("
    "  SELECT n.id AS start_id, n.id AS cur_id, n.parent_id, "
    "         n.visibility_override, 0 AS depth "
    "  FROM nodes n WHERE n.map_id = ? "
    "  UNION ALL "
    "  SELECT r.start_id, p.id, p.parent_id, p.visibility_override, r.depth + 1 "
    "  FROM resolve r JOIN nodes p ON p.id = r.parent_id "
    "  WHERE r.visibility_override = FALSE AND r.depth < " +
        std::to_string(MAX_NODE_DEPTH) +
    "), visible_starts AS ( "
    "  SELECT DISTINCT r.start_id FROM resolve r "
    "  JOIN node_visibility nv "
    "       ON nv.node_id = r.cur_id AND r.visibility_override = TRUE "
    "  JOIN visibility_group_members vgm "
    "       ON vgm.visibility_group_id = nv.visibility_group_id "
    "  WHERE vgm.user_id = ? "
    ") ";

// Predicate to AND into WHERE for non-admin callers. Binds 1 param: (userId).
// Owner X-ray bypass is included so map owners with owner_xray = TRUE see
// every node regardless of visibility tagging. Note: non-xray owners are
// still bound by visibility — this matches the design intent (a GM who
// owns the map only sees nodes tagged for them, unless they explicitly
// opt into xray).
const std::string VISIBILITY_PREDICATE =
    " AND ((m.owner_id = ? AND m.owner_xray = TRUE) "
    "      OR n.id IN (SELECT start_id FROM visible_starts)) ";

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
    bool isAdmin = isTenantAdmin(req);

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

    // Tenant admins bypass the visibility filter and see every node
    // (per the #99 design). For non-admins, prepend the resolve CTE
    // and AND in the visibility predicate.
    std::string sql;
    if (!isAdmin) sql = VISIBILITY_RESOLVE_CTE;
    sql +=
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
        "WHERE n.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? "
        "       OR mp.level IN ('view','comment','edit','moderate','admin') "
        "       OR mp_pub.level IN ('view','comment','edit','moderate','admin'))";
    if (!isAdmin) sql += VISIBILITY_PREDICATE;
    if (topLevelOnly) {
        sql += " AND n.parent_id IS NULL";
    } else if (hasParentFilter) {
        sql += " AND n.parent_id = ?";
    }
    sql += " ORDER BY n.created_at ASC";

    // After fetching, null out parent_id on rows whose parent isn't
    // also visible. Otherwise a child leaks the existence of a hidden
    // ancestor via its parentId field. (Only matters when a non-admin
    // can see a child but not its parent — possible if the parent is
    // tagged with a different group than the child or has different
    // override status.)
    auto resultCb = [callback](const drogon::orm::Result& r) {
        std::set<int> visibleIds;
        for (const auto& row : r) visibleIds.insert(row["id"].as<int>());

        Json::Value arr(Json::arrayValue);
        for (const auto& row : r) {
            Json::Value n = rowToNode(row);
            if (!n["parentId"].isNull()) {
                int p = n["parentId"].asInt();
                if (visibleIds.find(p) == visibleIds.end()) {
                    n["parentId"] = Json::Value();
                }
            }
            arr.append(n);
        }
        callback(drogon::HttpResponse::newHttpJsonResponse(arr));
    };
    auto errCb = [callback](const drogon::orm::DrogonDbException&) {
        callback(errorResponse(drogon::k500InternalServerError,
            "db_error", "Failed to fetch nodes"));
    };

    // Param order:
    //   non-admin: mapId, userId   (CTE)
    //              userId           (mp.user_id JOIN)
    //              mapId, tenantId  (WHERE)
    //              userId           (owner_id check)
    //              userId           (visibility predicate xray check)
    //              [parentFilter]   (only when child filter active)
    //   admin:     userId, mapId, tenantId, userId[, parentFilter]
    auto db = drogon::app().getDbClient();
    if (isAdmin) {
        if (hasParentFilter && !topLevelOnly) {
            db->execSqlAsync(sql, resultCb, errCb,
                userId, mapId, tenantId, userId, parentFilter);
        } else {
            db->execSqlAsync(sql, resultCb, errCb,
                userId, mapId, tenantId, userId);
        }
    } else {
        if (hasParentFilter && !topLevelOnly) {
            db->execSqlAsync(sql, resultCb, errCb,
                mapId, userId,                 // CTE
                userId,                        // mp join
                mapId, tenantId, userId,       // WHERE map gating
                userId,                        // visibility xray
                parentFilter);
        } else {
            db->execSqlAsync(sql, resultCb, errCb,
                mapId, userId,
                userId,
                mapId, tenantId, userId,
                userId);
        }
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
    bool isAdmin = isTenantAdmin(req);

    std::string sql;
    if (!isAdmin) sql = VISIBILITY_RESOLVE_CTE;
    sql +=
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
        "  AND (m.owner_id = ? OR mp.level IN ('view','comment','edit','moderate','admin') OR mp_pub.level IN ('view','comment','edit','moderate','admin'))";
    if (!isAdmin) sql += VISIBILITY_PREDICATE;

    auto onResult = [callback, req, tenantId, mapId, userId, isAdmin]
        (const drogon::orm::Result& r) {
        if (r.empty()) {
            callback(errorResponse(drogon::k404NotFound,
                "not_found", "Node not found or no permission"));
            return;
        }
        Json::Value n = rowToNode(r[0]);

        // Same hidden-parent rule as listNodes: if the parent isn't
        // visible to the caller, null out parentId. Admins skip this
        // check (they see everything).
        if (isAdmin || n["parentId"].isNull()) {
            callback(drogon::HttpResponse::newHttpJsonResponse(n));
            return;
        }
        int parentId = n["parentId"].asInt();

        // One-shot existence-via-visibility check on the parent.
        std::string vSql = VISIBILITY_RESOLVE_CTE +
            "SELECT 1 FROM nodes n "
            "JOIN maps m ON m.id = n.map_id "
            "LEFT JOIN map_permissions mp     ON mp.map_id = m.id     AND mp.user_id = ? "
            "LEFT JOIN map_permissions mp_pub ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL "
            "                                AND mp_pub.level IN ('view','comment','edit','moderate','admin') "
            "WHERE n.id = ? AND n.map_id = ? AND m.tenant_id = ? "
            "  AND (m.owner_id = ? OR mp.level IN ('view','comment','edit','moderate','admin') OR mp_pub.level IN ('view','comment','edit','moderate','admin'))" +
            VISIBILITY_PREDICATE;
        auto db = drogon::app().getDbClient();
        db->execSqlAsync(vSql,
            [callback, n](const drogon::orm::Result& rp) mutable {
                if (rp.empty()) n["parentId"] = Json::Value();
                callback(drogon::HttpResponse::newHttpJsonResponse(n));
            },
            [callback, n](const drogon::orm::DrogonDbException&) mutable {
                // On DB error checking parent visibility, fail closed:
                // hide the parent rather than risk leaking it.
                n["parentId"] = Json::Value();
                callback(drogon::HttpResponse::newHttpJsonResponse(n));
            },
            mapId, userId,            // CTE
            userId,                   // mp join
            parentId, mapId, tenantId, userId,  // WHERE
            userId);                  // xray check
    };

    auto db = drogon::app().getDbClient();
    if (isAdmin) {
        db->execSqlAsync(sql, onResult,
            [callback](const drogon::orm::DrogonDbException&) {
                callback(errorResponse(drogon::k500InternalServerError,
                    "db_error", "Database error"));
            },
            userId, id, mapId, tenantId, userId);
    } else {
        db->execSqlAsync(sql, onResult,
            [callback](const drogon::orm::DrogonDbException&) {
                callback(errorResponse(drogon::k500InternalServerError,
                    "db_error", "Database error"));
            },
            mapId, userId,            // CTE
            userId,                   // mp join
            id, mapId, tenantId, userId,  // WHERE
            userId);                  // xray check
    }
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

// ─── GET /api/v1/tenants/{tid}/maps/{mid}/nodes/{id}/children ────────────────
//
// Direct children only. Same shape as `GET /nodes?parentId=N`; the
// visibility filter applies. Per #99 / Phase 2b.ii, hidden parents do not
// produce a 404 here — the response is just the visible children (which may
// be empty). This matches the leak-safe behavior of the list endpoint.

void NodeController::listChildren(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    int userId = callerUserId(req);
    bool isAdmin = isTenantAdmin(req);

    std::string sql;
    if (!isAdmin) sql = VISIBILITY_RESOLVE_CTE;
    sql +=
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
        "WHERE n.parent_id = ? AND n.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? "
        "       OR mp.level IN ('view','comment','edit','moderate','admin') "
        "       OR mp_pub.level IN ('view','comment','edit','moderate','admin'))";
    if (!isAdmin) sql += VISIBILITY_PREDICATE;
    sql += " ORDER BY n.created_at ASC";

    auto resultCb = [callback, id](const drogon::orm::Result& r) {
        std::set<int> visibleIds;
        for (const auto& row : r) visibleIds.insert(row["id"].as<int>());
        Json::Value arr(Json::arrayValue);
        for (const auto& row : r) {
            Json::Value n = rowToNode(row);
            // Same parent-leak rule as listNodes: if a child's parent isn't
            // also visible, null out parentId. (Here the parent we're
            // listing under is `id`, but a sibling-level case can still
            // arise via deeper inheritance interactions.)
            if (!n["parentId"].isNull()) {
                int p = n["parentId"].asInt();
                if (visibleIds.find(p) == visibleIds.end() && p != id) {
                    n["parentId"] = Json::Value();
                }
            }
            arr.append(n);
        }
        callback(drogon::HttpResponse::newHttpJsonResponse(arr));
    };
    auto errCb = [callback](const drogon::orm::DrogonDbException&) {
        callback(errorResponse(drogon::k500InternalServerError,
            "db_error", "Failed to fetch children"));
    };

    auto db = drogon::app().getDbClient();
    if (isAdmin) {
        db->execSqlAsync(sql, resultCb, errCb,
            userId, id, mapId, tenantId, userId);
    } else {
        db->execSqlAsync(sql, resultCb, errCb,
            mapId, userId,                    // CTE
            userId,                           // mp join
            id, mapId, tenantId, userId,      // WHERE map gating (parent_id=id)
            userId);                          // visibility xray
    }
}

// ─── GET /api/v1/tenants/{tid}/maps/{mid}/nodes/{id}/subtree ─────────────────
//
// Recursive descent from the starting node, returning each node with a
// `depth` field (root = 0). For non-admins, the recursion only descends
// into visible nodes — a hidden ancestor severs its own visible descendants
// from the response, so no gaps leak hidden-node existence.
//
// Pagination via cursor (last id seen) + limit (default 100, max 500).
// Returns 404 when the starting node is hidden or missing.

void NodeController::getSubtree(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    int userId = callerUserId(req);
    bool isAdmin = isTenantAdmin(req);

    // Pagination params.
    constexpr int DEFAULT_LIMIT = 100;
    constexpr int MAX_LIMIT     = 500;
    int limit = DEFAULT_LIMIT;
    int cursor = 0;
    {
        std::string limitParam  = req->getParameter("limit");
        std::string cursorParam = req->getParameter("cursor");
        if (!limitParam.empty()) {
            try { limit = std::stoi(limitParam); }
            catch (...) {
                callback(errorResponse(drogon::k400BadRequest,
                    "bad_request", "limit must be an integer"));
                return;
            }
            if (limit < 1) {
                callback(errorResponse(drogon::k400BadRequest,
                    "bad_request", "limit must be at least 1"));
                return;
            }
            if (limit > MAX_LIMIT) {
                callback(errorResponse(drogon::k400BadRequest,
                    "bad_request", "limit exceeds maximum (" +
                    std::to_string(MAX_LIMIT) + ")"));
                return;
            }
        }
        if (!cursorParam.empty()) {
            try { cursor = std::stoi(cursorParam); }
            catch (...) {
                callback(errorResponse(drogon::k400BadRequest,
                    "bad_request", "cursor must be an integer"));
                return;
            }
        }
    }

    // Build the multi-CTE query. For non-admins, we prepend the standard
    // node-visibility resolve from #99 and use it to filter the subtree's
    // recursive descent. Admins get a simpler subtree-only CTE.
    //
    // Map permission gating still applies — we JOIN against maps + map
    // permissions inside the anchor and require the caller has at least
    // view access. (For non-admins the visibility filter further prunes,
    // but map gating is the outer ring.)
    //
    // We fetch limit+1 rows to detect the "has more" boundary; the extra
    // row's id (if present) becomes the next cursor.

    std::string sql;
    if (!isAdmin) {
        sql = VISIBILITY_RESOLVE_CTE.substr(0, VISIBILITY_RESOLVE_CTE.size() - 1);
        // Strip trailing space before continuing the WITH clause; we want
        // one CTE list that includes resolve + visible_starts + subtree.
        sql += ", ";
    } else {
        sql = "WITH RECURSIVE ";
    }
    sql +=
        "subtree AS ("
        "  SELECT n.id, n.map_id, n.parent_id, n.name, n.geo_json, n.description, "
        "         n.color, n.visibility_override, n.created_by, "
        "         u.username AS creator_username, "
        "         n.created_at, n.updated_at, 0 AS depth "
        "  FROM nodes n "
        "  JOIN maps m  ON m.id = n.map_id "
        "  JOIN users u ON u.id = n.created_by "
        "  LEFT JOIN map_permissions mp     ON mp.map_id = m.id     AND mp.user_id = ? "
        "  LEFT JOIN map_permissions mp_pub ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL "
        "                                  AND mp_pub.level IN ('view','comment','edit','moderate','admin') "
        "  WHERE n.id = ? AND n.map_id = ? AND m.tenant_id = ? "
        "    AND (m.owner_id = ? "
        "         OR mp.level IN ('view','comment','edit','moderate','admin') "
        "         OR mp_pub.level IN ('view','comment','edit','moderate','admin'))";
    if (!isAdmin) {
        sql +=
            "    AND ((m.owner_id = ? AND m.owner_xray = TRUE) "
            "         OR n.id IN (SELECT start_id FROM visible_starts)) ";
    }
    sql +=
        "  UNION ALL "
        "  SELECT c.id, c.map_id, c.parent_id, c.name, c.geo_json, c.description, "
        "         c.color, c.visibility_override, c.created_by, "
        "         uc.username, "
        "         c.created_at, c.updated_at, s.depth + 1 "
        "  FROM subtree s "
        "  JOIN nodes c ON c.parent_id = s.id "
        "  JOIN users uc ON uc.id = c.created_by ";
    if (!isAdmin) {
        // Need maps for the per-child xray check. Same-map check stays
        // within the requested subtree's map (no cross-map walking).
        sql +=
            "  JOIN maps mc ON mc.id = c.map_id "
            "  WHERE s.depth < " + std::to_string(MAX_NODE_DEPTH) +
            "    AND c.map_id = s.map_id "
            "    AND ((mc.owner_id = ? AND mc.owner_xray = TRUE) "
            "         OR c.id IN (SELECT start_id FROM visible_starts)) ";
    } else {
        sql +=
            "  WHERE s.depth < " + std::to_string(MAX_NODE_DEPTH) +
            "    AND c.map_id = s.map_id ";
    }
    sql +=
        ") "
        "SELECT * FROM subtree WHERE id > ? ORDER BY id ASC LIMIT ?";

    int fetchLimit = limit + 1;  // +1 to detect "has more"

    auto resultCb = [callback, limit](const drogon::orm::Result& r) {
        Json::Value arr(Json::arrayValue);
        std::set<int> visibleIds;
        for (const auto& row : r) visibleIds.insert(row["id"].as<int>());

        bool hasMore = static_cast<int>(r.size()) > limit;
        int nextCursor = 0;
        size_t emitCount = hasMore ? static_cast<size_t>(limit) : r.size();

        for (size_t i = 0; i < emitCount; ++i) {
            const auto& row = r[i];
            Json::Value n = rowToNode(row);
            n["depth"] = row["depth"].as<int>();
            // parent_id leak-out: if parent isn't in the subtree response,
            // null it out. (Won't happen for the root since its parent is
            // outside the requested subtree by design — but the root's
            // depth=0 still has its real parent_id, which is fine.)
            if (!n["parentId"].isNull() && row["depth"].as<int>() > 0) {
                int p = n["parentId"].asInt();
                if (visibleIds.find(p) == visibleIds.end()) {
                    n["parentId"] = Json::Value();
                }
            }
            arr.append(n);
        }
        if (hasMore) nextCursor = arr[static_cast<int>(arr.size() - 1)]["id"].asInt();

        // 404 the whole subtree if the result is empty AND cursor is 0
        // (first page). On a follow-up page request with no more results,
        // empty is a valid response with nextCursor=null.
        if (arr.empty()) {
            // For an empty first page, we can't distinguish "node hidden"
            // from "node has no descendants and is hidden" — but since the
            // root is always at depth=0 and is always included if visible,
            // empty really means "root not visible or doesn't exist." 404.
            //
            // If the caller paginated past the end, they'll also hit
            // empty here — accept that limitation in exchange for not
            // probing for existence.
            callback(errorResponse(drogon::k404NotFound,
                "not_found", "Subtree root not found"));
            return;
        }

        Json::Value out;
        out["nodes"] = arr;
        out["nextCursor"] = hasMore ? Json::Value(nextCursor) : Json::Value();
        callback(drogon::HttpResponse::newHttpJsonResponse(out));
    };
    auto errCb = [callback](const drogon::orm::DrogonDbException&) {
        callback(errorResponse(drogon::k500InternalServerError,
            "db_error", "Failed to fetch subtree"));
    };

    auto db = drogon::app().getDbClient();
    if (isAdmin) {
        // Anchor params: userId (mp join), id, mapId, tenantId, userId (owner)
        // Final SELECT params: cursor, fetchLimit
        db->execSqlAsync(sql, resultCb, errCb,
            userId, id, mapId, tenantId, userId,
            cursor, fetchLimit);
    } else {
        // Resolve CTE params: mapId, userId
        // Anchor: userId (mp), id, mapId, tenantId, userId (owner-or check),
        //         userId (xray)
        // Recursive step: userId (xray on child)
        // Final SELECT: cursor, fetchLimit
        db->execSqlAsync(sql, resultCb, errCb,
            mapId, userId,
            userId, id, mapId, tenantId, userId, userId,
            userId,
            cursor, fetchLimit);
    }
}

// ─── POST /api/v1/tenants/{tid}/maps/{mid}/nodes/{id}/move ───────────────────
//
// Re-parent and/or relocate a node + its subtree.
// Body: { newParentId: null | int, newMapId: null | int }
//
// Modes (driven by what's in the body):
//   - newParentId only         → re-parent within current map
//   - newMapId only            → relocate to a new map (new top-level)
//   - both                     → relocate to a new parent on a new map
//   - newMapId equals current  → same as omitting it (re-parent only)
//
// Permissions:
//   - Source map: caller has edit-or-above access.
//   - Destination map (if cross-map): edit-or-above access there too.
//   - Cross-tenant move: caller must be tenant admin in BOTH source
//     (already known from TenantFilter) and destination tenants.
//
// Side effects on cross-map move:
//   - All descendants get the new map_id (single UPDATE WHERE id IN ...).
//   - node_visibility rows on source + descendants are dropped (the
//     inheritance chain semantics changed; user re-tags as needed).
//   - On cross-tenant: plot_nodes memberships on source + descendants
//     are also cleared (plots are tenant-scoped).
//
// Cycle prevention: newParentId must not be the source itself or any
// of its descendants. Computed via a recursive CTE bounded by
// MAX_NODE_DEPTH.

void NodeController::moveNode(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    int userId = callerUserId(req);
    bool srcIsAdmin = isTenantAdmin(req);

    auto body = req->getJsonObject();
    if (!body) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "JSON body required"));
        return;
    }

    // Parse newParentId (nullable int).
    bool hasNewParent     = body->isMember("newParentId");
    bool newParentIsNull  = hasNewParent && (*body)["newParentId"].isNull();
    int  newParentId      = 0;
    if (hasNewParent && !newParentIsNull) {
        if (!(*body)["newParentId"].isInt()) {
            callback(errorResponse(drogon::k400BadRequest,
                "bad_request", "newParentId must be an integer or null"));
            return;
        }
        newParentId = (*body)["newParentId"].asInt();
    }

    // Parse newMapId (nullable int; null = "same map").
    bool hasNewMap    = body->isMember("newMapId");
    bool newMapIsNull = hasNewMap && (*body)["newMapId"].isNull();
    int  destMapId    = mapId;  // default to current
    if (hasNewMap && !newMapIsNull) {
        if (!(*body)["newMapId"].isInt()) {
            callback(errorResponse(drogon::k400BadRequest,
                "bad_request", "newMapId must be an integer or null"));
            return;
        }
        destMapId = (*body)["newMapId"].asInt();
    }

    if (!hasNewParent && !hasNewMap) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "Body must include newParentId or newMapId"));
        return;
    }

    bool isCrossMap = (destMapId != mapId);

    // Self-loop sanity check (cycle CTE catches deeper cycles).
    if (hasNewParent && !newParentIsNull && newParentId == id) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "Cannot move a node under itself"));
        return;
    }

    // Step 1: verify source exists in this tenant + caller has edit access
    // on the source map.
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT n.id FROM nodes n "
        "JOIN maps m ON m.id = n.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "WHERE n.id = ? AND n.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin'))",
        [callback, req, tenantId, mapId, id, userId, srcIsAdmin,
         hasNewParent, newParentIsNull, newParentId,
         hasNewMap, destMapId, isCrossMap]
        (const drogon::orm::Result& r1) {
            if (r1.empty()) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Source node not found or insufficient permissions"));
                return;
            }

            // Step 2 (only if cross-map): resolve destination map's tenant
            // and verify caller has edit access there. Sets up cross-tenant
            // role check.
            auto afterDestVerified = [callback, req, tenantId, mapId, id,
                                       userId, srcIsAdmin,
                                       hasNewParent, newParentIsNull, newParentId,
                                       destMapId, isCrossMap]
                (int destTenantId, bool isCrossTenant) {

                // Step 3: validate newParentId (if given) lives on the
                // destination map. (Skipped if null = "make top-level".)
                auto afterParentValidated = [callback, req, tenantId, mapId, id,
                                              userId, hasNewParent, newParentIsNull,
                                              newParentId, destMapId, isCrossMap,
                                              destTenantId, isCrossTenant]() {

                    // Step 4: compute descendant set (recursive CTE, bounded
                    // by MAX_NODE_DEPTH). Used for cycle check + cascading
                    // updates.
                    std::string descSql =
                        "WITH RECURSIVE descendants AS ( "
                        "  SELECT id FROM nodes WHERE id = ? "
                        "  UNION ALL "
                        "  SELECT c.id FROM descendants d JOIN nodes c "
                        "    ON c.parent_id = d.id "
                        "  WHERE c.map_id = (SELECT map_id FROM nodes WHERE id = ?) "
                        ") SELECT id FROM descendants";

                    auto dbD = drogon::app().getDbClient();
                    dbD->execSqlAsync(descSql,
                        [callback, req, tenantId, mapId, id, userId,
                         hasNewParent, newParentIsNull, newParentId,
                         destMapId, isCrossMap, destTenantId, isCrossTenant]
                        (const drogon::orm::Result& rD) {
                            std::vector<int> descendants;
                            descendants.reserve(rD.size());
                            for (const auto& row : rD) {
                                descendants.push_back(row["id"].as<int>());
                            }

                            // Cycle check: newParentId can't be the source
                            // itself or any descendant. (Self-loop already
                            // checked at the top; this catches deeper cases.)
                            if (hasNewParent && !newParentIsNull) {
                                for (int d : descendants) {
                                    if (d == newParentId) {
                                        callback(errorResponse(drogon::k400BadRequest,
                                            "bad_request",
                                            "Cannot move a node into its own subtree"));
                                        return;
                                    }
                                }
                            }

                            // Step 5: apply changes.
                            //
                            // Inline the descendant-id set as literal SQL
                            // ints (same trick used in #86). Safe because
                            // values came from row["id"].as<int>().
                            std::string idList;
                            for (size_t i = 0; i < descendants.size(); ++i) {
                                if (i > 0) idList += ",";
                                idList += std::to_string(descendants[i]);
                            }

                            auto finish = [callback, req, tenantId, id, userId,
                                           hasNewParent, newParentIsNull,
                                           newParentId, destMapId, isCrossMap,
                                           descendants]() {
                                Json::Value detail;
                                detail["sourceId"]        = id;
                                detail["destParentId"]    = (hasNewParent && !newParentIsNull)
                                                              ? Json::Value(newParentId)
                                                              : Json::Value();
                                detail["destMapId"]       = destMapId;
                                detail["descendantCount"] = static_cast<int>(descendants.size());
                                AuditLog::record("node_move", req,
                                    userId, 0, tenantId, detail);

                                Json::Value v;
                                v["id"]           = id;
                                v["mapId"]        = destMapId;
                                v["parentId"]     = (hasNewParent && !newParentIsNull)
                                                      ? Json::Value(newParentId)
                                                      : Json::Value();
                                v["descendantCount"] = static_cast<int>(descendants.size());
                                callback(drogon::HttpResponse::newHttpJsonResponse(v));
                            };

                            // Update parent_id on the source. (Always.)
                            auto updateSourceParent = [callback, id, hasNewParent,
                                                        newParentIsNull, newParentId,
                                                        finish]() {
                                auto dbP = drogon::app().getDbClient();
                                if (hasNewParent && newParentIsNull) {
                                    dbP->execSqlAsync(
                                        "UPDATE nodes SET parent_id = NULL WHERE id = ?",
                                        [finish](const drogon::orm::Result&) { finish(); },
                                        [callback](const drogon::orm::DrogonDbException&) {
                                            callback(errorResponse(drogon::k500InternalServerError,
                                                "db_error", "Failed to update parent"));
                                        },
                                        id);
                                } else if (hasNewParent) {
                                    dbP->execSqlAsync(
                                        "UPDATE nodes SET parent_id = ? WHERE id = ?",
                                        [finish](const drogon::orm::Result&) { finish(); },
                                        [callback](const drogon::orm::DrogonDbException&) {
                                            callback(errorResponse(drogon::k500InternalServerError,
                                                "db_error", "Failed to update parent"));
                                        },
                                        newParentId, id);
                                } else {
                                    // Cross-map move with no parent change:
                                    // skip the parent_id update entirely.
                                    finish();
                                }
                            };

                            if (!isCrossMap) {
                                // Same-map re-parent: just update the parent.
                                updateSourceParent();
                                return;
                            }

                            // Cross-map: chained sequence.
                            //   1. UPDATE map_id on all descendants
                            //   2. DELETE node_visibility for descendants
                            //   3. (cross-tenant only) DELETE plot_nodes
                            //   4. updateSourceParent
                            auto clearPlotIfCrossTenant = [callback, idList,
                                                            isCrossTenant,
                                                            updateSourceParent]() {
                                if (!isCrossTenant) {
                                    updateSourceParent();
                                    return;
                                }
                                auto dbC = drogon::app().getDbClient();
                                dbC->execSqlAsync(
                                    "DELETE FROM plot_nodes WHERE node_id IN (" + idList + ")",
                                    [updateSourceParent](const drogon::orm::Result&) {
                                        updateSourceParent();
                                    },
                                    [callback](const drogon::orm::DrogonDbException&) {
                                        callback(errorResponse(drogon::k500InternalServerError,
                                            "db_error", "Failed to clear plot memberships"));
                                    });
                            };

                            auto dropVisibility = [callback, idList,
                                                    clearPlotIfCrossTenant]() {
                                auto dbV = drogon::app().getDbClient();
                                dbV->execSqlAsync(
                                    "DELETE FROM node_visibility WHERE node_id IN (" + idList + ")",
                                    [clearPlotIfCrossTenant](const drogon::orm::Result&) {
                                        clearPlotIfCrossTenant();
                                    },
                                    [callback](const drogon::orm::DrogonDbException&) {
                                        callback(errorResponse(drogon::k500InternalServerError,
                                            "db_error", "Failed to clear visibility tags"));
                                    });
                            };

                            auto dbU = drogon::app().getDbClient();
                            dbU->execSqlAsync(
                                "UPDATE nodes SET map_id = ? WHERE id IN (" + idList + ")",
                                [dropVisibility](const drogon::orm::Result&) {
                                    dropVisibility();
                                },
                                [callback](const drogon::orm::DrogonDbException&) {
                                    callback(errorResponse(drogon::k500InternalServerError,
                                        "db_error", "Failed to update map_id on descendants"));
                                },
                                destMapId);
                        },
                        [callback](const drogon::orm::DrogonDbException&) {
                            callback(errorResponse(drogon::k500InternalServerError,
                                "db_error", "Failed to compute descendant set"));
                        },
                        id, id);
                };

                if (!hasNewParent || newParentIsNull) {
                    afterParentValidated();
                    return;
                }
                // Verify newParentId exists on the destination map.
                auto dbP = drogon::app().getDbClient();
                dbP->execSqlAsync(
                    "SELECT id FROM nodes WHERE id = ? AND map_id = ?",
                    [callback, afterParentValidated, newParentId]
                    (const drogon::orm::Result& rP) {
                        if (rP.empty()) {
                            callback(errorResponse(drogon::k400BadRequest,
                                "bad_request", "newParentId not found on destination map"));
                            return;
                        }
                        afterParentValidated();
                    },
                    [callback](const drogon::orm::DrogonDbException&) {
                        callback(errorResponse(drogon::k500InternalServerError,
                            "db_error", "Failed to verify new parent"));
                    },
                    newParentId, destMapId);
            };

            if (!isCrossMap) {
                // Same map — destination tenant is source tenant, not cross.
                afterDestVerified(tenantId, false);
                return;
            }

            // Cross-map: resolve destination map's tenant, verify caller's
            // edit access, and check cross-tenant admin rule if applicable.
            auto dbDest = drogon::app().getDbClient();
            dbDest->execSqlAsync(
                "SELECT m.tenant_id FROM maps m "
                "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
                "WHERE m.id = ? "
                "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin'))",
                [callback, req, tenantId, mapId, id, userId, srcIsAdmin,
                 destMapId, afterDestVerified]
                (const drogon::orm::Result& rDest) {
                    if (rDest.empty()) {
                        callback(errorResponse(drogon::k400BadRequest,
                            "bad_request",
                            "newMapId not found or insufficient permissions"));
                        return;
                    }
                    int destTenantId   = rDest[0]["tenant_id"].as<int>();
                    bool isCrossTenant = (destTenantId != tenantId);

                    if (!isCrossTenant) {
                        afterDestVerified(destTenantId, false);
                        return;
                    }
                    if (!srcIsAdmin) {
                        callback(errorResponse(drogon::k403Forbidden,
                            "forbidden", "Cross-tenant move requires tenant admin role"));
                        return;
                    }

                    // Check destination tenant role.
                    auto dbT = drogon::app().getDbClient();
                    dbT->execSqlAsync(
                        "SELECT role FROM tenant_members "
                        "WHERE tenant_id = ? AND user_id = ?",
                        [callback, afterDestVerified, destTenantId]
                        (const drogon::orm::Result& rT) {
                            if (rT.empty() ||
                                rT[0]["role"].as<std::string>() != "admin") {
                                callback(errorResponse(drogon::k403Forbidden,
                                    "forbidden",
                                    "Cross-tenant move requires admin in destination tenant"));
                                return;
                            }
                            afterDestVerified(destTenantId, true);
                        },
                        [callback](const drogon::orm::DrogonDbException&) {
                            callback(errorResponse(drogon::k500InternalServerError,
                                "db_error", "Failed to verify destination tenant role"));
                        },
                        destTenantId, userId);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to verify destination map"));
                },
                userId, destMapId, userId);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to verify source node"));
        },
        userId, id, mapId, tenantId, userId);
}
