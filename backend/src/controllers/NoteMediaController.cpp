#include "NoteMediaController.h"
#include "ErrorResponse.h"
#include <drogon/drogon.h>

// Phase 2a.iii: Media attachments on notes. Parallel to NodeMediaController
// — see that file for the design rationale and shared invariants. SQL
// joins go through notes → nodes → maps to derive the map for tenant/
// permission checks.

static int callerUserId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("userId"); }
    catch (...) { return 0; }
}

namespace {

constexpr size_t MAX_MEDIA_URL_LEN     = 2048;
constexpr size_t MAX_MEDIA_CAPTION_LEN = 512;

bool isHttpScheme(const std::string& url) {
    return url.rfind("http://", 0) == 0 || url.rfind("https://", 0) == 0;
}

Json::Value rowToMedia(const drogon::orm::Row& row) {
    Json::Value m;
    m["id"]         = row["id"].as<int>();
    m["noteId"]     = row["note_id"].as<int>();
    m["mediaType"]  = row["media_type"].as<std::string>();
    m["url"]        = row["url"].as<std::string>();
    m["caption"]    = row["caption"].isNull()
                        ? Json::Value("") : Json::Value(row["caption"].as<std::string>());
    m["createdAt"]  = row["created_at"].as<std::string>();
    return m;
}

} // anonymous namespace

// ─── GET .../notes/{noteId}/media ────────────────────────────────────────────

void NoteMediaController::listMedia(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int noteId) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT nm.id, nm.note_id, nm.media_type, nm.url, nm.caption, nm.created_at "
        "FROM note_media nm "
        "JOIN notes n ON n.id = nm.note_id "
        "JOIN nodes nd ON nd.id = n.node_id "
        "JOIN maps m  ON m.id  = nd.map_id "
        "LEFT JOIN map_permissions mp     ON mp.map_id = m.id     AND mp.user_id = ? "
        "LEFT JOIN map_permissions mp_pub ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL "
        "                                AND mp_pub.level IN ('view','comment','edit','moderate','admin') "
        "WHERE nm.note_id = ? AND nd.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('view','comment','edit','moderate','admin') OR mp_pub.level IN ('view','comment','edit','moderate','admin')) "
        "ORDER BY nm.created_at ASC",
        [callback](const drogon::orm::Result& r) {
            Json::Value arr(Json::arrayValue);
            for (const auto& row : r) arr.append(rowToMedia(row));
            callback(drogon::HttpResponse::newHttpJsonResponse(arr));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to fetch media"));
        },
        userId, noteId, mapId, tenantId, userId);
}

// ─── POST .../notes/{noteId}/media ───────────────────────────────────────────

void NoteMediaController::addMedia(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int noteId) {

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body || !body->isMember("mediaType") || !body->isMember("url")) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "mediaType and url are required"));
        return;
    }

    std::string mediaType = (*body)["mediaType"].asString();
    std::string url       = (*body)["url"].asString();
    std::string caption   = (*body).get("caption", "").asString();

    if (mediaType != "image" && mediaType != "link") {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "mediaType must be 'image' or 'link'"));
        return;
    }
    if (!isHttpScheme(url)) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "url must use http or https scheme"));
        return;
    }
    if (!checkMaxLen("url", url, MAX_MEDIA_URL_LEN, callback)) return;
    if (!checkMaxLen("caption", caption, MAX_MEDIA_CAPTION_LEN, callback)) return;

    // Verify the note exists on this map and the caller has edit access
    // OR is the note's creator (matches note CRUD permission rules).
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT n.id FROM notes n "
        "JOIN nodes nd ON nd.id = n.node_id "
        "JOIN maps m   ON m.id  = nd.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "WHERE n.id = ? AND nd.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin') OR n.created_by = ?)",
        [callback, noteId, mediaType, url, caption]
        (const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Note not found or insufficient permissions"));
                return;
            }
            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "INSERT INTO note_media (note_id, media_type, url, caption) "
                "VALUES (?, ?, ?, NULLIF(?, ''))",
                [callback, noteId, mediaType, url, caption]
                (const drogon::orm::Result& r2) {
                    int newId = static_cast<int>(r2.insertId());
                    Json::Value m;
                    m["id"]         = newId;
                    m["noteId"]     = noteId;
                    m["mediaType"]  = mediaType;
                    m["url"]        = url;
                    m["caption"]    = caption;
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(m);
                    resp->setStatusCode(drogon::k201Created);
                    callback(resp);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to add media"));
                },
                noteId, mediaType, url, caption);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Database error"));
        },
        userId, noteId, mapId, tenantId, userId, userId);
}

// ─── PUT .../notes/{noteId}/media/{id} ───────────────────────────────────────

void NoteMediaController::updateMedia(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int noteId, int id) {

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body || !body->isMember("caption")) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "caption is required"));
        return;
    }
    std::string caption = (*body)["caption"].asString();
    if (!checkMaxLen("caption", caption, MAX_MEDIA_CAPTION_LEN, callback)) return;

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "UPDATE note_media nm "
        "JOIN notes n ON n.id = nm.note_id "
        "JOIN nodes nd ON nd.id = n.node_id "
        "JOIN maps m   ON m.id  = nd.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "SET nm.caption = NULLIF(?, '') "
        "WHERE nm.id = ? AND nm.note_id = ? AND nd.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin') OR n.created_by = ?)",
        [callback, id](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Media not found or insufficient permissions"));
                return;
            }
            Json::Value v;
            v["id"]      = id;
            v["updated"] = true;
            callback(drogon::HttpResponse::newHttpJsonResponse(v));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to update media"));
        },
        userId, caption, id, noteId, mapId, tenantId, userId, userId);
}

// ─── DELETE .../notes/{noteId}/media/{id} ────────────────────────────────────

void NoteMediaController::deleteMedia(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int noteId, int id) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
        "DELETE nm FROM note_media nm "
        "JOIN notes n ON n.id = nm.note_id "
        "JOIN nodes nd ON nd.id = n.node_id "
        "JOIN maps m   ON m.id  = nd.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "WHERE nm.id = ? AND nm.note_id = ? AND nd.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin') OR n.created_by = ?)",
        [callback](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Media not found or insufficient permissions"));
                return;
            }
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k204NoContent);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to delete media"));
        },
        userId, id, noteId, mapId, tenantId, userId, userId);
}
