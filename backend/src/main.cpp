#include <drogon/drogon.h>
#include <iostream>

int main(int argc, char* argv[]) {
    std::string configPath = "config.json";
    if (argc > 1) configPath = argv[1];

    // Load Drogon config (listeners, DB, etc.)
    drogon::app().loadConfigFile(configPath);

    // Enable CORS for development (tighten in production)
    drogon::app().registerPreSendingAdvice(
        [](const drogon::HttpRequestPtr& req,
           const drogon::HttpResponsePtr& resp) {
            const auto& origin = req->getHeader("Origin");
            if (!origin.empty()) {
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
