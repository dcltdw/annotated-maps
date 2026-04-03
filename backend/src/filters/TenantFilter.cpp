#include "TenantFilter.h"
#include <drogon/drogon.h>
#include <regex>
#include <memory>

void TenantFilter::doFilter(const drogon::HttpRequestPtr& req,
                            drogon::FilterCallback&&      failCb,
                            drogon::FilterChainCallback&& nextCb) {
    // Extract tenantId from path: /api/v1/tenants/{tenantId}/...
    static const std::regex kTenantPath(R"(/api/v1/tenants/(\d+)/)");
    const std::string path = req->getPath();
    std::smatch m;

    if (!std::regex_search(path, m, kTenantPath)) {
        Json::Value body;
        body["error"]   = "forbidden";
        body["message"] = "Tenant ID not found in request path";
        auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
        resp->setStatusCode(drogon::k403Forbidden);
        failCb(resp);
        return;
    }

    int tenantId = std::stoi(m[1].str());

    // userId was injected by JwtFilter
    int userId = 0;
    try {
        userId = req->getAttributes()->get<int>("userId");
    } catch (...) {
        Json::Value body;
        body["error"]   = "unauthorized";
        body["message"] = "Authentication required before tenant check";
        auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
        resp->setStatusCode(drogon::k401Unauthorized);
        failCb(resp);
        return;
    }

    // Superuser bypasses tenant membership check
    std::string platformRole;
    try {
        platformRole = req->getAttributes()->get<std::string>("platformRole");
    } catch (...) {}

    if (platformRole == "superuser") {
        req->getAttributes()->insert("tenantId",   tenantId);
        req->getAttributes()->insert("tenantRole", std::string("admin"));
        nextCb();
        return;
    }

    // Wrap failCb in shared_ptr so both lambdas can call it.
    auto sharedFailCb = std::make_shared<drogon::FilterCallback>(std::move(failCb));

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT role FROM tenant_members WHERE tenant_id=? AND user_id=? LIMIT 1",
        [req, tenantId, sharedFailCb,
         nextCb = std::move(nextCb)](const drogon::orm::Result& r) mutable {
            if (r.empty()) {
                Json::Value body;
                body["error"]   = "forbidden";
                body["message"] = "You are not a member of this tenant";
                auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
                resp->setStatusCode(drogon::k403Forbidden);
                (*sharedFailCb)(resp);
                return;
            }
            req->getAttributes()->insert("tenantId",   tenantId);
            req->getAttributes()->insert("tenantRole", r[0]["role"].as<std::string>());
            nextCb();
        },
        [sharedFailCb](const drogon::orm::DrogonDbException&) {
            Json::Value body;
            body["error"]   = "db_error";
            body["message"] = "Failed to verify tenant membership";
            auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
            resp->setStatusCode(drogon::k500InternalServerError);
            (*sharedFailCb)(resp);
        },
        tenantId, userId);
}
