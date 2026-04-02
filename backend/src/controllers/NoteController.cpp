#include "NoteController.h"
#include <drogon/drogon.h>

static int callerUserId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("userId"); }
    catch (...) { return 0; }
}

static Json::Value errorJson(const std::string& code, const std::string& msg) {
    Json::Value v;
    v["error"]   = code;
    v["message"] = msg;
    return v;
}

// ─── GET /api/v1/tenants/{tenantId}/maps/{mapId}/notes ────────────────────────

void NoteController::listNotes(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId) {

    int userId = callerUserId(req);

    // Verify the map belongs to this tenant and the user can view it
    const std::string sql = R"(
        SELECT n.id, n.map_id, n.created_by, u.username AS creator_username,
               n.lat, n.lng, n.title, n.text, n.pinned,
               n.created_at, n.updated_at,
               CASE WHEN m.owner_id = ? OR n.created_by = ? OR mp.can_edit = 1
                    THEN 1 ELSE 0 END AS can_edit
        FROM notes n
        JOIN maps m ON m.id = n.map_id
        JOIN users u ON u.id = n.created_by
        LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ?
        LEFT JOIN map_permissions mp_pub
               ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL AND mp_pub.can_view = 1
        WHERE n.map_id = ? AND m.tenant_id = ?
          AND (m.owner_id = ? OR mp.can_view = 1 OR mp_pub.can_view = 1)
        ORDER BY n.pinned DESC, n.created_at ASC
    )";

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        sql,
        [callback](const drogon::orm::Result& r) {
            Json::Value arr(Json::arrayValue);
            for (const auto& row : r) {
                Json::Value n;
                n["id"]               = row["id"].as<int>();
                n["mapId"]            = row["map_id"].as<int>();
                n["createdBy"]        = row["created_by"].as<int>();
                n["createdByUsername"] = row["creator_username"].as<std::string>();
                n["lat"]              = row["lat"].as<double>();
                n["lng"]              = row["lng"].as<double>();
                n["title"]            = row["title"].isNull() ? "" : row["title"].as<std::string>();
                n["text"]             = row["text"].as<std::string>();
                n["pinned"]           = row["pinned"].as<bool>();
                n["createdAt"]        = row["created_at"].as<std::string>();
                n["updatedAt"]        = row["updated_at"].as<std::string>();
                n["canEdit"]          = row["can_edit"].as<bool>();
                arr.append(n);
            }
            callback(drogon::HttpResponse::newHttpJsonResponse(arr));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Failed to fetch notes"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        userId, userId, userId, mapId, tenantId, userId);
}

// ─── POST /api/v1/tenants/{tenantId}/maps/{mapId}/notes ───────────────────────

void NoteController::createNote(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId) {

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body || !body->isMember("lat") || !body->isMember("lng") || !(*body)["text"]) {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "lat, lng, and text are required"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    double lat   = (*body)["lat"].asDouble();
    double lng   = (*body)["lng"].asDouble();
    std::string title = (*body).get("title", "").asString();
    std::string text  = (*body)["text"].asString();

    // Verify map exists in this tenant and user has at least view access
    // (any member who can see the map can leave a note)
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT m.id FROM maps m "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "LEFT JOIN map_permissions mp_pub "
        "       ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL AND mp_pub.can_view = 1 "
        "WHERE m.id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.can_view = 1 OR mp_pub.can_view = 1)",
        [callback, mapId, userId, lat, lng, title, text]
        (const drogon::orm::Result& r) {
            if (r.empty()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("forbidden", "Map not found or you lack access"));
                resp->setStatusCode(drogon::k403Forbidden);
                callback(resp);
                return;
            }

            // Resource limit: 10,000 notes per map
            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "SELECT COUNT(*) AS cnt FROM notes WHERE map_id = ?",
                [callback, mapId, userId, lat, lng, title, text]
                (const drogon::orm::Result& rc) {
                    if (!rc.empty() && rc[0]["cnt"].as<int>() >= 10000) {
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(
                            errorJson("limit_exceeded", "Note limit reached for this map"));
                        resp->setStatusCode(drogon::k400BadRequest);
                        callback(resp);
                        return;
                    }

                    auto db3 = drogon::app().getDbClient();
                    db3->execSqlAsync(
                        "INSERT INTO notes (map_id, created_by, lat, lng, title, text) "
                        "VALUES (?,?,?,?,?,?)",
                        [callback, mapId, userId, lat, lng, title, text]
                        (const drogon::orm::Result& r2) {
                            int newId = static_cast<int>(r2.insertId());
                            Json::Value n;
                            n["id"]        = newId;
                            n["mapId"]     = mapId;
                            n["createdBy"] = userId;
                            n["lat"]       = lat;
                            n["lng"]       = lng;
                            n["title"]     = title;
                            n["text"]      = text;
                            n["pinned"]    = false;
                            n["canEdit"]   = true;
                            auto resp = drogon::HttpResponse::newHttpJsonResponse(n);
                            resp->setStatusCode(drogon::k201Created);
                            callback(resp);
                        },
                        [callback](const drogon::orm::DrogonDbException&) {
                            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                                errorJson("db_error", "Failed to create note"));
                            resp->setStatusCode(drogon::k500InternalServerError);
                            callback(resp);
                        },
                        mapId, userId, lat, lng, title, text);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(
                        errorJson("db_error", "Failed to check note count"));
                    resp->setStatusCode(drogon::k500InternalServerError);
                    callback(resp);
                },
                mapId);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Database error"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        userId, mapId, tenantId, userId);
}

// ─── GET /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id} ──────────────────

void NoteController::getNote(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT n.*, u.username AS creator_username, "
        "       CASE WHEN m.owner_id=? OR n.created_by=? OR mp.can_edit=1 "
        "            THEN 1 ELSE 0 END AS can_edit "
        "FROM notes n "
        "JOIN maps m ON m.id = n.map_id "
        "JOIN users u ON u.id = n.created_by "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "LEFT JOIN map_permissions mp_pub "
        "       ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL AND mp_pub.can_view = 1 "
        "WHERE n.id = ? AND n.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.can_view = 1 OR mp_pub.can_view = 1)",
        [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("not_found", "Note not found or no permission"));
                resp->setStatusCode(drogon::k404NotFound);
                callback(resp);
                return;
            }
            const auto& row = r[0];
            Json::Value n;
            n["id"]               = row["id"].as<int>();
            n["mapId"]            = row["map_id"].as<int>();
            n["createdBy"]        = row["created_by"].as<int>();
            n["createdByUsername"] = row["creator_username"].as<std::string>();
            n["lat"]              = row["lat"].as<double>();
            n["lng"]              = row["lng"].as<double>();
            n["title"]            = row["title"].isNull() ? "" : row["title"].as<std::string>();
            n["text"]             = row["text"].as<std::string>();
            n["pinned"]           = row["pinned"].as<bool>();
            n["createdAt"]        = row["created_at"].as<std::string>();
            n["updatedAt"]        = row["updated_at"].as<std::string>();
            n["canEdit"]          = row["can_edit"].as<bool>();
            callback(drogon::HttpResponse::newHttpJsonResponse(n));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Database error"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
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
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "Request body required"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    std::string newTitle = (*body).get("title", "").asString();
    std::string newText  = (*body).get("text", "").asString();

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "UPDATE notes n "
        "JOIN maps m ON m.id = n.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "SET n.title = IF(?='', n.title, ?), "
        "    n.text  = IF(?='', n.text, ?) "
        "WHERE n.id = ? AND n.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.can_edit = 1 OR n.created_by = ?)",
        [callback, id](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("forbidden", "Cannot update note"));
                resp->setStatusCode(drogon::k403Forbidden);
                callback(resp);
                return;
            }
            Json::Value v;
            v["id"]      = id;
            v["updated"] = true;
            callback(drogon::HttpResponse::newHttpJsonResponse(v));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Failed to update note"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        userId,
        newTitle, newTitle,
        newText, newText,
        id, mapId, tenantId, userId, userId);
}

// ─── DELETE /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id} ────────────────

void NoteController::deleteNote(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
        "DELETE n FROM notes n "
        "JOIN maps m ON m.id = n.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "WHERE n.id = ? AND n.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.can_edit = 1 OR n.created_by = ?)",
        [callback](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("forbidden", "Cannot delete note"));
                resp->setStatusCode(drogon::k403Forbidden);
                callback(resp);
                return;
            }
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k204NoContent);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Failed to delete note"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        userId, id, mapId, tenantId, userId, userId);
}
