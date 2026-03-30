#pragma once
#include <drogon/HttpFilter.h>

/**
 * RateLimitFilter
 *
 * Sliding-window rate limiter keyed by client IP.
 * Applied to auth endpoints to prevent brute-force attacks.
 *
 * Configuration (in config.json custom config):
 *   "rate_limit": {
 *       "max_requests": 10,      // requests allowed per window
 *       "window_seconds": 60     // window duration
 *   }
 *
 * Returns HTTP 429 with Retry-After header when the limit is exceeded.
 */
class RateLimitFilter : public drogon::HttpFilter<RateLimitFilter> {
public:
    void doFilter(const drogon::HttpRequestPtr& req,
                  drogon::FilterCallback&&      failCb,
                  drogon::FilterChainCallback&& nextCb) override;
};
