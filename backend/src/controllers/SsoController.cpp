#include "SsoController.h"
#include "AuditLog.h"
#include "ErrorResponse.h"
#include <drogon/drogon.h>
#include <jwt-cpp/jwt.h>
#include <openssl/rand.h>
#include <sstream>
#include <iomanip>
#include <chrono>

// ─── Utilities ────────────────────────────────────────────────────────────────

std::string SsoController::generateRandom(int bytes) {
    std::vector<unsigned char> buf(bytes);
    // RAND_bytes returns 1 on success, 0 if not seeded, -1 if unsupported.
    // Without this check, a failed RNG leaves `buf` zero-initialized and
    // produces a predictable state/nonce, defeating SSO CSRF and replay
    // defenses.
    if (RAND_bytes(buf.data(), bytes) != 1) {
        throw std::runtime_error("RAND_bytes failed — cannot generate SSO random value");
    }
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

void SsoController::purgeExpiredAppCodes() {
    auto now = std::chrono::steady_clock::now();
    std::lock_guard<std::mutex> lock(codeMutex_);
    for (auto it = pendingAppCodes_.begin(); it != pendingAppCodes_.end();) {
        if (it->second.expiry < now) it = pendingAppCodes_.erase(it);
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
                callback(errorResponse(drogon::k400BadRequest,
                    "bad_request", "SSO is not available"));
                return;
            }

            int orgId = r[0]["org_id"].as<int>();
            Json::Value ssoConfig;
            Json::Reader reader;
            reader.parse(r[0]["config"].as<std::string>(), ssoConfig);

            std::string authEndpoint = ssoConfig["authorization_endpoint"].asString();
            std::string clientId     = ssoConfig["client_id"].asString();
            std::string redirectUri  = ssoConfig["redirect_uri"].asString();

            std::string state, nonce;
            try {
                state = generateRandom(16);
                nonce = generateRandom(16);
            } catch (const std::exception&) {
                callback(errorResponse(drogon::k500InternalServerError,
                    "server_error", "SSO is not available"));
                return;
            }

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
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Database error during SSO initiation"));
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
        callback(errorResponse(drogon::k400BadRequest,
            "sso_error", "IdP returned error: " + error));
        return;
    }

    if (code.empty() || state.empty()) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "code and state are required"));
        return;
    }

    OidcState savedState;
    {
        std::lock_guard<std::mutex> lock(stateMutex_);
        auto it = pendingStates_.find(state);
        if (it == pendingStates_.end() ||
            it->second.expiry < std::chrono::steady_clock::now()) {
            callback(errorResponse(drogon::k400BadRequest,
                "invalid_state", "SSO state is invalid or expired"));
            return;
        }
        savedState = it->second;
        pendingStates_.erase(it);
    }

    int orgId = savedState.orgId;
    std::string expectedNonce = savedState.nonce;

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT s.config FROM sso_providers s WHERE s.org_id = ? LIMIT 1",
        [this, callback, req, code, orgId, expectedNonce](const drogon::orm::Result& r) {
            if (r.empty()) {
                callback(errorResponse(drogon::k404NotFound,
                    "not_found", "SSO provider config not found"));
                return;
            }

            Json::Value ssoConfig;
            Json::Reader reader;
            reader.parse(r[0]["config"].as<std::string>(), ssoConfig);

            std::string tokenEndpoint    = ssoConfig["token_endpoint"].asString();
            std::string userinfoEndpoint = ssoConfig["userinfo_endpoint"].asString();
            std::string clientId         = ssoConfig["client_id"].asString();
            std::string redirectUri      = ssoConfig["redirect_uri"].asString();

            // H5: client_secret is read from SSO_CLIENT_SECRET_<ORG_ID> env var,
            // never from the database. See docs/DEVELOPER-GUIDE.md.
            std::string secretEnv = "SSO_CLIENT_SECRET_" + std::to_string(orgId);
            const char* clientSecretPtr = std::getenv(secretEnv.c_str());
            if (!clientSecretPtr || std::string(clientSecretPtr).empty()) {
                callback(errorResponse(drogon::k500InternalServerError,
                    "server_error", "SSO is not available"));
                return;
            }
            std::string clientSecret = clientSecretPtr;

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
                [this, callback, req, orgId, userinfoEndpoint, expectedNonce]
                (drogon::ReqResult result, const drogon::HttpResponsePtr& tokenResp) {
                    if (result != drogon::ReqResult::Ok) {
                        callback(errorResponse(drogon::k502BadGateway,
                            "sso_error", "Failed to contact IdP token endpoint"));
                        return;
                    }

                    Json::Value tokenData;
                    Json::Reader reader;
                    reader.parse(std::string(tokenResp->getBody()), tokenData);

                    if (!tokenData.isMember("access_token")) {
                        callback(errorResponse(drogon::k502BadGateway,
                            "sso_error", "No access_token in IdP response"));
                        return;
                    }

                    // M1: verify the ID token's `nonce` claim matches what we
                    // generated at initiate. This protects against token replay
                    // where an attacker reuses a previously-captured ID token
                    // (the nonce is generated fresh per-flow and only known to
                    // the IdP via the original authorize redirect).
                    //
                    // We decode the JWT locally without signature verification.
                    // The signature would require fetching the IdP's JWKS;
                    // sufficient for nonce checking is that the value matches
                    // what we sent — an attacker forging an ID token would not
                    // know our generated nonce.
                    if (!tokenData.isMember("id_token")) {
                        callback(errorResponse(drogon::k502BadGateway,
                            "sso_error", "No id_token in IdP response"));
                        return;
                    }
                    try {
                        auto decoded = jwt::decode(tokenData["id_token"].asString());
                        if (!decoded.has_payload_claim("nonce")) {
                            callback(errorResponse(drogon::k400BadRequest,
                                "invalid_nonce", "ID token missing nonce claim"));
                            return;
                        }
                        std::string idTokenNonce =
                            decoded.get_payload_claim("nonce").as_string();
                        if (idTokenNonce != expectedNonce) {
                            callback(errorResponse(drogon::k400BadRequest,
                                "invalid_nonce", "ID token nonce does not match"));
                            return;
                        }
                    } catch (const std::exception&) {
                        callback(errorResponse(drogon::k400BadRequest,
                            "invalid_nonce", "Failed to parse ID token"));
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
                                callback(errorResponse(drogon::k502BadGateway,
                                    "sso_error", "Failed to contact IdP userinfo endpoint"));
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
                                callback(errorResponse(drogon::k502BadGateway,
                                    "sso_error", "IdP did not return a subject claim"));
                                return;
                            }

                            // M4: SELECT-then-INSERT-or-UPDATE rather than blind
                            // upsert. If a user already exists with this
                            // (org_id, external_id) and a different email, an
                            // IdP subject-ID collision is possible (against
                            // OIDC spec but observed in practice) — fail closed
                            // and log so an admin can investigate.
                            auto db = drogon::app().getDbClient();
                            db->execSqlAsync(
                                "SELECT id, email FROM users "
                                "WHERE org_id=? AND external_id=? LIMIT 1",
                                [this, callback, req, orgId, username, email, externalId]
                                (const drogon::orm::Result& existing) {
                                    if (!existing.empty()) {
                                        int existingId = existing[0]["id"].as<int>();
                                        std::string existingEmail =
                                            existing[0]["email"].isNull() ? ""
                                            : existing[0]["email"].as<std::string>();

                                        if (!existingEmail.empty() && !email.empty() &&
                                            existingEmail != email) {
                                            // Email change on SSO-linked account.
                                            // Audit the rejection so an admin can
                                            // investigate and reconcile manually.
                                            Json::Value detail;
                                            detail["existingEmail"] = existingEmail;
                                            detail["incomingEmail"] = email;
                                            detail["externalId"]    = externalId;
                                            AuditLog::record("sso_identity_collision",
                                                req, existingId, 0, 0, detail);
                                            callback(errorResponse(drogon::k409Conflict,
                                                "identity_collision",
                                                "SSO account email changed; admin must reconcile"));
                                            return;
                                        }

                                        // Same email or no change — refresh username,
                                        // then proceed with the existing user id.
                                        auto db2 = drogon::app().getDbClient();
                                        db2->execSqlAsync(
                                            "UPDATE users SET username=? WHERE id=?",
                                            [this, callback, req, orgId, existingId, username]
                                            (const drogon::orm::Result&) {
                                                this->purgeExpiredAppCodes();
                                                this->postIssueAppCode(callback, req, existingId, username, orgId);
                                            },
                                            [callback](const drogon::orm::DrogonDbException&) {
                                                callback(errorResponse(
                                                    drogon::k500InternalServerError,
                                                    "db_error", "Failed to update SSO user"));
                                            },
                                            username, existingId);
                                        return;
                                    }

                                    // New user — INSERT.
                                    auto db3 = drogon::app().getDbClient();
                                    db3->execSqlAsync(
                                        "INSERT INTO users (username, email, org_id, external_id) "
                                        "VALUES (?,?,?,?)",
                                        [this, callback, req, orgId, username]
                                        (const drogon::orm::Result& ins) {
                                            int newId = static_cast<int>(ins.insertId());
                                            this->purgeExpiredAppCodes();
                                            this->postIssueAppCode(callback, req, newId, username, orgId);
                                        },
                                        [callback](const drogon::orm::DrogonDbException&) {
                                            callback(errorResponse(
                                                drogon::k500InternalServerError,
                                                "db_error", "Failed to create SSO user"));
                                        },
                                        username, email, orgId, externalId);
                                },
                                [callback](const drogon::orm::DrogonDbException&) {
                                    callback(errorResponse(drogon::k500InternalServerError,
                                        "db_error", "Failed to look up SSO user"));
                                },
                                orgId, externalId);
                        });
                });
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to load SSO provider config"));
        },
        orgId);
}

// Helper used by both the existing-user-update and new-user-insert paths
// in callback(). Issues a JWT, stores it under a one-time app code with a
// 2-minute TTL, and redirects the browser to the frontend's
// /sso/callback?code=... URL.
void SsoController::postIssueAppCode(
    std::function<void(const drogon::HttpResponsePtr&)> callback,
    const drogon::HttpRequestPtr& req,
    int userId, const std::string& username, int orgId) {

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT t.id AS tenant_id "
        "FROM tenant_members tm "
        "JOIN tenants t ON t.id = tm.tenant_id "
        "WHERE tm.user_id = ? AND t.org_id = ? "
        "ORDER BY tm.created_at ASC LIMIT 1",
        [this, callback, req, userId, username, orgId]
        (const drogon::orm::Result& r2) {
            int tenantId = r2.empty() ? 0 : r2[0]["tenant_id"].as<int>();
            AuditLog::record("sso_login", req, userId);
            std::string token = issueToken(userId, username, orgId);

            std::string appCode;
            try {
                appCode = generateRandom(32);
            } catch (const std::exception&) {
                callback(errorResponse(drogon::k500InternalServerError,
                    "server_error", "SSO is not available"));
                return;
            }

            {
                std::lock_guard<std::mutex> lock(codeMutex_);
                pendingAppCodes_[appCode] = {
                    token, tenantId,
                    std::chrono::steady_clock::now() + std::chrono::minutes(2)
                };
            }

            const auto& cfg = drogon::app().getCustomConfig();
            std::string frontendUrl =
                cfg.get("frontend_url", "http://localhost:5173").asString();
            std::string location =
                frontendUrl + "/sso/callback?code=" + appCode;

            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setStatusCode(drogon::k302Found);
            resp->addHeader("Location", location);
            callback(resp);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            callback(errorResponse(drogon::k500InternalServerError,
                "db_error", "Failed to load tenant info"));
        },
        userId, orgId);
}

// ─── POST /api/v1/auth/sso/exchange ───────────────────────────────────────────

void SsoController::exchange(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback) {

    auto body = req->getJsonObject();
    if (!body || !(*body).isMember("code")) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "code is required"));
        return;
    }

    std::string code = (*body)["code"].asString();
    if (code.empty()) {
        callback(errorResponse(drogon::k400BadRequest,
            "bad_request", "code is required"));
        return;
    }

    AppCode found;
    bool ok = false;
    {
        std::lock_guard<std::mutex> lock(codeMutex_);
        auto it = pendingAppCodes_.find(code);
        if (it != pendingAppCodes_.end() &&
            it->second.expiry >= std::chrono::steady_clock::now()) {
            found = it->second;
            ok = true;
        }
        // Always erase if found, even if expired — one-time use.
        if (it != pendingAppCodes_.end()) pendingAppCodes_.erase(it);
    }
    purgeExpiredAppCodes();

    if (!ok) {
        callback(errorResponse(drogon::k400BadRequest,
            "invalid_code", "SSO code is invalid or expired"));
        return;
    }

    Json::Value resp;
    resp["token"]    = found.token;
    resp["tenantId"] = found.tenantId;
    callback(drogon::HttpResponse::newHttpJsonResponse(resp));
}
