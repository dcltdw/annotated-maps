# ── Build stage ─────────────────────────────────────────────────────────────
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    build-essential cmake git pkg-config \
    libjsoncpp-dev uuid-dev zlib1g-dev libssl-dev \
    libmysqlclient-dev \
    libsodium-dev \
    libbrotli-dev \
    && rm -rf /var/lib/apt/lists/*

# Build Drogon from source (pin to a stable release)
ARG DROGON_VERSION=v1.9.3
RUN git clone --depth 1 --branch ${DROGON_VERSION} \
    https://github.com/drogonframework/drogon.git /tmp/drogon \
    && cd /tmp/drogon \
    && git submodule update --init \
    && cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_EXAMPLES=OFF \
    && cmake --build build -j$(nproc) \
    && cmake --install build \
    && rm -rf /tmp/drogon

# Install jwt-cpp (header-only)
RUN git clone --depth 1 https://github.com/Thalhammer/jwt-cpp.git /tmp/jwt-cpp \
    && cmake -B /tmp/jwt-cpp/build /tmp/jwt-cpp -DCMAKE_BUILD_TYPE=Release \
    && cmake --install /tmp/jwt-cpp/build \
    && rm -rf /tmp/jwt-cpp

WORKDIR /src
COPY . .

RUN cmake -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build -j$(nproc)

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM ubuntu:22.04 AS runtime

RUN apt-get update && apt-get install -y \
    libssl3 libjsoncpp25 libmysqlclient21 libsodium23 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /src/build/annotated_maps .
COPY config.json .

RUN mkdir -p uploads logs

EXPOSE 8080
CMD ["./annotated_maps", "config.json"]
