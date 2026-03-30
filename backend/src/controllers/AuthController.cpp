#include "AuthController.h"
#include <drogon/drogon.h>
#include <jwt-cpp/jwt.h>
#include <sodium.h>
#include <chrono>

// ─── Helpers ──────────────────────────────────────────────────────────────────

static Json::Value errorJson(const std::string& code, const std::string& msg) {
    Json::Value v;
    v["error"]   = code;
    v["message"] = msg;
    return v;
}

static std::string hashPassword(const std::string& password) {
    char hashed[crypto_pwhash_STRBYTES];
    if (crypto_pwhash_str(hashed, password.c_str(), password.size(),
                          crypto_pwhash_OPSLIMIT_INTERACTIVE,
                          crypto_pwhash_MEMLIMIT_INTERACTIVE) != 0) {
        throw std::runtime_error("Argon2id hashing failed (out of memory?)");
    }
    return std::string(hashed);
}

// Returns true if password matches the stored Argon2id hash.
// Rejects legacy SHA-256 hashes (64-char hex, no leading '$').
static bool verifyPassword(const std::string& password,
                            const std::string& storedHash) {
    if (storedHash.empty() || storedHash[0] != '$') {
        return false;
    }
    return crypto_pwhash_str_verify(
               storedHash.c_str(), password.c_str(), password.size()) == 0;
}

// ─── Token issuance ───────────────────────────────────────────────────────────

std::string AuthController::issueToken(int userId, const std::string& username,
                                       int orgId) const {
    const auto& cfg = drogon::app().getCustomConfig()["jwt"];
    const std::string secret = cfg["secret"].asString();
    const std::string issuer = cfg["issuer"].asString();
    const int         ttl    = cfg["access_token_ttl_seconds"].asInt();

    auto now = std::chrono::system_clock::now();
    return jwt::create()
        .set_issuer(issuer)
        .set_subject(std::to_string(userId))
        .set_payload_claim("username", jwt::claim(username))
        .set_payload_claim("orgId",    jwt::claim(std::to_string(orgId)))
        .set_issued_at(now)
        .set_expires_at(now + std::chrono::seconds(ttl))
        .sign(jwt::algorithm::hs256{secret});
}

// ─── POST /api/v1/auth/register ───────────────────────────────────────────────

void AuthController::registerUser(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback) {

    auto body = req->getJsonObject();
    if (!body || !(*body)["username"] || !(*body)["email"] || !(*body)["password"]) {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "username, email, and password are required"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    const std::string username = (*body)["username"].asString();
    const std::string email    = (*body)["email"].asString();

    std::string pwHash;
    try {
        pwHash = hashPassword((*body)["password"].asString());
    } catch (...) {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("server_error", "Failed to hash password"));
        resp->setStatusCode(drogon::k500InternalServerError);
        callback(resp);
        return;
    }

    // Step 1: Create personal organization (slug = username)
    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "INSERT INTO organizations (name, slug) VALUES (?,?)",
        [callback, username, email, pwHash, this](const drogon::orm::Result& r) {
            int orgId = static_cast<int>(r.insertId());

            // Step 2: Create personal tenant
            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "INSERT INTO tenants (org_id, name, slug) VALUES (?,?,?)",
                [callback, username, email, pwHash, orgId, this]
                (const drogon::orm::Result& r2) {
                    int tenantId = static_cast<int>(r2.insertId());

                    // Step 3: Insert user with org_id
                    auto db3 = drogon::app().getDbClient();
                    db3->execSqlAsync(
                        "INSERT INTO users (username, email, password_hash, org_id) "
                        "VALUES (?,?,?,?)",
                        [callback, username, email, orgId, tenantId, this]
                        (const drogon::orm::Result& r3) {
                            int newId = static_cast<int>(r3.insertId());

                            // Step 4: Add to tenant as admin
                            auto db4 = drogon::app().getDbClient();
                            db4->execSqlAsync(
                                "INSERT INTO tenant_members (tenant_id, user_id, role) "
                                "VALUES (?,?,?)",
                                [callback, newId, username, email, orgId, tenantId, this]
                                (const drogon::orm::Result&) {
                                    std::string token = issueToken(newId, username, orgId);

                                    Json::Value tenant;
                                    tenant["id"]   = tenantId;
                                    tenant["name"] = "Personal";
                                    tenant["slug"] = "personal";
                                    tenant["role"] = "admin";

                                    Json::Value tenants(Json::arrayValue);
                                    tenants.append(tenant);

                                    Json::Value resp;
                                    resp["user"]["id"]       = newId;
                                    resp["user"]["username"] = username;
                                    resp["user"]["email"]    = email;
                                    resp["token"]            = token;
                                    resp["orgId"]            = orgId;
                                    resp["tenantId"]         = tenantId;
                                    resp["tenants"]          = tenants;

                                    auto httpResp =
                                        drogon::HttpResponse::newHttpJsonResponse(resp);
                                    httpResp->setStatusCode(drogon::k201Created);
                                    callback(httpResp);
                                },
                                [callback](const drogon::orm::DrogonDbException&) {
                                    auto resp = drogon::HttpResponse::newHttpJsonResponse(
                                        errorJson("db_error", "Failed to assign tenant membership"));
                                    resp->setStatusCode(drogon::k500InternalServerError);
                                    callback(resp);
                                },
                                tenantId, newId, "admin");
                        },
                        [callback](const drogon::orm::DrogonDbException& e) {
                            std::string err = e.base().what();
                            bool dup = err.find("Duplicate") != std::string::npos;
                            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                                errorJson(dup ? "conflict" : "db_error",
                                          dup ? "Email or username already exists"
                                              : "Database error"));
                            resp->setStatusCode(dup ? drogon::k409Conflict
                                                    : drogon::k500InternalServerError);
                            callback(resp);
                        },
                        username, email, pwHash, orgId);
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(
                        errorJson("db_error", "Failed to create personal tenant"));
                    resp->setStatusCode(drogon::k500InternalServerError);
                    callback(resp);
                },
                orgId, "Personal", "personal");
        },
        [callback](const drogon::orm::DrogonDbException& e) {
            std::string err = e.base().what();
            bool dup = err.find("Duplicate") != std::string::npos;
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson(dup ? "conflict" : "db_error",
                          dup ? "Username already exists" : "Database error"));
            resp->setStatusCode(dup ? drogon::k409Conflict
                                    : drogon::k500InternalServerError);
            callback(resp);
        },
        username, username);
}

// ─── POST /api/v1/auth/login ──────────────────────────────────────────────────

void AuthController::login(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback) {

    auto body = req->getJsonObject();
    if (!body || !(*body)["email"] || !(*body)["password"]) {
        auto resp = drogon::HttpResponse::newHttpJsonResponse(
            errorJson("bad_request", "email and password are required"));
        resp->setStatusCode(drogon::k400BadRequest);
        callback(resp);
        return;
    }

    const std::string email    = (*body)["email"].asString();
    const std::string password = (*body)["password"].asString();

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT id, username, email, password_hash, "
        "       COALESCE(org_id, 0) AS org_id "
        "FROM users WHERE email=? LIMIT 1",
        [callback, password, this](const drogon::orm::Result& r) {
            if (r.empty()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("unauthorized", "Invalid email or password"));
                resp->setStatusCode(drogon::k401Unauthorized);
                callback(resp);
                return;
            }

            std::string storedHash = r[0]["password_hash"].isNull()
                ? "" : r[0]["password_hash"].as<std::string>();

            if (!verifyPassword(password, storedHash)) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("unauthorized", "Invalid email or password"));
                resp->setStatusCode(drogon::k401Unauthorized);
                callback(resp);
                return;
            }

            int         userId    = r[0]["id"].as<int>();
            std::string username  = r[0]["username"].as<std::string>();
            std::string userEmail = r[0]["email"].as<std::string>();
            int         orgId     = r[0]["org_id"].as<int>();

            auto db2 = drogon::app().getDbClient();
            db2->execSqlAsync(
                "SELECT t.id, t.name, t.slug, tm.role "
                "FROM tenant_members tm "
                "JOIN tenants t ON t.id = tm.tenant_id "
                "WHERE tm.user_id = ? ORDER BY tm.created_at ASC",
                [this, callback, userId, username, userEmail, orgId]
                (const drogon::orm::Result& r2) {
                    std::string token = issueToken(userId, username, orgId);

                    Json::Value tenants(Json::arrayValue);
                    int firstTenantId = 0;
                    for (const auto& row : r2) {
                        Json::Value t;
                        t["id"]   = row["id"].as<int>();
                        t["name"] = row["name"].as<std::string>();
                        t["slug"] = row["slug"].as<std::string>();
                        t["role"] = row["role"].as<std::string>();
                        if (firstTenantId == 0) firstTenantId = row["id"].as<int>();
                        tenants.append(t);
                    }

                    Json::Value resp;
                    resp["user"]["id"]       = userId;
                    resp["user"]["username"] = username;
                    resp["user"]["email"]    = userEmail;
                    resp["token"]            = token;
                    resp["orgId"]            = orgId;
                    resp["tenantId"]         = firstTenantId;
                    resp["tenants"]          = tenants;

                    callback(drogon::HttpResponse::newHttpJsonResponse(resp));
                },
                [callback](const drogon::orm::DrogonDbException&) {
                    auto resp = drogon::HttpResponse::newHttpJsonResponse(
                        errorJson("db_error", "Failed to fetch tenant info"));
                    resp->setStatusCode(drogon::k500InternalServerError);
                    callback(resp);
                },
                userId);
        },
        [callback](const drogon::orm::DrogonDbException&) {
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Database error"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        email);
}

// ─── POST /api/v1/auth/refresh ────────────────────────────────────────────────

void AuthController::refresh(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback) {

    int         userId   = req->getAttributes()->get<int>("userId");
    std::string username = req->getAttributes()->get<std::string>("username");
    int         orgId    = 0;
    try { orgId = req->getAttributes()->get<int>("orgId"); } catch (...) {}

    Json::Value resp;
    resp["token"] = issueToken(userId, username, orgId);
    callback(drogon::HttpResponse::newHttpJsonResponse(resp));
}

// ─── POST /api/v1/auth/logout ─────────────────────────────────────────────────

void AuthController::logout(
    const drogon::HttpRequestPtr&,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    auto resp = drogon::HttpResponse::newHttpResponse();
    resp->setStatusCode(drogon::k204NoContent);
    callback(resp);
}
