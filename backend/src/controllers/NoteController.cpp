#include "NoteController.h"
#include "AuditLog.h"
#include "ErrorResponse.h"
#include <drogon/drogon.h>

// Phase 2a.ii: Notes attach to nodes via the URL path. List/create
// nest under /maps/{mapId}/nodes/{nodeId}/notes; get/put/delete sit
// under /maps/{mapId}/notes/{id} since the note id alone identifies
// it within the map. Visibility filtering arrives in Phase 2b.iii.

static int callerUserId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("userId"); }
    catch (...) { return 0; }
}

namespace {

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

    const std::string sql = R"(
        SELECT n.id, n.node_id, nd.map_id, n.created_by, u.username AS creator_username,
               n.title, n.text, n.pinned, n.color, n.visibility_override,
               n.created_at, n.updated_at,
               CASE WHEN m.owner_id = ? OR n.created_by = ? OR mp.level IN ('edit','moderate','admin')
                    THEN 1 ELSE 0 END AS can_edit
        FROM notes n
        JOIN nodes nd ON nd.id = n.node_id
        JOIN maps m   ON m.id  = nd.map_id
        JOIN users u  ON u.id  = n.created_by
        LEFT JOIN map_permissions mp     ON mp.map_id = m.id     AND mp.user_id = ?
        LEFT JOIN map_permissions mp_pub ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL
                                        AND mp_pub.level IN ('view','comment','edit','moderate','admin')
        WHERE n.node_id = ? AND nd.map_id = ? AND m.tenant_id = ?
          AND (m.owner_id = ? OR mp.level IN ('view','comment','edit','moderate','admin') OR mp_pub.level IN ('view','comment','edit','moderate','admin'))
        ORDER BY n.pinned DESC, n.created_at ASC
    )";

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        sql,
        [callback](const drogon::orm::Result& r) {
            Json::Value arr(Json::arrayValue);
            for (const auto& row : r) arr.append(rowToNote(row));
            callback(drogon::HttpResponse::newHttpJsonResponse(arr));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to fetch notes"));
        },
        userId, userId, userId, nodeId, mapId, tenantId, userId);
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
        [callback, mapId, nodeId, userId, callerUsername, title, text, color]
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
                "INSERT INTO notes (node_id, created_by, title, text, color) "
                "SELECT ?,?,?,?,NULLIF(?,'') FROM dual "
                "WHERE (SELECT COUNT(*) FROM notes n2 "
                "       JOIN nodes nd2 ON nd2.id = n2.node_id "
                "       WHERE nd2.map_id = ?) < 10000",
                [callback, mapId, nodeId, userId, callerUsername, title, text, color]
                (const drogon::orm::Result& r2) {
                    if (r2.affectedRows() == 0) {
                        callback(errorResponse(drogon::k400BadRequest,
                            "limit_exceeded", "Note limit reached for this map"));
                        return;
                    }
                    int newId = static_cast<int>(r2.insertId());
                    Json::Value n;
                    n["id"]                  = newId;
                    n["nodeId"]              = nodeId;
                    n["mapId"]               = mapId;
                    n["createdBy"]           = userId;
                    n["createdByUsername"]   = callerUsername;
                    n["title"]               = title;
                    n["text"]                = text;
                    n["pinned"]              = false;
                    n["color"]               = color.empty() ? Json::Value() : Json::Value(color);
                    n["visibilityOverride"]  = false;
                    n["canEdit"]             = true;
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(n);
                    resp->setStatusCode(drogon::k201Created);
                    callback(resp);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to create note"));
                },
                nodeId, userId, title, text, color, mapId);
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
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
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
        "  AND (m.owner_id = ? OR mp.level IN ('view','comment','edit','moderate','admin') OR mp_pub.level IN ('view','comment','edit','moderate','admin'))",
        [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "Note not found or no permission"));
                return;
            }
            callback(drogon::HttpResponse::newHttpJsonResponse(rowToNote(r[0])));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Database error"));
        },
        userId, userId, userId, id, mapId, tenantId, userId);
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
