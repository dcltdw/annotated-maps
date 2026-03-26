#include "AnnotationController.h"
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

// Helper: check caller's effective permission on a map
// Returns "none" | "view" | "edit" | "owner"
static std::string effectivePermission(int mapId, int userId,
                                       const drogon::orm::Result& r) {
    (void)mapId; (void)userId; (void)r;
    // In a real implementation, query map_permissions. Here we return
    // based on the pre-fetched result passed in from the calling function.
    return "view"; // placeholder — actual logic in SQL joins below
}

// ─── GET /api/v1/maps/{mapId}/annotations ─────────────────────────────────────

void AnnotationController::listAnnotations(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int mapId) {

    int userId = callerUserId(req);

    // Permission check + annotation fetch in one query
    const std::string sql = R"(
        SELECT a.id, a.map_id, a.created_by, u.username AS creator_username,
               a.type, a.title, a.description, a.geo_json,
               a.created_at, a.updated_at,
               CASE
                   WHEN m.owner_id = ? THEN 1
                   WHEN mp.can_edit = 1 THEN 1
                   ELSE 0
               END AS can_edit
        FROM annotations a
        JOIN maps m ON m.id = a.map_id
        JOIN users u ON u.id = a.created_by
        LEFT JOIN map_permissions mp
               ON mp.map_id = m.id AND mp.user_id = ?
        LEFT JOIN map_permissions mp_pub
               ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL AND mp_pub.can_view = 1
        WHERE a.map_id = ?
          AND (m.owner_id = ? OR mp.can_view = 1 OR mp_pub.can_view = 1)
        ORDER BY a.created_at ASC
    )";

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        sql,
        [callback, mapId](const drogon::orm::Result& r) {
            (void)mapId;
            Json::Value arr(Json::arrayValue);
            for (const auto& row : r) {
                Json::Value a;
                a["id"]                = row["id"].as<int>();
                a["mapId"]             = row["map_id"].as<int>();
                a["createdBy"]         = row["created_by"].as<int>();
                a["createdByUsername"] = row["creator_username"].as<std::string>();
                a["type"]              = row["type"].as<std::string>();
                a["title"]             = row["title"].as<std::string>();
                a["description"]       = row["description"].isNull() ? "" : row["description"].as<std::string>();
                a["createdAt"]         = row["created_at"].as<std::string>();
                a["updatedAt"]         = row["updated_at"].as<std::string>();
                a["canEdit"]           = row["can_edit"].as<bool>();
                a["media"]             = Json::Value(Json::arrayValue); // loaded separately if needed

                // Parse stored GeoJSON string into JSON
                Json::Value geoJson;
                Json::Reader reader;
                reader.parse(row["geo_json"].as<std::string>(), geoJson);
                a["geoJson"] = geoJson;

                arr.append(a);
            }
            callback(drogon::HttpResponse::newHttpJsonResponse(arr));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("forbidden_or_not_found",
                          "Map not found or you lack view permission"));
            resp->setStatusCode(drogon::k403Forbidden);
            callback(resp);
        },
        userId, userId, mapId, userId);
}

// ─── POST /api/v1/maps/{mapId}/annotations ────────────────────────────────────

void AnnotationController::createAnnotation(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int mapId) {

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body || !(*body)["type"] || !(*body)["title"] || !(*body)["geoJson"]) {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "type, title, and geoJson are required"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    std::string type        = (*body)["type"].asString();
    std::string title       = (*body)["title"].asString();
    std::string description = (*body).get("description", "").asString();

    // Serialize geoJson back to string for storage
    Json::StreamWriterBuilder wb;
    std::string geoJsonStr = Json::writeString(wb, (*body)["geoJson"]);

    // Verify caller has edit permission on the map
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT CASE WHEN m.owner_id=? THEN 1 "
        "            WHEN mp.can_edit=1 THEN 1 ELSE 0 END AS allowed "
        "FROM maps m "
        "LEFT JOIN map_permissions mp ON mp.map_id=m.id AND mp.user_id=? "
        "WHERE m.id=?",
        [callback, mapId, userId, type, title, description, geoJsonStr]
        (const drogon::orm::Result& r) {
            if (r.empty() || !r[0]["allowed"].as<bool>()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("forbidden", "You do not have edit permission on this map"));
                resp->setStatusCode(drogon::k403Forbidden);
                callback(resp);
                return;
            }
            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "INSERT INTO annotations (map_id, created_by, type, title, description, geo_json) "
                "VALUES (?,?,?,?,?,?)",
                [callback, mapId, userId, type, title, description](const drogon::orm::Result& r2) {
                    int newId = static_cast<int>(r2.insertId());
                    Json::Value a;
                    a["id"]          = newId;
                    a["mapId"]       = mapId;
                    a["createdBy"]   = userId;
                    a["type"]        = type;
                    a["title"]       = title;
                    a["description"] = description;
                    a["canEdit"]     = true;
                    a["media"]       = Json::Value(Json::arrayValue);
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(a);
                    resp->setStatusCode(drogon::k201Created);
                    callback(resp);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(
                        errorJson("db_error", "Failed to create annotation"));
                    resp->setStatusCode(drogon::k500InternalServerError);
                    callback(resp);
                },
                mapId, userId, type, title, description, geoJsonStr);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Database error"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        userId, userId, mapId);
}

// ─── GET /api/v1/maps/{mapId}/annotations/{id} ────────────────────────────────

void AnnotationController::getAnnotation(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int mapId, int id) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT a.*, u.username AS creator_username, "
        "       CASE WHEN m.owner_id=? OR mp.can_edit=1 THEN 1 ELSE 0 END AS can_edit "
        "FROM annotations a "
        "JOIN maps m ON m.id=a.map_id "
        "JOIN users u ON u.id=a.created_by "
        "LEFT JOIN map_permissions mp ON mp.map_id=m.id AND mp.user_id=? "
        "LEFT JOIN map_permissions mp_pub "
        "       ON mp_pub.map_id=m.id AND mp_pub.user_id IS NULL AND mp_pub.can_view=1 "
        "WHERE a.id=? AND a.map_id=? "
        "  AND (m.owner_id=? OR mp.can_view=1 OR mp_pub.can_view=1)",
        [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("not_found", "Annotation not found or no permission"));
                resp->setStatusCode(drogon::k404NotFound);
                callback(resp);
                return;
            }
            const auto& row = r[0];
            Json::Value a;
            a["id"]                = row["id"].as<int>();
            a["mapId"]             = row["map_id"].as<int>();
            a["createdBy"]         = row["created_by"].as<int>();
            a["createdByUsername"] = row["creator_username"].as<std::string>();
            a["type"]              = row["type"].as<std::string>();
            a["title"]             = row["title"].as<std::string>();
            a["description"]       = row["description"].isNull() ? "" : row["description"].as<std::string>();
            a["createdAt"]         = row["created_at"].as<std::string>();
            a["updatedAt"]         = row["updated_at"].as<std::string>();
            a["canEdit"]           = row["can_edit"].as<bool>();
            a["media"]             = Json::Value(Json::arrayValue);
            Json::Value geoJson;
            Json::Reader reader;
            reader.parse(row["geo_json"].as<std::string>(), geoJson);
            a["geoJson"] = geoJson;
            callback(drogon::HttpResponse::newHttpJsonResponse(a));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Database error"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        userId, userId, id, mapId, userId);
}

// ─── PUT /api/v1/maps/{mapId}/annotations/{id} ────────────────────────────────

void AnnotationController::updateAnnotation(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int mapId, int id) {

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body) {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "Request body required"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    // Only owner of annotation or map editor can update
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "UPDATE annotations a "
        "JOIN maps m ON m.id=a.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id=m.id AND mp.user_id=? "
        "SET a.title=COALESCE(?,a.title), a.description=COALESCE(?,a.description) "
        "WHERE a.id=? AND a.map_id=? "
        "  AND (m.owner_id=? OR mp.can_edit=1 OR a.created_by=?)",
        [callback, id](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("forbidden", "Cannot update annotation"));
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
                errorJson("db_error", "Failed to update annotation"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        userId,
        (*body).get("title", Json::Value()).asString().empty()
            ? nullptr : new std::string((*body)["title"].asString()),
        (*body).get("description", Json::Value()).asString().empty()
            ? nullptr : new std::string((*body)["description"].asString()),
        id, mapId, userId, userId);
}

// ─── DELETE /api/v1/maps/{mapId}/annotations/{id} ─────────────────────────────

void AnnotationController::deleteAnnotation(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int mapId, int id) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
        "DELETE a FROM annotations a "
        "JOIN maps m ON m.id=a.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id=m.id AND mp.user_id=? "
        "WHERE a.id=? AND a.map_id=? "
        "  AND (m.owner_id=? OR mp.can_edit=1 OR a.created_by=?)",
        [callback](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("forbidden", "Cannot delete annotation"));
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
                errorJson("db_error", "Failed to delete annotation"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        userId, id, mapId, userId, userId);
}

// ─── POST /api/v1/maps/{mapId}/annotations/{id}/media ─────────────────────────

void AnnotationController::addMedia(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int mapId, int id) {

    (void)mapId;
    auto body = req->getJsonObject();
    if (!body || !(*body)["mediaType"] || !(*body)["url"]) {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "mediaType and url are required"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    std::string mediaType = (*body)["mediaType"].asString();
    std::string url       = (*body)["url"].asString();
    std::string caption   = (*body).get("caption", "").asString();

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "INSERT INTO annotation_media (annotation_id, media_type, url, caption) VALUES (?,?,?,?)",
        [callback, id, mediaType, url, caption](const drogon::orm::Result& r) {
            int newId = static_cast<int>(r.insertId());
            Json::Value m;
            m["id"]           = newId;
            m["annotationId"] = id;
            m["mediaType"]    = mediaType;
            m["url"]          = url;
            m["caption"]      = caption;
            auto resp = drogon::HttpResponse::newHttpJsonResponse(m);
            resp->setStatusCode(drogon::k201Created);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Failed to add media"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        id, mediaType, url, caption);
}

// ─── DELETE /api/v1/maps/{mapId}/annotations/{id}/media/{mediaId} ─────────────

void AnnotationController::deleteMedia(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int mapId, int id, int mediaId) {

    (void)req; (void)mapId; (void)id;
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "DELETE FROM annotation_media WHERE id=?",
        [callback](const drogon::orm::Result&) {
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k204NoContent);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Failed to delete media"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        mediaId);
}
