#include "NoteController.h"
#include "AuditLog.h"
#include "ErrorResponse.h"
#include "NodeController.h"  // MAX_NODE_DEPTH for the resolve CTE
#include "VisibilityAuth.h"
#include <drogon/drogon.h>
#include <set>

// Phase 2a.ii: Notes attach to nodes via the URL path. List/create
// nest under /maps/{mapId}/nodes/{nodeId}/notes; get/put/delete sit
// under /maps/{mapId}/notes/{id} since the note id alone identifies
// it within the map.
//
// Phase 2b.iii (#87) adds visibility tagging + read filtering. The
// effective-visibility CTE is structurally similar to the node one in
// #99 (NodeController.cpp): walk up `parent_id` to the first override
// = TRUE ancestor. The note version adds an extra hop at the bottom —
// from the note to its attached node — and short-circuits when the
// note itself has override = TRUE.

static int callerUserId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("userId"); }
    catch (...) { return 0; }
}

namespace {

// ─── Effective-visibility CTE for notes (#87) ────────────────────────────────
// `node_resolve` and `node_visible_starts` are structurally identical to
// the node version in NodeController.cpp (#99). `note_visible` then
// produces the set of note ids visible to the caller, computed as:
//   - note.override = TRUE: visible if user is in any tagged group on
//     note_visibility for that note.
//   - note.override = FALSE: visible if the attached node is in
//     node_visible_starts (i.e., visible-by-inheritance via the node
//     parent chain).
//
// Bound the recursion against MAX_NODE_DEPTH so a malicious deep chain
// can't stall the query.
//
// CTE prefix binds 4 parameters (in order):
//   (mapId, userId, mapId, userId)
// — mapId+userId for the node CTE pair, then mapId+userId for note_visible.

const std::string NOTE_VISIBILITY_CTE =
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

// Predicate to AND into a notes WHERE clause. Aliases assumed:
//   m → maps, n → notes (the row being filtered).
// Binds 1 parameter: (userId) for the owner_xray check.
const std::string NOTE_VISIBILITY_PREDICATE =
    " AND ((m.owner_id = ? AND m.owner_xray = TRUE) "
    "      OR n.id IN (SELECT visible_note_id FROM note_visible)) ";

// Build a JSON note from a result row. Shape is consistent across all
// read endpoints.
Json::Value rowToNote(const drogon::orm::Row& row) {
    Json::Value n;
    n["id"]                  = row["id"].as<int>();
    n["nodeId"]              = row["node_id"].as<int>();
    n["mapId"]               = row["map_id"].as<int>();
    n["createdBy"]           = row["created_by"].as<int>();
    n["createdByUsername"]   = row["creator_username"].as<std::string>();
    n["title"]               = row["title"].isNull() ? "" : row["title"].as<std::string>();
    n["text"]                = row["text"].as<std::string>();
    n["pinned"]              = row["pinned"].as<bool>();
    n["color"]               = row["color"].isNull()
                                 ? Json::Value() : Json::Value(row["color"].as<std::string>());
    n["visibilityOverride"]  = row["visibility_override"].as<bool>();
    n["createdAt"]           = row["created_at"].as<std::string>();
    n["updatedAt"]           = row["updated_at"].as<std::string>();
    n["canEdit"]             = row["can_edit"].as<bool>();
    return n;
}

} // anonymous namespace

// ─── GET /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/notes ────────

void NoteController::listNotes(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int nodeId) {

    int userId = callerUserId(req);
    bool isAdmin = isTenantAdmin(req);

    // Tenant admins bypass the visibility filter; non-admins get the
    // CTE prefix and the effective-visibility predicate. Order-of-bind
    // notes preserved inline below.
    std::string sql;
    if (!isAdmin) sql = NOTE_VISIBILITY_CTE;
    sql +=
        "SELECT n.id, n.node_id, nd.map_id, n.created_by, u.username AS creator_username, "
        "       n.title, n.text, n.pinned, n.color, n.visibility_override, "
        "       n.created_at, n.updated_at, "
        "       CASE WHEN m.owner_id = ? OR n.created_by = ? OR mp.level IN ('edit','moderate','admin') "
        "            THEN 1 ELSE 0 END AS can_edit "
        "FROM notes n "
        "JOIN nodes nd ON nd.id = n.node_id "
        "JOIN maps m   ON m.id  = nd.map_id "
        "JOIN users u  ON u.id  = n.created_by "
        "LEFT JOIN map_permissions mp     ON mp.map_id = m.id     AND mp.user_id = ? "
        "LEFT JOIN map_permissions mp_pub ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL "
        "                                AND mp_pub.level IN ('view','comment','edit','moderate','admin') "
        "WHERE n.node_id = ? AND nd.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('view','comment','edit','moderate','admin') OR mp_pub.level IN ('view','comment','edit','moderate','admin'))";
    if (!isAdmin) sql += NOTE_VISIBILITY_PREDICATE;
    sql += " ORDER BY n.pinned DESC, n.created_at ASC";

    auto db = drogon::app().getDbClient();
    auto resultCb = [callback](const drogon::orm::Result& r) {
        Json::Value arr(Json::arrayValue);
        for (const auto& row : r) arr.append(rowToNote(row));
        callback(drogon::HttpResponse::newHttpJsonResponse(arr));
    };
    auto errCb = [callback](const drogon::orm::DrogonDbException&) {
        callback(errorResponse(drogon::k500InternalServerError,
            "db_error", "Failed to fetch notes"));
    };

    if (isAdmin) {
        // Existing param order preserved.
        db->execSqlAsync(sql, resultCb, errCb,
            userId, userId, userId, nodeId, mapId, tenantId, userId);
    } else {
        // CTE binds (mapId, userId, mapId, userId), then the SELECT
        // binds the same params as the admin path, then the predicate
        // binds (userId) for the xray check.
        db->execSqlAsync(sql, resultCb, errCb,
            mapId, userId, mapId, userId,           // CTE
            userId, userId, userId,                  // can_edit + mp join
            nodeId, mapId, tenantId, userId,         // WHERE map gating
            userId);                                 // visibility xray
    }
}

// ─── POST /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/notes ───────

void NoteController::createNote(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int nodeId) {

    int userId = callerUserId(req);
    std::string callerUsername;
    try { callerUsername = req->getAttributes()->get<std::string>("username"); } catch (...) {}

    auto body = req->getJsonObject();
    if (!body || !(*body)["text"]) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "text is required"));
        return;
    }

    std::string title = (*body).get("title", "").asString();
    std::string text  = (*body)["text"].asString();
    std::string color = (*body).get("color", "").asString();
    // Mirror updateNote's pinned handling (line 352–353). Default to FALSE
    // when the field is absent. Bug #154: previously the create path
    // dropped pinned entirely — column was missing from the INSERT, the
    // response hardcoded false, and the row landed at the schema default.
    bool pinned       = (*body).get("pinned", false).asBool();

    if (!checkMaxLen("title", title, MAX_TITLE_LEN, callback)) return;
    if (!checkMaxLen("text", text, MAX_TEXT_LEN, callback)) return;

    // Verify the node exists on the right map+tenant and the caller
    // has at least view access to that map. The 10k-notes-per-map limit
    // is preserved (counted via JOIN through nodes).
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT nd.id FROM nodes nd "
        "JOIN maps m ON m.id = nd.map_id "
        "LEFT JOIN map_permissions mp     ON mp.map_id = m.id     AND mp.user_id = ? "
        "LEFT JOIN map_permissions mp_pub ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL "
        "                                AND mp_pub.level IN ('view','comment','edit','moderate','admin') "
        "WHERE nd.id = ? AND nd.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('view','comment','edit','moderate','admin') "
        "       OR mp_pub.level IN ('view','comment','edit','moderate','admin'))",
        [callback, mapId, nodeId, userId, callerUsername, title, text, color, pinned]
        (const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Node not found or you lack access"));
                return;
            }

            // Atomic INSERT-with-limit-check (10k notes per map). Count
            // via JOIN through nodes since notes carry node_id only.
            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "INSERT INTO notes (node_id, created_by, title, text, color, pinned) "
                "SELECT ?,?,?,?,NULLIF(?,''),? FROM dual "
                "WHERE (SELECT COUNT(*) FROM notes n2 "
                "       JOIN nodes nd2 ON nd2.id = n2.node_id "
                "       WHERE nd2.map_id = ?) < 10000",
                [callback, mapId, nodeId, userId, callerUsername, title, text, color, pinned]
                (const drogon::orm::Result& r2) {
                    if (r2.affectedRows() == 0) {
                        callback(errorResponse(drogon::k400BadRequest,
                            "limit_exceeded", "Note limit reached for this map"));
                        return;
                    }
                    int newId = static_cast<int>(r2.insertId());

                    // Re-fetch just the timestamps so the response shape
                    // matches the GET-style payload exactly (frontend Zod
                    // schema requires createdAt + updatedAt). Same fix as
                    // the MapController one in #127.
                    auto db3 = drogon::app().getDbClient();
                    db3->execSqlAsync(
                        "SELECT created_at, updated_at FROM notes WHERE id = ?",
                        [callback, newId, nodeId, mapId, userId, callerUsername,
                         title, text, color, pinned]
                        (const drogon::orm::Result& rTs) {
                            Json::Value n;
                            n["id"]                  = newId;
                            n["nodeId"]              = nodeId;
                            n["mapId"]               = mapId;
                            n["createdBy"]           = userId;
                            n["createdByUsername"]   = callerUsername;
                            n["title"]               = title;
                            n["text"]                = text;
                            n["pinned"]              = pinned;
                            n["color"]               = color.empty()
                                                         ? Json::Value()
                                                         : Json::Value(color);
                            n["visibilityOverride"]  = false;
                            n["canEdit"]             = true;
                            if (!rTs.empty()) {
                                n["createdAt"] = rTs[0]["created_at"].as<std::string>();
                                n["updatedAt"] = rTs[0]["updated_at"].as<std::string>();
                            }
                            auto resp = drogon::HttpResponse::newHttpJsonResponse(n);
                            resp->setStatusCode(drogon::k201Created);
                            callback(resp);
                        },
                        [callback](const drogon::orm::DrogonDbException&) {
                            callback(errorResponse(drogon::k500InternalServerError,
                                "db_error", "Failed to fetch created note timestamps"));
                        },
                        newId);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to create note"));
                },
                nodeId, userId, title, text, color, pinned, mapId);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Database error"));
        },
        userId, nodeId, mapId, tenantId, userId);
}

// ─── GET /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id} ──────────────────

void NoteController::getNote(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    int userId = callerUserId(req);
    bool isAdmin = isTenantAdmin(req);

    std::string sql;
    if (!isAdmin) sql = NOTE_VISIBILITY_CTE;
    sql +=
        "SELECT n.id, n.node_id, nd.map_id, n.created_by, u.username AS creator_username, "
        "       n.title, n.text, n.pinned, n.color, n.visibility_override, "
        "       n.created_at, n.updated_at, "
        "       CASE WHEN m.owner_id = ? OR n.created_by = ? OR mp.level IN ('edit','moderate','admin') "
        "            THEN 1 ELSE 0 END AS can_edit "
        "FROM notes n "
        "JOIN nodes nd ON nd.id = n.node_id "
        "JOIN maps m   ON m.id  = nd.map_id "
        "JOIN users u  ON u.id  = n.created_by "
        "LEFT JOIN map_permissions mp     ON mp.map_id = m.id     AND mp.user_id = ? "
        "LEFT JOIN map_permissions mp_pub ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL "
        "                                AND mp_pub.level IN ('view','comment','edit','moderate','admin') "
        "WHERE n.id = ? AND nd.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('view','comment','edit','moderate','admin') OR mp_pub.level IN ('view','comment','edit','moderate','admin'))";
    if (!isAdmin) sql += NOTE_VISIBILITY_PREDICATE;

    auto resultCb = [callback](const drogon::orm::Result& r) {
        if (r.empty()) {
            callback(errorResponse(drogon::k404NotFound,
                "not_found", "Note not found or no permission"));
            return;
        }
        callback(drogon::HttpResponse::newHttpJsonResponse(rowToNote(r[0])));
    };
    auto errCb = [callback](const drogon::orm::DrogonDbException&) {
        callback(errorResponse(drogon::k500InternalServerError,
            "db_error", "Database error"));
    };

    auto db = drogon::app().getDbClient();
    if (isAdmin) {
        db->execSqlAsync(sql, resultCb, errCb,
            userId, userId, userId, id, mapId, tenantId, userId);
    } else {
        db->execSqlAsync(sql, resultCb, errCb,
            mapId, userId, mapId, userId,           // CTE
            userId, userId, userId,                  // can_edit + mp join
            id, mapId, tenantId, userId,             // WHERE
            userId);                                 // xray
    }
}

// ─── PUT /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id} ──────────────────

void NoteController::updateNote(
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

    std::string newTitle = (*body).get("title", "").asString();
    std::string newText  = (*body).get("text", "").asString();
    std::string newColor = (*body).get("color", "").asString();
    bool hasPinned       = body->isMember("pinned");
    bool newPinned       = hasPinned ? (*body)["pinned"].asBool() : false;

    if (!checkMaxLen("title", newTitle, MAX_TITLE_LEN, callback)) return;
    if (!checkMaxLen("text", newText, MAX_TEXT_LEN, callback)) return;

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "UPDATE notes n "
        "JOIN nodes nd ON nd.id = n.node_id "
        "JOIN maps m   ON m.id  = nd.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "SET n.title  = IF(?='', n.title, ?), "
        "    n.text   = IF(?='', n.text,  ?), "
        "    n.color  = IF(?='', n.color, ?), "
        "    n.pinned = IF(?, ?, n.pinned) "
        "WHERE n.id = ? AND nd.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin') OR n.created_by = ?)",
        [callback, req, userId, tenantId, mapId, id](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Cannot update note"));
                return;
            }
            Json::Value detail;
            detail["mapId"]  = mapId;
            detail["noteId"] = id;
            AuditLog::record("note_update", req, userId, 0, tenantId, detail);
            Json::Value v;
            v["id"]      = id;
            v["updated"] = true;
            callback(drogon::HttpResponse::newHttpJsonResponse(v));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to update note"));
        },
        userId,
        newTitle, newTitle,
        newText,  newText,
        newColor, newColor,
        hasPinned, newPinned,
        id, mapId, tenantId, userId, userId);
}

// ─── DELETE /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id} ───────────────

void NoteController::deleteNote(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
        "DELETE n FROM notes n "
        "JOIN nodes nd ON nd.id = n.node_id "
        "JOIN maps m   ON m.id  = nd.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "WHERE n.id = ? AND nd.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin') OR n.created_by = ?)",
        [callback, req, userId, tenantId, mapId, id](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Cannot delete note"));
                return;
            }
            Json::Value detail;
            detail["mapId"]  = mapId;
            detail["noteId"] = id;
            AuditLog::record("note_delete", req, userId, 0, tenantId, detail);
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k204NoContent);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to delete note"));
        },
        userId, id, mapId, tenantId, userId, userId);
}

// ─── GET /api/v1/tenants/{tid}/maps/{mid}/notes/{id}/visibility ──────────────
//
// Raw stored state (no inheritance). Mirror of NodeController::getVisibility:
// the caller doesn't need read-side visibility on the note itself — managers
// need to be able to inspect tagging metadata before editing it. Tenant
// scoping (note must live under a node on a map in this tenant) is the
// only existence check.

void NoteController::getVisibility(
    const drogon::HttpRequestPtr& /*req*/,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT n.visibility_override, nv.visibility_group_id "
        "FROM notes n "
        "JOIN nodes nd ON nd.id = n.node_id "
        "JOIN maps m ON m.id = nd.map_id "
        "LEFT JOIN note_visibility nv ON nv.note_id = n.id "
        "WHERE n.id = ? AND nd.map_id = ? AND m.tenant_id = ?",
        [callback, id](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "Note not found"));
                return;
            }
            Json::Value out;
            out["noteId"]   = id;
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
                "db_error", "Failed to fetch note visibility"));
        },
        id, mapId, tenantId);
}

// ─── POST /api/v1/tenants/{tid}/maps/{mid}/notes/{id}/visibility ─────────────
//
// Body: { override?: bool, groupIds?: number[] }   — same shape as #86 nodes.
// Auth: requireVisibilityGroupManager (admin OR manages_visibility group
// member). Validates that all groupIds belong to this tenant; verifies the
// note lives on this map+tenant.

void NoteController::setVisibility(
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

    // Same int-set → "1,2,3" join trick used in #86 NodeController. Safe
    // because the values came from Json::Value::asInt() — bounded ints,
    // no string content, no SQL injection vector.
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
            detail["noteId"] = id;
            AuditLog::record("note_visibility_set", req,
                userId, 0, tenantId, detail);
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k204NoContent);
            callback(resp);
        };

        // Step 4: replace tag set if groupIds present.
        auto applyTags = [callback, id, hasGroupIds, groupIds, finish]() {
            if (!hasGroupIds) { finish(); return; }
            auto dbT = drogon::app().getDbClient();
            dbT->execSqlAsync(
                "DELETE FROM note_visibility WHERE note_id = ?",
                [callback, id, groupIds, finish](const drogon::orm::Result&) {
                    if (groupIds.empty()) { finish(); return; }
                    std::string vals;
                    bool first = true;
                    for (int g : groupIds) {
                        if (!first) vals += ",";
                        vals += "(" + std::to_string(id) + "," + std::to_string(g) + ")";
                        first = false;
                    }
                    auto dbI = drogon::app().getDbClient();
                    dbI->execSqlAsync(
                        "INSERT INTO note_visibility "
                        "  (note_id, visibility_group_id) VALUES " + vals,
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

        // Step 3: optionally update note.visibility_override.
        auto applyOverrideThenTags =
            [callback, id, hasOverride, overrideVal, applyTags]() {
            if (!hasOverride) { applyTags(); return; }
            auto dbO = drogon::app().getDbClient();
            dbO->execSqlAsync(
                "UPDATE notes SET visibility_override = ? WHERE id = ?",
                [applyTags](const drogon::orm::Result&) { applyTags(); },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to set override"));
                },
                overrideVal, id);
        };

        // Step 2: verify the note exists on this map+tenant.
        auto dbN = drogon::app().getDbClient();
        dbN->execSqlAsync(
            "SELECT n.id FROM notes n "
            "JOIN nodes nd ON nd.id = n.node_id "
            "JOIN maps m ON m.id = nd.map_id "
            "WHERE n.id = ? AND nd.map_id = ? AND m.tenant_id = ?",
            [callback, tenantId, hasGroupIds, groupIds, joinIds,
             applyOverrideThenTags](const drogon::orm::Result& r1) {
                if (r1.empty()) {
                    callback(errorResponse(drogon::k404NotFound,
                        "not_found", "Note not found"));
                    return;
                }
                if (!hasGroupIds || groupIds.empty()) {
                    applyOverrideThenTags();
                    return;
                }
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
                    "db_error", "Failed to verify note"));
            },
            id, mapId, tenantId);
    });
}
