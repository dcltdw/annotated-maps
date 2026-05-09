#pragma once
#include <drogon/HttpController.h>

/**
 * EdgeController — graph layer alongside the existing node tree (#148).
 *
 * Edges connect two nodes within the same map for relational use cases
 * (trade routes, ferry connections, quest dependencies). Tree structure
 * (parent_id) stays for containment; edges layer in for "A connects to B."
 *
 * This sub-ticket lands the schema + unfiltered CRUD. Visibility filtering
 * (edge is visible iff BOTH endpoints are visible) lands in #197.
 *
 * Edge CRUD:
 *   GET    /api/v1/tenants/{tenantId}/maps/{mapId}/edges
 *   POST   /api/v1/tenants/{tenantId}/maps/{mapId}/edges
 *   GET    /api/v1/tenants/{tenantId}/maps/{mapId}/edges/{id}
 *   PUT    /api/v1/tenants/{tenantId}/maps/{mapId}/edges/{id}
 *   DELETE /api/v1/tenants/{tenantId}/maps/{mapId}/edges/{id}
 *
 * Per-node edge listing (used by NodeDetailPanel in #200):
 *   GET    /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/edges
 *
 * Authorization:
 *   - Read: any tenant member with view access on the map.
 *   - Write: tenant admin/editor with edit access on the map.
 *
 * Body shapes:
 *   POST /edges — { sourceNodeId, destNodeId, directed?, color?,
 *                   label?, description? }
 *   PUT  /edges/{id} — { directed?, color?, label?, description? }
 *                       (endpoints are immutable; create a new edge to
 *                        re-target — keeps audit semantics simple)
 *
 * Constraints:
 *   - Both sourceNodeId and destNodeId must belong to {mapId}; cross-map
 *     edges are out of scope for v1 (#148 design decision).
 *   - sourceNodeId != destNodeId enforced by DB CHECK.
 *   - Duplicate edges (same source/dest/directed) are intentionally
 *     allowed — represent distinct trade routes, ferry runs, etc.
 *
 * POST/PUT both return the full canonical record (per §4b — frontend
 * Zod schema parses the response without a follow-up GET).
 */
class EdgeController : public drogon::HttpController<EdgeController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(EdgeController::listEdges,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/edges",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(EdgeController::createEdge,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/edges",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(EdgeController::getEdge,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/edges/{id}",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(EdgeController::updateEdge,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/edges/{id}",
                      drogon::Put, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(EdgeController::deleteEdge,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/edges/{id}",
                      drogon::Delete, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(EdgeController::listEdgesForNode,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{nodeId}/edges",
                      drogon::Get, "JwtFilter", "TenantFilter");
    METHOD_LIST_END

    void listEdges(const drogon::HttpRequestPtr&,
                   std::function<void(const drogon::HttpResponsePtr&)>&&,
                   int tenantId, int mapId);
    void createEdge(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int mapId);
    void getEdge(const drogon::HttpRequestPtr&,
                 std::function<void(const drogon::HttpResponsePtr&)>&&,
                 int tenantId, int mapId, int id);
    void updateEdge(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int mapId, int id);
    void deleteEdge(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int mapId, int id);
    void listEdgesForNode(const drogon::HttpRequestPtr&,
                          std::function<void(const drogon::HttpResponsePtr&)>&&,
                          int tenantId, int mapId, int nodeId);
};
