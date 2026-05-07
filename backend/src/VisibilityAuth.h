#pragma once

// Shared authorization helpers for visibility-group-gated endpoints.
//
// "Visibility-group manager" = tenant admin OR a member of any
// visibility_group with manages_visibility = TRUE in the same tenant.
// First introduced in VisibilityGroupController (#85 / #98); now also
// used by node and note tagging endpoints (#86 / #87 / #99).

#include "ErrorResponse.h"
#include <drogon/HttpRequest.h>
#include <drogon/HttpResponse.h>
#include <drogon/drogon.h>
#include <drogon/orm/Result.h>
#include <drogon/orm/Exception.h>
#include <functional>
#include <string>
#include <utility>

inline bool isTenantAdmin(const drogon::HttpRequestPtr& req) {
    try {
        return req->getAttributes()->get<std::string>("tenantRole") == "admin";
    } catch (...) { return false; }
}

// Sync-fast-path / async-DB-path authorization gate. On success, calls
// onAllowed(). On denial or DB error, sends a 403/500 via callback —
// caller should NOT also send a response on those paths.
inline void requireVisibilityGroupManager(
    const drogon::HttpRequestPtr& req,
    int tenantId,
    int userId,
    const std::function<void(const drogon::HttpResponsePtr&)>& callback,
    std::function<void()> onAllowed) {

    if (isTenantAdmin(req)) {
        onAllowed();
        return;
    }

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT 1 FROM visibility_group_members vgm "
        "JOIN visibility_groups vg ON vg.id = vgm.visibility_group_id "
        "WHERE vgm.user_id = ? AND vg.tenant_id = ? "
        "  AND vg.manages_visibility = TRUE LIMIT 1",
        [callback, onAllowed = std::move(onAllowed)]
        (const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(errorResponse(drogon::k403Forbidden,
                    "forbidden",
                    "Only tenant admins or visibility-group managers "
                    "can manage visibility tagging"));
                return;
            }
            onAllowed();
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to check authorization"));
        },
        userId, tenantId);
}
