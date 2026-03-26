#pragma once
#include <drogon/HttpController.h>

/**
 * MapController
 *
 * GET    /api/v1/maps              — list maps visible to caller (public + own)
 * POST   /api/v1/maps              — create map (auth required)
 * GET    /api/v1/maps/{id}         — get map detail (respects permissions)
 * PUT    /api/v1/maps/{id}         — update map metadata (owner only)
 * DELETE /api/v1/maps/{id}         — delete map (owner only)
 *
 * GET    /api/v1/maps/{id}/permissions      — list permissions (owner only)
 * PUT    /api/v1/maps/{id}/permissions      — set a permission (owner only)
 * DELETE /api/v1/maps/{id}/permissions/{target} — remove permission (owner only)
 */
class MapController : public drogon::HttpController<MapController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(MapController::listMaps,
                      "/api/v1/maps",        drogon::Get);
        ADD_METHOD_TO(MapController::createMap,
                      "/api/v1/maps",        drogon::Post, "JwtFilter");
        ADD_METHOD_TO(MapController::getMap,
                      "/api/v1/maps/{id}",   drogon::Get);
        ADD_METHOD_TO(MapController::updateMap,
                      "/api/v1/maps/{id}",   drogon::Put,    "JwtFilter");
        ADD_METHOD_TO(MapController::deleteMap,
                      "/api/v1/maps/{id}",   drogon::Delete, "JwtFilter");
        ADD_METHOD_TO(MapController::listPermissions,
                      "/api/v1/maps/{id}/permissions",         drogon::Get,    "JwtFilter");
        ADD_METHOD_TO(MapController::setPermission,
                      "/api/v1/maps/{id}/permissions",         drogon::Put,    "JwtFilter");
        ADD_METHOD_TO(MapController::removePermission,
                      "/api/v1/maps/{id}/permissions/{target}",drogon::Delete, "JwtFilter");
    METHOD_LIST_END

    void listMaps(const drogon::HttpRequestPtr&,
                  std::function<void(const drogon::HttpResponsePtr&)>&&);
    void createMap(const drogon::HttpRequestPtr&,
                   std::function<void(const drogon::HttpResponsePtr&)>&&);
    void getMap(const drogon::HttpRequestPtr&,
                std::function<void(const drogon::HttpResponsePtr&)>&&,
                int id);
    void updateMap(const drogon::HttpRequestPtr&,
                   std::function<void(const drogon::HttpResponsePtr&)>&&,
                   int id);
    void deleteMap(const drogon::HttpRequestPtr&,
                   std::function<void(const drogon::HttpResponsePtr&)>&&,
                   int id);
    void listPermissions(const drogon::HttpRequestPtr&,
                         std::function<void(const drogon::HttpResponsePtr&)>&&,
                         int id);
    void setPermission(const drogon::HttpRequestPtr&,
                       std::function<void(const drogon::HttpResponsePtr&)>&&,
                       int id);
    void removePermission(const drogon::HttpRequestPtr&,
                          std::function<void(const drogon::HttpResponsePtr&)>&&,
                          int id, const std::string& target);
};
