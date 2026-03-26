#pragma once
#include <drogon/HttpFilter.h>

/**
 * JwtFilter
 *
 * Validates the Bearer token in the Authorization header.
 * On success, injects "userId" and "username" into request attributes
 * so downstream controllers can read them without re-parsing the token.
 *
 * Returns HTTP 401 if the token is missing or invalid.
 */
class JwtFilter : public drogon::HttpFilter<JwtFilter> {
public:
    void doFilter(const drogon::HttpRequestPtr& req,
                  drogon::FilterCallback&&      failCb,
                  drogon::FilterChainCallback&& nextCb) override;
};
