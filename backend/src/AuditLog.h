#pragma once
#include <drogon/HttpRequest.h>
#include <json/json.h>
#include <string>

/**
 * AuditLog — fire-and-forget audit event recorder.
 *
 * Inserts a row into the `audit_log` table asynchronously.
 * Failures are logged via LOG_ERROR but never propagate to the caller.
 */
namespace AuditLog {

void record(const std::string& eventType,
            const drogon::HttpRequestPtr& req,
            int userId        = 0,
            int targetUserId  = 0,
            int tenantId      = 0,
            const Json::Value& detail = Json::nullValue);

} // namespace AuditLog
