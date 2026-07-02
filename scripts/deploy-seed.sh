#!/usr/bin/env bash
# Complete first-run setup (if needed) on the deploy artifact stack and seed the
# M25 Agentic Airlines scenario into it. Companion to `make deploy-up`:
#
#   make deploy-up && make deploy-seed
#
# Env (all optional):
#   LOTUS_APP_PORT   published app port            (default 3101)
#   ADMIN_USER       platform admin to create/use  (default alice)
#   ADMIN_PASSWORD   admin password                (default password123)
#   ORG_NAME         first-run org name            (default "Sunkur AI")
#   DOMAIN_NAME      first-run domain              (default sunkur.ai)
set -euo pipefail

PORT="${LOTUS_APP_PORT:-3101}"
ADMIN_USER="${ADMIN_USER:-alice}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-password123}"
ORG_NAME="${ORG_NAME:-Sunkur AI}"
DOMAIN_NAME="${DOMAIN_NAME:-sunkur.ai}"

# Published container ports are not always reachable via localhost (IPv6-first
# resolution, sandboxed loopback) — probe the usual suspects, bridge IP last.
# Freshly-started containers take a moment to listen, so keep probing for a while.
API_URL=""
for _ in $(seq 1 30); do
  for host in localhost 127.0.0.1 172.17.0.1; do
    if curl -sf --max-time 2 "http://$host:$PORT/api/health" >/dev/null 2>&1; then
      API_URL="http://$host:$PORT"
      break 2
    fi
  done
  sleep 2
done
if [ -z "$API_URL" ]; then
  echo "App is not reachable on port $PORT (tried localhost, 127.0.0.1, 172.17.0.1 for 60s)." >&2
  echo "Start the stack first: make deploy-up" >&2
  exit 1
fi
echo "Target: $API_URL"

# Health is cheap liveness; wait for full readiness (CouchDB pair + auto-install).
for _ in $(seq 1 30); do
  curl -sf --max-time 2 "$API_URL/api/ready" >/dev/null 2>&1 && break
  sleep 2
done

state=$(curl -sf --max-time 5 "$API_URL/api/platform/state")
if echo "$state" | grep -q '"setupComplete":false'; then
  echo "Completing first-run setup (org: $ORG_NAME, admin: $ADMIN_USER)…"
  setup=$(curl -sf -X POST "$API_URL/api/platform/setup" -H "content-type: application/json" \
    -d "{\"orgName\":\"$ORG_NAME\",\"domainName\":\"$DOMAIN_NAME\",\"adminUser\":\"$ADMIN_USER\",\"adminPassword\":\"$ADMIN_PASSWORD\",\"confirmPassword\":\"$ADMIN_PASSWORD\"}")
  echo "$setup" | grep -q '"setupComplete":true' || { echo "Setup failed: $setup" >&2; exit 1; }
else
  echo "Setup already complete — seeding with ADMIN_USER=$ADMIN_USER (override if this instance uses another admin)."
fi

if echo "$state" | grep -q '"appId":"org"' && echo "$state" | grep -q '"appId":"leave-request"'; then
  echo "Agentic Airlines is already seeded here (org + leave-request apps installed). Nothing to do."
  exit 0
fi

API_URL="$API_URL" ADMIN_USER="$ADMIN_USER" ADMIN_PASSWORD="$ADMIN_PASSWORD" npm run seed:airline
