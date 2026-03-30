#!/usr/bin/env bash
# seed-local-dev.sh
#
# Registers test users via the running backend (to get real Argon2id hashes),
# then applies the SQL seed to set up orgs, tenants, and memberships.
#
# Prerequisites: the Docker Compose stack must be running (docker compose up).
#
# Usage:
#   ./database/seed-local-dev.sh

set -euo pipefail

API="http://localhost:8080/api/v1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Registering test users via the API..."
for entry in "alice alice@acme.test" "bob bob@acme.test" "carol carol@acme.test" \
             "dan dan@beta.test" "eve eve@beta.test"; do
    set -- $entry
    username="$1"
    email="$2"
    printf "  %-20s " "$email"
    status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/register" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$username\",\"email\":\"$email\",\"password\":\"password\"}")
    case "$status" in
        201) echo "registered" ;;
        409) echo "already exists (ok)" ;;
        *)   echo "HTTP $status (unexpected)" ;;
    esac
done

echo ""
echo "==> Applying org/tenant seed SQL..."
docker compose exec -T mysql mysql -uroot -prootpassword annotated_maps \
    < "$SCRIPT_DIR/seed-local-dev.sql"

echo ""
echo "==> Done. Test accounts:"
echo "    alice@acme.test / password  (Acme: Engineering=admin, Sales=viewer)"
echo "    bob@acme.test   / password  (Acme: Engineering=editor, Support=admin)"
echo "    carol@acme.test / password  (Acme: Sales=admin)"
echo "    dan@beta.test   / password  (Beta: Engineering=admin, Marketing=editor)"
echo "    eve@beta.test   / password  (Beta: Marketing=admin, Operations=viewer)"
echo ""
echo "    Open http://localhost:5173 and log in."
