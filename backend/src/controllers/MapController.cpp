#include "MapController.h"
#include "AuditLog.h"
#include "ErrorResponse.h"
#include <drogon/drogon.h>
#include <sstream>

static int callerUserId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("userId"); }
    catch (...) { return 0; }
}

static int callerOrgId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("orgId"); }
    catch (...) { return 0; }
}

// ─── coordinate_system validation ────────────────────────────────────────────
// Validates the JSON shape stored on `maps.coordinate_system`. Phase 2f
// adds frontend rendering for `pixel` and `blank`; the schema accepts
// all three types from day one. Returns empty string on success or an
// error message describing the first problem found.

namespace {

std::string validateCoordinateSystem(const Json::Value& cs) {
    if (!cs.isObject())                return "coordinateSystem must be an object";
    if (!cs.isMember("type"))          return "coordinateSystem.type is required";
    if (!cs["type"].isString())        return "coordinateSystem.type must be a string";

    const std::string type = cs["type"].asString();
    if (type == "wgs84") {
        if (!cs.isMember("center") || !cs["center"].isObject())
            return "coordinateSystem.center object required for type wgs84";
        const auto& center = cs["center"];
        if (!center.isMember("lat") || !center["lat"].isNumeric())
            return "coordinateSystem.center.lat must be numeric";
        if (!center.isMember("lng") || !center["lng"].isNumeric())
            return "coordinateSystem.center.lng must be numeric";
        if (!cs.isMember("zoom") || !cs["zoom"].isNumeric())
            return "coordinateSystem.zoom must be numeric for type wgs84";
        return "";
    }
    if (type == "pixel") {
        if (!cs.isMember("image_url") || !cs["image_url"].isString())
            return "coordinateSystem.image_url must be a string for type pixel";
        const std::string url = cs["image_url"].asString();
        if (url.rfind("http://", 0) != 0 && url.rfind("https://", 0) != 0)
            return "coordinateSystem.image_url must use http or https";
        if (!cs.isMember("width") || !cs["width"].isNumeric() || cs["width"].asInt() <= 0)
            return "coordinateSystem.width must be a positive number for type pixel";
        if (!cs.isMember("height") || !cs["height"].isNumeric() || cs["height"].asInt() <= 0)
            return "coordinateSystem.height must be a positive number for type pixel";
        // viewport describes the initial pan/zoom on the image: pixel
        // coordinates (x, y) of the centerpoint plus a zoom factor.
        if (!cs.isMember("viewport") || !cs["viewport"].isObject())
            return "coordinateSystem.viewport object required for type pixel";
        const auto& vp = cs["viewport"];
        if (!vp.isMember("x") || !vp["x"].isNumeric())
            return "coordinateSystem.viewport.x must be numeric";
        if (!vp.isMember("y") || !vp["y"].isNumeric())
            return "coordinateSystem.viewport.y must be numeric";
        if (!vp.isMember("zoom") || !vp["zoom"].isNumeric())
            return "coordinateSystem.viewport.zoom must be numeric";
        return "";
    }
    if (type == "blank") {
        if (!cs.isMember("extent") || !cs["extent"].isObject())
            return "coordinateSystem.extent object required for type blank";
        const auto& ex = cs["extent"];
        // extent describes the canvas size in arbitrary units; positive
        // integers since this is a bounded drawable surface.
        if (!ex.isMember("x") || !ex["x"].isNumeric() || ex["x"].asInt() <= 0)
            return "coordinateSystem.extent.x must be a positive number";
        if (!ex.isMember("y") || !ex["y"].isNumeric() || ex["y"].asInt() <= 0)
            return "coordinateSystem.extent.y must be a positive number";
        return "";
    }
    return "coordinateSystem.type must be one of: wgs84, pixel, blank";
}

// Compact-print a Json::Value for storage in a JSON column.
std::string compactJson(const Json::Value& v) {
    Json::StreamWriterBuilder b;
    b["indentation"] = "";
    return Json::writeString(b, v);
}

// Parse a stored JSON column string back to a Json::Value.
// Returns nullValue on parse failure (shouldn't happen for rows we wrote).
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

} // anonymous namespace

// ─── GET /api/v1/tenants/{tenantId}/maps ──────────────────────────────────────

void MapController::listMaps(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId) {

    int userId   = callerUserId(req);
    int page     = 1;
    int pageSize = 20;
    try { page     = std::stoi(req->getParameter("page")); }     catch (...) {}
    try { pageSize = std::stoi(req->getParameter("pageSize")); } catch (...) {}
    if (page < 1) page = 1;
    if (pageSize < 1) pageSize = 1;
    if (pageSize > 100) pageSize = 100;
    int offset   = (page - 1) * pageSize;

    const std::string sql = R"(
        SELECT DISTINCT m.id, m.owner_id, u.username AS owner_username,
               m.title, m.description,
               m.coordinate_system, m.owner_xray,
               m.created_at, m.updated_at,
               CASE
                   WHEN m.owner_id = ? THEN 'owner'
                   WHEN mp2.level IN ('edit','moderate','admin') THEN 'edit'
                   WHEN mp2.level IN ('view','comment') OR mp_pub.level IN ('view','comment','edit') THEN 'view'
                   ELSE 'none'
               END AS permission
        FROM maps m
        JOIN users u ON u.id = m.owner_id
        LEFT JOIN map_permissions mp2
               ON mp2.map_id = m.id AND mp2.user_id = ?
        LEFT JOIN map_permissions mp_pub
               ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL
               AND mp_pub.level IN ('view','comment','edit','moderate','admin')
        WHERE m.tenant_id = ?
          AND (m.owner_id = ?
               OR mp2.level IN ('view','comment','edit','moderate','admin')
               OR mp_pub.level IN ('view','comment','edit','moderate','admin'))
        ORDER BY m.updated_at DESC
        LIMIT ? OFFSET ?
    )";

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        sql,
        [callback, page, pageSize](const drogon::orm::Result& r) {
            Json::Value data(Json::arrayValue);
            for (const auto& row : r) {
                Json::Value m;
                m["id"]                = row["id"].as<int>();
                m["ownerId"]           = row["owner_id"].as<int>();
                m["ownerUsername"]     = row["owner_username"].as<std::string>();
                m["title"]             = row["title"].as<std::string>();
                m["description"]       = row["description"].isNull() ? "" : row["description"].as<std::string>();
                m["coordinateSystem"]  = parseJsonColumn(row["coordinate_system"].as<std::string>());
                m["ownerXray"]         = row["owner_xray"].as<bool>();
                m["createdAt"]         = row["created_at"].as<std::string>();
                m["updatedAt"]         = row["updated_at"].as<std::string>();
                m["permission"]        = row["permission"].as<std::string>();
                data.append(m);
            }
            Json::Value resp;
            resp["data"]     = data;
            resp["page"]     = page;
            resp["pageSize"] = pageSize;
            resp["total"]    = static_cast<int>(r.size());
            callback(drogon::HttpResponse::newHttpJsonResponse(resp));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Failed to fetch maps"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        userId, userId, tenantId, userId, pageSize, offset);
}

// ─── POST /api/v1/tenants/{tenantId}/maps ─────────────────────────────────────

void MapController::createMap(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId) {

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body || !(*body)["title"]) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "title is required"));
        return;
    }

    std::string title       = (*body)["title"].asString();
    std::string description = (*body).get("description", "").asString();

    // M8: enforce input length limits before any DB work
    if (!checkMaxLen("title", title, MAX_TITLE_LEN, callback)) return;
    if (!checkMaxLen("description", description, MAX_DESCRIPTION_LEN, callback)) return;

    // coordinate_system: required; default to a usable WGS84 view if absent
    Json::Value coordSys;
    if (body->isMember("coordinateSystem")) {
        coordSys = (*body)["coordinateSystem"];
    } else {
        coordSys["type"]   = "wgs84";
        coordSys["center"] = Json::Value(Json::objectValue);
        coordSys["center"]["lat"] = 0.0;
        coordSys["center"]["lng"] = 0.0;
        coordSys["zoom"]   = 3;
    }
    {
        std::string err = validateCoordinateSystem(coordSys);
        if (!err.empty()) {
            callback(errorResponse(drogon::k400BadRequest, "bad_request", err));
            return;
        }
    }
    bool ownerXray = (*body).get("ownerXray", false).asBool();
    std::string coordSysJson = compactJson(coordSys);

    // M9 + L4: enforce per-tenant map limit atomically. The previous pattern
    // (SELECT COUNT then INSERT in separate queries) raced — two concurrent
    // creates could both pass the count check. INSERT ... SELECT ... WHERE
    // (subquery) evaluates the count and inserts in a single statement; the
    // affectedRows() == 0 case means the limit was hit.
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "INSERT INTO maps (owner_id, tenant_id, title, description, "
        "                  coordinate_system, owner_xray) "
        "SELECT ?,?,?,?,CAST(? AS JSON),? FROM dual "
        "WHERE (SELECT COUNT(*) FROM maps WHERE tenant_id=?) < 1000",
        [callback, userId, tenantId, title, description, coordSys, ownerXray]
        (const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k400BadRequest,
                    "limit_exceeded", "Tenant map limit reached"));
                return;
            }
            int newId = static_cast<int>(r.insertId());
            Json::Value m;
            m["id"]                = newId;
            m["ownerId"]           = userId;
            m["tenantId"]          = tenantId;
            m["title"]             = title;
            m["description"]       = description;
            m["coordinateSystem"]  = coordSys;
            m["ownerXray"]         = ownerXray;
            m["permission"]        = "owner";
            auto resp = drogon::HttpResponse::newHttpJsonResponse(m);
            resp->setStatusCode(drogon::k201Created);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to create map"));
        },
        userId, tenantId, title, description, coordSysJson, ownerXray, tenantId);
}

// ─── GET /api/v1/tenants/{tenantId}/maps/{id} ─────────────────────────────────

void MapController::getMap(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    int userId = callerUserId(req);
    const std::string sql = R"(
        SELECT m.id, m.owner_id, u.username AS owner_username,
               m.title, m.description,
               m.coordinate_system, m.owner_xray,
               m.created_at, m.updated_at,
               CASE
                   WHEN m.owner_id = ? THEN 'owner'
                   WHEN mp2.level IN ('edit','moderate','admin') THEN 'edit'
                   WHEN mp2.level IN ('view','comment') OR mp_pub.level IN ('view','comment','edit') THEN 'view'
                   ELSE 'none'
               END AS permission
        FROM maps m
        JOIN users u ON u.id = m.owner_id
        LEFT JOIN map_permissions mp2
               ON mp2.map_id = m.id AND mp2.user_id = ?
        LEFT JOIN map_permissions mp_pub
               ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL
               AND mp_pub.level IN ('view','comment','edit','moderate','admin')
        WHERE m.id = ? AND m.tenant_id = ?
    )";

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        sql,
        [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "Map not found"));
                return;
            }
            const auto& row = r[0];
            std::string perm = row["permission"].as<std::string>();
            if (perm == "none") {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "You do not have permission to view this map"));
                return;
            }
            Json::Value m;
            m["id"]                = row["id"].as<int>();
            m["ownerId"]           = row["owner_id"].as<int>();
            m["ownerUsername"]     = row["owner_username"].as<std::string>();
            m["title"]             = row["title"].as<std::string>();
            m["description"]       = row["description"].isNull() ? "" : row["description"].as<std::string>();
            m["coordinateSystem"]  = parseJsonColumn(row["coordinate_system"].as<std::string>());
            m["ownerXray"]         = row["owner_xray"].as<bool>();
            m["createdAt"]         = row["created_at"].as<std::string>();
            m["updatedAt"]         = row["updated_at"].as<std::string>();
            m["permission"]        = perm;
            callback(drogon::HttpResponse::newHttpJsonResponse(m));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Database error"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        userId, userId, id, tenantId);
}

// ─── PUT /api/v1/tenants/{tenantId}/maps/{id} ─────────────────────────────────

void MapController::updateMap(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "Request body required"));
        return;
    }

    // Extract optional fields — build SET clause dynamically with
    // sentinel-based IF(...) so a missing field leaves the column unchanged.
    std::string title       = (*body).get("title", "").asString();
    std::string description = (*body).get("description", "").asString();

    // M8: length limits apply on update too
    if (!checkMaxLen("title", title, MAX_TITLE_LEN, callback)) return;
    if (!checkMaxLen("description", description, MAX_DESCRIPTION_LEN, callback)) return;

    // coordinate_system: optional on update; if present, validate before write.
    bool hasCoord = body->isMember("coordinateSystem");
    std::string coordSysJson;
    if (hasCoord) {
        std::string err = validateCoordinateSystem((*body)["coordinateSystem"]);
        if (!err.empty()) {
            callback(errorResponse(drogon::k400BadRequest, "bad_request", err));
            return;
        }
        coordSysJson = compactJson((*body)["coordinateSystem"]);
    }

    bool hasOwnerXray = body->isMember("ownerXray");
    bool ownerXray = hasOwnerXray ? (*body)["ownerXray"].asBool() : false;

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "UPDATE maps SET "
        "title             = IF(?='', title, ?), "
        "description       = IF(?='', description, ?), "
        "coordinate_system = IF(?, CAST(? AS JSON), coordinate_system), "
        "owner_xray        = IF(?, ?, owner_xray) "
        "WHERE id=? AND tenant_id=? AND owner_id=?",
        [callback, req, userId, tenantId, id](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Map not found or insufficient permissions"));
                return;
            }
            // M12: audit the update
            Json::Value detail;
            detail["mapId"] = id;
            AuditLog::record("map_update", req, userId, 0, tenantId, detail);
            Json::Value v;
            v["id"]      = id;
            v["updated"] = true;
            callback(drogon::HttpResponse::newHttpJsonResponse(v));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to update map"));
        },
        title, title,
        description, description,
        hasCoord, coordSysJson,
        hasOwnerXray, ownerXray,
        id, tenantId, userId);
}

// ─── DELETE /api/v1/tenants/{tenantId}/maps/{id} ──────────────────────────────

void MapController::deleteMap(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
        "DELETE FROM maps WHERE id=? AND tenant_id=? AND owner_id=?",
        [callback, req, userId, tenantId, id](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden", "Map not found or insufficient permissions"));
                return;
            }
            // M12: audit the deletion
            Json::Value detail;
            detail["mapId"] = id;
            AuditLog::record("map_delete", req, userId, 0, tenantId, detail);
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k204NoContent);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to delete map"));
        },
        id, tenantId, userId);
}

// ─── GET /api/v1/tenants/{tenantId}/maps/{id}/permissions ─────────────────────

void MapController::listPermissions(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    int userId = callerUserId(req);
    auto db    = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT id FROM maps WHERE id=? AND tenant_id=? AND owner_id=?",
        [callback, id](const drogon::orm::Result& r) {
            if (r.empty()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("forbidden", "You must be the map owner to manage permissions"));
                resp->setStatusCode(drogon::k403Forbidden);
                callback(resp);
                return;
            }
            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "SELECT mp.id, mp.user_id, u.username, mp.level "
                "FROM map_permissions mp "
                "LEFT JOIN users u ON u.id = mp.user_id "
                "WHERE mp.map_id=?",
                [callback](const drogon::orm::Result& r2) {
                    Json::Value arr(Json::arrayValue);
                    for (const auto& row : r2) {
                        Json::Value p;
                        p["id"]       = row["id"].as<int>();
                        p["userId"]   = row["user_id"].isNull() ? Json::Value() : Json::Value(row["user_id"].as<int>());
                        p["username"] = row["username"].isNull() ? Json::Value("(public)") : Json::Value(row["username"].as<std::string>());
                        p["level"]    = row["level"].as<std::string>();
                        arr.append(p);
                    }
                    callback(drogon::HttpResponse::newHttpJsonResponse(arr));
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(
                        errorJson("db_error", "Failed to fetch permissions"));
                    resp->setStatusCode(drogon::k500InternalServerError);
                    callback(resp);
                },
                id);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Database error"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        id, tenantId, userId);
}

// ─── PUT /api/v1/tenants/{tenantId}/maps/{id}/permissions ─────────────────────

void MapController::setPermission(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    int callerId  = callerUserId(req);
    int callerOrg = callerOrgId(req);
    auto body = req->getJsonObject();
    if (!body) {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "Request body required"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    // Accept "level" (new) or fall back to "canView"/"canEdit" (legacy compat)
    std::string level = (*body).get("level", "").asString();
    if (level.empty()) {
        bool canEdit = (*body).get("canEdit", false).asBool();
        bool canView = (*body).get("canView", false).asBool();
        level = canEdit ? "edit" : (canView ? "view" : "none");
    }
    // Validate level
    if (level != "none" && level != "view" && level != "comment" &&
        level != "edit" && level != "moderate" && level != "admin") {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "level must be none, view, comment, edit, moderate, or admin"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    bool isPublic = (*body)["userId"].isNull();
    int  targetId = isPublic ? 0 : (*body)["userId"].asInt();

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT id FROM maps WHERE id=? AND tenant_id=? AND owner_id=?",
        [callback, req, id, tenantId, callerId, callerOrg, targetId,
         isPublic, level](const drogon::orm::Result& r) {
            if (r.empty()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("forbidden", "Only the map owner can set permissions"));
                resp->setStatusCode(drogon::k403Forbidden);
                callback(resp);
                return;
            }

            if (!isPublic && targetId != 0) {
                auto dbCheck = drogon::app().getDbClient();
                dbCheck->execSqlAsync(
                    "SELECT id FROM users WHERE id=? AND org_id=?",
                    [callback, req, id, tenantId, callerId, targetId, level]
                    (const drogon::orm::Result& rc) {
                        if (rc.empty()) {
                            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                                errorJson("bad_request",
                                    "Cannot grant access to a user outside your organization"));
                            resp->setStatusCode(drogon::k400BadRequest);
                            callback(resp);
                            return;
                        }
                        auto db2 = drogon::app().getDbClient();
                        db2->execSqlAsync(
                            "INSERT INTO map_permissions (map_id, user_id, level) "
                            "VALUES (?,?,?) "
                            "ON DUPLICATE KEY UPDATE level=VALUES(level)",
                            [callback, req, id, tenantId, callerId, targetId, level]
                            (const drogon::orm::Result&) {
                                Json::Value detail;
                                detail["mapId"] = id; detail["targetUserId"] = targetId;
                                detail["level"] = level;
                                AuditLog::record("permission_change", req, callerId, targetId, tenantId, detail);
                                Json::Value v; v["updated"] = true;
                                callback(drogon::HttpResponse::newHttpJsonResponse(v));
                            },
                            [callback](const drogon::orm::DrogonDbException&) {
                                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                                    errorJson("db_error", "Failed to set permission"));
                                resp->setStatusCode(drogon::k500InternalServerError);
                                callback(resp);
                            },
                            id, targetId, level);
                    },
                    [callback](const drogon::orm::DrogonDbException&) {
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(
                            errorJson("db_error", "Database error"));
                        resp->setStatusCode(drogon::k500InternalServerError);
                        callback(resp);
                    },
                    targetId, callerOrg);
            } else {
                auto db2 = drogon::app().getDbClient();
                db2->execSqlAsync(
                    "INSERT INTO map_permissions (map_id, user_id, level) "
                    "VALUES (?, NULL, ?) "
                    "ON DUPLICATE KEY UPDATE level=VALUES(level)",
                    [callback, req, id, tenantId, callerId, level]
                    (const drogon::orm::Result&) {
                        Json::Value detail;
                        detail["mapId"] = id; detail["public"] = true;
                        detail["level"] = level;
                        AuditLog::record("permission_change", req, callerId, 0, tenantId, detail);
                        Json::Value v; v["updated"] = true;
                        callback(drogon::HttpResponse::newHttpJsonResponse(v));
                    },
                    [callback](const drogon::orm::DrogonDbException&) {
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(
                            errorJson("db_error", "Failed to set permission"));
                        resp->setStatusCode(drogon::k500InternalServerError);
                        callback(resp);
                    },
                    id, level);
            }
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Database error"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        id, tenantId, callerId);
}

// ─── DELETE /api/v1/tenants/{tenantId}/maps/{id}/permissions/{target} ─────────

void MapController::removePermission(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id, const std::string& target) {

    int callerId = callerUserId(req);
    auto db      = drogon::app().getDbClient();

    db->execSqlAsync(
        "SELECT id FROM maps WHERE id=? AND tenant_id=? AND owner_id=?",
        [callback, id, target](const drogon::orm::Result& r) {
            if (r.empty()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("forbidden", "Only the map owner can remove permissions"));
                resp->setStatusCode(drogon::k403Forbidden);
                callback(resp);
                return;
            }
            auto db2 = drogon::app().getDbClient();
            if (target == "public") {
                db2->execSqlAsync(
                    "DELETE FROM map_permissions WHERE map_id=? AND user_id IS NULL",
                    [callback](const drogon::orm::Result&) {
                        auto resp = drogon::HttpResponse::newHttpResponse();
                        resp->setStatusCode(drogon::k204NoContent);
                        callback(resp);
                    },
                    [callback](const drogon::orm::DrogonDbException&) {
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(
                            errorJson("db_error", "Failed to remove permission"));
                        resp->setStatusCode(drogon::k500InternalServerError);
                        callback(resp);
                    },
                    id);
            } else {
                int targetId = std::stoi(target);
                db2->execSqlAsync(
                    "DELETE FROM map_permissions WHERE map_id=? AND user_id=?",
                    [callback](const drogon::orm::Result&) {
                        auto resp = drogon::HttpResponse::newHttpResponse();
                        resp->setStatusCode(drogon::k204NoContent);
                        callback(resp);
                    },
                    [callback](const drogon::orm::DrogonDbException&) {
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(
                            errorJson("db_error", "Failed to remove permission"));
                        resp->setStatusCode(drogon::k500InternalServerError);
                        callback(resp);
                    },
                    id, targetId);
            }
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Database error"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        id, tenantId, callerId);
}
