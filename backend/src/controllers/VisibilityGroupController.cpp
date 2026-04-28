#include "VisibilityGroupController.h"
#include "ErrorResponse.h"
#include <drogon/drogon.h>

// Phase 2b.i.a: CRUD on visibility_groups, tenant-admin-only. Member
// management + manages_visibility-based authorization + the
// tenant-creation bootstrap of a default "Visibility Managers" group
// land in Phase 2b.i.b (#98).
//
// Tagging nodes/notes with these groups arrives in #86 (nodes) and
// #87 (notes); read-time filtering using effective visibility is in #99.

static int callerUserId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("userId"); }
    catch (...) { return 0; }
}

namespace {

// Throughout this phase, only tenant admins can manage visibility groups.
// The manager-flag escape hatch is wired up in #98.
bool requireAdmin(const drogon::HttpRequestPtr& req,
                  const std::function<void(const drogon::HttpResponsePtr&)>& callback) {
    try {
        const std::string role = req->getAttributes()->get<std::string>("tenantRole");
        if (role == "admin") return true;
    } catch (...) {}
    callback(errorResponse(drogon::k403Forbidden,
        "forbidden", "Only tenant admins can manage visibility groups"));
    return false;
}

Json::Value rowToGroup(const drogon::orm::Row& row) {
    Json::Value g;
    g["id"]                 = row["id"].as<int>();
    g["tenantId"]           = row["tenant_id"].as<int>();
    g["name"]               = row["name"].as<std::string>();
    g["description"]        = row["description"].isNull()
                                ? "" : row["description"].as<std::string>();
    g["managesVisibility"]  = row["manages_visibility"].as<bool>();
    g["createdBy"]          = row["created_by"].as<int>();
    g["createdAt"]          = row["created_at"].as<std::string>();
    g["updatedAt"]          = row["updated_at"].as<std::string>();
    return g;
}

} // anonymous namespace

// ─── GET /api/v1/tenants/{tenantId}/visibility-groups ───────────────────────

void VisibilityGroupController::listGroups(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId) {

    if (!requireAdmin(req, callback)) return;

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT id, tenant_id, name, description, manages_visibility, "
        "       created_by, created_at, updated_at "
        "FROM visibility_groups "
        "WHERE tenant_id = ? "
        "ORDER BY name ASC",
        [callback](const drogon::orm::Result& r) {
            Json::Value arr(Json::arrayValue);
            for (const auto& row : r) arr.append(rowToGroup(row));
            callback(drogon::HttpResponse::newHttpJsonResponse(arr));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to fetch visibility groups"));
        },
        tenantId);
}

// ─── POST /api/v1/tenants/{tenantId}/visibility-groups ──────────────────────

void VisibilityGroupController::createGroup(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId) {

    if (!requireAdmin(req, callback)) return;

    int userId = callerUserId(req);
    auto body  = req->getJsonObject();
    if (!body || !body->isMember("name")) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "name is required"));
        return;
    }

    std::string name        = (*body)["name"].asString();
    std::string description = (*body).get("description", "").asString();
    bool managesVisibility  = (*body).get("managesVisibility", false).asBool();

    if (name.empty()) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "name cannot be empty"));
        return;
    }
    if (!checkMaxLen("name", name, MAX_NAME_LEN, callback)) return;
    if (!checkMaxLen("description", description, MAX_DESCRIPTION_LEN, callback)) return;

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "INSERT INTO visibility_groups "
        "  (tenant_id, name, description, manages_visibility, created_by) "
        "VALUES (?, ?, NULLIF(?, ''), ?, ?)",
        [callback, tenantId, userId, name, description, managesVisibility]
        (const drogon::orm::Result& r) {
            int newId = static_cast<int>(r.insertId());
            Json::Value g;
            g["id"]                 = newId;
            g["tenantId"]           = tenantId;
            g["name"]               = name;
            g["description"]        = description;
            g["managesVisibility"]  = managesVisibility;
            g["createdBy"]          = userId;
            auto resp = drogon::HttpResponse::newHttpJsonResponse(g);
            resp->setStatusCode(drogon::k201Created);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException& ex) {
            // MariaDB error 1062 = duplicate key (UNIQUE on (tenant_id, name))
            // Match the same pattern AuthController uses for duplicate keys.
            if (std::string(ex.base().what()).find("Duplicate") != std::string::npos) {
                callback(errorResponse(drogon::k409Conflict,
                    "conflict", "A visibility group with this name already exists in this tenant"));
                return;
            }
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to create visibility group"));
        },
        tenantId, name, description, managesVisibility, userId);
}

// ─── GET /api/v1/tenants/{tenantId}/visibility-groups/{id} ──────────────────

void VisibilityGroupController::getGroup(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    if (!requireAdmin(req, callback)) return;

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT id, tenant_id, name, description, manages_visibility, "
        "       created_by, created_at, updated_at "
        "FROM visibility_groups WHERE id = ? AND tenant_id = ?",
        [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "Visibility group not found"));
                return;
            }
            callback(drogon::HttpResponse::newHttpJsonResponse(rowToGroup(r[0])));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Database error"));
        },
        id, tenantId);
}

// ─── PUT /api/v1/tenants/{tenantId}/visibility-groups/{id} ──────────────────

void VisibilityGroupController::updateGroup(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    if (!requireAdmin(req, callback)) return;

    auto body = req->getJsonObject();
    if (!body) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "Request body required"));
        return;
    }

    std::string name        = (*body).get("name", "").asString();
    std::string description = (*body).get("description", "").asString();
    bool hasManages         = body->isMember("managesVisibility");
    bool managesVisibility  = hasManages ? (*body)["managesVisibility"].asBool() : false;

    if (!checkMaxLen("name", name, MAX_NAME_LEN, callback)) return;
    if (!checkMaxLen("description", description, MAX_DESCRIPTION_LEN, callback)) return;

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "UPDATE visibility_groups SET "
        "  name               = IF(?='', name, ?), "
        "  description        = IF(?='', description, ?), "
        "  manages_visibility = IF(?, ?, manages_visibility) "
        "WHERE id = ? AND tenant_id = ?",
        [callback, id](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "Visibility group not found"));
                return;
            }
            Json::Value v;
            v["id"]      = id;
            v["updated"] = true;
            callback(drogon::HttpResponse::newHttpJsonResponse(v));
        },
        [callback](const drogon::orm::DrogonDbException& ex) {
            // Match the same pattern AuthController uses for duplicate keys.
            if (std::string(ex.base().what()).find("Duplicate") != std::string::npos) {
                callback(errorResponse(drogon::k409Conflict,
                    "conflict", "A visibility group with this name already exists in this tenant"));
                return;
            }
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to update visibility group"));
        },
        name, name,
        description, description,
        hasManages, managesVisibility,
        id, tenantId);
}

// ─── DELETE /api/v1/tenants/{tenantId}/visibility-groups/{id} ───────────────
//
// Junction tables (visibility_group_members, node_visibility,
// note_visibility) are FK CASCADE'd via the schema, so deleting a
// group cleans up its memberships and tagging without a manual sweep.

void VisibilityGroupController::deleteGroup(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    if (!requireAdmin(req, callback)) return;

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "DELETE FROM visibility_groups WHERE id = ? AND tenant_id = ?",
        [callback](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "Visibility group not found"));
                return;
            }
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k204NoContent);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to delete visibility group"));
        },
        id, tenantId);
}
