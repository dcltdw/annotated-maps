#include "TenantFilter.h"
#include <drogon/drogon.h>
#include <regex>

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

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT role FROM tenant_members WHERE tenant_id=? AND user_id=? LIMIT 1",
        [req, tenantId, failCb = std::move(failCb),
         nextCb = std::move(nextCb)](const drogon::orm::Result& r) mutable {
            if (r.empty()) {
                Json::Value body;
                body["error"]   = "forbidden";
                body["message"] = "You are not a member of this tenant";
                auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
                resp->setStatusCode(drogon::k403Forbidden);
                failCb(resp);
                return;
            }
            req->getAttributes()->insert("tenantId",   tenantId);
            req->getAttributes()->insert("tenantRole", r[0]["role"].as<std::string>());
            nextCb();
        },
        [failCb = std::move(failCb)](const drogon::orm::DrogonDbException&) mutable {
            Json::Value body;
            body["error"]   = "db_error";
            body["message"] = "Failed to verify tenant membership";
            auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
            resp->setStatusCode(drogon::k500InternalServerError);
            failCb(resp);
        },
        tenantId, userId);
}
