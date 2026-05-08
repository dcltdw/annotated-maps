#include "AuthController.h"
#include "AuditLog.h"
#include "ErrorResponse.h"
#include "../TenantBootstrap.h"
#include <drogon/drogon.h>
#include <jwt-cpp/jwt.h>
#include <sodium.h>
#include <chrono>
#include <cstdlib>
#include <cstring>

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Argon2id cost parameters. Configurable via environment:
//   ARGON2_OPSLIMIT  — iteration count (default: MIN = 1)
//   ARGON2_MEMLIMIT  — memory in bytes (default: MIN = 8 MiB)
//
// Defaults are MIN-safe for local dev on x86_64-on-ARM emulation, where
// INTERACTIVE (4 iter, 64 MiB) hangs. Production deployments MUST set
// these to at least INTERACTIVE: ARGON2_OPSLIMIT=4, ARGON2_MEMLIMIT=67108864.
// See docs/DEVELOPER-GUIDE.md.
static unsigned long long getArgon2OpsLimit() {
    const char* env = std::getenv("ARGON2_OPSLIMIT");
    if (env && std::strlen(env) > 0) {
        try { return std::stoull(env); } catch (...) {}
    }
    return crypto_pwhash_OPSLIMIT_MIN;
}

static size_t getArgon2MemLimit() {
    const char* env = std::getenv("ARGON2_MEMLIMIT");
    if (env && std::strlen(env) > 0) {
        try { return std::stoull(env); } catch (...) {}
    }
    return crypto_pwhash_MEMLIMIT_MIN;
}

static std::string hashPassword(const std::string& password) {
    char hashed[crypto_pwhash_STRBYTES];
    if (crypto_pwhash_str(hashed, password.c_str(), password.size(),
                          getArgon2OpsLimit(),
                          getArgon2MemLimit()) != 0) {
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
        .set_audience("annotated-maps")
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

    // #230 / audit #46 H1: wrap the 6-step new-account flow (org +
    // tenant + user + tenant_members + org_members + bootstrap) in a
    // single transaction. Pre-fix, a failure mid-chain left an orphan
    // org/tenant/user with no membership rows, requiring DB cleanup.
    //
    // Response handling: a `responded` flag gates callback so it's
    // called exactly once. Inner error handlers call respond(...) with
    // the appropriate status (preserving 409 differentiation for
    // username/email duplicates), then trans->rollback(). The success
    // path runs from setCommitCallback after commit confirms.
    auto responded = std::make_shared<bool>(false);
    auto respondOnce =
        [callback, responded](const drogon::HttpResponsePtr& r) {
            if (*responded) return;
            *responded = true;
            callback(r);
        };
    auto respondErr =
        [respondOnce](const std::string& code, const std::string& msg,
                      drogon::HttpStatusCode status) {
            auto r = drogon::HttpResponse::newHttpJsonResponse(
                errorJson(code, msg));
            r->setStatusCode(status);
            respondOnce(r);
        };

    auto db = drogon::app().getDbClient();
    db->newTransactionAsync(
        [callback, respondOnce, respondErr, req, username, email, pwHash, this]
        (const std::shared_ptr<drogon::orm::Transaction>& trans) {

        if (!trans) {
            respondErr("db_error", "Failed to begin transaction",
                       drogon::k500InternalServerError);
            return;
        }

        // Captured into the commit callback. Audit + JWT + JSON response
        // all run after the transaction's writes are durable.
        auto resultIds = std::make_shared<std::tuple<int,int,int>>(0,0,0);  // (orgId, tenantId, userId)

        trans->setCommitCallback(
            [respondOnce, req, username, email, resultIds, this]
            (bool committed) {
                if (!committed) {
                    // Explicit error responses are sent inline from the
                    // failing handler via respondErr; no-op here. (If
                    // the trans rolled back without an explicit handler
                    // firing, fall through to a generic 500.)
                    auto fallback = drogon::HttpResponse::newHttpJsonResponse(
                        errorJson("db_error", "Transaction failed to commit"));
                    fallback->setStatusCode(drogon::k500InternalServerError);
                    respondOnce(fallback);
                    return;
                }
                int orgId    = std::get<0>(*resultIds);
                int tenantId = std::get<1>(*resultIds);
                int newId    = std::get<2>(*resultIds);
                AuditLog::record("register", req, newId);
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
                respondOnce(httpResp);
            });

        // Step 1: Create personal organization (slug = username)
        trans->execSqlAsync(
            "INSERT INTO organizations (name, slug) VALUES (?,?)",
            [trans, username, email, pwHash, respondErr, resultIds]
            (const drogon::orm::Result& r) {
            int orgId = static_cast<int>(r.insertId());
            std::get<0>(*resultIds) = orgId;

            // Step 2: Create personal tenant
            trans->execSqlAsync(
                "INSERT INTO tenants (org_id, name, slug) VALUES (?,?,?)",
                [trans, username, email, pwHash, orgId, respondErr, resultIds]
                (const drogon::orm::Result& r2) {
                int tenantId = static_cast<int>(r2.insertId());
                std::get<1>(*resultIds) = tenantId;

                // Step 3: Insert user with org_id
                trans->execSqlAsync(
                    "INSERT INTO users (username, email, password_hash, org_id) "
                    "VALUES (?,?,?,?)",
                    [trans, orgId, tenantId, respondErr, resultIds]
                    (const drogon::orm::Result& r3) {
                    int newId = static_cast<int>(r3.insertId());
                    std::get<2>(*resultIds) = newId;

                    // Step 4: Add to tenant as admin
                    trans->execSqlAsync(
                        "INSERT INTO tenant_members (tenant_id, user_id, role) "
                        "VALUES (?,?,?)",
                        [trans, newId, orgId, tenantId, respondErr]
                        (const drogon::orm::Result&) {
                        // Step 5: Add to org as owner
                        trans->execSqlAsync(
                            "INSERT INTO org_members (org_id, user_id, role) "
                            "VALUES (?,?,?)",
                            [trans, newId, tenantId, respondErr]
                            (const drogon::orm::Result&) {
                            // Step 6: Bootstrap default visibility-group state
                            // (#218 / audit #46 L3) — uses the trans-aware
                            // overload so it commits atomically with the rest.
                            TenantBootstrap::seedDefaults(
                                trans, tenantId, newId,
                                []() { /* commit fires response */ },
                                [trans, respondErr](const std::string& msg) {
                                    respondErr("db_error", msg, drogon::k500InternalServerError);
                                    trans->rollback();
                                });
                            },
                            [trans, respondErr](const drogon::orm::DrogonDbException&) {
                                respondErr("db_error", "Failed to assign org membership",
                                       drogon::k500InternalServerError);
                                trans->rollback();
                            },
                            orgId, newId, "owner");
                        },
                        [trans, respondErr](const drogon::orm::DrogonDbException&) {
                            respondErr("db_error", "Failed to assign tenant membership",
                                   drogon::k500InternalServerError);
                            trans->rollback();
                        },
                        tenantId, newId, "admin");
                    },
                    [trans, respondErr](const drogon::orm::DrogonDbException& e) {
                        std::string err = e.base().what();
                        bool dup = err.find("Duplicate") != std::string::npos;
                        std::string code = "db_error";
                        if (dup) {
                            if (err.find("uq_users_email") != std::string::npos)
                                code = "email_taken";
                            else if (err.find("uq_users_username") != std::string::npos)
                                code = "username_taken";
                            else
                                code = "conflict";
                        }
                        respondErr(code, "Registration failed",
                               dup ? drogon::k409Conflict
                                   : drogon::k500InternalServerError);
                        trans->rollback();
                    },
                    username, email, pwHash, orgId);
                },
                [trans, respondErr](const drogon::orm::DrogonDbException&) {
                    respondErr("db_error", "Failed to create personal tenant",
                           drogon::k500InternalServerError);
                    trans->rollback();
                },
                orgId, "Personal", "personal");
            },
            [trans, respondErr](const drogon::orm::DrogonDbException& e) {
                std::string err = e.base().what();
                bool dup = err.find("Duplicate") != std::string::npos;
                respondErr(dup ? "username_taken" : "db_error",
                       "Registration failed",
                       dup ? drogon::k409Conflict
                           : drogon::k500InternalServerError);
                trans->rollback();
            },
            username, username);
    });
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
        [callback, req, email, password, this](const drogon::orm::Result& r) {
            if (r.empty()) {
                Json::Value detail; detail["email"] = email;
                AuditLog::record("login_failure", req, 0, 0, 0, detail);
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("unauthorized", "Invalid email or password"));
                resp->setStatusCode(drogon::k401Unauthorized);
                callback(resp);
                return;
            }

            std::string storedHash = r[0]["password_hash"].isNull()
                ? "" : r[0]["password_hash"].as<std::string>();

            if (!verifyPassword(password, storedHash)) {
                Json::Value detail; detail["email"] = email;
                AuditLog::record("login_failure", req, r[0]["id"].as<int>(), 0, 0, detail);
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
                [this, callback, req, userId, username, userEmail, orgId]
                (const drogon::orm::Result& r2) {
                    AuditLog::record("login_success", req, userId);
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
