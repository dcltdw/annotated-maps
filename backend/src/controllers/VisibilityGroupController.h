#pragma once
#include <drogon/HttpController.h>

/**
 * VisibilityGroupController — tenant-scoped CRUD + member management.
 *
 * GET    /api/v1/tenants/{tenantId}/visibility-groups
 * POST   /api/v1/tenants/{tenantId}/visibility-groups
 * GET    /api/v1/tenants/{tenantId}/visibility-groups/{id}
 * PUT    /api/v1/tenants/{tenantId}/visibility-groups/{id}
 * DELETE /api/v1/tenants/{tenantId}/visibility-groups/{id}
 *
 * GET    /api/v1/tenants/{tenantId}/visibility-groups/{id}/members
 * POST   /api/v1/tenants/{tenantId}/visibility-groups/{id}/members
 * DELETE /api/v1/tenants/{tenantId}/visibility-groups/{id}/members/{userId}
 *
 * Authorization: tenant admins always; plus any user who is a member of
 * a visibility group with manages_visibility = TRUE in the same tenant.
 *
 * One escalation guard: setting managesVisibility = true on a group
 * via PUT is admin-only — managers cannot bootstrap themselves into
 * more power.
 *
 * Body shapes:
 *   POST /visibility-groups       — { name, description?, managesVisibility? }
 *   PUT  /visibility-groups/{id}  — same, all optional
 *   POST /members                  — { userId }
 *
 * On registration of a new user (AuthController), a default
 * "Visibility Managers" group is auto-created with manages_visibility
 * = TRUE and the registering user as the sole member.
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
        ADD_METHOD_TO(VisibilityGroupController::listMembers,
                      "/api/v1/tenants/{tenantId}/visibility-groups/{id}/members",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(VisibilityGroupController::addMember,
                      "/api/v1/tenants/{tenantId}/visibility-groups/{id}/members",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(VisibilityGroupController::removeMember,
                      "/api/v1/tenants/{tenantId}/visibility-groups/{id}/members/{userId}",
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
    void listMembers(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int tenantId, int id);
    void addMember(const drogon::HttpRequestPtr&,
                   std::function<void(const drogon::HttpResponsePtr&)>&&,
                   int tenantId, int id);
    void removeMember(const drogon::HttpRequestPtr&,
                      std::function<void(const drogon::HttpResponsePtr&)>&&,
                      int tenantId, int id, int userId);
};
