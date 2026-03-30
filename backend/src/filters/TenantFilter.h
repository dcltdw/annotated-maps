#pragma once
#include <drogon/HttpFilter.h>

/**
 * TenantFilter
 *
 * Enforces tenant membership for any route containing /tenants/{tenantId}/.
 *
 * Prerequisites: JwtFilter must have already run (injects "userId").
 *
 * On success:
 *   - Injects "tenantId"   (int)    into request attributes.
 *   - Injects "tenantRole" (string) into request attributes.
 *     Values: "admin" | "editor" | "viewer"
 *
 * Returns HTTP 403 if the caller is not a member of the tenant, or if the
 * tenantId cannot be parsed from the path.
 */
class TenantFilter : public drogon::HttpFilter<TenantFilter> {
public:
    void doFilter(const drogon::HttpRequestPtr& req,
                  drogon::FilterCallback&&      failCb,
                  drogon::FilterChainCallback&& nextCb) override;
};
