#pragma once
#include <drogon/HttpController.h>

/**
 * AnnotationController — tenant-scoped
 *
 * GET    /api/v1/tenants/{tenantId}/maps/{mapId}/annotations
 * POST   /api/v1/tenants/{tenantId}/maps/{mapId}/annotations
 * GET    /api/v1/tenants/{tenantId}/maps/{mapId}/annotations/{id}
 * PUT    /api/v1/tenants/{tenantId}/maps/{mapId}/annotations/{id}
 * DELETE /api/v1/tenants/{tenantId}/maps/{mapId}/annotations/{id}
 * POST   /api/v1/tenants/{tenantId}/maps/{mapId}/annotations/{id}/media
 * DELETE /api/v1/tenants/{tenantId}/maps/{mapId}/annotations/{id}/media/{mediaId}
 */
class AnnotationController : public drogon::HttpController<AnnotationController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(AnnotationController::listAnnotations,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/annotations",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(AnnotationController::createAnnotation,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/annotations",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(AnnotationController::getAnnotation,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/annotations/{id}",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(AnnotationController::updateAnnotation,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/annotations/{id}",
                      drogon::Put, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(AnnotationController::deleteAnnotation,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/annotations/{id}",
                      drogon::Delete, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(AnnotationController::addMedia,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/annotations/{id}/media",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(AnnotationController::deleteMedia,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/annotations/{id}/media/{mediaId}",
                      drogon::Delete, "JwtFilter", "TenantFilter", "RateLimitFilter");
    METHOD_LIST_END

    void listAnnotations(const drogon::HttpRequestPtr&,
                         std::function<void(const drogon::HttpResponsePtr&)>&&,
                         int tenantId, int mapId);
    void createAnnotation(const drogon::HttpRequestPtr&,
                          std::function<void(const drogon::HttpResponsePtr&)>&&,
                          int tenantId, int mapId);
    void getAnnotation(const drogon::HttpRequestPtr&,
                       std::function<void(const drogon::HttpResponsePtr&)>&&,
                       int tenantId, int mapId, int id);
    void updateAnnotation(const drogon::HttpRequestPtr&,
                          std::function<void(const drogon::HttpResponsePtr&)>&&,
                          int tenantId, int mapId, int id);
    void deleteAnnotation(const drogon::HttpRequestPtr&,
                          std::function<void(const drogon::HttpResponsePtr&)>&&,
                          int tenantId, int mapId, int id);
    void addMedia(const drogon::HttpRequestPtr&,
                  std::function<void(const drogon::HttpResponsePtr&)>&&,
                  int tenantId, int mapId, int id);
    void deleteMedia(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int tenantId, int mapId, int id, int mediaId);
};
