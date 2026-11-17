#!/bin/sh
# Container entry point for every service built from this image.
#
# APP_ENTRY selects the program (unset = the API server). The global monitoring
# worker sets APP_ENTRY=src/monitoring/global-start.ts (see DEPLOYMENT.md).
#
# Migrations: only the API server runs them. Every other service waits until
# all migrations shipped in this image are applied (wait-for-migrations.ts),
# so it never runs new code against an unmigrated database and two services
# never migrate at once (Prisma's migrate lock times out after 10s).
#
# The program is exec'd as `node --import tsx`, so Node is PID 1 and receives
# SIGTERM directly. The worker installs a handler and drains; the API server
# installs none and, as PID 1, ignores it until the stop timeout (as before).
set -eu

API_ENTRY="src/server/auth-server.ts"
ENTRY="${APP_ENTRY:-$API_ENTRY}"
if [ ! -f "$ENTRY" ]; then
  echo "docker-entrypoint: APP_ENTRY file not found: '$ENTRY'" >&2
  exit 1
fi

# Compare resolved paths, so ./src/... or /app/src/... still count as the API.
if [ "$(realpath "$ENTRY")" = "$(realpath "$API_ENTRY")" ]; then
  npx prisma migrate deploy
else
  node --import tsx src/scripts/wait-for-migrations.ts
fi

exec node --import tsx "$ENTRY"
