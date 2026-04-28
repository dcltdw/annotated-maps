#include "VisibilityGroupController.h"
#include "ErrorResponse.h"
#include <drogon/drogon.h>

// Phase 2b.i.b: Member management endpoints + the manages_visibility-
// based authorization helper + tenant-creation bootstrap (which lives
// in AuthController, since that's where new tenants are created).
//
// Tagging nodes/notes with these groups arrives in #86/#87; read-time
// filtering using effective visibility is in #99.

static int callerUserId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("userId"); }
    catch (...) { return 0; }
}

static int callerOrgId(const drogon::HttpRequestPtr& req) {
    try { return req->getAttributes()->get<int>("orgId"); }
    catch (...) { return 0; }
}

namespace {

bool isTenantAdmin(const drogon::HttpRequestPtr& req) {
    try {
        return req->getAttributes()->get<std::string>("tenantRole") == "admin";
    } catch (...) { return false; }
}

// Authorization helper for visibility-group management. Allowed if:
//   * Caller is a tenant admin (sync path), OR
//   * Caller is a member of any visibility_group in this tenant with
//     manages_visibility = TRUE (async path — one DB query).
//
// On success, calls onAllowed(). On denial or DB error, sends a 403/500
// via callback. Pattern mirrors how filter chains hand off to the next
// step — each handler wraps its real logic in onAllowed.
void requireVisibilityGroupManager(
    const drogon::HttpRequestPtr& req,
    int tenantId,
    int userId,
    const std::function<void(const drogon::HttpResponsePtr&)>& callback,
    std::function<void()> onAllowed) {

    if (isTenantAdmin(req)) {
        onAllowed();
        return;
    }

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT 1 FROM visibility_group_members vgm "
        "JOIN visibility_groups vg ON vg.id = vgm.visibility_group_id "
        "WHERE vgm.user_id = ? AND vg.tenant_id = ? "
        "  AND vg.manages_visibility = TRUE LIMIT 1",
        [callback, onAllowed = std::move(onAllowed)](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden",
                    "Only tenant admins or visibility-group managers "
                    "can manage visibility groups"));
                return;
            }
            onAllowed();
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to check authorization"));
        },
        userId, tenantId);
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

Json::Value rowToMember(const drogon::orm::Row& row) {
    Json::Value m;
    m["userId"]   = row["user_id"].as<int>();
    m["username"] = row["username"].as<std::string>();
    m["email"]    = row["email"].as<std::string>();
    m["joinedAt"] = row["joined_at"].as<std::string>();
    return m;
}

} // anonymous namespace

// ─── GET /api/v1/tenants/{tenantId}/visibility-groups ───────────────────────

void VisibilityGroupController::listGroups(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId) {

    int userId = callerUserId(req);
    requireVisibilityGroupManager(req, tenantId, userId, callback,
        [callback, tenantId]() {
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
        });
}

// ─── POST /api/v1/tenants/{tenantId}/visibility-groups ──────────────────────

void VisibilityGroupController::createGroup(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId) {

    int userId = callerUserId(req);

    auto body = req->getJsonObject();
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

    // Escalation guard: only tenant admins can CREATE a manages_visibility
    // group. Managers can create regular groups but not promote a group
    // to manager status. Symmetric with the PUT guard below.
    if (managesVisibility && !isTenantAdmin(req)) {
        callback(errorResponse(drogon::k403Forbidden,
            "forbidden",
            "Only tenant admins can create a managesVisibility group"));
        return;
    }

    requireVisibilityGroupManager(req, tenantId, userId, callback,
        [callback, tenantId, userId, name, description, managesVisibility]() {
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
                    if (std::string(ex.base().what()).find("Duplicate") != std::string::npos) {
                        callback(errorResponse(drogon::k409Conflict,
                            "conflict",
                            "A visibility group with this name already exists in this tenant"));
                        return;
                    }
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to create visibility group"));
                },
                tenantId, name, description, managesVisibility, userId);
        });
}

// ─── GET /api/v1/tenants/{tenantId}/visibility-groups/{id} ──────────────────

void VisibilityGroupController::getGroup(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    int userId = callerUserId(req);
    requireVisibilityGroupManager(req, tenantId, userId, callback,
        [callback, tenantId, id]() {
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
        });
}

// ─── PUT /api/v1/tenants/{tenantId}/visibility-groups/{id} ──────────────────

void VisibilityGroupController::updateGroup(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    int userId = callerUserId(req);

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

    // Escalation guard: only tenant admins can change managesVisibility.
    // Managers cannot promote themselves (or peers) into more power.
    if (hasManages && !isTenantAdmin(req)) {
        callback(errorResponse(drogon::k403Forbidden,
            "forbidden",
            "Only tenant admins can change managesVisibility"));
        return;
    }

    requireVisibilityGroupManager(req, tenantId, userId, callback,
        [callback, tenantId, id, name, description, hasManages, managesVisibility]() {
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
                    if (std::string(ex.base().what()).find("Duplicate") != std::string::npos) {
                        callback(errorResponse(drogon::k409Conflict,
                            "conflict",
                            "A visibility group with this name already exists in this tenant"));
                        return;
                    }
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to update visibility group"));
                },
                name, name,
                description, description,
                hasManages, managesVisibility,
                id, tenantId);
        });
}

// ─── DELETE /api/v1/tenants/{tenantId}/visibility-groups/{id} ───────────────

void VisibilityGroupController::deleteGroup(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    int userId = callerUserId(req);
    requireVisibilityGroupManager(req, tenantId, userId, callback,
        [callback, tenantId, id]() {
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
        });
}

// ─── GET .../visibility-groups/{id}/members ─────────────────────────────────

void VisibilityGroupController::listMembers(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    int userId = callerUserId(req);
    requireVisibilityGroupManager(req, tenantId, userId, callback,
        [callback, tenantId, id]() {
            auto db = drogon::app().getDbClient();
            db->execSqlAsync(
                "SELECT vgm.user_id, u.username, u.email, vgm.joined_at "
                "FROM visibility_group_members vgm "
                "JOIN visibility_groups vg ON vg.id = vgm.visibility_group_id "
                "JOIN users u ON u.id = vgm.user_id "
                "WHERE vgm.visibility_group_id = ? AND vg.tenant_id = ? "
                "ORDER BY u.username ASC",
                [callback](const drogon::orm::Result& r) {
                    Json::Value arr(Json::arrayValue);
                    for (const auto& row : r) arr.append(rowToMember(row));
                    callback(drogon::HttpResponse::newHttpJsonResponse(arr));
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to fetch members"));
                },
                id, tenantId);
        });
}

// ─── POST .../visibility-groups/{id}/members ────────────────────────────────

void VisibilityGroupController::addMember(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id) {

    int callerId  = callerUserId(req);
    int callerOrg = callerOrgId(req);

    auto body = req->getJsonObject();
    if (!body || !body->isMember("userId")) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "userId is required"));
        return;
    }
    int targetUserId = (*body)["userId"].asInt();

    requireVisibilityGroupManager(req, tenantId, callerId, callback,
        [callback, tenantId, id, callerOrg, targetUserId]() {
            // Verify the target user is in the same org. Visibility-group
            // membership is tenant-scoped but cross-org members are
            // intentionally rejected (matches the map-permission-add rule).
            auto db = drogon::app().getDbClient();
            db->execSqlAsync(
                "SELECT 1 FROM visibility_groups vg "
                "JOIN users u ON u.id = ? AND u.org_id = ? "
                "WHERE vg.id = ? AND vg.tenant_id = ? LIMIT 1",
                [callback, id, targetUserId](const drogon::orm::Result& r) {
                    if (r.empty()) {
                        callback(errorResponse(drogon::k400BadRequest,
                            "bad_request",
                            "Visibility group not found or user is in a different organization"));
                        return;
                    }
                    auto db2 = drogon::app().getDbClient();
                    db2->execSqlAsync(
                        "INSERT IGNORE INTO visibility_group_members "
                        "  (visibility_group_id, user_id) VALUES (?, ?)",
                        [callback, id, targetUserId](const drogon::orm::Result&) {
                            Json::Value v;
                            v["visibilityGroupId"] = id;
                            v["userId"]            = targetUserId;
                            v["added"]             = true;
                            auto resp = drogon::HttpResponse::newHttpJsonResponse(v);
                            resp->setStatusCode(drogon::k201Created);
                            callback(resp);
                        },
                        [callback](const drogon::orm::DrogonDbException&) {
                            callback(errorResponse(drogon::k500InternalServerError,
                                "db_error", "Failed to add member"));
                        },
                        id, targetUserId);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Database error"));
                },
                targetUserId, callerOrg, id, tenantId);
        });
}

// ─── DELETE .../visibility-groups/{id}/members/{userId} ─────────────────────

void VisibilityGroupController::removeMember(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int id, int userId) {

    int callerId = callerUserId(req);
    requireVisibilityGroupManager(req, tenantId, callerId, callback,
        [callback, tenantId, id, userId]() {
            auto db = drogon::app().getDbClient();
            db->execSqlAsync(
                "DELETE vgm FROM visibility_group_members vgm "
                "JOIN visibility_groups vg ON vg.id = vgm.visibility_group_id "
                "WHERE vgm.visibility_group_id = ? AND vgm.user_id = ? "
                "  AND vg.tenant_id = ?",
                [callback](const drogon::orm::Result& r) {
                    if (r.affectedRows() == 0) {
                        callback(errorResponse(drogon::k404NotFound,
                            "not_found",
                            "Member not found in this visibility group"));
                        return;
                    }
                    auto resp = drogon::HttpResponse::newHttpResponse();
                    resp->setStatusCode(drogon::k204NoContent);
                    callback(resp);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    callback(errorResponse(drogon::k500InternalServerError,
                        "db_error", "Failed to remove member"));
                },
                id, userId, tenantId);
        });
}
