#pragma once
#include <drogon/HttpController.h>

/**
 * NoteController — tenant-scoped, attached to a Node
 *
 * Notes attach to a node (no own coordinates). The list/create routes
 * nest under nodes; get/put/delete sit under maps because the note id
 * is globally unique within a map and we don't need the parent node id
 * to identify a note.
 *
 * GET    /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/notes
 * POST   /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/notes
 * GET    /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id}
 * PUT    /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id}
 * DELETE /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id}
 *
 * Visibility filtering arrives in Phase 2b.iii (#87). For now, standard
 * map view-access gates list/get; map edit-access (or note creator)
 * gates update/delete.
 */
class NoteController : public drogon::HttpController<NoteController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(NoteController::listNotes,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/notes",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(NoteController::createNote,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/notes",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(NoteController::getNote,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id}",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(NoteController::updateNote,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id}",
                      drogon::Put, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(NoteController::deleteNote,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id}",
                      drogon::Delete, "JwtFilter", "TenantFilter", "RateLimitFilter");
    METHOD_LIST_END

    void listNotes(const drogon::HttpRequestPtr&,
                   std::function<void(const drogon::HttpResponsePtr&)>&&,
                   int tenantId, int mapId, int nodeId);
    void createNote(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int mapId, int nodeId);
    void getNote(const drogon::HttpRequestPtr&,
                 std::function<void(const drogon::HttpResponsePtr&)>&&,
                 int tenantId, int mapId, int id);
    void updateNote(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int mapId, int id);
    void deleteNote(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int mapId, int id);
};
