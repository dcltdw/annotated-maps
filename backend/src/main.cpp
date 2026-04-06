// Test: broken C++ for CI compile-check verification
#include <drogon/drogon.h>
THIS_IS_NOT_VALID_CPP;
#include <sodium.h>
#include <iostream>
#include <set>
#include <string>
#include <cstdlib>

int main(int argc, char* argv[]) {
    // Initialize libsodium (required before any Argon2id password hashing)
    if (sodium_init() < 0) {
        std::cerr << "FATAL: libsodium initialization failed\n";
        return 1;
    }

    std::string configPath = "config.json";
    if (argc > 1) configPath = argv[1];

    // Load Drogon config (listeners, DB, etc.)
    drogon::app().loadConfigFile(configPath);

    // ── C2 fix: Override JWT secret from environment variable if set ─────────
    const char* envSecret = std::getenv("JWT_SECRET");
    if (envSecret && std::string(envSecret).size() >= 32) {
        auto& cfg = const_cast<Json::Value&>(drogon::app().getCustomConfig());
        cfg["jwt"]["secret"] = std::string(envSecret);
    } else if (!envSecret) {
        // Warn if using the config file default (which may be a placeholder)
        const auto& secret = drogon::app().getCustomConfig()["jwt"]["secret"].asString();
        if (secret.find("CHANGE_ME") != std::string::npos) {
            std::cerr << "WARNING: JWT secret is a placeholder. "
                      << "Set JWT_SECRET environment variable (min 32 chars) "
                      << "before production use.\n";
        }
    } else {
        std::cerr << "WARNING: JWT_SECRET is set but shorter than 32 characters. "
                  << "Using config file value.\n";
    }

    // ── M5 fix: Validate frontend_url at startup ─────────────────────────────
    const auto& frontendUrl = drogon::app().getCustomConfig()
                                  .get("frontend_url", "").asString();
    if (!frontendUrl.empty() &&
        frontendUrl.substr(0, 8) != "https://" &&
        frontendUrl.substr(0, 16) != "http://localhost" &&
        frontendUrl.substr(0, 14) != "http://127.0.0") {
        std::cerr << "WARNING: frontend_url (" << frontendUrl
                  << ") is not HTTPS and not localhost. "
                  << "SSO redirects may be insecure.\n";
    }

    // ── C1 fix: CORS with origin whitelist ───────────────────────────────────
    // Build allowed origins set from config
    std::set<std::string> allowedOrigins;
    const auto& originsConfig = drogon::app().getCustomConfig()["allowed_origins"];
    if (originsConfig.isArray()) {
        for (const auto& o : originsConfig)
            allowedOrigins.insert(o.asString());
    }
    // Always allow the configured frontend_url
    if (!frontendUrl.empty())
        allowedOrigins.insert(frontendUrl);
    // Default: allow localhost dev origins if no explicit config
    if (allowedOrigins.empty()) {
        allowedOrigins.insert("http://localhost:5173");
        allowedOrigins.insert("http://localhost:8080");
    }

    // ── H2 fix: Security headers + CORS ──────────────────────────────────────
    drogon::app().registerPreSendingAdvice(
        [allowedOrigins](const drogon::HttpRequestPtr& req,
                         const drogon::HttpResponsePtr& resp) {
            // Security headers
            resp->addHeader("X-Content-Type-Options", "nosniff");
            resp->addHeader("X-Frame-Options", "DENY");
            resp->addHeader("Referrer-Policy", "strict-origin-when-cross-origin");

            // CORS — only allow whitelisted origins
            const auto& origin = req->getHeader("Origin");
            if (!origin.empty() && allowedOrigins.count(origin) > 0) {
                resp->addHeader("Access-Control-Allow-Origin", origin);
                resp->addHeader("Access-Control-Allow-Credentials", "true");
                resp->addHeader("Access-Control-Allow-Methods",
                                "GET,POST,PUT,DELETE,OPTIONS");
                resp->addHeader("Access-Control-Allow-Headers",
                                "Content-Type,Authorization");
            }
        });

    // Handle preflight OPTIONS globally
    drogon::app().registerHandler(
        "/{path}",
        [](const drogon::HttpRequestPtr& req,
           std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
            if (req->method() == drogon::Options) {
                auto resp = drogon::HttpResponse::newHttpResponse();
                resp->setStatusCode(drogon::k204NoContent);
                callback(resp);
            }
        },
        {drogon::Options});

    std::cout << "Annotated Maps backend starting on port 8080…\n";
    drogon::app().run();
    return 0;
}
