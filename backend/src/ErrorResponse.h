#pragma once

// All controllers should include this header and use errorJson() /
// errorResponse() instead of defining their own local helpers or
// constructing error JSON inline. See docs/DEVELOPER-GUIDE.md.

#include <drogon/HttpResponse.h>
#include <json/json.h>
#include <string>

// Shared error JSON helper — returns {"error": code, "message": msg}
inline Json::Value errorJson(const std::string& code, const std::string& msg) {
    Json::Value v;
    v["error"]   = code;
    v["message"] = msg;
    return v;
}

// Convenience: build an error HTTP response in one call
inline drogon::HttpResponsePtr errorResponse(
    drogon::HttpStatusCode status,
    const std::string& code,
    const std::string& msg) {
    auto resp = drogon::HttpResponse::newHttpJsonResponse(errorJson(code, msg));
    resp->setStatusCode(status);
    return resp;
}

// ─── Input length limits ─────────────────────────────────────────────────────
// Server-side caps on user-supplied string fields. These are the ceiling the
// application enforces; the database columns are VARCHAR(255) for name-like
// fields and TEXT (64 KiB) for long-form content. Keeping app limits below
// DB limits avoids silent truncation.

inline constexpr size_t MAX_TITLE_LEN       = 255;
inline constexpr size_t MAX_NAME_LEN        = 255;
inline constexpr size_t MAX_DESCRIPTION_LEN = 10000;
inline constexpr size_t MAX_TEXT_LEN        = 10000;

// Returns true if `value.size() <= max`. If too long, sends a 400 response
// via `callback` (caller should `return` immediately on false). Use this at
// controller entry so oversized input is rejected before any DB work.
inline bool checkMaxLen(
    const std::string& fieldName,
    const std::string& value,
    size_t max,
    const std::function<void(const drogon::HttpResponsePtr&)>& callback) {
    if (value.size() > max) {
        callback(errorResponse(drogon::k400BadRequest, "bad_request",
            "Field '" + fieldName + "' exceeds maximum length (" +
            std::to_string(max) + " characters)"));
        return false;
    }
    return true;
}
