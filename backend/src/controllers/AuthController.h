#pragma once
#include <drogon/HttpController.h>

/**
 * AuthController
 *
 * POST /api/v1/auth/register  — create account + personal org/tenant, return JWT
 * POST /api/v1/auth/login     — verify credentials (Argon2id), return JWT + tenant list
 * POST /api/v1/auth/refresh   — exchange valid token for fresh one
 * POST /api/v1/auth/logout    — (stateless JWT; client discards token)
 */
class AuthController : public drogon::HttpController<AuthController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(AuthController::registerUser,
                      "/api/v1/auth/register", drogon::Post, "RateLimitFilter");
        ADD_METHOD_TO(AuthController::login,
                      "/api/v1/auth/login",    drogon::Post, "RateLimitFilter");
        ADD_METHOD_TO(AuthController::refresh,
                      "/api/v1/auth/refresh",  drogon::Post, "JwtFilter");
        ADD_METHOD_TO(AuthController::logout,
                      "/api/v1/auth/logout",   drogon::Post, "JwtFilter");
    METHOD_LIST_END

    void registerUser(const drogon::HttpRequestPtr&,
                      std::function<void(const drogon::HttpResponsePtr&)>&&);

    void login(const drogon::HttpRequestPtr&,
               std::function<void(const drogon::HttpResponsePtr&)>&&);

    void refresh(const drogon::HttpRequestPtr&,
                 std::function<void(const drogon::HttpResponsePtr&)>&&);

    void logout(const drogon::HttpRequestPtr&,
                std::function<void(const drogon::HttpResponsePtr&)>&&);

private:
    std::string issueToken(int userId, const std::string& username, int orgId) const;
};
