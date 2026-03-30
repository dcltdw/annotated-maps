#include "TenantController.h"
#include "AuditLog.h"
#include <drogon/drogon.h>

static Json::Value errorJson(const std::string& code, const std::string& msg) {
    Json::Value v;
    v["error"]   = code;
    v["message"] = msg;
    return v;
}

// ─── GET /api/v1/tenants ──────────────────────────────────────────────────────

void TenantController::listTenants(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback) {

    int userId = req->getAttributes()->get<int>("userId");

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT t.id, t.org_id, o.name AS org_name, o.slug AS org_slug, "
        "       t.name, t.slug, tm.role "
        "FROM tenant_members tm "
        "JOIN tenants       t ON t.id = tm.tenant_id "
        "JOIN organizations o ON o.id = t.org_id "
        "WHERE tm.user_id = ? "
        "ORDER BY o.name, t.name",
        [callback](const drogon::orm::Result& r) {
            Json::Value arr(Json::arrayValue);
            for (const auto& row : r) {
                Json::Value item;
                item["id"]      = row["id"].as<int>();
                item["orgId"]   = row["org_id"].as<int>();
                item["orgName"] = row["org_name"].as<std::string>();
                item["orgSlug"] = row["org_slug"].as<std::string>();
                item["name"]    = row["name"].as<std::string>();
                item["slug"]    = row["slug"].as<std::string>();
                item["role"]    = row["role"].as<std::string>();
                arr.append(item);
            }
            callback(drogon::HttpResponse::newHttpJsonResponse(arr));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Failed to fetch tenants"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        userId);
}

// ─── GET /api/v1/tenants/{tenantId}/branding ──────────────────────────────────

void TenantController::getBranding(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId) {

    (void)req;
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT branding FROM tenants WHERE id=? LIMIT 1",
        [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("not_found", "Tenant not found"));
                resp->setStatusCode(drogon::k404NotFound);
                callback(resp);
                return;
            }
            Json::Value branding;
            if (!r[0]["branding"].isNull()) {
                Json::Reader reader;
                reader.parse(r[0]["branding"].as<std::string>(), branding);
            } else {
                branding = Json::objectValue;
            }
            callback(drogon::HttpResponse::newHttpJsonResponse(branding));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Failed to fetch branding"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        tenantId);
}

// ─── PUT /api/v1/tenants/{tenantId}/branding ──────────────────────────────────

void TenantController::updateBranding(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId) {

    const std::string callerRole = req->getAttributes()->get<std::string>("tenantRole");
    if (callerRole != "admin") {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("forbidden", "Only tenant admins can update branding"));
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

    // Whitelist allowed branding keys
    Json::Value branding(Json::objectValue);
    static const std::vector<std::string> allowedKeys = {
        "logo_url", "favicon_url", "primary_color", "accent_color", "display_name"
    };
    for (const auto& key : allowedKeys) {
        if (body->isMember(key))
            branding[key] = (*body)[key];
    }

    Json::StreamWriterBuilder wb;
    std::string brandingStr = Json::writeString(wb, branding);

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "UPDATE tenants SET branding=? WHERE id=?",
        [callback, branding](const drogon::orm::Result&) {
            callback(drogon::HttpResponse::newHttpJsonResponse(branding));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Failed to update branding"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        brandingStr, tenantId);
}

// ─── GET /api/v1/tenants/{tenantId}/members ───────────────────────────────────

void TenantController::listMembers(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId) {

    const std::string role = req->getAttributes()->get<std::string>("tenantRole");
    if (role != "admin") {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("forbidden", "Only tenant admins can list members"));
        resp->setStatusCode(drogon::k403Forbidden);
        callback(resp);
        return;
    }

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT tm.user_id, u.username, u.email, tm.role, tm.created_at "
        "FROM tenant_members tm "
        "JOIN users u ON u.id = tm.user_id "
        "WHERE tm.tenant_id = ? "
        "ORDER BY u.username",
        [callback](const drogon::orm::Result& r) {
            Json::Value arr(Json::arrayValue);
            for (const auto& row : r) {
                Json::Value m;
                m["userId"]    = row["user_id"].as<int>();
                m["username"]  = row["username"].as<std::string>();
                m["email"]     = row["email"].as<std::string>();
                m["role"]      = row["role"].as<std::string>();
                m["createdAt"] = row["created_at"].as<std::string>();
                arr.append(m);
            }
            callback(drogon::HttpResponse::newHttpJsonResponse(arr));
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Failed to fetch members"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        tenantId);
}

// ─── POST /api/v1/tenants/{tenantId}/members ─────────────────────────────────

void TenantController::addMember(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId) {

    const std::string callerRole = req->getAttributes()->get<std::string>("tenantRole");
    if (callerRole != "admin") {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("forbidden", "Only tenant admins can add members"));
        resp->setStatusCode(drogon::k403Forbidden);
        callback(resp);
        return;
    }

    auto body = req->getJsonObject();
    if (!body || !(*body)["userId"] || !(*body)["role"]) {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "userId and role are required"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    int         targetUserId = (*body)["userId"].asInt();
    std::string role         = (*body)["role"].asString();

    if (role != "admin" && role != "editor" && role != "viewer") {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "role must be admin, editor, or viewer"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    // Verify target user is in the same org as this tenant
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT u.id FROM users u "
        "JOIN tenants t ON t.org_id = u.org_id "
        "WHERE t.id = ? AND u.id = ? LIMIT 1",
        [callback, req, tenantId, targetUserId, role](const drogon::orm::Result& r) {
            if (r.empty()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("bad_request", "Target user is not in this organization"));
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            int callerId = 0;
            try { callerId = req->getAttributes()->get<int>("userId"); } catch (...) {}

            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "INSERT INTO tenant_members (tenant_id, user_id, role) "
                "VALUES (?,?,?) "
                "ON DUPLICATE KEY UPDATE role=VALUES(role)",
                [callback, req, callerId, tenantId, targetUserId, role](const drogon::orm::Result&) {
                    Json::Value detail; detail["role"] = role;
                    AuditLog::record("member_add", req, callerId, targetUserId, tenantId, detail);
                    Json::Value v;
                    v["userId"] = targetUserId;
                    v["role"]   = role;
                    v["added"]  = true;
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(v);
                    resp->setStatusCode(drogon::k201Created);
                    callback(resp);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(
                        errorJson("db_error", "Failed to add member"));
                    resp->setStatusCode(drogon::k500InternalServerError);
                    callback(resp);
                },
                tenantId, targetUserId, role);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Database error"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        tenantId, targetUserId);
}

// ─── DELETE /api/v1/tenants/{tenantId}/members/{userId} ───────────────────────

void TenantController::removeMember(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    int tenantId, int userId) {

    const std::string callerRole = req->getAttributes()->get<std::string>("tenantRole");
    int callerId = req->getAttributes()->get<int>("userId");

    if (callerRole != "admin") {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("forbidden", "Only tenant admins can remove members"));
        resp->setStatusCode(drogon::k403Forbidden);
        callback(resp);
        return;
    }

    if (callerId == userId) {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "You cannot remove yourself from the tenant"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "DELETE FROM tenant_members WHERE tenant_id=? AND user_id=?",
        [callback, req, callerId, tenantId, userId](const drogon::orm::Result& r) {
            if (r.affectedRows() == 0) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("not_found", "Member not found"));
                resp->setStatusCode(drogon::k404NotFound);
                callback(resp);
                return;
            }
            AuditLog::record("member_remove", req, callerId, userId, tenantId);
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k204NoContent);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Failed to remove member"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        tenantId, userId);
}
