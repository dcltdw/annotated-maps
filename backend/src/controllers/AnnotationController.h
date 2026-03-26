#pragma once
#include <drogon/HttpController.h>

/**
 * AnnotationController
 *
 * GET    /api/v1/maps/{mapId}/annotations           — list annotations
 * POST   /api/v1/maps/{mapId}/annotations           — create annotation
 * GET    /api/v1/maps/{mapId}/annotations/{id}      — get annotation
 * PUT    /api/v1/maps/{mapId}/annotations/{id}      — update annotation
 * DELETE /api/v1/maps/{mapId}/annotations/{id}      — delete annotation
 *
 * POST   /api/v1/maps/{mapId}/annotations/{id}/media     — attach media
 * DELETE /api/v1/maps/{mapId}/annotations/{id}/media/{mediaId} — remove media
 */
class AnnotationController : public drogon::HttpController<AnnotationController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(AnnotationController::listAnnotations,
                      "/api/v1/maps/{mapId}/annotations",
                      drogon::Get);
        ADD_METHOD_TO(AnnotationController::createAnnotation,
                      "/api/v1/maps/{mapId}/annotations",
                      drogon::Post, "JwtFilter");
        ADD_METHOD_TO(AnnotationController::getAnnotation,
                      "/api/v1/maps/{mapId}/annotations/{id}",
                      drogon::Get);
        ADD_METHOD_TO(AnnotationController::updateAnnotation,
                      "/api/v1/maps/{mapId}/annotations/{id}",
                      drogon::Put, "JwtFilter");
        ADD_METHOD_TO(AnnotationController::deleteAnnotation,
                      "/api/v1/maps/{mapId}/annotations/{id}",
                      drogon::Delete, "JwtFilter");
        ADD_METHOD_TO(AnnotationController::addMedia,
                      "/api/v1/maps/{mapId}/annotations/{id}/media",
                      drogon::Post, "JwtFilter");
        ADD_METHOD_TO(AnnotationController::deleteMedia,
                      "/api/v1/maps/{mapId}/annotations/{id}/media/{mediaId}",
                      drogon::Delete, "JwtFilter");
    METHOD_LIST_END

    void listAnnotations(const drogon::HttpRequestPtr&,
                         std::function<void(const drogon::HttpResponsePtr&)>&&,
                         int mapId);
    void createAnnotation(const drogon::HttpRequestPtr&,
                          std::function<void(const drogon::HttpResponsePtr&)>&&,
                          int mapId);
    void getAnnotation(const drogon::HttpRequestPtr&,
                       std::function<void(const drogon::HttpResponsePtr&)>&&,
                       int mapId, int id);
    void updateAnnotation(const drogon::HttpRequestPtr&,
                          std::function<void(const drogon::HttpResponsePtr&)>&&,
                          int mapId, int id);
    void deleteAnnotation(const drogon::HttpRequestPtr&,
                          std::function<void(const drogon::HttpResponsePtr&)>&&,
                          int mapId, int id);
    void addMedia(const drogon::HttpRequestPtr&,
                  std::function<void(const drogon::HttpResponsePtr&)>&&,
                  int mapId, int id);
    void deleteMedia(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int mapId, int id, int mediaId);
};
