#include "MapController.h"
#include "AuditLog.h"
#include <drogon/drogon.h>

static int callerUserId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("userId"); }
    catch (...) { return 0; }
}

static int callerOrgId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("orgId"); }
    catch (...) { return 0; }
}

static Json::Value errorJson(const std::string& code, const std::string& msg) {
    Json::Value v;
    v["error"]   = code;
    v["message"] = msg;
    return v;
}

// ─── GET /api/v1/tenants/{tenantId}/maps ──────────────────────────────────────

void MapController::listMaps(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId) {

    int userId   = callerUserId(req);
    int page     = std::stoi(req->getParameter("page").empty()     ? "1"  : req->getParameter("page"));
    int pageSize = std::stoi(req->getParameter("pageSize").empty() ? "20" : req->getParameter("pageSize"));
    int offset   = (page - 1) * pageSize;

    const std::string sql = R"(
        SELECT DISTINCT m.id, m.owner_id, u.username AS owner_username,
               m.title, m.description,
               m.center_lat, m.center_lng, m.zoom,
               m.created_at, m.updated_at,
               CASE
                   WHEN m.owner_id = ? THEN 'owner'
                   WHEN mp2.can_edit = 1 THEN 'edit'
                   WHEN mp2.can_view = 1 OR mp_pub.can_view = 1 THEN 'view'
                   ELSE 'none'
               END AS permission
        FROM maps m
        JOIN users u ON u.id = m.owner_id
        LEFT JOIN map_permissions mp2
               ON mp2.map_id = m.id AND mp2.user_id = ?
        LEFT JOIN map_permissions mp_pub
               ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL AND mp_pub.can_view = 1
        WHERE m.tenant_id = ?
          AND (m.owner_id = ? OR mp2.can_view = 1 OR mp_pub.can_view = 1)
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
                m["id"]            = row["id"].as<int>();
                m["ownerId"]       = row["owner_id"].as<int>();
                m["ownerUsername"] = row["owner_username"].as<std::string>();
                m["title"]         = row["title"].as<std::string>();
                m["description"]   = row["description"].isNull() ? "" : row["description"].as<std::string>();
                m["centerLat"]     = row["center_lat"].as<double>();
                m["centerLng"]     = row["center_lng"].as<double>();
                m["zoom"]          = row["zoom"].as<int>();
                m["createdAt"]     = row["created_at"].as<std::string>();
                m["updatedAt"]     = row["updated_at"].as<std::string>();
                m["permission"]    = row["permission"].as<std::string>();
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
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "title is required"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    std::string title       = (*body)["title"].asString();
    std::string description = (*body).get("description", "").asString();
    double      centerLat   = (*body).get("centerLat", 0.0).asDouble();
    double      centerLng   = (*body).get("centerLng", 0.0).asDouble();
    int         zoom        = (*body).get("zoom", 3).asInt();

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "INSERT INTO maps (owner_id, tenant_id, title, description, "
        "                  center_lat, center_lng, zoom) "
        "VALUES (?,?,?,?,?,?,?)",
        [callback, userId, tenantId, title, description, centerLat, centerLng, zoom]
        (const drogon::orm::Result& r) {
            int newId = static_cast<int>(r.insertId());
            Json::Value m;
            m["id"]          = newId;
            m["ownerId"]     = userId;
            m["tenantId"]    = tenantId;
            m["title"]       = title;
            m["description"] = description;
            m["centerLat"]   = centerLat;
            m["centerLng"]   = centerLng;
            m["zoom"]        = zoom;
            m["permission"]  = "owner";
            auto resp = drogon::HttpResponse::newHttpJsonResponse(m);
            resp->setStatusCode(drogon::k201Created);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Failed to create map"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        userId, tenantId, title, description, centerLat, centerLng, zoom);
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
               m.center_lat, m.center_lng, m.zoom,
               m.created_at, m.updated_at,
               CASE
                   WHEN m.owner_id = ? THEN 'owner'
                   WHEN mp2.can_edit = 1 THEN 'edit'
                   WHEN mp2.can_view = 1 OR mp_pub.can_view = 1 THEN 'view'
                   ELSE 'none'
               END AS permission
        FROM maps m
        JOIN users u ON u.id = m.owner_id
        LEFT JOIN map_permissions mp2
               ON mp2.map_id = m.id AND mp2.user_id = ?
        LEFT JOIN map_permissions mp_pub
               ON mp_pub.map_id = m.id AND mp_pub.user_id IS NULL AND mp_pub.can_view = 1
        WHERE m.id = ? AND m.tenant_id = ?
    )";

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        sql,
        [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("not_found", "Map not found"));
                resp->setStatusCode(drogon::k404NotFound);
                callback(resp);
                return;
            }
            const auto& row = r[0];
            std::string perm = row["permission"].as<std::string>();
            if (perm == "none") {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("forbidden", "You do not have permission to view this map"));
                resp->setStatusCode(drogon::k403Forbidden);
                callback(resp);
                return;
            }
            Json::Value m;
            m["id"]            = row["id"].as<int>();
            m["ownerId"]       = row["owner_id"].as<int>();
            m["ownerUsername"] = row["owner_username"].as<std::string>();
            m["title"]         = row["title"].as<std::string>();
            m["description"]   = row["description"].isNull() ? "" : row["description"].as<std::string>();
            m["centerLat"]     = row["center_lat"].as<double>();
            m["centerLng"]     = row["center_lng"].as<double>();
            m["zoom"]          = row["zoom"].as<int>();
            m["createdAt"]     = row["created_at"].as<std::string>();
            m["updatedAt"]     = row["updated_at"].as<std::string>();
            m["permission"]    = perm;
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
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "Request body required"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "UPDATE maps SET "
        "title=COALESCE(?,title), description=COALESCE(?,description), "
        "center_lat=COALESCE(?,center_lat), center_lng=COALESCE(?,center_lng), "
        "zoom=COALESCE(?,zoom) "
        "WHERE id=? AND tenant_id=? AND owner_id=?",
        [callback, id](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("forbidden", "Map not found or insufficient permissions"));
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
                errorJson("db_error", "Failed to update map"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        (*body).get("title", Json::Value()).asString().empty()
            ? nullptr : new std::string((*body)["title"].asString()),
        (*body).get("description", Json::Value()).asString().empty()
            ? nullptr : new std::string((*body)["description"].asString()),
        (*body).isMember("centerLat") ? &(*body)["centerLat"].asDouble() : nullptr,
        (*body).isMember("centerLng") ? &(*body)["centerLng"].asDouble() : nullptr,
        (*body).isMember("zoom")      ? &(*body)["zoom"].asInt()         : nullptr,
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
        [callback](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("forbidden", "Map not found or insufficient permissions"));
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
                errorJson("db_error", "Failed to delete map"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
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
                "SELECT mp.id, mp.user_id, u.username, mp.can_view, mp.can_edit "
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
                        p["canView"]  = row["can_view"].as<bool>();
                        p["canEdit"]  = row["can_edit"].as<bool>();
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

    bool canView  = (*body).get("canView", false).asBool();
    bool canEdit  = (*body).get("canEdit", false).asBool();
    bool isPublic = (*body)["userId"].isNull();
    int  targetId = isPublic ? 0 : (*body)["userId"].asInt();

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT id FROM maps WHERE id=? AND tenant_id=? AND owner_id=?",
        [callback, req, id, tenantId, callerId, callerOrg, targetId,
         isPublic, canView, canEdit](const drogon::orm::Result& r) {
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
                    [callback, req, id, tenantId, callerId, targetId, canView, canEdit]
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
                            "INSERT INTO map_permissions (map_id, user_id, can_view, can_edit) "
                            "VALUES (?,?,?,?) "
                            "ON DUPLICATE KEY UPDATE can_view=VALUES(can_view), can_edit=VALUES(can_edit)",
                            [callback, req, id, tenantId, callerId, targetId, canView, canEdit]
                            (const drogon::orm::Result&) {
                                Json::Value detail;
                                detail["mapId"] = id; detail["targetUserId"] = targetId;
                                detail["canView"] = canView; detail["canEdit"] = canEdit;
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
                            id, targetId, canView, canEdit);
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
                    "INSERT INTO map_permissions (map_id, user_id, can_view, can_edit) "
                    "VALUES (?, NULL, ?, ?) "
                    "ON DUPLICATE KEY UPDATE can_view=VALUES(can_view), can_edit=VALUES(can_edit)",
                    [callback, req, id, tenantId, callerId, canView, canEdit]
                    (const drogon::orm::Result&) {
                        Json::Value detail;
                        detail["mapId"] = id; detail["public"] = true;
                        detail["canView"] = canView; detail["canEdit"] = canEdit;
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
                    id, canView, canEdit);
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
