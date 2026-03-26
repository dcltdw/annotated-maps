#include "JwtFilter.h"
#include <drogon/drogon.h>
#include <jwt-cpp/jwt.h>
#include <string>

void JwtFilter::doFilter(const drogon::HttpRequestPtr& req,
                         drogon::FilterCallback&&      failCb,
                         drogon::FilterChainCallback&& nextCb) {
    // Extract "Bearer <token>" from Authorization header
    const std::string& authHeader = req->getHeader("Authorization");
    if (authHeader.size() <= 7 ||
        authHeader.substr(0, 7) != "Bearer ") {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            Json::Value{[](Json::Value v) -> Json::Value {
                v["error"] = "unauthorized";
                v["message"] = "Missing or malformed Authorization header";
                return v;
            }(Json::Value{})});
        resp->setStatusCode(drogon::k401Unauthorized);
        failCb(resp);
        return;
    }

    const std::string token = authHeader.substr(7);

    try {
        const auto& config = drogon::app().getCustomConfig();
        const std::string secret = config["jwt"]["secret"].asString();
        const std::string issuer = config["jwt"]["issuer"].asString();

        auto decoded = jwt::decode(token);
        auto verifier = jwt::verify()
            .allow_algorithm(jwt::algorithm::hs256{secret})
            .with_issuer(issuer);

        verifier.verify(decoded);

        // Inject claims into request attributes for controllers to use
        req->getAttributes()->insert("userId",
            std::stoi(decoded.get_payload_claim("sub").as_string()));
        req->getAttributes()->insert("username",
            decoded.get_payload_claim("username").as_string());

        nextCb();
    } catch (const std::exception& e) {
        Json::Value body;
        body["error"] = "unauthorized";
        body["message"] = "Invalid or expired token";
        auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
        resp->setStatusCode(drogon::k401Unauthorized);
        failCb(resp);
    }
}
