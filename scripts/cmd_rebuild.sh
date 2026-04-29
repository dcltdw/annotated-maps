# Run from the repo root so `docker compose` finds docker-compose.yml.
cd "$(git rev-parse --show-toplevel)"

echo "Rebuilding..."
docker compose build --no-cache backend && docker compose up -d
