#pragma once
#include <drogon/HttpController.h>

/**
 * NoteController — tenant-scoped
 *
 * GET    /api/v1/tenants/{tenantId}/maps/{mapId}/notes
 * POST   /api/v1/tenants/{tenantId}/maps/{mapId}/notes
 * GET    /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id}
 * PUT    /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id}
 * DELETE /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id}
 */
class NoteController : public drogon::HttpController<NoteController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(NoteController::listNotes,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/notes",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(NoteController::createNote,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/notes",
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
                   int tenantId, int mapId);
    void createNote(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int mapId);
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
