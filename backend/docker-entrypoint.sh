#!/bin/sh
# Container entry point for every service built from this image.
#
# APP_ENTRY selects the program (unset = the API server). The global monitoring
# worker sets APP_ENTRY=src/monitoring/global-start.ts (see DEPLOYMENT.md).
#
# Migrations run only for the API server (APP_ENTRY unset), or when
# RUN_MIGRATIONS=true: two services migrating the same database at once can
# time out on Prisma's migrate lock and crash-loop one of them.
#
# The program is exec'd as `node --import tsx`, so Node itself is PID 1 and
# receives SIGTERM directly. A program that installs a SIGTERM handler (the
# worker) drains gracefully; one that does not (the API server) ignores it as
# PID 1, exactly as when `sh` was PID 1, until the stop timeout.
set -eu

ENTRY="${APP_ENTRY:-src/server/auth-server.ts}"
if [ ! -f "$ENTRY" ]; then
  echo "docker-entrypoint: APP_ENTRY file not found: '$ENTRY'" >&2
  exit 1
fi

if [ -z "${APP_ENTRY:-}" ] || [ "${RUN_MIGRATIONS:-}" = "true" ]; then
  npx prisma migrate deploy
fi

exec node --import tsx "$ENTRY"
