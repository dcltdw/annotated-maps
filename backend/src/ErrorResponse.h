#pragma once

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
