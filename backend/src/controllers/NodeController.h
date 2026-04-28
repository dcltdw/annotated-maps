#pragma once
#include <drogon/HttpController.h>

/**
 * NodeController — tenant-scoped, map-scoped
 *
 * GET    /api/v1/tenants/{tenantId}/maps/{mapId}/nodes
 * POST   /api/v1/tenants/{tenantId}/maps/{mapId}/nodes
 * GET    /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}
 * PUT    /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}
 * DELETE /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}
 *
 * Node = the central new abstraction in the nodes-rebuild model
 * (tree-structured place markers, replacing annotations + adding
 * hierarchy via parent_id). See #96 and the nodes-rebuild branch
 * for the full design.
 *
 * Visibility filtering is NOT applied at this phase (Phase 2a.i.b);
 * standard map permission gating is sufficient. Per-node visibility
 * filtering arrives in Phase 2b.ii (#86 + #99).
 */
class NodeController : public drogon::HttpController<NodeController> {
public:
    METHOD_LIST_BEGIN
        ADD_METHOD_TO(NodeController::listNodes,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(NodeController::createNode,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(NodeController::getNode,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(NodeController::updateNode,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}",
                      drogon::Put, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(NodeController::deleteNode,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}",
                      drogon::Delete, "JwtFilter", "TenantFilter", "RateLimitFilter");
    METHOD_LIST_END

    void listNodes(const drogon::HttpRequestPtr&,
                   std::function<void(const drogon::HttpResponsePtr&)>&&,
                   int tenantId, int mapId);
    void createNode(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int mapId);
    void getNode(const drogon::HttpRequestPtr&,
                 std::function<void(const drogon::HttpResponsePtr&)>&&,
                 int tenantId, int mapId, int id);
    void updateNode(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int mapId, int id);
    void deleteNode(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int mapId, int id);
};

// Maximum tree depth for node parent_id chains. Bounded so the
// recursive visibility CTE (Phase 2b.ii) and tree-navigation CTE
// (Phase 2d) don't blow up. Enforced at the application layer
// (MySQL CHECK can't easily express "walk up parent chain").
//
// Capped at 15 to stay within MySQL's default FK cascade-action
// nesting limit. Deleting a deeply nested root would otherwise hit
// "cascade nesting too deep" once descendants exceed that boundary.
inline constexpr int MAX_NODE_DEPTH = 15;
