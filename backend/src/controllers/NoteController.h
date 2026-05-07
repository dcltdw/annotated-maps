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
 * GET    /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id}/visibility
 * POST   /api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id}/visibility
 *
 * Phase 2b.iii (#87) wires up visibility tagging + read-time filtering
 * for notes. Effective visibility for a note:
 *   1. If note.visibility_override = TRUE → use note_visibility rows.
 *   2. Else walk to the attached node and recurse up the node parent
 *      chain (same as #99) to its first override = TRUE ancestor; use
 *      that node's node_visibility rows.
 *   3. If no override anywhere up the chain → admin-only (empty set).
 *
 * Tenant admins bypass the filter; map owners with owner_xray = TRUE
 * see every note. Hidden notes return 404 (don't leak existence).
 *
 * POST /visibility body shape (same as nodes in #86):
 *   { override?: bool, groupIds?: number[] }
 *   - groupIds OMITTED → leave existing tags untouched.
 *   - groupIds PRESENT (even []) → replace the entire tag set.
 *   - All groupIds must belong to {tenantId}.
 *   - Tags are kept regardless of override flag (lean: keep them so
 *     they can re-activate when override is flipped back on).
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
        ADD_METHOD_TO(NoteController::getVisibility,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id}/visibility",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(NoteController::setVisibility,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/notes/{id}/visibility",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
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
    void getVisibility(const drogon::HttpRequestPtr&,
                       std::function<void(const drogon::HttpResponsePtr&)>&&,
                       int tenantId, int mapId, int id);
    void setVisibility(const drogon::HttpRequestPtr&,
                       std::function<void(const drogon::HttpResponsePtr&)>&&,
                       int tenantId, int mapId, int id);
};
