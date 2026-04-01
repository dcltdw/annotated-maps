#include "AuditLog.h"
#include <drogon/drogon.h>
#include <atomic>

namespace AuditLog {

static std::atomic<uint64_t> sFailureCount{0};
static std::atomic<uint64_t> sSuccessCount{0};

uint64_t failureCount() { return sFailureCount.load(); }
uint64_t successCount() { return sSuccessCount.load(); }

static std::string clientIp(const drogon::HttpRequestPtr& req) {
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

    // Serialize detail to JSON string, or "null" for SQL NULL
    std::string detailStr;
    bool hasDetail = !detail.isNull();
    if (hasDetail) {
        Json::StreamWriterBuilder wb;
        detailStr = Json::writeString(wb, detail);
    }

    auto db = drogon::app().getDbClient();

    if (hasDetail) {
        db->execSqlAsync(
            "INSERT INTO audit_log (event_type, user_id, target_user_id, "
            "                       tenant_id, ip_address, detail) "
            "VALUES (?, NULLIF(?, 0), NULLIF(?, 0), NULLIF(?, 0), ?, ?)",
            [](const drogon::orm::Result&) { ++sSuccessCount; },
            [eventType](const drogon::orm::DrogonDbException& e) {
                ++sFailureCount;
                LOG_ERROR << "Audit log insert failed (" << eventType
                          << "): " << e.base().what()
                          << " [total failures: " << sFailureCount.load() << "]";
            },
            eventType, userId, targetUserId, tenantId, ip, detailStr);
    } else {
        db->execSqlAsync(
            "INSERT INTO audit_log (event_type, user_id, target_user_id, "
            "                       tenant_id, ip_address, detail) "
            "VALUES (?, NULLIF(?, 0), NULLIF(?, 0), NULLIF(?, 0), ?, NULL)",
            [](const drogon::orm::Result&) { ++sSuccessCount; },
            [eventType](const drogon::orm::DrogonDbException& e) {
                ++sFailureCount;
                LOG_ERROR << "Audit log insert failed (" << eventType
                          << "): " << e.base().what()
                          << " [total failures: " << sFailureCount.load() << "]";
            },
            eventType, userId, targetUserId, tenantId, ip);
    }
}

} // namespace AuditLog
