#include "NoteGroupController.h"
#include <drogon/drogon.h>

static int callerUserId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("userId"); }
    catch (...) { return 0; }
}

static std::string callerTenantRole(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<std::string>("tenantRole"); }
    catch (...) { return ""; }
}

static Json::Value errorJson(const std::string& code, const std::string& msg) {
    Json::Value v;
    v["error"]   = code;
    v["message"] = msg;
    return v;
}

// ─── GET .../note-groups ──────────────────────────────────────────────────────

void NoteGroupController::listGroups(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId) {

    (void)req;
    // Verify map belongs to this tenant
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT ng.id, ng.map_id, ng.name, ng.description, ng.color, "
        "       ng.sort_order, ng.created_by, u.username AS creator_username, "
        "       ng.created_at, ng.updated_at "
        "FROM note_groups ng "
        "JOIN maps m ON m.id = ng.map_id "
        "JOIN users u ON u.id = ng.created_by "
        "WHERE ng.map_id = ? AND m.tenant_id = ? "
        "ORDER BY ng.sort_order ASC, ng.name ASC",
        [callback](const drogon::orm::Result& r) {
            Json::Value arr(Json::arrayValue);
            for (const auto& row : r) {
                Json::Value g;
                g["id"]               = row["id"].as<int>();
                g["mapId"]            = row["map_id"].as<int>();
                g["name"]             = row["name"].as<std::string>();
                g["description"]      = row["description"].isNull() ? "" : row["description"].as<std::string>();
                g["color"]            = row["color"].isNull() ? "" : row["color"].as<std::string>();
                g["sortOrder"]        = row["sort_order"].as<int>();
                g["createdBy"]        = row["created_by"].as<int>();
                g["createdByUsername"] = row["creator_username"].as<std::string>();
                g["createdAt"]        = row["created_at"].as<std::string>();
                g["updatedAt"]        = row["updated_at"].as<std::string>();
                arr.append(g);
            }
            callback(drogon::HttpResponse::newHttpJsonResponse(arr));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Failed to fetch note groups"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        mapId, tenantId);
}

// ─── POST .../note-groups ─────────────────────────────────────────────────────

void NoteGroupController::createGroup(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId) {

    std::string role = callerTenantRole(req);
    if (role != "admin") {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("forbidden", "Only tenant admins can create note groups"));
        resp->setStatusCode(drogon::k403Forbidden);
        callback(resp);
        return;
    }

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body || !(*body)["name"]) {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "name is required"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    std::string name  = (*body)["name"].asString();
    std::string desc  = (*body).get("description", "").asString();
    std::string color = (*body).get("color", "").asString();
    int sortOrder     = (*body).get("sortOrder", 0).asInt();

    // Validate color if provided
    if (!color.empty()) {
        bool validColor = color[0] == '#' &&
            (color.size() == 4 || color.size() == 7 || color.size() == 9);
        if (validColor) {
            for (size_t i = 1; i < color.size(); ++i) {
                char c = color[i];
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') ||
                      (c >= 'A' && c <= 'F'))) {
                    validColor = false;
                    break;
                }
            }
        }
        if (!validColor) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("bad_request", "color must be a hex color (e.g. #ff0000)"));
            resp->setStatusCode(drogon::k400BadRequest);
            callback(resp);
            return;
        }
    }

    // Verify map belongs to tenant
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT id FROM maps WHERE id = ? AND tenant_id = ?",
        [callback, mapId, userId, name, desc, color, sortOrder]
        (const drogon::orm::Result& r) {
            if (r.empty()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("not_found", "Map not found in this tenant"));
                resp->setStatusCode(drogon::k404NotFound);
                callback(resp);
                return;
            }

            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "INSERT INTO note_groups (map_id, name, description, color, sort_order, created_by) "
                "VALUES (?,?,?,?,?,?)",
                [callback, mapId, name, desc, color, sortOrder, userId]
                (const drogon::orm::Result& r2) {
                    int newId = static_cast<int>(r2.insertId());
                    Json::Value g;
                    g["id"]        = newId;
                    g["mapId"]     = mapId;
                    g["name"]      = name;
                    g["description"] = desc;
                    g["color"]     = color;
                    g["sortOrder"] = sortOrder;
                    g["createdBy"] = userId;
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(g);
                    resp->setStatusCode(drogon::k201Created);
                    callback(resp);
                },
                [callback](const drogon::orm::DrogonDbException& e) {
                    std::string err = e.base().what();
                    bool dup = err.find("Duplicate") != std::string::npos;
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(
                        errorJson(dup ? "conflict" : "db_error",
                                  dup ? "A group with this name already exists on this map"
                                      : "Failed to create note group"));
                    resp->setStatusCode(dup ? drogon::k409Conflict
                                            : drogon::k500InternalServerError);
                    callback(resp);
                },
                mapId, name, desc, color, sortOrder, userId);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Database error"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        mapId, tenantId);
}

// ─── PUT .../note-groups/{id} ─────────────────────────────────────────────────

void NoteGroupController::updateGroup(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    std::string role = callerTenantRole(req);
    if (role != "admin") {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("forbidden", "Only tenant admins can update note groups"));
        resp->setStatusCode(drogon::k403Forbidden);
        callback(resp);
        return;
    }

    auto body = req->getJsonObject();
    if (!body) {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "Request body required"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    std::string newName  = (*body).get("name", "").asString();
    std::string newDesc  = (*body).get("description", "").asString();
    std::string newColor = (*body).get("color", "").asString();
    bool hasSortOrder    = body->isMember("sortOrder");
    int newSortOrder     = (*body).get("sortOrder", 0).asInt();

    // Validate color if provided
    if (!newColor.empty()) {
        bool validColor = newColor[0] == '#' &&
            (newColor.size() == 4 || newColor.size() == 7 || newColor.size() == 9);
        if (validColor) {
            for (size_t i = 1; i < newColor.size(); ++i) {
                char c = newColor[i];
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') ||
                      (c >= 'A' && c <= 'F'))) {
                    validColor = false;
                    break;
                }
            }
        }
        if (!validColor) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("bad_request", "color must be a hex color (e.g. #ff0000)"));
            resp->setStatusCode(drogon::k400BadRequest);
            callback(resp);
            return;
        }
    }

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "UPDATE note_groups ng "
        "JOIN maps m ON m.id = ng.map_id "
        "SET ng.name        = IF(?='', ng.name, ?), "
        "    ng.description = IF(?='', ng.description, ?), "
        "    ng.color       = IF(?='', ng.color, ?), "
        "    ng.sort_order  = IF(?=0, ng.sort_order, ?) "
        "WHERE ng.id = ? AND ng.map_id = ? AND m.tenant_id = ?",
        [callback, id](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("not_found", "Note group not found"));
                resp->setStatusCode(drogon::k404NotFound);
                callback(resp);
                return;
            }
            Json::Value v;
            v["id"]      = id;
            v["updated"] = true;
            callback(drogon::HttpResponse::newHttpJsonResponse(v));
        },
        [callback](const drogon::orm::DrogonDbException& e) {
            std::string err = e.base().what();
            bool dup = err.find("Duplicate") != std::string::npos;
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson(dup ? "conflict" : "db_error",
                          dup ? "A group with this name already exists on this map"
                              : "Failed to update note group"));
            resp->setStatusCode(dup ? drogon::k409Conflict
                                    : drogon::k500InternalServerError);
            callback(resp);
        },
        newName, newName,
        newDesc, newDesc,
        newColor, newColor,
        hasSortOrder ? 1 : 0, newSortOrder,
        id, mapId, tenantId);
}

// ─── DELETE .../note-groups/{id} ──────────────────────────────────────────────

void NoteGroupController::deleteGroup(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int mapId, int id) {

    std::string role = callerTenantRole(req);
    if (role != "admin") {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("forbidden", "Only tenant admins can delete note groups"));
        resp->setStatusCode(drogon::k403Forbidden);
        callback(resp);
        return;
    }

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "DELETE ng FROM note_groups ng "
        "JOIN maps m ON m.id = ng.map_id "
        "WHERE ng.id = ? AND ng.map_id = ? AND m.tenant_id = ?",
        [callback](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("not_found", "Note group not found"));
                resp->setStatusCode(drogon::k404NotFound);
                callback(resp);
                return;
            }
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k204NoContent);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Failed to delete note group"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        id, mapId, tenantId);
}
