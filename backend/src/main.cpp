#include <drogon/drogon.h>
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
    // Refuse to start with a placeholder JWT secret. A silent startup with a
    // known-bad secret allows token forgery against any account. Set
    // ALLOW_PLACEHOLDER_SECRETS=1 if you're deliberately running a dev build
    // with the placeholder for local experimentation.
    const char* envSecret  = std::getenv("JWT_SECRET");
    const char* allowPlace = std::getenv("ALLOW_PLACEHOLDER_SECRETS");
    const bool allowPlaceholder = allowPlace && std::string(allowPlace) == "1";

    if (envSecret && std::string(envSecret).size() >= 32) {
        auto& cfg = const_cast<Json::Value&>(drogon::app().getCustomConfig());
        cfg["jwt"]["secret"] = std::string(envSecret);
    } else {
        if (envSecret) {
            // Env var is set but too short — don't silently fall back to config.
            std::cerr << "FATAL: JWT_SECRET is set but shorter than 32 characters.\n";
            return 1;
        }
        const auto& secret = drogon::app().getCustomConfig()["jwt"]["secret"].asString();
        if (secret.find("CHANGE_ME") != std::string::npos) {
            if (allowPlaceholder) {
                std::cerr << "WARNING: JWT secret is a placeholder. "
                          << "Running anyway because ALLOW_PLACEHOLDER_SECRETS=1. "
                          << "DO NOT use this in production.\n";
            } else {
                std::cerr << "FATAL: JWT secret is a placeholder. "
                          << "Set JWT_SECRET environment variable (min 32 chars), "
                          << "or set ALLOW_PLACEHOLDER_SECRETS=1 for a local dev run.\n";
                return 1;
            }
        }
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

    // ── Production flag (controls HSTS emission) ─────────────────────────────
    // Set PRODUCTION=1 in production deployments. Also triggers HSTS when the
    // request is served over HTTPS (detected via X-Forwarded-Proto from the
    // trusted reverse proxy — see docs/DEVELOPER-GUIDE.md "Proxy trust").
    const char* prodEnv = std::getenv("PRODUCTION");
    const bool isProduction = prodEnv && std::string(prodEnv) == "1";

    // ── H2 + M6 + M7 + L4: Security headers + CORS ───────────────────────────
    drogon::app().registerPreSendingAdvice(
        [allowedOrigins, isProduction](const drogon::HttpRequestPtr& req,
                                       const drogon::HttpResponsePtr& resp) {
            // Baseline security headers on every response
            resp->addHeader("X-Content-Type-Options", "nosniff");
            resp->addHeader("X-Frame-Options", "DENY");
            resp->addHeader("Referrer-Policy", "strict-origin-when-cross-origin");

            // M6: Content-Security-Policy. This backend serves a JSON API;
            // `default-src 'none'` is the tightest default. The frontend
            // static files are served by Vite/nginx in a separate origin;
            // their CSP is configured there.
            resp->addHeader("Content-Security-Policy",
                            "default-src 'none'; frame-ancestors 'none'");

            // L4: Permissions-Policy — disable browser features we don't use.
            resp->addHeader("Permissions-Policy",
                            "geolocation=(), microphone=(), camera=(), usb=()");

            // M7: HSTS only when both (a) running in production, and (b) the
            // request arrived via HTTPS at the trusted proxy. Emitting HSTS
            // on HTTP responses is harmless but misleading; emitting it in
            // dev would cache the requirement on localhost and break http
            // dev access for a year.
            if (isProduction) {
                const auto& proto = req->getHeader("X-Forwarded-Proto");
                if (proto == "https") {
                    resp->addHeader("Strict-Transport-Security",
                                    "max-age=31536000; includeSubDomains");
                }
            }

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
