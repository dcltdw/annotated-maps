#include "SsoController.h"
#include "AuditLog.h"
#include <drogon/drogon.h>
#include <jwt-cpp/jwt.h>
#include <openssl/rand.h>
#include <sstream>
#include <iomanip>
#include <chrono>

// ─── Utilities ────────────────────────────────────────────────────────────────

std::string SsoController::generateRandom(int bytes) {
    std::vector<unsigned char> buf(bytes);
    RAND_bytes(buf.data(), bytes);
    std::ostringstream oss;
    for (auto b : buf)
        oss << std::hex << std::setw(2) << std::setfill('0') << (int)b;
    return oss.str();
}

void SsoController::purgeExpiredStates() {
    auto now = std::chrono::steady_clock::now();
    std::lock_guard<std::mutex> lock(stateMutex_);
    for (auto it = pendingStates_.begin(); it != pendingStates_.end();) {
        if (it->second.expiry < now) it = pendingStates_.erase(it);
        else ++it;
    }
}

std::string SsoController::issueToken(int userId, const std::string& username,
                                      int orgId) const {
    const auto& cfg = drogon::app().getCustomConfig()["jwt"];
    const std::string secret = cfg["secret"].asString();
    const std::string issuer = cfg["issuer"].asString();
    const int         ttl    = cfg["access_token_ttl_seconds"].asInt();

    auto now = std::chrono::system_clock::now();
    return jwt::create()
        .set_issuer(issuer)
        .set_audience("annotated-maps")
        .set_subject(std::to_string(userId))
        .set_payload_claim("username", jwt::claim(username))
        .set_payload_claim("orgId",    jwt::claim(std::to_string(orgId)))
        .set_issued_at(now)
        .set_expires_at(now + std::chrono::seconds(ttl))
        .sign(jwt::algorithm::hs256{secret});
}

// ─── GET /api/v1/auth/sso/{orgSlug} ──────────────────────────────────────────

void SsoController::initiate(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    const std::string& orgSlug) {

    (void)req;
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT o.id AS org_id, s.config "
        "FROM organizations o "
        "JOIN sso_providers s ON s.org_id = o.id "
        "WHERE o.slug = ? LIMIT 1",
        [this, callback, orgSlug](const drogon::orm::Result& r) {
            if (r.empty()) {
                Json::Value body;
                body["error"]   = "bad_request";
                body["message"] = "SSO is not available";
                auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
                resp->setStatusCode(drogon::k400BadRequest);
                callback(resp);
                return;
            }

            int orgId = r[0]["org_id"].as<int>();
            Json::Value ssoConfig;
            Json::Reader reader;
            reader.parse(r[0]["config"].as<std::string>(), ssoConfig);

            std::string authEndpoint = ssoConfig["authorization_endpoint"].asString();
            std::string clientId     = ssoConfig["client_id"].asString();
            std::string redirectUri  = ssoConfig["redirect_uri"].asString();

            std::string state = generateRandom(16);
            std::string nonce = generateRandom(16);

            {
                std::lock_guard<std::mutex> lock(stateMutex_);
                pendingStates_[state] = {
                    orgId, nonce,
                    std::chrono::steady_clock::now() + std::chrono::minutes(10)
                };
            }
            purgeExpiredStates();

            std::string location =
                authEndpoint +
                "?response_type=code" +
                "&client_id="    + clientId +
                "&redirect_uri=" + redirectUri +
                "&scope=openid%20email%20profile" +
                "&state="        + state +
                "&nonce="        + nonce;

            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k302Found);
            resp->addHeader("Location", location);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            Json::Value body;
            body["error"]   = "db_error";
            body["message"] = "Database error during SSO initiation";
            auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        orgSlug);
}

// ─── GET /api/v1/auth/sso/{orgSlug}/callback ─────────────────────────────────

void SsoController::callback(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback,
    const std::string& orgSlug) {

    (void)orgSlug;
    std::string code  = req->getParameter("code");
    std::string state = req->getParameter("state");
    std::string error = req->getParameter("error");

    if (!error.empty()) {
        Json::Value body;
        body["error"]   = "sso_error";
        body["message"] = "IdP returned error: " + error;
        auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    if (code.empty() || state.empty()) {
        Json::Value body;
        body["error"]   = "bad_request";
        body["message"] = "code and state are required";
        auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    OidcState savedState;
    {
        std::lock_guard<std::mutex> lock(stateMutex_);
        auto it = pendingStates_.find(state);
        if (it == pendingStates_.end() ||
            it->second.expiry < std::chrono::steady_clock::now()) {
            Json::Value body;
            body["error"]   = "invalid_state";
            body["message"] = "SSO state is invalid or expired";
            auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
            resp->setStatusCode(drogon::k400BadRequest);
            callback(resp);
            return;
        }
        savedState = it->second;
        pendingStates_.erase(it);
    }

    int orgId = savedState.orgId;

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT s.config FROM sso_providers s WHERE s.org_id = ? LIMIT 1",
        [this, callback, req, code, orgId](const drogon::orm::Result& r) {
            if (r.empty()) {
                Json::Value body;
                body["error"]   = "not_found";
                body["message"] = "SSO provider config not found";
                auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
                resp->setStatusCode(drogon::k404NotFound);
                callback(resp);
                return;
            }

            Json::Value ssoConfig;
            Json::Reader reader;
            reader.parse(r[0]["config"].as<std::string>(), ssoConfig);

            std::string tokenEndpoint    = ssoConfig["token_endpoint"].asString();
            std::string userinfoEndpoint = ssoConfig["userinfo_endpoint"].asString();
            std::string clientId         = ssoConfig["client_id"].asString();
            std::string clientSecret     = ssoConfig["client_secret"].asString();
            std::string redirectUri      = ssoConfig["redirect_uri"].asString();

            std::string tokenBody =
                "grant_type=authorization_code"
                "&code=" + code +
                "&redirect_uri=" + redirectUri +
                "&client_id=" + clientId +
                "&client_secret=" + clientSecret;

            // Parse scheme+host from token endpoint
            std::string scheme = "https", host, tokenPath;
            {
                std::string ep = tokenEndpoint;
                size_t sep = ep.find("://");
                if (sep != std::string::npos) { scheme = ep.substr(0, sep); ep = ep.substr(sep + 3); }
                size_t sl = ep.find('/');
                if (sl != std::string::npos) { host = ep.substr(0, sl); tokenPath = ep.substr(sl); }
                else { host = ep; tokenPath = "/"; }
            }

            auto tokenClient = drogon::HttpClient::newHttpClient(scheme + "://" + host);
            auto tokenReq    = drogon::HttpRequest::newHttpRequest();
            tokenReq->setMethod(drogon::Post);
            tokenReq->setPath(tokenPath);
            tokenReq->setBody(tokenBody);
            tokenReq->addHeader("Content-Type", "application/x-www-form-urlencoded");

            tokenClient->sendRequest(
                tokenReq,
                [this, callback, req, orgId, userinfoEndpoint]
                (drogon::ReqResult result, const drogon::HttpResponsePtr& tokenResp) {
                    if (result != drogon::ReqResult::Ok) {
                        Json::Value body;
                        body["error"]   = "sso_error";
                        body["message"] = "Failed to contact IdP token endpoint";
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
                        resp->setStatusCode(drogon::k502BadGateway);
                        callback(resp);
                        return;
                    }

                    Json::Value tokenData;
                    Json::Reader reader;
                    reader.parse(std::string(tokenResp->getBody()), tokenData);

                    if (!tokenData.isMember("access_token")) {
                        Json::Value body;
                        body["error"]   = "sso_error";
                        body["message"] = "No access_token in IdP response";
                        auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
                        resp->setStatusCode(drogon::k502BadGateway);
                        callback(resp);
                        return;
                    }

                    std::string accessToken = tokenData["access_token"].asString();

                    // Parse userinfo endpoint
                    std::string scheme2 = "https", host2, uiPath;
                    {
                        std::string ep = userinfoEndpoint;
                        size_t sep = ep.find("://");
                        if (sep != std::string::npos) { scheme2 = ep.substr(0, sep); ep = ep.substr(sep + 3); }
                        size_t sl = ep.find('/');
                        if (sl != std::string::npos) { host2 = ep.substr(0, sl); uiPath = ep.substr(sl); }
                        else { host2 = ep; uiPath = "/"; }
                    }

                    auto uiClient = drogon::HttpClient::newHttpClient(scheme2 + "://" + host2);
                    auto uiReq    = drogon::HttpRequest::newHttpRequest();
                    uiReq->setMethod(drogon::Get);
                    uiReq->setPath(uiPath);
                    uiReq->addHeader("Authorization", "Bearer " + accessToken);

                    uiClient->sendRequest(
                        uiReq,
                        [this, callback, req, orgId]
                        (drogon::ReqResult result2, const drogon::HttpResponsePtr& uiResp) {
                            if (result2 != drogon::ReqResult::Ok) {
                                Json::Value body;
                                body["error"]   = "sso_error";
                                body["message"] = "Failed to contact IdP userinfo endpoint";
                                auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
                                resp->setStatusCode(drogon::k502BadGateway);
                                callback(resp);
                                return;
                            }

                            Json::Value uiData;
                            Json::Reader reader;
                            reader.parse(std::string(uiResp->getBody()), uiData);

                            std::string externalId = uiData.get("sub",   "").asString();
                            std::string email      = uiData.get("email", "").asString();
                            std::string username   = uiData.get("preferred_username",
                                uiData.get("name", email).asString()).asString();

                            if (externalId.empty()) {
                                Json::Value body;
                                body["error"]   = "sso_error";
                                body["message"] = "IdP did not return a subject claim";
                                auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
                                resp->setStatusCode(drogon::k502BadGateway);
                                callback(resp);
                                return;
                            }

                            auto db = drogon::app().getDbClient();
                            db->execSqlAsync(
                                "INSERT INTO users (username, email, org_id, external_id) "
                                "VALUES (?,?,?,?) "
                                "ON DUPLICATE KEY UPDATE "
                                "  username=VALUES(username), "
                                "  email=VALUES(email), "
                                "  id=LAST_INSERT_ID(id)",
                                [this, callback, req, orgId, username]
                                (const drogon::orm::Result& r) {
                                    int userId = static_cast<int>(r.insertId());

                                    auto db2 = drogon::app().getDbClient();
                                    db2->execSqlAsync(
                                        "SELECT t.id AS tenant_id "
                                        "FROM tenant_members tm "
                                        "JOIN tenants t ON t.id = tm.tenant_id "
                                        "WHERE tm.user_id = ? AND t.org_id = ? "
                                        "ORDER BY tm.created_at ASC LIMIT 1",
                                        [this, callback, req, orgId, userId, username]
                                        (const drogon::orm::Result& r2) {
                                            int tenantId = r2.empty() ? 0 : r2[0]["tenant_id"].as<int>();
                                            AuditLog::record("sso_login", req, userId);
                                            std::string token = issueToken(userId, username, orgId);

                                            const auto& cfg = drogon::app().getCustomConfig();
                                            std::string frontendUrl =
                                                cfg.get("frontend_url", "http://localhost:5173").asString();
                                            std::string location =
                                                frontendUrl + "/sso/callback#token=" + token +
                                                "&tenantId=" + std::to_string(tenantId);

                                            auto resp = drogon::HttpResponse::newHttpResponse();
                                            resp->setStatusCode(drogon::k302Found);
                                            resp->addHeader("Location", location);
                                            callback(resp);
                                        },
                                        [callback](const drogon::orm::DrogonDbException&) {
                                            Json::Value body;
                                            body["error"]   = "db_error";
                                            body["message"] = "Failed to load tenant info";
                                            auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
                                            resp->setStatusCode(drogon::k500InternalServerError);
                                            callback(resp);
                                        },
                                        userId, orgId);
                                },
                                [callback](const drogon::orm::DrogonDbException&) {
                                    Json::Value body;
                                    body["error"]   = "db_error";
                                    body["message"] = "Failed to upsert SSO user";
                                    auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
                                    resp->setStatusCode(drogon::k500InternalServerError);
                                    callback(resp);
                                },
                                username, email, orgId, externalId);
                        });
                });
        },
        [callback](const drogon::orm::DrogonDbException&) {
            Json::Value body;
            body["error"]   = "db_error";
            body["message"] = "Failed to load SSO provider config";
            auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        orgId);
}
