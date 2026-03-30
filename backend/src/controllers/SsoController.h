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
 * GET /api/v1/auth/sso/{orgSlug}           — generate state, redirect to IdP
 * GET /api/v1/auth/sso/{orgSlug}/callback  — exchange code, issue app JWT,
 *                                            redirect to frontend
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
    METHOD_LIST_END

    void initiate(const drogon::HttpRequestPtr&,
                  std::function<void(const drogon::HttpResponsePtr&)>&&,
                  const std::string& orgSlug);

    void callback(const drogon::HttpRequestPtr&,
                  std::function<void(const drogon::HttpResponsePtr&)>&&,
                  const std::string& orgSlug);

private:
    struct OidcState {
        int         orgId;
        std::string nonce;
        std::chrono::steady_clock::time_point expiry;
    };

    std::mutex                                 stateMutex_;
    std::unordered_map<std::string, OidcState> pendingStates_;

    void        purgeExpiredStates();
    std::string generateRandom(int bytes = 32);
    std::string issueToken(int userId, const std::string& username, int orgId) const;
};
