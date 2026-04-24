#include "RateLimitFilter.h"
#include <drogon/drogon.h>
#include <chrono>
#include <deque>
#include <mutex>
#include <unordered_map>
#include <string>

static std::mutex                  sMutex;
static std::unordered_map<std::string,
           std::deque<std::chrono::steady_clock::time_point>> sWindows;
static uint64_t sCallCount = 0;

static std::string clientIp(const drogon::HttpRequestPtr& req) {
    // X-Forwarded-For is honored, but only trust it if the deployment
    // sits behind a reverse proxy that strips client-supplied XFF.
    // See docs/DEVELOPER-GUIDE.md "Proxy trust".
    const std::string& xff = req->getHeader("X-Forwarded-For");
    if (!xff.empty()) {
        auto comma = xff.find(',');
        return comma != std::string::npos ? xff.substr(0, comma) : xff;
    }
    return req->getPeerAddr().toIp();
}

// M10: when JwtFilter has run upstream, key the rate window by user ID.
// Authenticated abuse from a single account is what we're guarding against
// on content endpoints; IP-keying would let one user wedge other users
// behind the same NAT.
static std::string rateKey(const drogon::HttpRequestPtr& req) {
    try {
        int userId = req->getAttributes()->get<int>("userId");
        if (userId > 0) return "user:" + std::to_string(userId);
    } catch (...) {}
    return "ip:" + clientIp(req);
}

void RateLimitFilter::doFilter(const drogon::HttpRequestPtr& req,
                               drogon::FilterCallback&&      failCb,
                               drogon::FilterChainCallback&& nextCb) {
    const auto& cfg = drogon::app().getCustomConfig()["rate_limit"];
    int maxReqs     = cfg.get("max_requests",   10).asInt();
    int windowSecs  = cfg.get("window_seconds",  60).asInt();

    std::string key = rateKey(req);
    auto now        = std::chrono::steady_clock::now();
    auto cutoff     = now - std::chrono::seconds(windowSecs);

    std::lock_guard<std::mutex> lock(sMutex);

    auto& dq = sWindows[key];

    // Trim timestamps outside the window
    while (!dq.empty() && dq.front() < cutoff)
        dq.pop_front();

    if (static_cast<int>(dq.size()) >= maxReqs) {
        Json::Value body;
        body["error"]   = "rate_limited";
        body["message"] = "Too many requests. Try again later.";
        auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
        resp->setStatusCode(drogon::k429TooManyRequests);
        resp->addHeader("Retry-After", std::to_string(windowSecs));
        failCb(resp);
        return;
    }

    dq.push_back(now);

    // Periodic sweep: every 100 requests, remove IPs with empty deques
    if (++sCallCount % 100 == 0) {
        for (auto it = sWindows.begin(); it != sWindows.end();) {
            if (it->second.empty()) it = sWindows.erase(it);
            else ++it;
        }
    }

    nextCb();
}
