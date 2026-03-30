#include "AuditLog.h"
#include <drogon/drogon.h>

namespace AuditLog {

static std::string clientIp(const drogon::HttpRequestPtr& req) {
    // Prefer X-Forwarded-For (leftmost entry) when behind a trusted proxy
    const std::string& xff = req->getHeader("X-Forwarded-For");
    if (!xff.empty()) {
        auto comma = xff.find(',');
        return comma != std::string::npos ? xff.substr(0, comma) : xff;
    }
    return req->getPeerAddr().toIp();
}

void record(const std::string& eventType,
            const drogon::HttpRequestPtr& req,
            int userId,
            int targetUserId,
            int tenantId,
            const Json::Value& detail) {

    std::string ip = clientIp(req);

    // Serialize detail to string (NULL if Json::nullValue)
    std::string detailStr;
    bool hasDetail = !detail.isNull();
    if (hasDetail) {
        Json::StreamWriterBuilder wb;
        detailStr = Json::writeString(wb, detail);
    }

    auto db = drogon::app().getDbClient();

    // Build SQL with conditional NULLs for the optional FK columns
    const std::string sql =
        "INSERT INTO audit_log (event_type, user_id, target_user_id, "
        "                       tenant_id, ip_address, detail) "
        "VALUES (?, "
        "        NULLIF(?, 0), "
        "        NULLIF(?, 0), "
        "        NULLIF(?, 0), "
        "        ?, ?)";

    db->execSqlAsync(
        sql,
        [](const drogon::orm::Result&) { /* success — nothing to do */ },
        [eventType](const drogon::orm::DrogonDbException& e) {
            LOG_ERROR << "Audit log insert failed (" << eventType
                      << "): " << e.base().what();
        },
        eventType, userId, targetUserId, tenantId, ip,
        hasDetail ? detailStr : std::string());
}

} // namespace AuditLog
