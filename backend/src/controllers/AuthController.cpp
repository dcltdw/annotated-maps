#include "AuthController.h"
#include <drogon/drogon.h>
#include <jwt-cpp/jwt.h>
#include <openssl/sha.h>
#include <iomanip>
#include <sstream>
#include <chrono>

// ─── Helpers ──────────────────────────────────────────────────────────────────

static std::string sha256(const std::string& input) {
    unsigned char hash[SHA256_DIGEST_LENGTH];
    SHA256(reinterpret_cast<const unsigned char*>(input.c_str()),
           input.size(), hash);
    std::ostringstream oss;
    for (auto byte : hash)
        oss << std::hex << std::setw(2) << std::setfill('0') << (int)byte;
    return oss.str();
}

static Json::Value errorJson(const std::string& code, const std::string& msg) {
    Json::Value v;
    v["error"] = code;
    v["message"] = msg;
    return v;
}

// ─── Token issuance ───────────────────────────────────────────────────────────

std::string AuthController::issueToken(int userId,
                                       const std::string& username) const {
    const auto& cfg = drogon::app().getCustomConfig()["jwt"];
    const std::string secret  = cfg["secret"].asString();
    const std::string issuer  = cfg["issuer"].asString();
    const int         ttl     = cfg["access_token_ttl_seconds"].asInt();

    auto now = std::chrono::system_clock::now();
    return jwt::create()
        .set_issuer(issuer)
        .set_subject(std::to_string(userId))
        .set_payload_claim("username", jwt::claim(username))
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
    const std::string pwHash   = sha256((*body)["password"].asString());

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "INSERT INTO users (username, email, password_hash) VALUES (?,?,?)",
        [callback, username](const drogon::orm::Result& r) {
            // r.insertId() gives the new user's id
            int newId = static_cast<int>(r.insertId());
            Json::Value resp;
            resp["user"]["id"]       = newId;
            resp["user"]["username"] = username;
            // issueToken is non-static; re-instantiate or make it static helper
            // For simplicity we inline here
            const auto& cfg   = drogon::app().getCustomConfig()["jwt"];
            const std::string secret = cfg["secret"].asString();
            const std::string issuer = cfg["issuer"].asString();
            const int ttl = cfg["access_token_ttl_seconds"].asInt();
            auto now = std::chrono::system_clock::now();
            resp["token"] = jwt::create()
                .set_issuer(issuer)
                .set_subject(std::to_string(newId))
                .set_payload_claim("username", jwt::claim(username))
                .set_issued_at(now)
                .set_expires_at(now + std::chrono::seconds(ttl))
                .sign(jwt::algorithm::hs256{secret});

            auto httpResp = drogon::HttpResponse::newHttpJsonResponse(resp);
            httpResp->setStatusCode(drogon::k201Created);
            callback(httpResp);
        },
        [callback](const drogon::orm::DrogonDbException& e) {
            std::string err = e.base().what();
            bool duplicate  = err.find("Duplicate") != std::string::npos;
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson(duplicate ? "conflict" : "db_error",
                          duplicate ? "Email or username already exists"
                                    : "Database error"));
            resp->setStatusCode(duplicate ? drogon::k409Conflict
                                          : drogon::k500InternalServerError);
            callback(resp);
        },
        username, email, pwHash);
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

    const std::string email  = (*body)["email"].asString();
    const std::string pwHash = sha256((*body)["password"].asString());

    auto db = drogon::app().getDbClient();
    db->execSqlAsync(
        "SELECT id, username, email FROM users WHERE email=? AND password_hash=? LIMIT 1",
        [callback](const drogon::orm::Result& r) {
            if (r.empty()) {
                auto resp = drogon::HttpResponse::newHttpJsonResponse(
                    errorJson("unauthorized", "Invalid email or password"));
                resp->setStatusCode(drogon::k401Unauthorized);
                callback(resp);
                return;
            }
            int         userId   = r[0]["id"].as<int>();
            std::string username = r[0]["username"].as<std::string>();

            const auto& cfg   = drogon::app().getCustomConfig()["jwt"];
            const std::string secret = cfg["secret"].asString();
            const std::string issuer = cfg["issuer"].asString();
            const int ttl = cfg["access_token_ttl_seconds"].asInt();
            auto now = std::chrono::system_clock::now();

            Json::Value resp;
            resp["user"]["id"]       = userId;
            resp["user"]["username"] = username;
            resp["user"]["email"]    = r[0]["email"].as<std::string>();
            resp["token"] = jwt::create()
                .set_issuer(issuer)
                .set_subject(std::to_string(userId))
                .set_payload_claim("username", jwt::claim(username))
                .set_issued_at(now)
                .set_expires_at(now + std::chrono::seconds(ttl))
                .sign(jwt::algorithm::hs256{secret});

            callback(drogon::HttpResponse::newHttpJsonResponse(resp));
        },
        [callback](const drogon::orm::DrogonDbException& e) {
            (void)e;
            auto resp = drogon::HttpResponse::newHttpJsonResponse(
                errorJson("db_error", "Database error"));
            resp->setStatusCode(drogon::k500InternalServerError);
            callback(resp);
        },
        email, pwHash);
}

// ─── POST /api/v1/auth/refresh (requires JwtFilter) ──────────────────────────

void AuthController::refresh(
    const drogon::HttpRequestPtr& req,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback) {

    int         userId   = req->getAttributes()->get<int>("userId");
    std::string username = req->getAttributes()->get<std::string>("username");

    Json::Value resp;
    resp["token"] = issueToken(userId, username);
    callback(drogon::HttpResponse::newHttpJsonResponse(resp));
}

// ─── POST /api/v1/auth/logout (stateless — client drops token) ────────────────

void AuthController::logout(
    const drogon::HttpRequestPtr&,
    std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
    auto resp = drogon::HttpResponse::newHttpResponse();
    resp->setStatusCode(drogon::k204NoContent);
    callback(resp);
}
