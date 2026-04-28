#pragma once
#include <drogon/HttpController.h>

/**
 * VisibilityGroupController — tenant-scoped, admin-only CRUD.
 *
 * GET    /api/v1/tenants/{tenantId}/visibility-groups
 * POST   /api/v1/tenants/{tenantId}/visibility-groups
 * GET    /api/v1/tenants/{tenantId}/visibility-groups/{id}
 * PUT    /api/v1/tenants/{tenantId}/visibility-groups/{id}
 * DELETE /api/v1/tenants/{tenantId}/visibility-groups/{id}
 *
 * Visibility groups are tenant-scoped, generic audiences. No GM/Player
 * baked in — each tenant defines its own. The `manages_visibility`
 * flag designates a group whose members can manage visibility groups
 * (used by Phase 2b.i.b's auth helper); for THIS phase, only tenant
 * admins can CRUD groups, regardless of the flag.
 *
 * Member management endpoints + the manages_visibility-based auth
 * helper + tenant-creation bootstrap arrive in Phase 2b.i.b (#98).
 *
 * Body shape:
 *   { "name": "...", "description": "...", "managesVisibility": false }
 *
 * `name` is unique per tenant (enforced via UNIQUE KEY (tenant_id, name)).
 */
class VisibilityGroupController : public drogon::HttpController<VisibilityGroupController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(VisibilityGroupController::listGroups,
                      "/api/v1/tenants/{tenantId}/visibility-groups",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(VisibilityGroupController::createGroup,
                      "/api/v1/tenants/{tenantId}/visibility-groups",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(VisibilityGroupController::getGroup,
                      "/api/v1/tenants/{tenantId}/visibility-groups/{id}",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(VisibilityGroupController::updateGroup,
                      "/api/v1/tenants/{tenantId}/visibility-groups/{id}",
                      drogon::Put, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(VisibilityGroupController::deleteGroup,
                      "/api/v1/tenants/{tenantId}/visibility-groups/{id}",
                      drogon::Delete, "JwtFilter", "TenantFilter", "RateLimitFilter");
    METHOD_LIST_END

    void listGroups(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId);
    void createGroup(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int tenantId);
    void getGroup(const drogon::HttpRequestPtr&,
                  std::function<void(const drogon::HttpResponsePtr&)>&&,
                  int tenantId, int id);
    void updateGroup(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int tenantId, int id);
    void deleteGroup(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int tenantId, int id);
};
