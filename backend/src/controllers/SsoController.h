#pragma once
#include <drogon/HttpController.h>
#include <mutex>
#include <unordered_map>
#include <chrono>
#include <string>

/**
 * SsoController
 *
 * Implements OIDC Authorization Code Flow for organizational SSO.
 *
 * GET  /api/v1/auth/sso/{orgSlug}           — generate state, redirect to IdP
 * GET  /api/v1/auth/sso/{orgSlug}/callback  — exchange IdP code, store
 *                                             one-time app code, redirect
 *                                             to frontend with ?code=
 * POST /api/v1/auth/sso/exchange            — exchange one-time app code
 *                                             for the application JWT
 *                                             (#58 / M3)
 */
class SsoController : public drogon::HttpController<SsoController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(SsoController::initiate,
                      "/api/v1/auth/sso/{orgSlug}",
                      drogon::Get, "RateLimitFilter");
        ADD_METHOD_TO(SsoController::callback,
                      "/api/v1/auth/sso/{orgSlug}/callback",
                      drogon::Get, "RateLimitFilter");
        ADD_METHOD_TO(SsoController::exchange,
                      "/api/v1/auth/sso/exchange",
                      drogon::Post, "RateLimitFilter");
    METHOD_LIST_END

    void initiate(const drogon::HttpRequestPtr&,
                  std::function<void(const drogon::HttpResponsePtr&)>&&,
                  const std::string& orgSlug);

    void callback(const drogon::HttpRequestPtr&,
                  std::function<void(const drogon::HttpResponsePtr&)>&&,
                  const std::string& orgSlug);

    void exchange(const drogon::HttpRequestPtr&,
                  std::function<void(const drogon::HttpResponsePtr&)>&&);

private:
    struct OidcState {
        int         orgId;
        std::string nonce;
        std::chrono::steady_clock::time_point expiry;
    };

    // M3: one-time application code that the frontend POSTs to retrieve
    // the JWT. Replaces the prior URL-fragment delivery, which leaked
    // tokens via browser history and Referer.
    struct AppCode {
        std::string token;
        int         tenantId;
        std::chrono::steady_clock::time_point expiry;
    };

    std::mutex                                 stateMutex_;
    std::unordered_map<std::string, OidcState> pendingStates_;

    std::mutex                                 codeMutex_;
    std::unordered_map<std::string, AppCode>   pendingAppCodes_;

    void        purgeExpiredStates();
    void        purgeExpiredAppCodes();
    std::string generateRandom(int bytes = 32);
    std::string issueToken(int userId, const std::string& username, int orgId) const;

    // Helper: look up the user's first tenant, mint a JWT, store it under a
    // one-time app code, and respond with a 302 to the frontend's
    // /sso/callback?code=... URL (M3).
    void postIssueAppCode(
        std::function<void(const drogon::HttpResponsePtr&)> callback,
        const drogon::HttpRequestPtr& req,
        int userId, const std::string& username, int orgId);
};
