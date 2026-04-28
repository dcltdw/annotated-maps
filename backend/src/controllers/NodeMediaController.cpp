#include "NodeMediaController.h"
#include "ErrorResponse.h"
#include <drogon/drogon.h>

// Phase 2a.iii: Media attachments on nodes. Mirrors the old
// annotation_media surface; will have a near-identical sibling
// (NoteMediaController) for notes — see #84 for the design split.

static int callerUserId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("userId"); }
    catch (...) { return 0; }
}

namespace {

// Cap on URL and caption lengths — match the schema column widths so
// API rejection is the loud failure mode rather than silent DB truncation.
constexpr size_t MAX_MEDIA_URL_LEN     = 2048;
constexpr size_t MAX_MEDIA_CAPTION_LEN = 512;

// http(s) scheme validation. The DB column accepts any string, but
// stored javascript:/data:/file: URLs are an XSS vector when the frontend
// renders them, so we lock them out at the API layer.
bool isHttpScheme(const std::string& url) {
    return url.rfind("http://", 0) == 0 || url.rfind("https://", 0) == 0;
}

Json::Value rowToMedia(const drogon::orm::Row& row) {
    Json::Value m;
    m["id"]         = row["id"].as<int>();
    m["nodeId"]     = row["node_id"].as<int>();
    m["mediaType"]  = row["media_type"].as<std::string>();
    m["url"]        = row["url"].as<std::string>();
    m["caption"]    = row["caption"].isNull()
                        ? Json::Value("") : Json::Value(row["caption"].as<std::string>());
    m["createdAt"]  = row["created_at"].as<std::string>();
    return m;
}

} // anonymous namespace

// ─── GET .../nodes/{nodeId}/media ────────────────────────────────────────────

void NodeMediaController::listMedia(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int nodeId) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT nm.id, nm.node_id, nm.media_type, nm.url, nm.caption, nm.created_at "
        "FROM node_media nm "
        "JOIN nodes nd ON nd.id = nm.node_id "
        "JOIN maps m   ON m.id  = nd.map_id "
        "LEFT JOIN map_permissions mp     ON mp.map_id = m.id     AND mp.user_id = ? "
        "LEFT JOIN map_permissions mp_pub ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL "
        "                                AND mp_pub.level IN ('view','comment','edit','moderate','admin') "
        "WHERE nm.node_id = ? AND nd.map_id = ? AND m.tenant_id = ? "
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
        userId, nodeId, mapId, tenantId, userId);
}

// ─── POST .../nodes/{nodeId}/media ───────────────────────────────────────────

void NodeMediaController::addMedia(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int nodeId) {

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

    // Verify the node exists on this map and the caller has edit access
    // (any view-access user can read, but only edit-access can attach).
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT nd.id FROM nodes nd "
        "JOIN maps m ON m.id = nd.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "WHERE nd.id = ? AND nd.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin'))",
        [callback, nodeId, mediaType, url, caption]
        (const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Node not found or insufficient permissions"));
                return;
            }
            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "INSERT INTO node_media (node_id, media_type, url, caption) "
                "VALUES (?, ?, ?, NULLIF(?, ''))",
                [callback, nodeId, mediaType, url, caption]
                (const drogon::orm::Result& r2) {
                    int newId = static_cast<int>(r2.insertId());
                    Json::Value m;
                    m["id"]         = newId;
                    m["nodeId"]     = nodeId;
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
                nodeId, mediaType, url, caption);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Database error"));
        },
        userId, nodeId, mapId, tenantId, userId);
}

// ─── PUT .../nodes/{nodeId}/media/{id} ───────────────────────────────────────
// Caption-only edit. URL/mediaType are immutable — replace the row to
// change those (delete + add). Keeps the audit trail simpler.

void NodeMediaController::updateMedia(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int nodeId, int id) {

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
        "UPDATE node_media nm "
        "JOIN nodes nd ON nd.id = nm.node_id "
        "JOIN maps m   ON m.id  = nd.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "SET nm.caption = NULLIF(?, '') "
        "WHERE nm.id = ? AND nm.node_id = ? AND nd.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin'))",
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
        userId, caption, id, nodeId, mapId, tenantId, userId);
}

// ─── DELETE .../nodes/{nodeId}/media/{id} ────────────────────────────────────

void NodeMediaController::deleteMedia(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int nodeId, int id) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
        "DELETE nm FROM node_media nm "
        "JOIN nodes nd ON nd.id = nm.node_id "
        "JOIN maps m   ON m.id  = nd.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id = m.id AND mp.user_id = ? "
        "WHERE nm.id = ? AND nm.node_id = ? AND nd.map_id = ? AND m.tenant_id = ? "
        "  AND (m.owner_id = ? OR mp.level IN ('edit','moderate','admin'))",
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
        userId, id, nodeId, mapId, tenantId, userId);
}
