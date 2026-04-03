echo "Rebuilding..."
docker compose build --no-cache backend && docker compose up -d
