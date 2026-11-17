#!/bin/sh
# Container entry point for every service built from this image.
#
# APP_ENTRY selects the program (unset = the API server). The global monitoring
# worker sets APP_ENTRY=src/monitoring/global-start.ts; the per-org worker sets
# APP_ENTRY=src/monitoring/start.ts and APP_ARGS=--organization-id=<uuid>
# (APP_ARGS is split on whitespace). See DEPLOYMENT.md.
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
# Set but empty is a configuration mistake (e.g. a blank Coolify env var), not
# "the API server": failing loudly beats a silent second API that migrates.
if [ "${APP_ENTRY+set}" = "set" ] && [ -z "$APP_ENTRY" ]; then
  echo "docker-entrypoint: APP_ENTRY is set but empty; unset it for the API server" >&2
  exit 1
fi
ENTRY="${APP_ENTRY:-$API_ENTRY}"
if [ ! -f "$ENTRY" ]; then
  echo "docker-entrypoint: APP_ENTRY file not found: '$ENTRY'" >&2
  exit 1
fi

# Compare resolved paths, so ./src/... or /app/src/... still count as the API.
if [ "$(realpath "$ENTRY")" = "$(realpath "$API_ENTRY")" ]; then
  npx prisma migrate deploy
else
  # PID 1 is still sh here and would ignore SIGTERM for the whole wait: stop
  # promptly instead. (Not done for `migrate deploy` above: interrupting a
  # migration can leave it half-applied.)
  trap 'exit 143' TERM INT
  node --import tsx src/scripts/wait-for-migrations.ts &
  wait $!
  trap - TERM INT
fi

# shellcheck disable=SC2086 # APP_ARGS is deliberately split into arguments
exec node --import tsx "$ENTRY" ${APP_ARGS:-}
