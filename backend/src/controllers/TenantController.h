#pragma once
#include <drogon/HttpController.h>

/**
 * TenantController
 *
 * GET    /api/v1/tenants                           — list caller's tenants
 * GET    /api/v1/tenants/{tenantId}/branding       — get branding (any member)
 * PUT    /api/v1/tenants/{tenantId}/branding       — update branding (admin only)
 * GET    /api/v1/tenants/{tenantId}/members        — list members (admin only)
 * POST   /api/v1/tenants/{tenantId}/members        — add member (admin only)
 * DELETE /api/v1/tenants/{tenantId}/members/{uid}  — remove member (admin only)
 */
class TenantController : public drogon::HttpController<TenantController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(TenantController::listTenants,
                      "/api/v1/tenants",
                      drogon::Get, "JwtFilter");
        ADD_METHOD_TO(TenantController::getBranding,
                      "/api/v1/tenants/{tenantId}/branding",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(TenantController::updateBranding,
                      "/api/v1/tenants/{tenantId}/branding",
                      drogon::Put, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(TenantController::listMembers,
                      "/api/v1/tenants/{tenantId}/members",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(TenantController::addMember,
                      "/api/v1/tenants/{tenantId}/members",
                      drogon::Post, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(TenantController::removeMember,
                      "/api/v1/tenants/{tenantId}/members/{userId}",
                      drogon::Delete, "JwtFilter", "TenantFilter");
    METHOD_LIST_END

    void listTenants(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&);

    void getBranding(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int tenantId);

    void updateBranding(const drogon::HttpRequestPtr&,
                        std::function<void(const drogon::HttpResponsePtr&)>&&,
                        int tenantId);

    void listMembers(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int tenantId);

    void addMember(const drogon::HttpRequestPtr&,
                   std::function<void(const drogon::HttpResponsePtr&)>&&,
                   int tenantId);

    void removeMember(const drogon::HttpRequestPtr&,
                      std::function<void(const drogon::HttpResponsePtr&)>&&,
                      int tenantId, int userId);
};
