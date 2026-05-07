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
 * GET    /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}/visibility
 * POST   /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}/visibility
 *
 * GET    /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}/children
 * GET    /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}/subtree
 *
 * POST   /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}/move
 * POST   /api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}/copy
 *
 * Node = the central new abstraction in the nodes-rebuild model
 * (tree-structured place markers, replacing annotations + adding
 * hierarchy via parent_id). See #96 and the nodes-rebuild branch
 * for the full design.
 *
 * Per-node visibility tagging (set/get) lands in Phase 2b.ii.a (#86):
 * stored state only; effective inheritance + filtering lands in #99.
 * Authorization for the visibility endpoints uses VisibilityAuth.h's
 * requireVisibilityGroupManager (tenant admin OR manages_visibility
 * group member).
 *
 * POST /visibility body shape:
 *   { override?: bool, groupIds?: number[] }
 *   - override and groupIds are independently authoritative.
 *   - groupIds OMITTED → leave existing tags untouched.
 *   - groupIds PRESENT (even if []) → replace the entire tag set.
 *   - All groupIds must belong to {tenantId}.
 *   - Tags are kept regardless of override flag — flipping override
 *     to FALSE doesn't drop the rows. (Inheritance treats override
 *     = FALSE as "ignore my own tags, walk up parent_id"; the rows
 *     remain ready to re-activate.)
 *
 * Copy (Phase 2e.b, #100):
 *   - POST /copy — recursively duplicate a node + its subtree with new
 *     ids. Body: { newParentId: null | int, newMapId: null | int }.
 *     - Each duplicated node has created_by = caller and a fresh
 *       created_at; map_id = destination map; parent_id is rewired to
 *       point at the copy of its (already-copied) parent so the in-copy
 *       parent-child relationships mirror the source's.
 *     - node_visibility rows are NOT copied; visibility_override resets
 *       to FALSE on every copy. The user re-tags the copy explicitly.
 *     - plot_nodes memberships are NOT copied; the user re-attaches if
 *       desired.
 *     - Notes attached to copied nodes are duplicated too — new ids,
 *       reset created_by/created_at, no note_visibility carry-over.
 *     - Cross-tenant copy requires admin in BOTH source and destination
 *       tenants (same rule as move).
 *     - No cycle check needed (the copies have new ids; placing the
 *       copy under the source or its descendants is valid).
 *     - Audit event: node_copy with descendantCount.
 *
 * Move (Phase 2e.a, #90):
 *   - POST /move — re-parent and/or relocate a node and its full subtree.
 *     Body: { newParentId: null | int, newMapId: null | int }.
 *     - Same-map re-parent: change parent_id only; visibility tags +
 *       plot memberships preserved (parent chain shifts but groups
 *       stay valid).
 *     - Cross-map (same tenant): update map_id on source + descendants;
 *       drop their node_visibility rows (inheritance chain semantics
 *       changed); plot memberships preserved (plots are tenant-scoped).
 *     - Cross-tenant: requires admin in BOTH source and destination
 *       tenants. Drops both node_visibility rows AND plot_nodes
 *       memberships on source + descendants.
 *     - Cycle prevention: rejects when newParentId is in source's
 *       subtree (or equals source itself).
 *     - Notes follow their nodes (note.node_id stays the same;
 *       no note_visibility cleanup needed since note inheritance
 *       walks through its node, which moved with consistent semantics).
 *     - Audit event: node_move with descendantCount.
 *
 * Tree navigation (Phase 2d, #89):
 *   - GET /children — direct children only. Same shape as
 *     `GET /nodes?parentId=N`; visibility filter applies.
 *   - GET /subtree  — recursive descent from the starting node, with
 *     a `depth` field on each entry (0 = the starting node). The
 *     recursion only descends into visible nodes, so a hidden
 *     ancestor severs its own visible descendants from the response
 *     (no gaps that would leak hidden-node existence).
 *     Returns 404 if the starting node is hidden from the caller.
 *     Pagination: ?limit=N&cursor=<lastId>. Default limit 100, max 500.
 *     Response shape: { nodes: [{...node fields..., depth}], nextCursor: int|null }.
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
        ADD_METHOD_TO(NodeController::getVisibility,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}/visibility",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(NodeController::setVisibility,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}/visibility",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(NodeController::listChildren,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}/children",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(NodeController::getSubtree,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}/subtree",
                      drogon::Get, "JwtFilter", "TenantFilter");
        ADD_METHOD_TO(NodeController::moveNode,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}/move",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
        ADD_METHOD_TO(NodeController::copyNode,
                      "/api/v1/tenants/{tenantId}/maps/{mapId}/nodes/{id}/copy",
                      drogon::Post, "JwtFilter", "TenantFilter", "RateLimitFilter");
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
    void getVisibility(const drogon::HttpRequestPtr&,
                       std::function<void(const drogon::HttpResponsePtr&)>&&,
                       int tenantId, int mapId, int id);
    void setVisibility(const drogon::HttpRequestPtr&,
                       std::function<void(const drogon::HttpResponsePtr&)>&&,
                       int tenantId, int mapId, int id);
    void listChildren(const drogon::HttpRequestPtr&,
                      std::function<void(const drogon::HttpResponsePtr&)>&&,
                      int tenantId, int mapId, int id);
    void getSubtree(const drogon::HttpRequestPtr&,
                    std::function<void(const drogon::HttpResponsePtr&)>&&,
                    int tenantId, int mapId, int id);
    void moveNode(const drogon::HttpRequestPtr&,
                  std::function<void(const drogon::HttpResponsePtr&)>&&,
                  int tenantId, int mapId, int id);
    void copyNode(const drogon::HttpRequestPtr&,
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
