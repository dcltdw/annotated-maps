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
    const std::string& xff = req->getHeader("X-Forwarded-For");
    if (!xff.empty()) {
        auto comma = xff.find(',');
        return comma != std::string::npos ? xff.substr(0, comma) : xff;
    }
    return req->getPeerAddr().toIp();
}

void RateLimitFilter::doFilter(const drogon::HttpRequestPtr& req,
                               drogon::FilterCallback&&      failCb,
                               drogon::FilterChainCallback&& nextCb) {
    const auto& cfg = drogon::app().getCustomConfig()["rate_limit"];
    int maxReqs     = cfg.get("max_requests",   10).asInt();
    int windowSecs  = cfg.get("window_seconds",  60).asInt();

    std::string ip = clientIp(req);
    auto now       = std::chrono::steady_clock::now();
    auto cutoff    = now - std::chrono::seconds(windowSecs);

    std::lock_guard<std::mutex> lock(sMutex);

    auto& dq = sWindows[ip];

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
