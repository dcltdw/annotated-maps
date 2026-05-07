#pragma once
#include <drogon/HttpController.h>

/**
 * NoteMediaController — media attachments on a note.
 *
 * GET    /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/media
 * POST   /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/media
 * PUT    /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/media/{id}
 * DELETE /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/media/{id}
 *
 * Mirror of NodeMediaController, swapping node→note in the URL and
 * SQL joins. See that file for the body shape, scheme validation,
 * and permission rules — they're identical.
 */
class NoteMediaController : public drogon::HttpController<NoteMediaController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(NoteMediaController::listMedia,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/media",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(NoteMediaController::addMedia,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/media",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(NoteMediaController::updateMedia,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/media/{id}",
                      drogon::Put, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(NoteMediaController::deleteMedia,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/notes/{noteId}/media/{id}",
                      drogon::Delete, "JwtFilter", "TenantFilter", "RateLimitFilter");
    METHOD_LIST_END

    void listMedia(const drogon::HttpRequestPtr&,
                   std::function<void(const drogon::HttpResponsePtr&)>&&,
                   int tenantId, int mapId, int noteId);
    void addMedia(const drogon::HttpRequestPtr&,
                  std::function<void(const drogon::HttpResponsePtr&)>&&,
                  int tenantId, int mapId, int noteId);
    void updateMedia(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int tenantId, int mapId, int noteId, int id);
    void deleteMedia(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int tenantId, int mapId, int noteId, int id);
};
