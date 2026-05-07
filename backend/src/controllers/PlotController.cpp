#include "PlotController.h"
#include "AuditLog.h"
#include "ErrorResponse.h"
#include "NodeController.h"  // MAX_NODE_DEPTH for the resolve CTE
#include <drogon/drogon.h>

// Phase 2c (#88): plots are tenant-scoped narrative groupings that tie
// together places (nodes) and content (notes) across one or more maps.
// Two parallel junction tables (plot_nodes, plot_notes) hold the
// membership; CASCADE on either side handles cleanup.
//
// Read endpoints are open to any tenant member (TenantFilter enforces).
// Write endpoints (CRUD + membership add/remove) require tenantRole IN
// ('admin', 'editor'). The membership listing applies the same node and
// note effective-visibility filters from #99 / #87, so plot members the
// caller can't otherwise see don't leak through this endpoint.

static int callerUserId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("userId"); }
    catch (...) { return 0; }
}

namespace {

bool isTenantAdmin(const drogon::HttpRequestPtr& req) {
    try {
        return req->getAttributes()->get<std::string>("tenantRole") == "admin";
    } catch (...) { return false; }
}

bool isTenantEditorOrAdmin(const drogon::HttpRequestPtr& req) {
    try {
        const auto role = req->getAttributes()->get<std::string>("tenantRole");
        return role == "admin" || role == "editor";
    } catch (...) { return false; }
}

Json::Value rowToPlot(const drogon::orm::Row& row) {
    Json::Value p;
    p["id"]          = row["id"].as<int>();
    p["tenantId"]    = row["tenant_id"].as<int>();
    p["name"]        = row["name"].as<std::string>();
    p["description"] = row["description"].isNull()
                         ? "" : row["description"].as<std::string>();
    p["createdBy"]   = row["created_by"].as<int>();
    p["createdAt"]   = row["created_at"].as<std::string>();
    p["updatedAt"]   = row["updated_at"].as<std::string>();
    return p;
}

Json::Value rowToNodeMember(const drogon::orm::Row& row) {
    Json::Value n;
    n["id"]                 = row["id"].as<int>();
    n["mapId"]              = row["map_id"].as<int>();
    n["parentId"]           = row["parent_id"].isNull()
                                ? Json::Value()
                                : Json::Value(row["parent_id"].as<int>());
    n["name"]               = row["name"].as<std::string>();
    n["color"]              = row["color"].isNull()
                                ? Json::Value()
                                : Json::Value(row["color"].as<std::string>());
    n["visibilityOverride"] = row["visibility_override"].as<bool>();
    return n;
}

Json::Value rowToNoteMember(const drogon::orm::Row& row) {
    Json::Value n;
    n["id"]                 = row["id"].as<int>();
    n["nodeId"]             = row["node_id"].as<int>();
    n["mapId"]              = row["map_id"].as<int>();
    n["title"]              = row["title"].isNull() ? "" : row["title"].as<std::string>();
    n["pinned"]             = row["pinned"].as<bool>();
    n["color"]              = row["color"].isNull()
                                ? Json::Value()
                                : Json::Value(row["color"].as<std::string>());
    n["visibilityOverride"] = row["visibility_override"].as<bool>();
    return n;
}

// ─── Plot-member visibility CTEs ─────────────────────────────────────────────
// Adapted from #99 (NodeController) and #87 (NoteController). The shape is:
// the recursive walk's anchor is restricted to the *plot's members*
// (instead of all nodes on a map), then `node_visible_starts` and
// `note_visible` are computed exactly as in those controllers. This keeps
// the work proportional to plot membership, not whole maps.

const std::string PLOT_NODE_VISIBILITY_CTE =
    "WITH RECURSIVE node_resolve AS ("
    "  SELECT nd.id AS start_id, nd.id AS cur_id, nd.parent_id, "
    "         nd.visibility_override, 0 AS depth "
    "  FROM nodes nd JOIN plot_nodes pn ON pn.node_id = nd.id AND pn.plot_id = ? "
    "  UNION ALL "
    "  SELECT r.start_id, p.id, p.parent_id, p.visibility_override, r.depth + 1 "
    "  FROM node_resolve r JOIN nodes p ON p.id = r.parent_id "
    "  WHERE r.visibility_override = FALSE AND r.depth < " +
        std::to_string(MAX_NODE_DEPTH) +
    "), node_visible_starts AS ( "
    "  SELECT DISTINCT r.start_id FROM node_resolve r "
    "  JOIN node_visibility nv "
    "       ON nv.node_id = r.cur_id AND r.visibility_override = TRUE "
    "  JOIN visibility_group_members vgm "
    "       ON vgm.visibility_group_id = nv.visibility_group_id "
    "  WHERE vgm.user_id = ? "
    ") ";

// For notes, the resolve walks: (note's attached node) → its parent chain.
// Anchor = nodes attached to a note that's a member of this plot.
const std::string PLOT_NOTE_VISIBILITY_CTE =
    "WITH RECURSIVE node_resolve AS ("
    "  SELECT nd.id AS start_id, nd.id AS cur_id, nd.parent_id, "
    "         nd.visibility_override, 0 AS depth "
    "  FROM nodes nd "
    "  JOIN notes n ON n.node_id = nd.id "
    "  JOIN plot_notes pnn ON pnn.note_id = n.id AND pnn.plot_id = ? "
    "  UNION ALL "
    "  SELECT r.start_id, p.id, p.parent_id, p.visibility_override, r.depth + 1 "
    "  FROM node_resolve r JOIN nodes p ON p.id = r.parent_id "
    "  WHERE r.visibility_override = FALSE AND r.depth < " +
        std::to_string(MAX_NODE_DEPTH) +
    "), node_visible_starts AS ( "
    "  SELECT DISTINCT r.start_id FROM node_resolve r "
    "  JOIN node_visibility nv "
    "       ON nv.node_id = r.cur_id AND r.visibility_override = TRUE "
    "  JOIN visibility_group_members vgm "
    "       ON vgm.visibility_group_id = nv.visibility_group_id "
    "  WHERE vgm.user_id = ? "
    "), note_visible AS ( "
    "  SELECT n.id AS visible_note_id FROM notes n "
    "  JOIN plot_notes pnn ON pnn.note_id = n.id AND pnn.plot_id = ? "
    "  WHERE (n.visibility_override = TRUE "
    "         AND EXISTS (SELECT 1 FROM note_visibility nv2 "
    "                     JOIN visibility_group_members vgm2 "
    "                          ON vgm2.visibility_group_id = nv2.visibility_group_id "
    "                     WHERE nv2.note_id = n.id AND vgm2.user_id = ?)) "
    "     OR (n.visibility_override = FALSE "
    "         AND n.node_id IN (SELECT start_id FROM node_visible_starts)) "
    ") ";

// Map-scoped visibility CTEs for the reverse-membership endpoints (#139).
// These mirror NodeController's VISIBILITY_RESOLVE_CTE and NoteController's
// NOTE_VISIBILITY_CTE — same shape, same MAX_NODE_DEPTH bound — but kept
// local so PlotController doesn't depend on those private constants. Used
// by GET /maps/{mid}/nodes/{nid}/plots and the analogous note endpoint.

const std::string MAP_NODE_VISIBILITY_CTE =
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

const std::string MAP_NOTE_VISIBILITY_CTE =
    "WITH RECURSIVE node_resolve AS ("
    "  SELECT nd.id AS start_id, nd.id AS cur_id, nd.parent_id, "
    "         nd.visibility_override, 0 AS depth "
    "  FROM nodes nd WHERE nd.map_id = ? "
    "  UNION ALL "
    "  SELECT r.start_id, p.id, p.parent_id, p.visibility_override, r.depth + 1 "
    "  FROM node_resolve r JOIN nodes p ON p.id = r.parent_id "
    "  WHERE r.visibility_override = FALSE AND r.depth < " +
        std::to_string(MAX_NODE_DEPTH) +
    "), node_visible_starts AS ( "
    "  SELECT DISTINCT r.start_id FROM node_resolve r "
    "  JOIN node_visibility nv "
    "       ON nv.node_id = r.cur_id AND r.visibility_override = TRUE "
    "  JOIN visibility_group_members vgm "
    "       ON vgm.visibility_group_id = nv.visibility_group_id "
    "  WHERE vgm.user_id = ? "
    "), note_visible AS ( "
    "  SELECT n.id AS visible_note_id FROM notes n "
    "  JOIN nodes nd ON nd.id = n.node_id AND nd.map_id = ? "
    "  WHERE (n.visibility_override = TRUE "
    "         AND EXISTS (SELECT 1 FROM note_visibility nv2 "
    "                     JOIN visibility_group_members vgm2 "
    "                          ON vgm2.visibility_group_id = nv2.visibility_group_id "
    "                     WHERE nv2.note_id = n.id AND vgm2.user_id = ?)) "
    "     OR (n.visibility_override = FALSE "
    "         AND n.node_id IN (SELECT start_id FROM node_visible_starts)) "
    ") ";

}  // anonymous namespace

// ─── GET /api/v1/tenants/{tid}/plots ─────────────────────────────────────────

void PlotController::listPlots(
    const drogon::HttpRequestPtr& /*req*/,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId) {

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT id, tenant_id, name, description, created_by, created_at, updated_at "
        "FROM plots WHERE tenant_id = ? ORDER BY name ASC",
        [callback](const drogon::orm::Result& r) {
            Json::Value arr(Json::arrayValue);
            for (const auto& row : r) arr.append(rowToPlot(row));
            callback(drogon::HttpResponse::newHttpJsonResponse(arr));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to fetch plots"));
        },
        tenantId);
}

// ─── POST /api/v1/tenants/{tid}/plots ────────────────────────────────────────

void PlotController::createPlot(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId) {

    if (!isTenantEditorOrAdmin(req)) {
        callback(errorResponse(drogon::k403Forbidden,
            "forbidden", "Plot management requires editor or admin role"));
        return;
    }

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body || !(*body)["name"]) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "name is required"));
        return;
    }

    std::string name        = (*body)["name"].asString();
    std::string description = (*body).get("description", "").asString();

    if (name.empty()) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "name must not be empty"));
        return;
    }
    if (!checkMaxLen("name", name, MAX_NAME_LEN, callback)) return;
    if (!checkMaxLen("description", description, MAX_DESCRIPTION_LEN, callback)) return;

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "INSERT INTO plots (tenant_id, name, description, created_by) "
        "VALUES (?, ?, NULLIF(?, ''), ?)",
        [callback, req, tenantId, userId, name, description]
        (const drogon::orm::Result& r) {
            int newId = static_cast<int>(r.insertId());
            Json::Value p;
            p["id"]          = newId;
            p["tenantId"]    = tenantId;
            p["name"]        = name;
            p["description"] = description;
            p["createdBy"]   = userId;
            Json::Value detail;
            detail["plotId"] = newId;
            AuditLog::record("plot_create", req, userId, 0, tenantId, detail);
            auto resp = drogon::HttpResponse::newHttpJsonResponse(p);
            resp->setStatusCode(drogon::k201Created);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to create plot"));
        },
        tenantId, name, description, userId);
}

// ─── GET /api/v1/tenants/{tid}/plots/{id} ────────────────────────────────────

void PlotController::getPlot(
    const drogon::HttpRequestPtr& /*req*/,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT id, tenant_id, name, description, created_by, created_at, updated_at "
        "FROM plots WHERE id = ? AND tenant_id = ?",
        [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "Plot not found"));
                return;
            }
            callback(drogon::HttpResponse::newHttpJsonResponse(rowToPlot(r[0])));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to fetch plot"));
        },
        id, tenantId);
}

// ─── PUT /api/v1/tenants/{tid}/plots/{id} ────────────────────────────────────

void PlotController::updatePlot(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    if (!isTenantEditorOrAdmin(req)) {
        callback(errorResponse(drogon::k403Forbidden,
            "forbidden", "Plot management requires editor or admin role"));
        return;
    }

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "Request body required"));
        return;
    }

    std::string name        = (*body).get("name", "").asString();
    std::string description = (*body).get("description", "").asString();
    bool hasDescription     = body->isMember("description");

    if (!checkMaxLen("name", name, MAX_NAME_LEN, callback)) return;
    if (!checkMaxLen("description", description, MAX_DESCRIPTION_LEN, callback)) return;

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "UPDATE plots SET "
        "  name        = IF(?='', name, ?), "
        "  description = IF(?, NULLIF(?, ''), description) "
        "WHERE id = ? AND tenant_id = ?",
        [callback, req, userId, tenantId, id]
        (const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                // Either the plot doesn't exist in this tenant, or the
                // submitted body matched current values exactly. The
                // latter still represents a no-op success; do an
                // existence check to disambiguate.
                auto db2 = drogon::app().getDbClient();
                db2->execSqlAsync(
                    "SELECT 1 FROM plots WHERE id = ? AND tenant_id = ?",
                    [callback, req, userId, tenantId, id]
                    (const drogon::orm::Result& r2) {
                        if (r2.empty()) {
                            callback(errorResponse(drogon::k404NotFound,
                                "not_found", "Plot not found"));
                            return;
                        }
                        Json::Value detail; detail["plotId"] = id;
                        AuditLog::record("plot_update", req, userId, 0, tenantId, detail);
                        Json::Value v; v["id"] = id; v["updated"] = true;
                        callback(drogon::HttpResponse::newHttpJsonResponse(v));
                    },
                    [callback](const drogon::orm::DrogonDbException&) {
                        callback(errorResponse(drogon::k500InternalServerError,
                            "db_error", "Failed to verify plot"));
                    },
                    id, tenantId);
                return;
            }
            Json::Value detail; detail["plotId"] = id;
            AuditLog::record("plot_update", req, userId, 0, tenantId, detail);
            Json::Value v; v["id"] = id; v["updated"] = true;
            callback(drogon::HttpResponse::newHttpJsonResponse(v));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to update plot"));
        },
        name, name,
        hasDescription, description,
        id, tenantId);
}

// ─── DELETE /api/v1/tenants/{tid}/plots/{id} ─────────────────────────────────

void PlotController::deletePlot(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    if (!isTenantEditorOrAdmin(req)) {
        callback(errorResponse(drogon::k403Forbidden,
            "forbidden", "Plot management requires editor or admin role"));
        return;
    }

    int userId = callerUserId(req);
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "DELETE FROM plots WHERE id = ? AND tenant_id = ?",
        [callback, req, userId, tenantId, id](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "Plot not found"));
                return;
            }
            Json::Value detail; detail["plotId"] = id;
            AuditLog::record("plot_delete", req, userId, 0, tenantId, detail);
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k204NoContent);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to delete plot"));
        },
        id, tenantId);
}

// ─── GET /api/v1/tenants/{tid}/plots/{id}/members ────────────────────────────
//
// Combined response: { nodes: [...], notes: [...] }
// Visibility-filtered for non-admins using the plot-scoped CTEs above.
// Map-owner xray bypass is honored per-member (a member's owning map's
// owner_xray flag short-circuits the visibility predicate for that member).

void PlotController::listMembers(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    int userId = callerUserId(req);
    bool isAdmin = isTenantAdmin(req);

    auto db = drogon::app().getDbClient();

    // Step 1: verify the plot exists in this tenant.
    db->execSqlAsync(
        "SELECT 1 FROM plots WHERE id = ? AND tenant_id = ?",
        [callback, req, tenantId, id, userId, isAdmin]
        (const drogon::orm::Result& r1) {
            if (r1.empty()) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "Plot not found"));
                return;
            }

            // Step 2: fetch visible node members. Admins skip the CTE.
            std::string nodeSql;
            if (!isAdmin) nodeSql = PLOT_NODE_VISIBILITY_CTE;
            nodeSql +=
                "SELECT n.id, n.map_id, n.parent_id, n.name, n.color, n.visibility_override "
                "FROM nodes n "
                "JOIN plot_nodes pn ON pn.node_id = n.id AND pn.plot_id = ? "
                "JOIN maps m ON m.id = n.map_id AND m.tenant_id = ? ";
            if (!isAdmin) {
                nodeSql +=
                    "WHERE ((m.owner_id = ? AND m.owner_xray = TRUE) "
                    "       OR n.id IN (SELECT start_id FROM node_visible_starts)) ";
            }
            nodeSql += "ORDER BY n.created_at ASC";

            // Step 3: fetch visible note members. Admins skip the CTE.
            std::string noteSql;
            if (!isAdmin) noteSql = PLOT_NOTE_VISIBILITY_CTE;
            noteSql +=
                "SELECT nt.id, nt.node_id, nd.map_id, nt.title, nt.pinned, "
                "       nt.color, nt.visibility_override "
                "FROM notes nt "
                "JOIN plot_notes pnn ON pnn.note_id = nt.id AND pnn.plot_id = ? "
                "JOIN nodes nd ON nd.id = nt.node_id "
                "JOIN maps m ON m.id = nd.map_id AND m.tenant_id = ? ";
            if (!isAdmin) {
                noteSql +=
                    "WHERE ((m.owner_id = ? AND m.owner_xray = TRUE) "
                    "       OR nt.id IN (SELECT visible_note_id FROM note_visible)) ";
            }
            noteSql += "ORDER BY nt.pinned DESC, nt.created_at ASC";

            // Sequence: nodes query → notes query → combined response.
            auto dbN = drogon::app().getDbClient();
            auto noteFetch = [callback, noteSql, id, tenantId, userId, isAdmin]
                (Json::Value nodesArr) {
                auto dbT = drogon::app().getDbClient();
                auto onNotes = [callback, nodesArr]
                    (const drogon::orm::Result& rN) mutable {
                    Json::Value notesArr(Json::arrayValue);
                    for (const auto& row : rN) notesArr.append(rowToNoteMember(row));
                    Json::Value out;
                    out["nodes"] = nodesArr;
                    out["notes"] = notesArr;
                    callback(drogon::HttpResponse::newHttpJsonResponse(out));
                };
                auto onNotesErr = [callback]
                    (const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to fetch plot note members"));
                };
                if (isAdmin) {
                    dbT->execSqlAsync(noteSql, onNotes, onNotesErr,
                        id, tenantId);
                } else {
                    // CTE binds: (plotId, userId, plotId, userId, plotId)
                    // — anchor uses plotId, node_visible_starts uses userId,
                    // note_visible's outer JOIN uses plotId, override-TRUE
                    // EXISTS uses userId, then SELECT JOIN uses plotId.
                    dbT->execSqlAsync(noteSql, onNotes, onNotesErr,
                        id, userId, id, userId,   // CTE
                        id, tenantId, userId);    // SELECT WHERE + xray
                }
            };

            auto onNodes = [callback, noteFetch]
                (const drogon::orm::Result& rN) mutable {
                Json::Value nodesArr(Json::arrayValue);
                for (const auto& row : rN) nodesArr.append(rowToNodeMember(row));
                noteFetch(nodesArr);
            };
            auto onNodesErr = [callback]
                (const drogon::orm::DrogonDbException&) {
                callback(errorResponse(drogon::k500InternalServerError,
                    "db_error", "Failed to fetch plot node members"));
            };

            if (isAdmin) {
                dbN->execSqlAsync(nodeSql, onNodes, onNodesErr, id, tenantId);
            } else {
                dbN->execSqlAsync(nodeSql, onNodes, onNodesErr,
                    id, userId,             // CTE (plotId, userId)
                    id, tenantId, userId);  // SELECT WHERE + xray
            }
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to verify plot"));
        },
        id, tenantId);
}

// ─── POST /api/v1/tenants/{tid}/plots/{id}/nodes ─────────────────────────────
//
// Body: { nodeId: number }
// Idempotent: re-attaching an already-attached node returns 201 with no
// duplicate row (INSERT IGNORE). Cross-tenant defense: the node's owning
// map must live in this tenant.

void PlotController::addNode(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    if (!isTenantEditorOrAdmin(req)) {
        callback(errorResponse(drogon::k403Forbidden,
            "forbidden", "Plot management requires editor or admin role"));
        return;
    }

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body || !body->isMember("nodeId") || !(*body)["nodeId"].isInt()) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "nodeId (integer) is required"));
        return;
    }
    int nodeId = (*body)["nodeId"].asInt();

    // Verify both the plot AND the node live in this tenant before
    // inserting. Single existence query joins through the appropriate
    // tenant scopes.
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT (SELECT COUNT(*) FROM plots WHERE id = ? AND tenant_id = ?) AS plot_ok, "
        "       (SELECT COUNT(*) FROM nodes nd JOIN maps m ON m.id = nd.map_id "
        "        WHERE nd.id = ? AND m.tenant_id = ?) AS node_ok",
        [callback, req, tenantId, id, nodeId, userId]
        (const drogon::orm::Result& r1) {
            int plotOk = r1[0]["plot_ok"].as<int>();
            int nodeOk = r1[0]["node_ok"].as<int>();
            if (plotOk == 0) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "Plot not found"));
                return;
            }
            if (nodeOk == 0) {
                callback(errorResponse(drogon::k400BadRequest,
                    "bad_request", "Node not found in this tenant"));
                return;
            }

            auto dbI = drogon::app().getDbClient();
            dbI->execSqlAsync(
                "INSERT IGNORE INTO plot_nodes (plot_id, node_id) VALUES (?, ?)",
                [callback, req, tenantId, id, nodeId, userId]
                (const drogon::orm::Result&) {
                    Json::Value detail;
                    detail["plotId"] = id;
                    detail["nodeId"] = nodeId;
                    AuditLog::record("plot_node_add", req, userId, 0, tenantId, detail);
                    Json::Value v;
                    v["plotId"] = id;
                    v["nodeId"] = nodeId;
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(v);
                    resp->setStatusCode(drogon::k201Created);
                    callback(resp);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to attach node"));
                },
                id, nodeId);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to verify plot or node"));
        },
        id, tenantId, nodeId, tenantId);
}

// ─── DELETE /api/v1/tenants/{tid}/plots/{id}/nodes/{nodeId} ──────────────────

void PlotController::removeNode(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id, int nodeId) {

    if (!isTenantEditorOrAdmin(req)) {
        callback(errorResponse(drogon::k403Forbidden,
            "forbidden", "Plot management requires editor or admin role"));
        return;
    }

    int userId = callerUserId(req);
    auto db = drogon::app().getDbClient();
    // DELETE only if the plot is in this tenant. The plot_nodes row's
    // existence is the success signal — no row → 404.
    db->execSqlAsync(
        "DELETE pn FROM plot_nodes pn "
        "JOIN plots p ON p.id = pn.plot_id "
        "WHERE pn.plot_id = ? AND pn.node_id = ? AND p.tenant_id = ?",
        [callback, req, userId, tenantId, id, nodeId]
        (const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "Plot or node membership not found"));
                return;
            }
            Json::Value detail;
            detail["plotId"] = id;
            detail["nodeId"] = nodeId;
            AuditLog::record("plot_node_remove", req, userId, 0, tenantId, detail);
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k204NoContent);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to detach node"));
        },
        id, nodeId, tenantId);
}

// ─── POST /api/v1/tenants/{tid}/plots/{id}/notes ─────────────────────────────

void PlotController::addNote(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    if (!isTenantEditorOrAdmin(req)) {
        callback(errorResponse(drogon::k403Forbidden,
            "forbidden", "Plot management requires editor or admin role"));
        return;
    }

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body || !body->isMember("noteId") || !(*body)["noteId"].isInt()) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "noteId (integer) is required"));
        return;
    }
    int noteId = (*body)["noteId"].asInt();

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT (SELECT COUNT(*) FROM plots WHERE id = ? AND tenant_id = ?) AS plot_ok, "
        "       (SELECT COUNT(*) FROM notes n "
        "        JOIN nodes nd ON nd.id = n.node_id "
        "        JOIN maps m ON m.id = nd.map_id "
        "        WHERE n.id = ? AND m.tenant_id = ?) AS note_ok",
        [callback, req, tenantId, id, noteId, userId]
        (const drogon::orm::Result& r1) {
            int plotOk = r1[0]["plot_ok"].as<int>();
            int noteOk = r1[0]["note_ok"].as<int>();
            if (plotOk == 0) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "Plot not found"));
                return;
            }
            if (noteOk == 0) {
                callback(errorResponse(drogon::k400BadRequest,
                    "bad_request", "Note not found in this tenant"));
                return;
            }

            auto dbI = drogon::app().getDbClient();
            dbI->execSqlAsync(
                "INSERT IGNORE INTO plot_notes (plot_id, note_id) VALUES (?, ?)",
                [callback, req, tenantId, id, noteId, userId]
                (const drogon::orm::Result&) {
                    Json::Value detail;
                    detail["plotId"] = id;
                    detail["noteId"] = noteId;
                    AuditLog::record("plot_note_add", req, userId, 0, tenantId, detail);
                    Json::Value v;
                    v["plotId"] = id;
                    v["noteId"] = noteId;
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(v);
                    resp->setStatusCode(drogon::k201Created);
                    callback(resp);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to attach note"));
                },
                id, noteId);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to verify plot or note"));
        },
        id, tenantId, noteId, tenantId);
}

// ─── DELETE /api/v1/tenants/{tid}/plots/{id}/notes/{noteId} ──────────────────

void PlotController::removeNote(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id, int noteId) {

    if (!isTenantEditorOrAdmin(req)) {
        callback(errorResponse(drogon::k403Forbidden,
            "forbidden", "Plot management requires editor or admin role"));
        return;
    }

    int userId = callerUserId(req);
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "DELETE pnn FROM plot_notes pnn "
        "JOIN plots p ON p.id = pnn.plot_id "
        "WHERE pnn.plot_id = ? AND pnn.note_id = ? AND p.tenant_id = ?",
        [callback, req, userId, tenantId, id, noteId]
        (const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "Plot or note membership not found"));
                return;
            }
            Json::Value detail;
            detail["plotId"] = id;
            detail["noteId"] = noteId;
            AuditLog::record("plot_note_remove", req, userId, 0, tenantId, detail);
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k204NoContent);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to detach note"));
        },
        id, noteId, tenantId);
}

// ─── GET /api/v1/tenants/{tid}/maps/{mid}/nodes/{nid}/plots (#139) ──────────
//
// Reverse-membership: list plots that contain the given node. The caller
// must be able to see the node — a hidden node returns 404, never an empty
// array, so existence isn't leaked. Admins and map-owners-with-xray bypass
// the visibility check; everyone else is gated by the same effective-
// visibility CTE used elsewhere.

void PlotController::listPlotsForNode(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int nodeId) {

    int userId = callerUserId(req);
    bool isAdmin = isTenantAdmin(req);
    auto db = drogon::app().getDbClient();

    // Step 1: existence + visibility check, collapsed into one SELECT 1.
    // Returns 1 row iff the node exists in this tenant+map AND the caller
    // can see it. 0 rows → 404 in all three failure shapes (doesn't exist,
    // wrong map/tenant, or not visible) so existence isn't leaked.
    std::string verifySql;
    if (!isAdmin) verifySql = MAP_NODE_VISIBILITY_CTE;
    verifySql +=
        "SELECT 1 FROM nodes n "
        "JOIN maps m ON m.id = n.map_id AND m.tenant_id = ? "
        "WHERE n.id = ? AND n.map_id = ? ";
    if (!isAdmin) {
        verifySql +=
            "AND ((m.owner_id = ? AND m.owner_xray = TRUE) "
            "     OR n.id IN (SELECT start_id FROM visible_starts)) ";
    }

    auto onVerify = [callback, tenantId, nodeId]
        (const drogon::orm::Result& rV) {
        if (rV.empty()) {
            callback(errorResponse(drogon::k404NotFound,
                "not_found", "Node not found"));
            return;
        }
        // Step 2: list plots — no visibility filter on the plots themselves
        // (plots aren't visibility-tagged). Tenant-scoped to keep cross-
        // tenant rows out even though the node id alone would already
        // reach the right plots via plot_nodes.
        auto db2 = drogon::app().getDbClient();
        db2->execSqlAsync(
            "SELECT p.id, p.tenant_id, p.name, p.description, "
            "       p.created_by, p.created_at, p.updated_at "
            "FROM plots p "
            "JOIN plot_nodes pn ON pn.plot_id = p.id AND pn.node_id = ? "
            "WHERE p.tenant_id = ? "
            "ORDER BY p.name ASC",
            [callback](const drogon::orm::Result& rP) {
                Json::Value arr(Json::arrayValue);
                for (const auto& row : rP) arr.append(rowToPlot(row));
                callback(drogon::HttpResponse::newHttpJsonResponse(arr));
            },
            [callback](const drogon::orm::DrogonDbException&) {
                callback(errorResponse(drogon::k500InternalServerError,
                    "db_error", "Failed to fetch plots for node"));
            },
            nodeId, tenantId);
    };

    auto onErr = [callback](const drogon::orm::DrogonDbException&) {
        callback(errorResponse(drogon::k500InternalServerError,
            "db_error", "Failed to verify node visibility"));
    };

    if (isAdmin) {
        // verifySql binds: (tenantId, nodeId, mapId)
        db->execSqlAsync(verifySql, onVerify, onErr,
            tenantId, nodeId, mapId);
    } else {
        // CTE binds (mapId, userId), then verifySql binds
        // (tenantId, nodeId, mapId) for the SELECT and (userId) for xray.
        db->execSqlAsync(verifySql, onVerify, onErr,
            mapId, userId,
            tenantId, nodeId, mapId, userId);
    }
}

// ─── GET /api/v1/tenants/{tid}/maps/{mid}/notes/{nid}/plots (#139) ──────────
//
// Reverse-membership for notes. Same shape as listPlotsForNode but with
// note-visibility semantics (override-on-note OR inherited-from-attached-
// node visibility). 404 when not visible — see the node version's comment.

void PlotController::listPlotsForNote(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int noteId) {

    int userId = callerUserId(req);
    bool isAdmin = isTenantAdmin(req);
    auto db = drogon::app().getDbClient();

    std::string verifySql;
    if (!isAdmin) verifySql = MAP_NOTE_VISIBILITY_CTE;
    verifySql +=
        "SELECT 1 FROM notes n "
        "JOIN nodes nd ON nd.id = n.node_id "
        "JOIN maps m ON m.id = nd.map_id AND m.tenant_id = ? "
        "WHERE n.id = ? AND nd.map_id = ? ";
    if (!isAdmin) {
        verifySql +=
            "AND ((m.owner_id = ? AND m.owner_xray = TRUE) "
            "     OR n.id IN (SELECT visible_note_id FROM note_visible)) ";
    }

    auto onVerify = [callback, tenantId, noteId]
        (const drogon::orm::Result& rV) {
        if (rV.empty()) {
            callback(errorResponse(drogon::k404NotFound,
                "not_found", "Note not found"));
            return;
        }
        auto db2 = drogon::app().getDbClient();
        db2->execSqlAsync(
            "SELECT p.id, p.tenant_id, p.name, p.description, "
            "       p.created_by, p.created_at, p.updated_at "
            "FROM plots p "
            "JOIN plot_notes pnn ON pnn.plot_id = p.id AND pnn.note_id = ? "
            "WHERE p.tenant_id = ? "
            "ORDER BY p.name ASC",
            [callback](const drogon::orm::Result& rP) {
                Json::Value arr(Json::arrayValue);
                for (const auto& row : rP) arr.append(rowToPlot(row));
                callback(drogon::HttpResponse::newHttpJsonResponse(arr));
            },
            [callback](const drogon::orm::DrogonDbException&) {
                callback(errorResponse(drogon::k500InternalServerError,
                    "db_error", "Failed to fetch plots for note"));
            },
            noteId, tenantId);
    };

    auto onErr = [callback](const drogon::orm::DrogonDbException&) {
        callback(errorResponse(drogon::k500InternalServerError,
            "db_error", "Failed to verify note visibility"));
    };

    if (isAdmin) {
        // verifySql binds: (tenantId, noteId, mapId)
        db->execSqlAsync(verifySql, onVerify, onErr,
            tenantId, noteId, mapId);
    } else {
        // CTE binds (mapId, userId, mapId, userId), then SELECT binds
        // (tenantId, noteId, mapId) and xray binds (userId).
        db->execSqlAsync(verifySql, onVerify, onErr,
            mapId, userId, mapId, userId,
            tenantId, noteId, mapId, userId);
    }
}
