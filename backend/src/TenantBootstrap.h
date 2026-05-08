#pragma once
#include <drogon/drogon.h>
#include <functional>

// TenantBootstrap (#218 / audit #46 L3)
// ─────────────────────────────────────
// Helper for seeding the default visibility-group state a new tenant
// needs to be functional. Until this helper, the bootstrap was inlined
// in AuthController::registerUser only — meaning out-of-band tenant
// provisioning paths (DB seed, future SSO-tenant-bootstrap, internal
// admin tools) silently shipped tenants with no "Visibility Managers"
// group, leaving non-admin members unable to delegate visibility-group
// management.
//
// What gets seeded (currently): one visibility_groups row named
// "Visibility Managers" with `manages_visibility = TRUE`, and one
// visibility_group_members row attaching `ownerUserId` to it.
//
// Async chain: INSERT visibility_groups → INSERT visibility_group_members
// → onSuccess(). Any failure short-circuits to onError(message).

namespace TenantBootstrap {

inline void seedDefaults(
    int tenantId,
    int ownerUserId,
    std::function<void()> onSuccess,
    std::function<void(const std::string&)> onError) {

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "INSERT INTO visibility_groups "
        "  (tenant_id, name, manages_visibility, created_by) "
        "VALUES (?, 'Visibility Managers', TRUE, ?)",
        [ownerUserId, onSuccess, onError]
        (const drogon::orm::Result& rvg) {
            int vgId = static_cast<int>(rvg.insertId());
            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "INSERT INTO visibility_group_members "
                "  (visibility_group_id, user_id) VALUES (?, ?)",
                [onSuccess](const drogon::orm::Result&) { onSuccess(); },
                [onError](const drogon::orm::DrogonDbException&) {
                    onError("Failed to add to default visibility group");
                },
                vgId, ownerUserId);
        },
        [onError](const drogon::orm::DrogonDbException&) {
            onError("Failed to bootstrap default visibility group");
        },
        tenantId, ownerUserId);
}

} // namespace TenantBootstrap
