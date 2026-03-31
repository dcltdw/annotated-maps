cmake_minimum_required(VERSION 3.20)
project(annotated_maps_backend VERSION 0.2.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ── Build type ────────────────────────────────────────────────────────────────
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# ── Dependencies ─────────────────────────────────────────────────────────────
find_package(Drogon REQUIRED)
find_path(JWT_CPP_INCLUDE_DIRS "jwt-cpp/jwt.h")
find_package(PkgConfig REQUIRED)
pkg_check_modules(LIBSODIUM REQUIRED libsodium)

# ── Sources ───────────────────────────────────────────────────────────────────
file(GLOB_RECURSE SOURCES
  "src/*.cpp"
  "src/controllers/*.cpp"
  "src/filters/*.cpp"
  "src/models/*.cpp"
)

add_executable(annotated_maps ${SOURCES})

target_include_directories(annotated_maps
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${JWT_CPP_INCLUDE_DIRS}
    ${LIBSODIUM_INCLUDE_DIRS}
)

# MariaDB client — needed because Drogon is linked statically
find_library(MARIADB_LIBRARY NAMES mariadb mariadbclient mysqlclient)

target_link_libraries(annotated_maps
  PRIVATE
    Drogon::Drogon
    ${LIBSODIUM_LIBRARIES}
    ${MARIADB_LIBRARY}
)

# ── Install ───────────────────────────────────────────────────────────────────
install(TARGETS annotated_maps RUNTIME DESTINATION bin)
install(FILES config.json DESTINATION etc/annotated_maps)
