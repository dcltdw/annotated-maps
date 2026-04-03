echo "\n\n**************** Stopping the stack...\n"
docker compose down -v
echo "\n\n**************** Rebuilding...\n"
docker compose up --build
echo "\n\n**************** Seeding datbaase...\n"
python3 database/seed-local-dev.py
echo "done."
