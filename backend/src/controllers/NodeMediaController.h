#pragma once
#include <drogon/HttpController.h>

/**
 * NodeMediaController — media attachments on a node.
 *
 * GET    /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/media
 * POST   /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/media
 * PUT    /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/media/{id}
 * DELETE /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/media/{id}
 *
 * Body shape:
 *   { "mediaType": "image"|"link", "url": "https://...", "caption": "..." }
 *
 * URL scheme is validated (http/https only) — defense in depth against
 * stored-XSS via `javascript:` or `data:` URLs slipping through. The
 * frontend re-validates before rendering, but this is the canonical
 * server-side gate.
 *
 * Permission model: list/get inherit map view-access; create/update/
 * delete require map edit-access (or the node creator). Same rules as
 * NoteController. No visibility filtering at this phase.
 */
class NodeMediaController : public drogon::HttpController<NodeMediaController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(NodeMediaController::listMedia,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/media",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(NodeMediaController::addMedia,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/media",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(NodeMediaController::updateMedia,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/media/{id}",
                      drogon::Put, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(NodeMediaController::deleteMedia,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/media/{id}",
                      drogon::Delete, "JwtFilter", "TenantFilter", "RateLimitFilter");
    METHOD_LIST_END

    void listMedia(const drogon::HttpRequestPtr&,
                   std::function<void(const drogon::HttpResponsePtr&)>&&,
                   int tenantId, int mapId, int nodeId);
    void addMedia(const drogon::HttpRequestPtr&,
                  std::function<void(const drogon::HttpResponsePtr&)>&&,
                  int tenantId, int mapId, int nodeId);
    void updateMedia(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int tenantId, int mapId, int nodeId, int id);
    void deleteMedia(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int tenantId, int mapId, int nodeId, int id);
};
