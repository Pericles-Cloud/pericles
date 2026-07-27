#!/usr/bin/env bash
# coolify.sh — thin wrapper over the Coolify REST API for deploy workflows.
# Requires: curl, jq. Config via env: COOLIFY_URL, COOLIFY_API_TOKEN.
set -euo pipefail

: "${COOLIFY_URL:?Set COOLIFY_URL, e.g. https://coolify.example.com (no trailing slash)}"
: "${COOLIFY_API_TOKEN:?Set COOLIFY_API_TOKEN (Coolify UI -> Keys & Tokens -> API tokens)}"

BASE="${COOLIFY_URL%/}/api/v1"
AUTH=(-H "Authorization: Bearer ${COOLIFY_API_TOKEN}" -H "Accept: application/json")

api() { # api METHOD PATH [extra curl args...]
  local method="$1" path="$2"; shift 2
  local out http
  out=$(curl -sS -X "$method" "${BASE}${path}" "${AUTH[@]}" -w $'\n%{http_code}' "$@")
  http="${out##*$'\n'}"
  body="${out%$'\n'*}"
  if [[ "$http" -ge 400 ]]; then
    echo "HTTP $http from $method $path" >&2
    echo "$body" | jq . 2>/dev/null >&2 || echo "$body" >&2
    if [[ "$http" == "403" ]]; then
      echo "Hint: 403 lists the token permissions you're missing (read/write/deploy)." >&2
    elif [[ "$http" == "401" ]]; then
      echo "Hint: token invalid or expired. Recreate under Keys & Tokens." >&2
    elif [[ "$http" == "404" ]]; then
      echo "Hint: wrong UUID, or the resource belongs to a different team than this token." >&2
    fi
    return 1
  fi
  echo "$body"
}

cmd="${1:-help}"; shift || true

case "$cmd" in
  check)
    ver=$(api GET /version | tr -d '"')
    team=$(api GET /teams/current | jq -r '.name // .id')
    echo "OK — Coolify ${ver}, token bound to team: ${team}"
    ;;

  apps)
    api GET /applications | jq -r '.[] | [.uuid, .status // "-", .name, (.fqdn // "-")] | @tsv' \
      | column -t -s$'\t'
    ;;

  app)
    uuid="${1:?usage: coolify.sh app <uuid>}"
    api GET "/applications/${uuid}" | jq '{uuid, name, fqdn, status, git_repository, git_branch, build_pack, server: (.destination.server.name // null)}'
    ;;

  deploy)
    uuid="${1:?usage: coolify.sh deploy <uuid|uuid1,uuid2> [--force]}"
    q="uuid=${uuid}"
    # IMPORTANT: only append force when truly forcing — some Coolify versions
    # treat any present force param (even force=false) as a force rebuild.
    [[ "${2:-}" == "--force" ]] && q="${q}&force=true"
    api POST "/deploy?${q}" | jq -r '.deployments[] | "queued: \(.message // "-")  resource=\(.resource_uuid)  deployment_uuid=\(.deployment_uuid)"'
    ;;

  deploy-tag)
    tag="${1:?usage: coolify.sh deploy-tag <tag|tag1,tag2> [--force]}"
    q="tag=${tag}"
    [[ "${2:-}" == "--force" ]] && q="${q}&force=true"
    api POST "/deploy?${q}" | jq -r '.deployments[] | "queued: \(.message // "-")  resource=\(.resource_uuid)  deployment_uuid=\(.deployment_uuid)"'
    ;;

  watch)
    duuid="${1:?usage: coolify.sh watch <deployment_uuid>}"
    interval="${2:-5}"
    echo "Watching deployment ${duuid} (poll ${interval}s)..."
    while true; do
      d=$(api GET "/deployments/${duuid}")
      status=$(echo "$d" | jq -r '.status // "unknown"')
      printf '%s  status=%s\n' "$(date +%H:%M:%S)" "$status"
      case "$status" in
        finished) echo "Deployment succeeded."; exit 0 ;;
        failed|cancelled*|"cancelled-by-user")
          echo "Deployment ended: ${status}. Last log lines:" >&2
          echo "$d" | jq -r '.logs // empty' | tail -n 40 >&2
          exit 1 ;;
      esac
      sleep "$interval"
    done
    ;;

  deployments)
    if [[ -n "${1:-}" ]]; then
      api GET "/deployments/applications/${1}?take=${2:-10}" \
        | jq -r '.[] | [.deployment_uuid, .status, (.created_at // "-"), (.commit // "-")[0:10]] | @tsv' \
        | column -t -s$'\t'
    else
      api GET /deployments | jq -r 'if length==0 then "no running deployments" else .[] | [.deployment_uuid, .status, .application_name // "-"] | @tsv end' \
        | column -t -s$'\t'
    fi
    ;;

  logs)
    duuid="${1:?usage: coolify.sh logs <deployment_uuid>}"
    api GET "/deployments/${duuid}" | jq -r '.logs // "no logs on this deployment record"'
    ;;

  cancel)
    duuid="${1:?usage: coolify.sh cancel <deployment_uuid>}"
    api POST "/deployments/${duuid}/cancel" | jq -r '.message // "cancel requested"'
    ;;

  servers)
    api GET /servers | jq -r '.[] | [.uuid, .name, .ip, (if (.settings.is_build_server // .is_build_server // false) then "BUILD" else "app" end)] | @tsv' \
      | column -t -s$'\t'
    ;;

  envs)
    uuid="${1:?usage: coolify.sh envs <app_uuid>}"
    # keys only by default — values stay masked unless --values is passed
    if [[ "${2:-}" == "--values" ]]; then
      api GET "/applications/${uuid}/envs" | jq -r '.[] | [.key, .value, (if .is_build_time then "build" else "runtime" end)] | @tsv' | column -t -s$'\t'
    else
      api GET "/applications/${uuid}/envs" | jq -r '.[] | [.key, "********", (if .is_build_time then "build" else "runtime" end)] | @tsv' | column -t -s$'\t'
    fi
    ;;

  tasks)
    uuid="${1:?usage: coolify.sh tasks <app_uuid>}"
    api GET "/applications/${uuid}/scheduled-tasks" \
      | jq -r 'if length==0 then "no scheduled tasks" else .[] | [.uuid, .frequency, (if .enabled then "enabled" else "DISABLED" end), .name, .command] | @tsv end' \
      | column -t -s$'\t'
    ;;

  task-add)
    uuid="${1:?usage: coolify.sh task-add <app_uuid> <name> <cron> <command...>}"
    name="${2:?missing <name>}"
    freq="${3:?missing <cron>, e.g. '*/5 * * * *'}"
    shift 3
    cmd="${*:?missing <command>}"
    # The command runs INSIDE the app container — it must resolve against the
    # image WORKDIR and use only what the image installs.
    api POST "/applications/${uuid}/scheduled-tasks" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg n "$name" --arg c "$cmd" --arg f "$freq" '{name:$n, command:$c, frequency:$f}')" \
      | jq -r '"created: \(.name)  uuid=\(.uuid)  frequency=\(.frequency)  timeout=\(.timeout)s"'
    ;;

  task-rm)
    uuid="${1:?usage: coolify.sh task-rm <app_uuid> <task_uuid>}"
    tuuid="${2:?missing <task_uuid>}"
    api DELETE "/applications/${uuid}/scheduled-tasks/${tuuid}" | jq -r '.message // "deleted"'
    ;;

  help|*)
    cat <<'EOF'
Usage: coolify.sh <command>
  check                          verify connectivity, token, team
  apps                           list applications
  app <uuid>                     application details
  deploy <uuid[,uuid]> [--force] queue deployment(s); omit --force to use cache
  deploy-tag <tag> [--force]     deploy all resources with tag
  watch <deployment_uuid> [sec]  poll status until finished/failed
  deployments [app_uuid] [take]  running deployments, or history for an app
  logs <deployment_uuid>         deployment build/deploy logs
  cancel <deployment_uuid>       cancel an in-progress deployment
  servers                        list servers (build server marked BUILD)
  envs <app_uuid> [--values]     list env vars (values masked by default)
  tasks <app_uuid>               list scheduled (cron) tasks
  task-add <app_uuid> <name> <cron> <command...>
                                 add a scheduled task (runs in the container)
  task-rm <app_uuid> <task_uuid> delete a scheduled task
Env: COOLIFY_URL, COOLIFY_API_TOKEN
EOF
    ;;
esac
