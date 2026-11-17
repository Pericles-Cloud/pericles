#!/bin/sh
# Container entry point for every service built from this image.
#
# APP_ENTRY selects the program (unset = the API server). The global monitoring
# worker sets APP_ENTRY=src/monitoring/global-start.ts (see DEPLOYMENT.md).
#
# Migrations: the API server runs them (or any service with
# RUN_MIGRATIONS=true). Every other service waits until `prisma migrate status`
# reports the schema up to date, so it never runs new code against an
# unmigrated database, and two services never migrate at once (Prisma's
# migrate lock times out after 10s).
#
# The program is exec'd as `node --import tsx`, so Node is PID 1 and receives
# SIGTERM directly; each program decides what SIGTERM does (the worker drains,
# the API server keeps serving until the stop timeout).
set -eu

API_ENTRY="src/server/auth-server.ts"
ENTRY="${APP_ENTRY:-$API_ENTRY}"
if [ ! -f "$ENTRY" ]; then
  echo "docker-entrypoint: APP_ENTRY file not found: '$ENTRY'" >&2
  exit 1
fi

if [ "$ENTRY" = "$API_ENTRY" ] || [ "${RUN_MIGRATIONS:-}" = "true" ]; then
  npx prisma migrate deploy
else
  waited=0
  limit="${MIGRATION_WAIT_SECONDS:-300}"
  until npx prisma migrate status >/dev/null 2>&1; do
    if [ "$waited" -ge "$limit" ]; then
      echo "docker-entrypoint: schema still not up to date after ${limit}s; exiting so the platform retries" >&2
      exit 1
    fi
    echo "docker-entrypoint: waiting for migrations (${waited}s)..."
    sleep 5
    waited=$((waited + 5))
  done
fi

exec node --import tsx "$ENTRY"
