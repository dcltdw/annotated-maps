#include "JwtFilter.h"
#include <drogon/drogon.h>
#include <jwt-cpp/jwt.h>
#include <string>
#include <memory>

void JwtFilter::doFilter(const drogon::HttpRequestPtr& req,
                         drogon::FilterCallback&&      failCb,
                         drogon::FilterChainCallback&& nextCb) {
    const std::string& authHeader = req->getHeader("Authorization");
    if (authHeader.size() <= 7 ||
        authHeader.substr(0, 7) != "Bearer ") {
        Json::Value body;
        body["error"]   = "unauthorized";
        body["message"] = "Missing or malformed Authorization header";
        auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
        resp->setStatusCode(drogon::k401Unauthorized);
        failCb(resp);
        return;
    }

    const std::string token = authHeader.substr(7);

    int userId = 0;
    std::string username;
    int orgId = 0;

    try {
        const auto& config = drogon::app().getCustomConfig();
        const std::string secret = config["jwt"]["secret"].asString();
        const std::string issuer = config["jwt"]["issuer"].asString();

        auto decoded  = jwt::decode(token);
        auto verifier = jwt::verify()
            .allow_algorithm(jwt::algorithm::hs256{secret})
            .with_issuer(issuer)
            .with_audience("annotated-maps");

        verifier.verify(decoded);

        userId   = std::stoi(decoded.get_payload_claim("sub").as_string());
        username = decoded.get_payload_claim("username").as_string();

        try {
            orgId = std::stoi(decoded.get_payload_claim("orgId").as_string());
        } catch (...) {}

    } catch (const std::exception&) {
        Json::Value body;
        body["error"]   = "unauthorized";
        body["message"] = "Invalid or expired token";
        auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
        resp->setStatusCode(drogon::k401Unauthorized);
        failCb(resp);
        return;
    }

    // Wrap failCb in shared_ptr so both lambdas can call it.
    auto sharedFailCb = std::make_shared<drogon::FilterCallback>(std::move(failCb));

    // Verify the user still exists, is active, and get their platform_role.
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT status, platform_role FROM users WHERE id=? LIMIT 1",
        [req, userId, username, orgId,
         sharedFailCb,
         nextCb = std::move(nextCb)](const drogon::orm::Result& r) mutable {
            if (r.empty()) {
                Json::Value body;
                body["error"]   = "unauthorized";
                body["message"] = "Account does not exist";
                auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
                resp->setStatusCode(drogon::k401Unauthorized);
                (*sharedFailCb)(resp);
                return;
            }

            std::string status = r[0]["status"].as<std::string>();
            if (status != "active") {
                Json::Value body;
                body["error"]   = "unauthorized";
                body["message"] = "Account is " + status;
                auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
                resp->setStatusCode(drogon::k401Unauthorized);
                (*sharedFailCb)(resp);
                return;
            }

            std::string platformRole = r[0]["platform_role"].as<std::string>();

            req->getAttributes()->insert("userId",       userId);
            req->getAttributes()->insert("username",     username);
            req->getAttributes()->insert("orgId",        orgId);
            req->getAttributes()->insert("platformRole", platformRole);
            nextCb();
        },
        [sharedFailCb](const drogon::orm::DrogonDbException&) {
            Json::Value body;
            body["error"]   = "unauthorized";
            body["message"] = "Failed to verify account status";
            auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
            resp->setStatusCode(drogon::k500InternalServerError);
            (*sharedFailCb)(resp);
        },
        userId);
}
