#pragma once
#include <drogon/HttpController.h>

/**
 * MapController — tenant-scoped
 *
 * All routes are under /api/v1/tenants/{tenantId}/.
 * JwtFilter validates the bearer token.
 * TenantFilter validates membership and injects tenantRole.
 */
class MapController : public drogon::HttpController<MapController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(MapController::listMaps,
                      "/api/v1/tenants/{tenantId}/maps",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(MapController::createMap,
                      "/api/v1/tenants/{tenantId}/maps",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(MapController::getMap,
                      "/api/v1/tenants/{tenantId}/maps/{id}",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(MapController::updateMap,
                      "/api/v1/tenants/{tenantId}/maps/{id}",
                      drogon::Put, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(MapController::deleteMap,
                      "/api/v1/tenants/{tenantId}/maps/{id}",
                      drogon::Delete, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(MapController::listPermissions,
                      "/api/v1/tenants/{tenantId}/maps/{id}/permissions",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(MapController::setPermission,
                      "/api/v1/tenants/{tenantId}/maps/{id}/permissions",
                      drogon::Put, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(MapController::removePermission,
                      "/api/v1/tenants/{tenantId}/maps/{id}/permissions/{target}",
                      drogon::Delete, "JwtFilter", "TenantFilter", "RateLimitFilter");
    METHOD_LIST_END

    void listMaps(const drogon::HttpRequestPtr&,
                  std::function<void(const drogon::HttpResponsePtr&)>&&,
                  int tenantId);
    void createMap(const drogon::HttpRequestPtr&,
                   std::function<void(const drogon::HttpResponsePtr&)>&&,
                   int tenantId);
    void getMap(const drogon::HttpRequestPtr&,
                std::function<void(const drogon::HttpResponsePtr&)>&&,
                int tenantId, int id);
    void updateMap(const drogon::HttpRequestPtr&,
                   std::function<void(const drogon::HttpResponsePtr&)>&&,
                   int tenantId, int id);
    void deleteMap(const drogon::HttpRequestPtr&,
                   std::function<void(const drogon::HttpResponsePtr&)>&&,
                   int tenantId, int id);
    void listPermissions(const drogon::HttpRequestPtr&,
                         std::function<void(const drogon::HttpResponsePtr&)>&&,
                         int tenantId, int id);
    void setPermission(const drogon::HttpRequestPtr&,
                       std::function<void(const drogon::HttpResponsePtr&)>&&,
                       int tenantId, int id);
    void removePermission(const drogon::HttpRequestPtr&,
                          std::function<void(const drogon::HttpResponsePtr&)>&&,
                          int tenantId, int id, const std::string& target);
};
