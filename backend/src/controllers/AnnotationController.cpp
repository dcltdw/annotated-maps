#include "AnnotationController.h"
#include "AuditLog.h"
#include "ErrorResponse.h"
#include <drogon/drogon.h>

static int callerUserId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("userId"); }
    catch (...) { return 0; }
}

// ─── GET /api/v1/tenants/{tenantId}/maps/{mapId}/annotations ──────────────────

void AnnotationController::listAnnotations(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId) {

    int userId = callerUserId(req);

    const std::string sql = R"(
        SELECT a.id, a.map_id, a.created_by, u.username AS creator_username,
               a.type, a.title, a.description, a.geo_json,
               a.created_at, a.updated_at,
               CASE
                   WHEN m.owner_id = ? THEN 1
                   WHEN mp.level IN ('edit','moderate','admin') THEN 1
                   ELSE 0
               END AS can_edit
        FROM annotations a
        JOIN maps m ON m.id = a.map_id
        JOIN users u ON u.id = a.created_by
        LEFT JOIN map_permissions mp
               ON mp.map_id = m.id AND mp.user_id = ?
        LEFT JOIN map_permissions mp_pub
               ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL
               AND mp_pub.level IN ('view','comment','edit','moderate','admin')
        WHERE a.map_id = ?
          AND m.tenant_id = ?
          AND (m.owner_id = ? OR mp.level IN ('view','comment','edit','moderate','admin') OR mp_pub.level IN ('view','comment','edit','moderate','admin'))
        ORDER BY a.created_at ASC
    )";

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        sql,
        [callback](const drogon::orm::Result& r) {
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
                a["media"]             = Json::Value(Json::arrayValue);
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
        userId, userId, mapId, tenantId, userId);
}

// ─── POST /api/v1/tenants/{tenantId}/maps/{mapId}/annotations ────────────────

void AnnotationController::createAnnotation(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId) {

    int userId = callerUserId(req);
    std::string callerUsername;
    try { callerUsername = req->getAttributes()->get<std::string>("username"); } catch (...) {}
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

    // M8: length limits
    if (!checkMaxLen("title", title, MAX_TITLE_LEN, callback)) return;
    if (!checkMaxLen("description", description, MAX_DESCRIPTION_LEN, callback)) return;

    // Validate GeoJSON structure
    const auto& geoObj = (*body)["geoJson"];
    if (!geoObj.isObject() || !geoObj.isMember("type") || !geoObj.isMember("coordinates")) {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "geoJson must have 'type' and 'coordinates' fields"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }
    std::string geoType = geoObj["type"].asString();
    if (geoType != "Point" && geoType != "LineString" && geoType != "Polygon") {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "geoJson.type must be Point, LineString, or Polygon"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }
    if (!geoObj["coordinates"].isArray() || geoObj["coordinates"].empty()) {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "geoJson.coordinates must be a non-empty array"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    Json::StreamWriterBuilder wb;
    std::string geoJsonStr = Json::writeString(wb, geoObj);

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT CASE WHEN m.owner_id=? THEN 1 "
        "            WHEN mp.level IN ('edit','moderate','admin') THEN 1 ELSE 0 END AS allowed "
        "FROM maps m "
        "LEFT JOIN map_permissions mp ON mp.map_id=m.id AND mp.user_id=? "
        "WHERE m.id=? AND m.tenant_id=?",
        [callback, mapId, userId, callerUsername, type, title, description, geoJsonStr]
        (const drogon::orm::Result& r) {
            if (r.empty() || !r[0]["allowed"].as<bool>()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("forbidden", "You do not have edit permission on this map"));
                resp->setStatusCode(drogon::k403Forbidden);
                callback(resp);
                return;
            }
            // M9 + L4: atomic INSERT-with-limit-check (see MapController for rationale)
            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "INSERT INTO annotations (map_id, created_by, type, title, description, geo_json) "
                "SELECT ?,?,?,?,?,? FROM dual "
                "WHERE (SELECT COUNT(*) FROM annotations WHERE map_id=?) < 5000",
                [callback, mapId, userId, callerUsername, type, title, description, geoJsonStr]
                (const drogon::orm::Result& r2) {
                    if (r2.affectedRows() == 0) {
                        callback(errorResponse(drogon::k400BadRequest,
                            "limit_exceeded", "Annotation limit reached for this map"));
                        return;
                    }
                    int newId = static_cast<int>(r2.insertId());
                    Json::Value a;
                    a["id"]                = newId;
                    a["mapId"]             = mapId;
                    a["createdBy"]         = userId;
                    a["createdByUsername"] = callerUsername;
                    a["type"]              = type;
                    a["title"]       = title;
                    a["description"] = description;
                    a["canEdit"]     = true;
                    a["media"]       = Json::Value(Json::arrayValue);
                    // Parse stored GeoJSON back into the response
                    Json::Value geoJson;
                    Json::Reader reader;
                    reader.parse(geoJsonStr, geoJson);
                    a["geoJson"]     = geoJson;
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(a);
                    resp->setStatusCode(drogon::k201Created);
                    callback(resp);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to create annotation"));
                },
                mapId, userId, type, title, description, geoJsonStr, mapId);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Database error"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        userId, userId, mapId, tenantId);
}

// ─── GET /api/v1/tenants/{tenantId}/maps/{mapId}/annotations/{id} ────────────

void AnnotationController::getAnnotation(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT a.*, u.username AS creator_username, "
        "       CASE WHEN m.owner_id=? OR mp.level IN ('edit','moderate','admin') THEN 1 ELSE 0 END AS can_edit "
        "FROM annotations a "
        "JOIN maps m ON m.id=a.map_id "
        "JOIN users u ON u.id=a.created_by "
        "LEFT JOIN map_permissions mp ON mp.map_id=m.id AND mp.user_id=? "
        "LEFT JOIN map_permissions mp_pub "
        "       ON mp_pub.map_id=m.id AND mp_pub.user_id IS NULL"
        "               AND mp_pub.level IN ('view','comment','edit','moderate','admin') "
        "WHERE a.id=? AND a.map_id=? AND m.tenant_id=? "
        "  AND (m.owner_id=? OR mp.level IN ('view','comment','edit','moderate','admin') OR mp_pub.level IN ('view','comment','edit','moderate','admin'))",
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
        userId, userId, id, mapId, tenantId, userId);
}

// ─── PUT /api/v1/tenants/{tenantId}/maps/{mapId}/annotations/{id} ────────────

void AnnotationController::updateAnnotation(
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
    std::string newDesc  = (*body).get("description", "").asString();

    // M8: length limits
    if (!checkMaxLen("title", newTitle, MAX_TITLE_LEN, callback)) return;
    if (!checkMaxLen("description", newDesc, MAX_DESCRIPTION_LEN, callback)) return;

    // Serialize geoJson if provided
    std::string newGeoJson;
    bool hasGeoJson = body->isMember("geoJson") && !(*body)["geoJson"].isNull();
    if (hasGeoJson) {
        Json::StreamWriterBuilder wb;
        newGeoJson = Json::writeString(wb, (*body)["geoJson"]);
    }

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "UPDATE annotations a "
        "JOIN maps m ON m.id=a.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id=m.id AND mp.user_id=? "
        "SET a.title       = IF(?='', a.title, ?), "
        "    a.description = IF(?='', a.description, ?), "
        "    a.geo_json    = IF(?=0, a.geo_json, ?) "
        "WHERE a.id=? AND a.map_id=? AND m.tenant_id=? "
        "  AND (m.owner_id=? OR mp.level IN ('edit','moderate','admin') OR a.created_by=?)",
        [callback, req, userId, tenantId, mapId, id](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Cannot update annotation"));
                return;
            }
            // M12: audit the update
            Json::Value detail;
            detail["mapId"] = mapId;
            detail["annotationId"] = id;
            AuditLog::record("annotation_update", req, userId, 0, tenantId, detail);
            Json::Value v;
            v["id"]      = id;
            v["updated"] = true;
            callback(drogon::HttpResponse::newHttpJsonResponse(v));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to update annotation"));
        },
        userId,
        newTitle, newTitle,
        newDesc, newDesc,
        hasGeoJson ? 1 : 0, hasGeoJson ? newGeoJson : std::string(),
        id, mapId, tenantId, userId, userId);
}

// ─── DELETE /api/v1/tenants/{tenantId}/maps/{mapId}/annotations/{id} ─────────

void AnnotationController::deleteAnnotation(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
        "DELETE a FROM annotations a "
        "JOIN maps m ON m.id=a.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id=m.id AND mp.user_id=? "
        "WHERE a.id=? AND a.map_id=? AND m.tenant_id=? "
        "  AND (m.owner_id=? OR mp.level IN ('edit','moderate','admin') OR a.created_by=?)",
        [callback, req, userId, tenantId, mapId, id](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Cannot delete annotation"));
                return;
            }
            // M12: audit the deletion
            Json::Value detail;
            detail["mapId"] = mapId;
            detail["annotationId"] = id;
            AuditLog::record("annotation_delete", req, userId, 0, tenantId, detail);
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k204NoContent);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to delete annotation"));
        },
        userId, id, mapId, tenantId, userId, userId);
}

// ─── POST .../annotations/{id}/media ─────────────────────────────────────────

void AnnotationController::addMedia(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
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

    // Validate URL scheme (prevent javascript:, data:, etc.)
    if (url.substr(0, 8) != "https://" && url.substr(0, 7) != "http://") {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "url must use http or https scheme"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    // Verify caller has edit permission before inserting media
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT CASE WHEN m.owner_id=? THEN 1 "
        "            WHEN mp.level IN ('edit','moderate','admin') THEN 1 ELSE 0 END AS allowed "
        "FROM annotations a "
        "JOIN maps m ON m.id=a.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id=m.id AND mp.user_id=? "
        "WHERE a.id=? AND a.map_id=? AND m.tenant_id=?",
        [callback, id, mediaType, url, caption]
        (const drogon::orm::Result& r) {
            if (r.empty() || !r[0]["allowed"].as<bool>()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("forbidden", "Edit permission required to add media"));
                resp->setStatusCode(drogon::k403Forbidden);
                callback(resp);
                return;
            }
            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "INSERT INTO annotation_media (annotation_id, media_type, url, caption) "
                "VALUES (?,?,?,?)",
                [callback, id, mediaType, url, caption]
                (const drogon::orm::Result& r2) {
                    int newId = static_cast<int>(r2.insertId());
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
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Database error"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        userId, userId, id, mapId, tenantId);
}

// ─── DELETE .../annotations/{id}/media/{mediaId} ─────────────────────────────

void AnnotationController::deleteMedia(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id, int mediaId) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();

    // Allow: map owner, map editor, or the annotation's creator
    db->execSqlAsync(
        "SELECT am.id FROM annotation_media am "
        "JOIN annotations a ON a.id = am.annotation_id "
        "JOIN maps m ON m.id = a.map_id "
        "LEFT JOIN map_permissions mp ON mp.map_id=m.id AND mp.user_id=? "
        "WHERE am.id=? AND a.id=? AND a.map_id=? AND m.tenant_id=? "
        "  AND (m.owner_id=? OR mp.level IN ('edit','moderate','admin') OR a.created_by=?)",
        [callback, mediaId](const drogon::orm::Result& r) {
            if (r.empty()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("forbidden", "Cannot delete this media item"));
                resp->setStatusCode(drogon::k403Forbidden);
                callback(resp);
                return;
            }
            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
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
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Database error"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        userId, mediaId, id, mapId, tenantId, userId, userId);
}
