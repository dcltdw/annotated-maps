#pragma once
#include <drogon/HttpController.h>

/**
 * PlotController — tenant-scoped narrative grouping (Phase 2c, #88).
 *
 * A plot is a story-arc grouping: it ties together places (nodes) and
 * content (notes) across one or more maps within a single tenant. Two
 * parallel junction tables (`plot_nodes`, `plot_notes`) hold the
 * membership; CASCADE works naturally on either side.
 *
 * Plot CRUD:
 *   GET    /api/v1/tenants/{tenantId}/plots
 *   POST   /api/v1/tenants/{tenantId}/plots
 *   GET    /api/v1/tenants/{tenantId}/plots/{id}
 *   PUT    /api/v1/tenants/{tenantId}/plots/{id}
 *   DELETE /api/v1/tenants/{tenantId}/plots/{id}
 *
 * Membership:
 *   GET    /api/v1/tenants/{tenantId}/plots/{id}/members
 *   POST   /api/v1/tenants/{tenantId}/plots/{id}/nodes
 *   DELETE /api/v1/tenants/{tenantId}/plots/{id}/nodes/{nodeId}
 *   POST   /api/v1/tenants/{tenantId}/plots/{id}/notes
 *   DELETE /api/v1/tenants/{tenantId}/plots/{id}/notes/{noteId}
 *
 * Authorization:
 *   - Read endpoints: any tenant member (TenantFilter enforces).
 *   - Write endpoints (create/update/delete plot, attach/detach members):
 *     tenant role must be admin or editor.
 *
 * Plot membership respects node/note visibility: GET /members filters out
 * members the caller can't see, using the same effective-visibility CTEs
 * from #99 (nodes) and #87 (notes), adapted to walk only the plot's
 * members rather than every node on a map.
 *
 * Body shapes:
 *   POST /plots         — { name, description? }
 *   PUT  /plots/{id}    — { name?, description? } (all optional)
 *   POST /nodes         — { nodeId }
 *   POST /notes         — { noteId }
 *
 * Idempotency: POST /nodes and POST /notes use INSERT IGNORE — re-attaching
 * an already-attached member is a no-op (returns 201 either way).
 */
class PlotController : public drogon::HttpController<PlotController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(PlotController::listPlots,
                      "/api/v1/tenants/{tenantId}/plots",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(PlotController::createPlot,
                      "/api/v1/tenants/{tenantId}/plots",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(PlotController::getPlot,
                      "/api/v1/tenants/{tenantId}/plots/{id}",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(PlotController::updatePlot,
                      "/api/v1/tenants/{tenantId}/plots/{id}",
                      drogon::Put, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(PlotController::deletePlot,
                      "/api/v1/tenants/{tenantId}/plots/{id}",
                      drogon::Delete, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(PlotController::listMembers,
                      "/api/v1/tenants/{tenantId}/plots/{id}/members",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(PlotController::addNode,
                      "/api/v1/tenants/{tenantId}/plots/{id}/nodes",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(PlotController::removeNode,
                      "/api/v1/tenants/{tenantId}/plots/{id}/nodes/{nodeId}",
                      drogon::Delete, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(PlotController::addNote,
                      "/api/v1/tenants/{tenantId}/plots/{id}/notes",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(PlotController::removeNote,
                      "/api/v1/tenants/{tenantId}/plots/{id}/notes/{noteId}",
                      drogon::Delete, "JwtFilter", "TenantFilter", "RateLimitFilter");
    METHOD_LIST_END

    void listPlots(const drogon::HttpRequestPtr&,
                   std::function<void(const drogon::HttpResponsePtr&)>&&,
                   int tenantId);
    void createPlot(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId);
    void getPlot(const drogon::HttpRequestPtr&,
                 std::function<void(const drogon::HttpResponsePtr&)>&&,
                 int tenantId, int id);
    void updatePlot(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int id);
    void deletePlot(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int id);
    void listMembers(const drogon::HttpRequestPtr&,
                     std::function<void(const drogon::HttpResponsePtr&)>&&,
                     int tenantId, int id);
    void addNode(const drogon::HttpRequestPtr&,
                 std::function<void(const drogon::HttpResponsePtr&)>&&,
                 int tenantId, int id);
    void removeNode(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int id, int nodeId);
    void addNote(const drogon::HttpRequestPtr&,
                 std::function<void(const drogon::HttpResponsePtr&)>&&,
                 int tenantId, int id);
    void removeNote(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int id, int noteId);
};
