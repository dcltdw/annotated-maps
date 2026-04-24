#pragma once
#include <drogon/HttpController.h>

/**
 * NoteGroupController — tenant-scoped
 *
 * GET    /api/v1/tenants/{tenantId}/maps/{mapId}/note-groups
 * POST   /api/v1/tenants/{tenantId}/maps/{mapId}/note-groups
 * PUT    /api/v1/tenants/{tenantId}/maps/{mapId}/note-groups/{id}
 * DELETE /api/v1/tenants/{tenantId}/maps/{mapId}/note-groups/{id}
 */
class NoteGroupController : public drogon::HttpController<NoteGroupController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(NoteGroupController::listGroups,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/note-groups",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(NoteGroupController::createGroup,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/note-groups",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(NoteGroupController::updateGroup,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/note-groups/{id}",
                      drogon::Put, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(NoteGroupController::deleteGroup,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/note-groups/{id}",
                      drogon::Delete, "JwtFilter", "TenantFilter", "RateLimitFilter");
    METHOD_LIST_END

    void listGroups(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int mapId);
    void createGroup(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int tenantId, int mapId);
    void updateGroup(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int tenantId, int mapId, int id);
    void deleteGroup(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int tenantId, int mapId, int id);
};
